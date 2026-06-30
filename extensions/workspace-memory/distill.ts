/**
 * Session-end automatic distillation for workspace-memory.
 *
 * Reflected from jeo-code's `src/agent/memory.ts` distill pipeline: when an
 * agent loop ends, the recent transcript (which already contains the user's
 * goals, the commands that worked, and the failures that were corrected) is
 * distilled by the model into a few durable, structured memories and filed
 * through the SAME `createAndSaveMemory` path the `memory_save` tool uses —
 * so the OKF concept mirror, `index.md`/`log.md`, scoring and eviction all
 * happen for free (single source of truth, no parallel write path).
 *
 * This is jeo-pi's "knowledge accumulation" channel: the manual tool captures
 * what the model *chooses* to record mid-session; this captures what was
 * actually learned by the time the session ends, with no model cooperation
 * required during the turn.
 *
 * The model call is injected (`DistillComplete`) so the pure pieces
 * (transcript serialization, prompt construction, JSON extraction, dedup) are
 * deterministically testable without a live provider.
 */

import type { Context } from "@mariozechner/pi-ai";
import type { MemoryTemplate } from "./types";
import { createAndSaveMemory } from "./save";
import { getCachedIndex } from "./storage";
import { normalizeTemplate } from "./utils";

/** Char budget for the transcript tail fed to the distiller (mirrors jeo-code's
 *  bounded `transcriptTail` — keep the most recent, most relevant exchange). */
export const DISTILL_TRANSCRIPT_MAX_CHARS = 12_000;

/** Below this many transcript chars there is nothing worth distilling — a
 *  greeting or a one-line question should never spawn a memory. */
export const DISTILL_MIN_TRANSCRIPT_CHARS = 400;

/** Hard cap on memories filed from a single session, so one noisy session can
 *  never flood the store (eviction still applies on top of this). */
export const DISTILL_MAX_MEMORIES_PER_SESSION = 3;

/** A model completion call reduced to its text output. Injected for testability;
 *  index.ts wires this to `completeSimple(ctx.model, ...)`. Returns "" on failure. */
export type DistillComplete = (context: Context) => Promise<string>;

/** A single distilled learning, shaped to feed `createAndSaveMemory` verbatim. */
export interface DistilledMemory {
	template: MemoryTemplate;
	content: string;
	tags: string[];
}

// ── Transcript serialization (pure) ──────────────────────────────────────────

interface TextLike {
	type?: string;
	text?: string;
	name?: string;
}

/** Render one message's content array (or string) to plain text, tagging tool
 *  calls and tool results so the distiller can see what was actually run. */
function renderContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content as TextLike[]) {
		if (!block || typeof block !== "object") continue;
		if (block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		} else if (block.type === "thinking") {
			// Thinking is private scratch space — never distill it.
			continue;
		} else if (block.type === "toolCall" && typeof block.name === "string") {
			parts.push(`[tool:${block.name}]`);
		}
	}
	return parts.join("\n").trim();
}

/**
 * Build a compact, char-bounded transcript tail from the agent messages.
 * Keeps the MOST RECENT messages (jeo-code keeps the tail, where the resolution
 * lives) and labels each line by role so the distiller has structure.
 */
export function serializeTranscript(
	messages: readonly { role?: string; content?: unknown; isError?: boolean }[],
	maxChars: number = DISTILL_TRANSCRIPT_MAX_CHARS,
): string {
	const lines: string[] = [];
	for (const msg of messages) {
		const role = msg.role;
		const text = renderContent(msg.content);
		if (!text) continue;
		if (role === "user") {
			lines.push(`USER: ${text}`);
		} else if (role === "assistant") {
			lines.push(`ASSISTANT: ${text}`);
		} else if (role === "toolResult") {
			const prefix = msg.isError ? "TOOL(error): " : "TOOL: ";
			lines.push(prefix + text);
		}
	}
	const joined = lines.join("\n\n");
	if (joined.length <= maxChars) return joined;
	// Keep the tail (most recent exchange), not the head.
	return joined.slice(joined.length - maxChars);
}

// ── Distill prompt (pure) ────────────────────────────────────────────────────

const DISTILL_SYSTEM_PROMPT = [
	"You distill durable engineering knowledge from a coding session transcript.",
	"Extract ONLY learnings that will still be useful in a FUTURE session in this",
	"same repository: resolved bugs (with root cause + fix), important decisions,",
	"and reusable facts. Ignore chit-chat, transient state, and anything specific",
	"to this one transcript that won't recur.",
	"",
	"Respond with ONLY a JSON object, no prose, in exactly this shape:",
	'{ "memories": [ { "template": "post-mortem|decision-record|compact-note",',
	'  "tags": ["short","kebab","tags"], "content": "..." } ] }',
	"",
	"Write `content` using these labelled sections so it parses cleanly:",
	"- post-mortem: 'Problem: ...\\nRoot Cause: ...\\nFix: ...\\nPrevention: ...'",
	"- decision-record: 'Context: ...\\nDecision: ...\\nRationale: ...\\nAlternatives Considered: ...'",
	"- compact-note: 'Summary: ...' then '- ' bullet key points.",
	"",
	"Return at most three memories. If nothing is worth remembering, return",
	'{ "memories": [] }. Never invent facts not supported by the transcript.',
].join("\n");

