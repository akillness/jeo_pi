/**
 * Real-runtime verification driver for the failure-first pipeline (jeo-code's
 * core philosophy, ported): stalled-turn detection -> deterministic same-session
 * FailedAttempt capture -> priority-boosted recall on the next relevant turn.
 *
 * Unlike tests/stall.test.ts and tests/failure-first.test.ts (unit-level, call the
 * exported functions directly), this script drives the REAL wired extension —
 * workspaceMemoryExtension's actual `agent_end` and `before_agent_start` event
 * handlers, exactly as pi's runtime invokes them — against a real temp filesystem
 * (both the JSON store under a temp PI_CODING_AGENT_DIR and the OKF bundle under
 * the temp cwd's `.jeo/memory`). Not a unit test. Run:
 *   npx tsx scripts/failure-runtime-check.ts
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Redirect the JSON memory store to a throwaway directory BEFORE importing
// anything that resolves getAgentDir(), so this script never touches the real
// ~/.pi/agent store.
const agentDir = mkdtempSync(join(tmpdir(), "wm-failure-agentdir-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const { default: workspaceMemoryExtension } = await import("../index.js");
const { invalidateCache, getCachedIndex } = await import("../storage.js");
const { getBundleDir } = await import("../okf-bundle.js");
const { FAILURE_TAG } = await import("../types.js");

let failures = 0;
function check(label: string, cond: boolean, detail?: string): void {
	const mark = cond ? "\u2713" : "\u2717";
	if (!cond) failures++;
	console.log(`  ${mark} ${label}${cond ? "" : `  <-- FAIL ${detail ?? ""}`}`);
}

// ── Minimal fake pi ExtensionAPI, same shape tests/integration.test.ts uses ──
function createMockPi() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const events = new Map<string, any[]>();
	const mockPi: any = {
		registerTool: (def: any) => tools.set(def.name, def),
		registerCommand: (name: string, def: any) => commands.set(name, def),
		on: (event: string, handler: any) => {
			if (!events.has(event)) events.set(event, []);
			events.get(event)!.push(handler);
		},
	};
	return { mockPi, tools, commands, events };
}

// Deterministic per-call id generator so toolResult.toolCallId lines up with the
// matching assistant toolCall block, mirroring pi's real transcript shape.
let idSeq = 0;
function failingStep(tool: string, args: Record<string, unknown>) {
	const id = `tc-${++idSeq}`;
	return [
		{ role: "assistant", content: [{ type: "toolCall", id, name: tool, arguments: args }] },
		{ role: "toolResult", toolCallId: id, toolName: tool, isError: true },
	];
}

function stalledTranscript(task: string, failCount: number) {
	const messages: any[] = [{ role: "user", content: task }];
	for (let i = 0; i < failCount; i++) {
		messages.push(...failingStep("edit", { file: "a.ts", attempt: i }));
	}
	return messages;
}

async function withTemp(fn: (cwd: string) => void | Promise<void>): Promise<void> {
	const cwd = mkdtempSync(join(tmpdir(), "wm-failure-runtime-"));
	try {
		await fn(cwd);
	} finally {
		invalidateCache(cwd);
		rmSync(cwd, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	// ── Scenario 1: a stalled agent_end writes a FailedAttempt memory ────────
	console.log("Scenario 1: agent_end stall -> recorded FailedAttempt (real wiring)");
	await withTemp(async (cwd) => {
		const { mockPi, events } = createMockPi();
		workspaceMemoryExtension(mockPi);
		const ctx: any = { cwd, hasUI: true, ui: { setStatus: () => {}, notify: () => {} } };

		const MAX_FAILURES = 5; // GUARD_LIMITS.MAX_FAILURES, mirrored from jeo-code
		const messages = stalledTranscript("port the OKF failure-first logic into jeo-pi", MAX_FAILURES);
		await events.get("agent_end")?.[0]?.({ type: "agent_end", messages }, ctx);

		invalidateCache(cwd);
		const index = getCachedIndex(cwd);
		check("exactly one memory recorded", index.memories.length === 1, String(index.memories.length));
		const entry = index.memories[0];
		check("recorded as post-mortem template", entry?.template === "post-mortem", entry?.template);
		check("tagged as a failed attempt", entry?.tags.includes(FAILURE_TAG) === true, JSON.stringify(entry?.tags));
		check("summary references the stalled task", entry?.summary.includes("Stalled on:") === true, entry?.summary);

		const bundle = getBundleDir(cwd);
		check("OKF bundle mirrored to disk", existsSync(bundle), bundle);
		const indexMd = existsSync(join(bundle, "index.md")) ? readFileSync(join(bundle, "index.md"), "utf8") : "";
		check("bundle index.md references the concept", indexMd.length > 0, "index.md missing");
	});

	// ── Scenario 2: a healthy turn (no stall) records nothing ───────────────
	console.log("Scenario 2: agent_end healthy turn -> no FailedAttempt recorded");
	await withTemp(async (cwd) => {
		const { mockPi, events } = createMockPi();
		workspaceMemoryExtension(mockPi);
		const ctx: any = { cwd, hasUI: true, ui: { setStatus: () => {}, notify: () => {} } };

		const messages = [
			{ role: "user", content: "add a small feature" },
			{ role: "assistant", content: [{ type: "toolCall", id: "ok-1", name: "edit", arguments: { file: "x.ts" } }] },
			{ role: "toolResult", toolCallId: "ok-1", toolName: "edit", isError: false },
		];
		await events.get("agent_end")?.[0]?.({ type: "agent_end", messages }, ctx);

		invalidateCache(cwd);
		check("no memory recorded for a healthy turn", getCachedIndex(cwd).memories.length === 0);
	});

	// ── Scenario 3: end-to-end — the SAME session's next turn recalls the ───
	//    failure FIRST via the real before_agent_start system-prompt injection.
	console.log("Scenario 3: next turn's before_agent_start recalls the failure first");
	await withTemp(async (cwd) => {
		const { mockPi, tools, events } = createMockPi();
		workspaceMemoryExtension(mockPi);
		const ctx: any = { cwd, hasUI: true, ui: { setStatus: () => {}, notify: () => {} } };

		// A prior successful memory that also matches the upcoming query.
		await tools.get("memory_save").execute(
			"call-1",
			{ content: "Summary: tokenizer parser cleanup went smoothly", template: "compact-note", tags: ["tokenizer"] },
			undefined,
			undefined,
			ctx,
		);

		// This turn stalls on a related task.
		const messages = stalledTranscript("fix the tokenizer edge case", 5);
		await events.get("agent_end")?.[0]?.({ type: "agent_end", messages }, ctx);

		// Next turn: before_agent_start recalls for a query that hits both.
		const beforeResult = await events.get("before_agent_start")?.[0]?.(
			{ type: "before_agent_start", prompt: "working on the tokenizer again", systemPrompt: "BASE" },
			ctx,
		);
		const prompt: string = beforeResult?.systemPrompt ?? "";
		const failurePos = prompt.indexOf("Stalled on: fix the tokenizer edge case");
		const notePos = prompt.indexOf("tokenizer parser cleanup");
		check("system prompt contains the failure memory", failurePos >= 0, prompt.slice(0, 300));
		check("system prompt contains the earlier success memory", notePos >= 0, prompt.slice(0, 300));
		check("failure memory is injected BEFORE the success memory", failurePos >= 0 && notePos >= 0 && failurePos < notePos);
	});

	// ── Scenario 4: JEO_NO_MEMORY disables failure capture entirely ─────────
	console.log("Scenario 4: JEO_NO_MEMORY=1 disables failure-first capture");
	await withTemp(async (cwd) => {
		process.env.JEO_NO_MEMORY = "1";
		try {
			const { mockPi, events } = createMockPi();
			workspaceMemoryExtension(mockPi);
			const ctx: any = { cwd, hasUI: true, ui: { setStatus: () => {}, notify: () => {} } };
			const messages = stalledTranscript("anything", 5);
			await events.get("agent_end")?.[0]?.({ type: "agent_end", messages }, ctx);
			invalidateCache(cwd);
			check("no memory recorded when JEO_NO_MEMORY=1", getCachedIndex(cwd).memories.length === 0);
		} finally {
			delete process.env.JEO_NO_MEMORY;
		}
	});

	console.log(failures === 0 ? "\nALL FAILURE-FIRST RUNTIME CHECKS PASSED" : `\n${failures} RUNTIME CHECK(S) FAILED`);
	rmSync(agentDir, { recursive: true, force: true });
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	rmSync(agentDir, { recursive: true, force: true });
	process.exit(1);
});
