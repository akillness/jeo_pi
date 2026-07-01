import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import workspaceMemoryExtension from "../index.js";
import { invalidateCache, getCachedIndex } from "../storage.js";

import { MAX_RECALL_CONTEXT_CHARS } from "../recall.js";

vi.mock("@mariozechner/pi-coding-agent", () => ({
	getAgentDir: vi.fn(),
}));

import { getAgentDir } from "@mariozechner/pi-coding-agent";

const mockedGetAgentDir = vi.mocked(getAgentDir);
const tempRoots: string[] = [];

function createTempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "workspace-memory-e2e-"));
	tempRoots.push(root);
	return root;
}

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

afterEach(() => {
	for (const root of tempRoots.splice(0, tempRoots.length)) {
		rmSync(root, { recursive: true, force: true });
	}
	vi.clearAllMocks();
});

describe("workspace-memory integration flow", () => {
	it("saves memory, exposes slash command output, and injects recalled context", async () => {
		const root = createTempRoot();
		mockedGetAgentDir.mockReturnValue(root);

		const cwd = "/tmp/workspace-memory-integration";
		invalidateCache(cwd);

		const statusCalls: Array<{ key: string; value: string | undefined }> = [];
		const notifications: Array<{ message: string; level: string }> = [];

		const ctx: any = {
			cwd,
			hasUI: true,
			ui: {
				setStatus: (key: string, value: string | undefined) => {
					statusCalls.push({ key, value });
				},
				notify: (message: string, level: string) => {
					notifications.push({ message, level });
				},
			},
		};

		const { mockPi, tools, commands, events } = createMockPi();
		workspaceMemoryExtension(mockPi);

		await events.get("session_start")?.[0]?.({ type: "session_start" }, ctx);

		const saveResult = await tools
			.get("memory_save")
			.execute("call-1", { content: "Problem: bug in parser\nFix: apply patch" }, undefined, undefined, ctx);

		expect(saveResult.content[0].text).toContain("Memory saved successfully.");
		expect(statusCalls.some((call) => call.key === "memory" && call.value?.includes("💾 1"))).toBe(true);

		await commands.get("memory").handler("list", ctx);
		expect(notifications.some((n) => n.message.includes("| ID | Template | Summary | Recalls | Score |"))).toBe(true);

		const beforeResult = await events
			.get("before_agent_start")?.[0]?.(
				{ type: "before_agent_start", prompt: "parser bug fix regression", systemPrompt: "BASE" },
				ctx
			);

		expect(beforeResult?.systemPrompt).toContain("BASE");
		expect(beforeResult?.systemPrompt).toContain("## Workspace Memories");
		expect(beforeResult?.systemPrompt).toContain("<workspace_memories>");
	});

	it("caps recalled memory context before injecting it into the system prompt", async () => {
		const root = createTempRoot();
		mockedGetAgentDir.mockReturnValue(root);

		const cwd = "/tmp/workspace-memory-integration-cap";
		invalidateCache(cwd);

		const ctx: any = {
			cwd,
			hasUI: true,
			ui: {
				setStatus: vi.fn(),
				notify: vi.fn(),
			},
		};

		const { mockPi, tools, events } = createMockPi();
		workspaceMemoryExtension(mockPi);

		await tools.get("memory_save").execute(
			"call-1",
			{
				content: `Summary: parser ${"x".repeat(MAX_RECALL_CONTEXT_CHARS * 2)}`,
				template: "compact-note",
				tags: ["parser"],
			},
			undefined,
			undefined,
			ctx
		);

		const beforeResult = await events
			.get("before_agent_start")?.[0]?.(
				{ type: "before_agent_start", prompt: "parser memory recall", systemPrompt: "BASE" },
				ctx
			);

		expect(beforeResult?.systemPrompt).toContain("BASE");
		expect(beforeResult?.systemPrompt).toContain("## Workspace Memories");
		expect(beforeResult?.systemPrompt.length).toBeLessThanOrEqual(
			"BASE\n\n".length + MAX_RECALL_CONTEXT_CHARS
		);
	});

	it("captures a mid-session stall as a FailedAttempt and recalls it FIRST on the next turn (jeo-code's failure-first philosophy)", async () => {
		const root = createTempRoot();
		mockedGetAgentDir.mockReturnValue(root);

		const cwd = "/tmp/workspace-memory-failure-first-e2e";
		invalidateCache(cwd);

		const ctx: any = {
			cwd,
			hasUI: true,
			ui: { setStatus: vi.fn(), notify: vi.fn() },
		};

		const { mockPi, tools, events } = createMockPi();
		workspaceMemoryExtension(mockPi);

		// A prior, unrelated success that also matches the upcoming recall query.
		await tools.get("memory_save").execute(
			"call-1",
			{ content: "Summary: tokenizer parser cleanup went smoothly", template: "compact-note", tags: ["tokenizer"] },
			undefined,
			undefined,
			ctx,
		);

		// This turn stalls: MAX_FAILURES (5) consecutive failing `edit` calls on
		// the same tool, mirroring jeo-code's loop-guards `consecutive_failure`.
		let seq = 0;
		const messages: any[] = [{ role: "user", content: "fix the tokenizer edge case" }];
		for (let i = 0; i < 5; i++) {
			const id = `tc-${++seq}`;
			messages.push({ role: "assistant", content: [{ type: "toolCall", id, name: "edit", arguments: { file: "a.ts", attempt: i } }] });
			messages.push({ role: "toolResult", toolCallId: id, toolName: "edit", isError: true });
		}
		await events.get("agent_end")?.[0]?.({ type: "agent_end", messages }, ctx);

		invalidateCache(cwd);
		const index = getCachedIndex(cwd);
		const failureEntry = index.memories.find((m) => m.tags.includes("failed-attempt"));
		expect(failureEntry).toBeDefined();
		expect(failureEntry?.template).toBe("post-mortem");
		expect(failureEntry?.summary).toContain("Stalled on:");
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("memory", expect.stringContaining("failure recorded"));

		// Next turn: the failure memory must be recalled AHEAD of the earlier
		// success memory in the injected system prompt (jeo-code's priorityOrder).
		const beforeResult = await events.get("before_agent_start")?.[0]?.(
			{ type: "before_agent_start", prompt: "working on the tokenizer again", systemPrompt: "BASE" },
			ctx,
		);
		const prompt: string = beforeResult?.systemPrompt ?? "";
		const failurePos = prompt.indexOf("Stalled on: fix the tokenizer edge case");
		const notePos = prompt.indexOf("tokenizer parser cleanup");
		expect(failurePos).toBeGreaterThanOrEqual(0);
		expect(notePos).toBeGreaterThanOrEqual(0);
		expect(failurePos).toBeLessThan(notePos);
	});

	it("does not record a FailedAttempt for a healthy turn, and honours JEO_NO_MEMORY for stall capture", async () => {
		const root = createTempRoot();
		mockedGetAgentDir.mockReturnValue(root);

		const cwd = "/tmp/workspace-memory-failure-first-negative";
		invalidateCache(cwd);
		const ctx: any = { cwd, hasUI: true, ui: { setStatus: vi.fn(), notify: vi.fn() } };

		const { mockPi, events } = createMockPi();
		workspaceMemoryExtension(mockPi);

		await events.get("agent_end")?.[0]?.(
			{
				type: "agent_end",
				messages: [
					{ role: "user", content: "add a small feature" },
					{ role: "assistant", content: [{ type: "toolCall", id: "ok-1", name: "edit", arguments: { file: "x.ts" } }] },
					{ role: "toolResult", toolCallId: "ok-1", toolName: "edit", isError: false },
				],
			},
			ctx,
		);
		invalidateCache(cwd);
		expect(getCachedIndex(cwd).memories.length).toBe(0);

		process.env.JEO_NO_MEMORY = "1";
		try {
			const messages: any[] = [{ role: "user", content: "anything" }];
			for (let i = 0; i < 5; i++) {
				messages.push({ role: "assistant", content: [{ type: "toolCall", id: `d-${i}`, name: "edit", arguments: { i } }] });
				messages.push({ role: "toolResult", toolCallId: `d-${i}`, toolName: "edit", isError: true });
			}
			await events.get("agent_end")?.[0]?.({ type: "agent_end", messages }, ctx);
			invalidateCache(cwd);
			expect(getCachedIndex(cwd).memories.length).toBe(0);
		} finally {
			delete process.env.JEO_NO_MEMORY;
		}
	});

});