/** Build the model Context for a distill call. Pure — no provider touched. */
export function buildDistillContext(transcript: string, existingSummaries: string[]): Context {
	const known = existingSummaries.length
		? `\n\nAlready-recorded memories (do NOT duplicate these):\n${existingSummaries
				.map((s) => `- ${s}`)
				.join("\n")}`
		: "";
	return {
		systemPrompt: DISTILL_SYSTEM_PROMPT,
		messages: [
			{
				role: "user",
				content: `Session transcript:\n\n${transcript}${known}`,
				timestamp: Date.now(),
			},
		],
	};
}

// ── Robust JSON extraction (pure) ────────────────────────────────────────────

/** Extract the first balanced top-level `{...}` object from text that may be
 *  wrapped in prose or  fences (mirrors jeo-code's tolerant extractor). */
function extractFirstJsonObject(text: string): string | undefined {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const haystack = fenced ? fenced[1] : text;
	const start = haystack.indexOf("{");
	if (start === -1) return undefined;
	let depth = 0;
	let inString = false;
	let escape = false;
	for (let i = start; i < haystack.length; i++) {
		const ch = haystack[i];
		if (escape) {
			escape = false;
			continue;
		}
		if (ch === "\\") {
			escape = true;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return haystack.slice(start, i + 1);
		}
	}
	return undefined;
}

/**
 * Parse the model's distill output into validated DistilledMemory entries.
 * Tolerant: returns [] on any malformed output rather than throwing, and skips
 * individual malformed entries while keeping the valid ones.
 */
export function extractDistilledMemories(modelText: string): DistilledMemory[] {
	if (!modelText || !modelText.trim()) return [];
	const json = extractFirstJsonObject(modelText);
	if (!json) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return [];
	}
	const raw = (parsed as { memories?: unknown })?.memories;
	if (!Array.isArray(raw)) return [];
	const out: DistilledMemory[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const rec = item as { template?: unknown; content?: unknown; tags?: unknown };
		if (typeof rec.content !== "string" || !rec.content.trim()) continue;
		const template = normalizeTemplate(
			typeof rec.template === "string" ? rec.template : undefined,
		);
		const tags = Array.isArray(rec.tags)
			? rec.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 10)
			: [];
		out.push({ template, content: rec.content.trim(), tags });
		if (out.length >= DISTILL_MAX_MEMORIES_PER_SESSION) break;
	}
	return out;
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface DistillSessionInput {
	messages: readonly { role?: string; content?: unknown; isError?: boolean }[];
	cwd: string;
	/** Injected model call. */
	complete: DistillComplete;
}

export interface DistillSessionResult {
	saved: number;
	skipped?: string;
	/** IDs of memories created this session (for status / tests). */
	savedIds: string[];
}

/** Normalize a summary for cheap case-insensitive duplicate detection. */
function normalizeSummary(s: string): string {
	return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Distill the session transcript into durable memories and persist them via the
 * shared `createAndSaveMemory` path. Best-effort and side-effect contained:
 * returns a skip reason instead of throwing, so a failed distill never disrupts
 * shutdown. Honors `JEO_NO_MEMORY=1` (jeo-code's kill switch).
 */
export async function distillSession(input: DistillSessionInput): Promise<DistillSessionResult> {
	if (process.env.JEO_NO_MEMORY === "1") {
		return { saved: 0, skipped: "disabled (JEO_NO_MEMORY=1)", savedIds: [] };
	}

	const transcript = serializeTranscript(input.messages);
	if (transcript.length < DISTILL_MIN_TRANSCRIPT_CHARS) {
		return { saved: 0, skipped: "transcript too short to distill", savedIds: [] };
	}

	const index = getCachedIndex(input.cwd);
	const existingSummaries = index.memories.map((m) => m.summary).slice(0, 40);
	const seen = new Set(existingSummaries.map(normalizeSummary));

	let modelText: string;
	try {
		modelText = await input.complete(buildDistillContext(transcript, existingSummaries));
	} catch (err) {
		return { saved: 0, skipped: `distill model call failed: ${(err as Error)?.message ?? err}`, savedIds: [] };
	}

	const distilled = extractDistilledMemories(modelText);
	if (distilled.length === 0) {
		return { saved: 0, skipped: "distill produced no memories", savedIds: [] };
	}

	const savedIds: string[] = [];
	for (const mem of distilled) {
		const dupKey = normalizeSummary(mem.content.slice(0, 120));
		if (seen.has(dupKey)) continue;
		seen.add(dupKey);
		try {
			const { memory } = createAndSaveMemory(
				{ content: mem.content, template: mem.template, tags: mem.tags },
				input.cwd,
			);
			savedIds.push(memory.id);
		} catch {
			// Skip just this learning; keep filing the rest.
		}
	}

	return {
		saved: savedIds.length,
		savedIds,
		skipped: savedIds.length === 0 ? "all distilled memories were duplicates" : undefined,
	};
}
