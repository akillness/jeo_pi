/**
 * Workspace Memory Extension for pi
 *
 * Automatically detects important moments in conversation, saves them as
 * structured workspace-scoped memory, and efficiently recalls them in
 * future related conversations.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { completeSimple } from "@mariozechner/pi-ai";
import { getCachedIndex, setCachedIndex, saveIndex } from "./storage";
import { detectKeywords, selectTemplateFromKeywords, TEMPLATE_LABELS } from "./templates";
import { recallMemories } from "./recall";
import { createAndSaveMemory, recordFailedAttempt } from "./save";
import { detectStall } from "./stall";
import { distillSession, type DistillComplete } from "./distill";
import { handleMemoryCommand } from "./commands";

export default function workspaceMemoryExtension(pi: ExtensionAPI) {
	// --- Session start: load index ---
	pi.on("session_start", async (_event, ctx) => {
		const index = getCachedIndex(ctx.cwd);
		if (index.memories.length > 0) {
			ctx.ui.setStatus("memory", `💾 ${index.memories.length}`);
		} else {
			ctx.ui.setStatus("memory", undefined);
		}
	});
	// Most-recent agent-loop transcript per workspace, captured on `agent_end`
	// and distilled on `session_shutdown` (true session end). `session_shutdown`
	// itself carries no messages, so we stash them here.
	const latestMessages = new Map<string, { role?: string; content?: unknown; isError?: boolean }[]>();

	// --- Agent loop end: capture transcript + failure-first stall capture ---
	pi.on("agent_end", async (event, ctx) => {
		if (!Array.isArray(event.messages) || event.messages.length === 0) return;
		latestMessages.set(ctx.cwd, event.messages);

		// Failure-first (jeo-code's core philosophy): if this turn stalled —
		// repeated / cycled / consecutively failed without recovering — record it
		// NOW as a FailedAttempt memory so the next turn's recall resurfaces it
		// first and the model does not repeat the same dead end. Deterministic
		// (no LLM), best-effort: never disrupt the turn.
		try {
			const stall = detectStall(event.messages);
			if (stall) {
				const result = recordFailedAttempt(
					{
						task: stall.task,
						why: stall.why,
						steps: stall.steps,
						stopClass: stall.stopClass,
						candidates: stall.candidates,
						lastError: stall.lastError,
						evidence: stall.evidence,
					},
					ctx.cwd
				);

				if (result.recorded && ctx.hasUI) {
					const index = getCachedIndex(ctx.cwd);
					ctx.ui.setStatus("memory", `💾 ${index.memories.length} (⚠ failure recorded)`);
				}
			}
		} catch {
			// Stall capture is best-effort; never disrupt the agent loop.
		}
	});

	// --- Session shutdown: distill captured transcript into durable memories ---
	// Mirrors jeo-code's session-exit distill: accumulated learnings are filed
	// even if the model never called `memory_save` mid-session. Bounded by an
	// abort timeout so it can never hang `/exit`.
	pi.on("session_shutdown", async (_event, ctx) => {
		const messages = latestMessages.get(ctx.cwd);
		if (!messages || messages.length === 0) return;
		const model = ctx.model;
		if (!model) return;

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 8000);
		const complete: DistillComplete = async (context) => {
			const res = await completeSimple(model, context, { signal: controller.signal });
			const blocks = (res?.content ?? []) as { type?: string; text?: string }[];
			return blocks
				.filter((b) => b.type === "text" && typeof b.text === "string")
				.map((b) => b.text as string)
				.join("\n");
		};

		try {
			const result = await distillSession({ messages, cwd: ctx.cwd, complete });
			if (result.saved > 0 && ctx.hasUI) {
				const index = getCachedIndex(ctx.cwd);
				ctx.ui.setStatus("memory", `💾 ${index.memories.length} (+${result.saved} distilled)`);
			}
		} catch {
			// Distillation is best-effort; never disrupt shutdown.
		} finally {
			clearTimeout(timeout);
			latestMessages.delete(ctx.cwd);
		}
	});

	// --- Before agent start: keyword detection + recall ---
	pi.on("before_agent_start", async (event, ctx) => {
		const index = getCachedIndex(ctx.cwd);
		const promptText = event.prompt;
		const keywords = detectKeywords(promptText);

		// Recall relevant memories
		const { text: memoryContext, recalledIds } = await recallMemories(
			index,
			promptText,
			ctx.cwd
		);

		// Save index if any recalls happened (score updates)
		if (recalledIds.length > 0) {
			saveIndex(index, ctx.cwd);
			ctx.ui.setStatus("memory", `💾 ${index.memories.length} (${recalledIds.length} recalled)`);
		}

		const basePrompt = event.systemPrompt || "";
		let systemPrompt = basePrompt;

		// Inject recalled memories into system prompt
		if (memoryContext) {
			systemPrompt = basePrompt + "\n\n" + memoryContext;
		}

		// If trigger keywords detected, suggest saving memory
		if (keywords.length > 0) {
			const template = selectTemplateFromKeywords(keywords);
			const label = TEMPLATE_LABELS[template];
			const hint =
				`\n\n[System Note: This conversation contains keywords related to "${keywords.join(", ")}". ` +
				`If you resolved an issue, made an important decision, or learned something valuable, ` +
				`please use the \`memory_save\` tool to record it as a "${label}" for future reference.]`;
			systemPrompt = systemPrompt + hint;
		}

		return systemPrompt !== basePrompt ? { systemPrompt } : undefined;
	});

	// --- Tool: memory_save ---
	pi.registerTool({
		name: "memory_save",
		label: "Save Memory",
		description:
			"Save an important finding, bug fix, decision, or insight to workspace memory for future recall.",
		promptSnippet: "Save important workspace findings to memory for future recall",
		promptGuidelines: [
			"Use memory_save after resolving bugs, making decisions, or discovering important patterns.",
			"Be specific: include file names, error messages, root causes, and fixes.",
			"The system will automatically recall relevant memories in future conversations.",
		],
		parameters: Type.Object({
			content: Type.String({
				description:
					"Structured memory content. For post-mortem: Problem, Root Cause, Fix, Prevention. For decision: Context, Decision, Rationale, Alternatives.",
			}),
			template: Type.Optional(
				Type.String({
					description:
						"Memory template type: post-mortem, decision-record, or compact-note. Auto-detected if omitted.",
				})
			),
			tags: Type.Optional(
				Type.Array(Type.String(), {
					description: "Optional tags for categorization (e.g., ['bug', 'redis', 'performance'])",
				})
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { memory, evictedCount } = createAndSaveMemory(
				{
					content: params.content,
					template: params.template,
					tags: params.tags,
				},
				ctx.cwd
			);

			if (ctx.hasUI) {
				const index = getCachedIndex(ctx.cwd);
				ctx.ui.setStatus("memory", `💾 ${index.memories.length}`);
			}

			let message = `Memory saved successfully.\nID: ${memory.id}\nTemplate: ${memory.template}\nTags: ${memory.metadata.tags.join(", ") || "none"}`;
			if (evictedCount > 0) {
				message += `\n(${evictedCount} old memories evicted to stay within limit)`;
			}

			return {
				content: [{ type: "text", text: message }],
				details: { memoryId: memory.id, template: memory.template, tags: memory.metadata.tags },
			};
		},
	});

	// --- Commands ---
	pi.registerCommand("memory", {
		description:
			"Workspace memory commands. Usage: /memory list | show <id> | save <text> | delete <id> | search <query> | stats | okf [lint|rebuild]",
		handler: handleMemoryCommand,
	});
}
