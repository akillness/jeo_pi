/**
 * Turn-stall detection — jeo-pi's port of jeo-code's loop-guard "stopClass".
 *
 * jeo-code's core philosophy is failure-first: it focuses on the turns that did
 * NOT run / did NOT succeed and learns from them. Its agent loop watches every
 * step and, when the model spins without recovering, stops the turn with a
 * `stopClass` (`consecutive_failure` | `repeat` | `cycle`) and records a
 * FailedAttempt so the *next* turn already knows what NOT to repeat
 * (jeo-code/src/agent/engine.ts, loop-guards.ts).
 *
 * pi's runtime has no such in-loop guard, so this module reconstructs the same
 * three signals from the finished transcript at `agent_end`, using the identical
 * thresholds and the identical READONLY-tool exclusion, then hands the verdict to
 * recordFailedAttempt. Faithful, deterministic (no LLM), best-effort.
 *
 * Beyond classifying THAT a turn stalled, this module also extracts WHAT to carry
 * forward, mirroring the insight that raw tool-call/experiment counts matter less
 * than whether the concrete failure signal gets fed into the next attempt:
 *   - `candidates`: the distinct call signature(s) actually implicated in the
 *     stall (what NOT to repeat verbatim).
 *   - `lastError`: the real error text from the offending tool result, so the
 *     next turn gets a grounded diagnostic instead of a generic label.
 *   - `evidence`: distinct successful calls made earlier in the SAME turn before
 *     it stalled — confirmed facts worth keeping so the next turn does not
 *     re-derive them from scratch by re-reading the whole transcript.
 */

// ── Guard thresholds — copied verbatim from jeo-code/src/agent/loop-guards.ts
//    GUARD_LIMITS so the failure-focus behaviour matches step-for-step. ──
/** Identical step repeats tolerated before it counts as a stall. */
export const MAX_REPEAT = 4;
/** Consecutive different-but-failing steps before it counts as a stall. */
export const MAX_FAILURES = 5;
/** Recent-signature window scanned for an A↔B (≤2 distinct calls) cycle. */
export const CYCLE_WINDOW = 6;

/** Read-only tools never count toward the failure streak — a batch of one
 *  trivial read(ok) must not mask a step whose real (mutating) work failed.
 *  Mirrors jeo-code's READONLY_TOOLS set (engine.ts). */
export const READONLY_TOOLS = new Set(["read", "find", "search", "ls", "web_search"]);

/** Cap on how much of a raw tool-error message is carried into memory content. */
const MAX_ERROR_CHARS = 300;
/** Cap on how many distinct signatures are listed per bucket (candidates/evidence). */
const MAX_LISTED_SIGNATURES = 5;

export type StallClass = "consecutive_failure" | "repeat" | "cycle";

export interface StallResult {
	stopClass: StallClass;
	/** Human-readable reason, mirrors launch.ts's `why`. */
	why: string;
	/** Number of tool steps observed in the stalling turn. */
	steps: number;
	/** The task text (last user prompt) the turn stalled on. */
	task: string;
	/** Distinct call signature(s) implicated in the stall — what NOT to repeat. */
	candidates: string[];
	/** Real error text from the offending tool result, truncated. Empty if the
	 *  implicated calls did not report an error (e.g. a "repeat" that succeeded
	 *  every time but made no new progress). */
	lastError: string;
	/** Distinct successful call signatures observed earlier in this SAME turn,
	 *  before the stall — confirmed facts worth keeping across the boundary. */
	evidence: string[];
}

// Structural view over pi's transcript messages (UserMessage | AssistantMessage |
// ToolResultMessage) that also tolerates the loosely-typed stashed transcript.
interface StallToolCallBlock {
	type?: string;
	id?: string;
	name?: string;
	arguments?: Record<string, unknown>;
}
interface StallTextBlock {
	type?: string;
	text?: string;
}
export interface StallMessage {
	role?: string;
	content?: unknown;
	toolName?: string;
	toolCallId?: string;
	isError?: boolean;
}

/** Deterministic per-call signature: `tool:sortedArgsJSON`. Key-sorted so two
 *  identical calls compare equal regardless of argument key ordering. */
function callSignature(name: string, args: Record<string, unknown> | undefined): string {
	let argsJson = "{}";
	try {
		const keys = Object.keys(args ?? {}).sort();
		const ordered: Record<string, unknown> = {};
		for (const k of keys) ordered[k] = (args as Record<string, unknown>)[k];
		argsJson = JSON.stringify(ordered);
	} catch {
		argsJson = "{}";
	}
	return `${name}:${argsJson}`;
}

interface Step {
	/** Whole-step signature (joined per-call signatures). */
	sig: string;
	/** This step had at least one executed tool call (a result was recorded). */
	executed: boolean;
	/** The step is a failure: no non-trivial call succeeded (jeo-code's rule). */
	failed: boolean;
	/** Truncated error text from the first failing call in this step, if any. */
	errorText: string;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return (content as StallTextBlock[])
			.filter((b) => b && b.type === "text" && typeof b.text === "string")
			.map((b) => b.text as string)
			.join("\n");
	}
	return "";
}

function truncate(text: string, max: number): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= max) return collapsed;
	return `${collapsed.slice(0, max)}…`;
}

/** Extract the task the turn worked on: the LAST user prompt in the transcript
 *  (the prompt that drove this agent loop, jeo-code's `userInput`). */
export function extractTask(messages: readonly StallMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.role === "user") {
			const t = textOf(messages[i].content).replace(/\s+/g, " ").trim();
			if (t) return t;
		}
	}
	return "";
}

/** Build the ordered list of tool steps for the CURRENT turn (messages after the
 *  last user prompt), reconstructing per-step success exactly as jeo-code scores
 *  it: a step succeeds if any non-trivial (non-readonly) executed call succeeded;
 *  a readonly-only step succeeds if any call succeeded. Also captures the real
 *  error text of the first failing call per step, so a stall can carry a grounded
 *  diagnostic forward instead of only a generic classification. */
function buildSteps(messages: readonly StallMessage[]): Step[] {
	// Scope to the current turn: everything after the last user message.
	let start = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.role === "user") {
			start = i + 1;
			break;
		}
	}

	// Map toolCallId -> { isError, text } for results recorded in this turn.
	const resultById = new Map<string, { isError: boolean; text: string }>();
	for (let i = start; i < messages.length; i++) {
		const m = messages[i];
		if (m?.role === "toolResult" && typeof m.toolCallId === "string") {
			resultById.set(m.toolCallId, {
				isError: m.isError === true,
				text: truncate(textOf(m.content), MAX_ERROR_CHARS),
			});
		}
	}

	const steps: Step[] = [];
	for (let i = start; i < messages.length; i++) {
		const m = messages[i];
		if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
		const calls = (m.content as StallToolCallBlock[]).filter(
			(b) => b && b.type === "toolCall" && typeof b.name === "string",
		);
		if (calls.length === 0) continue;

		const sigs: string[] = [];
		const executedNonTrivial: boolean[] = []; // isError flags
		const executedAny: boolean[] = [];
		let errorText = "";
		for (const c of calls) {
			const name = c.name as string;
			sigs.push(callSignature(name, c.arguments));
			const id = typeof c.id === "string" ? c.id : undefined;
			if (id && resultById.has(id)) {
				const r = resultById.get(id)!;
				executedAny.push(r.isError);
				if (!READONLY_TOOLS.has(name)) executedNonTrivial.push(r.isError);
				if (r.isError && !errorText && r.text) errorText = r.text;
			}
		}

		const executed = executedAny.length > 0;
		// A step with no recorded results (e.g. a terminating `done` or a
		// text-only reply that slipped through) is neutral: not a failure.
		let failed = false;
		if (executed) {
			failed =
				executedNonTrivial.length > 0
					? executedNonTrivial.every((isError) => isError) // every non-trivial call failed
					: executedAny.every((isError) => isError); // readonly-only: every call failed
		}

		steps.push({ sig: sigs.join(" | "), executed, failed, errorText: failed ? errorText : "" });
	}

	return steps;
}

/** Longest run of consecutive steps satisfying `pred`, with its [start, end] index
 *  range (inclusive), so callers can recover exactly which steps were implicated. */
function longestRunRange<T>(
	items: readonly T[],
	pred: (a: T, prev: T | undefined) => boolean,
): { length: number; start: number; end: number } {
	let bestLen = 0;
	let bestStart = -1;
	let bestEnd = -1;
	let run = 0;
	let runStart = 0;
	for (let i = 0; i < items.length; i++) {
		if (pred(items[i], items[i - 1])) {
			if (run === 0) runStart = i;
			run++;
		} else {
			run = 0;
		}
		if (run > bestLen) {
			bestLen = run;
			bestStart = runStart;
			bestEnd = i;
		}
	}
	return { length: bestLen, start: bestStart, end: bestEnd };
}

/** Distinct step signatures in `steps[from..to]` (inclusive), most-recent-first,
 *  capped at MAX_LISTED_SIGNATURES. */
function distinctSignatures(steps: readonly Step[], from: number, to: number): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (let i = to; i >= from; i--) {
		if (!seen.has(steps[i].sig)) {
			seen.add(steps[i].sig);
			out.push(steps[i].sig);
			if (out.length >= MAX_LISTED_SIGNATURES) break;
		}
	}
	return out;
}

/** Distinct signatures of successful, executed steps BEFORE index `before` —
 *  confirmed facts from earlier in the same turn, excluding anything already
 *  listed as a candidate. Most-recent-first, capped at MAX_LISTED_SIGNATURES. */
function priorEvidence(steps: readonly Step[], before: number, excluding: readonly string[]): string[] {
	const exclude = new Set(excluding);
	const seen = new Set<string>();
	const out: string[] = [];
	for (let i = before - 1; i >= 0; i--) {
		const s = steps[i];
		if (!s.executed || s.failed) continue;
		if (exclude.has(s.sig) || seen.has(s.sig)) continue;
		seen.add(s.sig);
		out.push(s.sig);
		if (out.length >= MAX_LISTED_SIGNATURES) break;
	}
	return out;
}

/** Last non-empty error text among `steps[from..to]` (inclusive), scanning from
 *  the end so the MOST RECENT failure (freshest diagnostic) wins. */
function lastErrorIn(steps: readonly Step[], from: number, to: number): string {
	for (let i = to; i >= from; i--) {
		if (steps[i].errorText) return steps[i].errorText;
	}
	return "";
}

/**
 * Classify whether the finished turn stalled. Returns the stall verdict or null.
 *
 * Priority mirrors the user's failure-first emphasis ("실행이 되지 않거나 실패한
 * 경우에 집중"): a genuine execution-failure streak is the sharpest "it failed"
 * signal, so it is checked first; then an exact repeat; then an A↔B cycle.
 */
export function detectStall(messages: readonly StallMessage[]): StallResult | null {
	if (!Array.isArray(messages) || messages.length === 0) return null;
	const steps = buildSteps(messages);
	if (steps.length === 0) return null;
	const task = extractTask(messages);

	// 1. consecutive_failure: MAX_FAILURES consecutive failing steps.
	const failRun = longestRunRange(steps, (s) => s.failed);
	if (failRun.length >= MAX_FAILURES) {
		return {
			stopClass: "consecutive_failure",
			why: "consecutive failing tool calls",
			steps: steps.length,
			task,
			candidates: distinctSignatures(steps, failRun.start, failRun.end),
			lastError: lastErrorIn(steps, failRun.start, failRun.end),
			evidence: priorEvidence(steps, failRun.start, distinctSignatures(steps, failRun.start, failRun.end)),
		};
	}

	// 2. repeat: MAX_REPEAT identical consecutive step signatures.
	if (steps.length >= MAX_REPEAT) {
		let run = 1;
		let best = 1;
		let bestEnd = 0;
		for (let i = 1; i < steps.length; i++) {
			run = steps[i].sig === steps[i - 1].sig ? run + 1 : 1;
			if (run > best) {
				best = run;
				bestEnd = i;
			}
		}
		if (best >= MAX_REPEAT) {
			const bestStart = bestEnd - best + 1;
			return {
				stopClass: "repeat",
				why: "repeating the same tool call",
				steps: steps.length,
				task,
				candidates: [steps[bestEnd].sig],
				lastError: lastErrorIn(steps, bestStart, bestEnd),
				evidence: priorEvidence(steps, bestStart, [steps[bestEnd].sig]),
			};
		}
	}

	// 3. cycle: any CYCLE_WINDOW contiguous steps span >1 but ≤2 distinct
	//    signatures (an A↔B ping-pong the exact-repeat guard can't see).
	if (steps.length >= CYCLE_WINDOW) {
		for (let i = 0; i + CYCLE_WINDOW <= steps.length; i++) {
			const windowEnd = i + CYCLE_WINDOW - 1;
			const window = steps.slice(i, windowEnd + 1);
			const distinct = new Set(window.map((s) => s.sig)).size;
			if (distinct > 1 && distinct <= 2) {
				const candidates = distinctSignatures(steps, i, windowEnd);
				return {
					stopClass: "cycle",
					why: "cycling through the same tool calls",
					steps: steps.length,
					task,
					candidates,
					lastError: lastErrorIn(steps, i, windowEnd),
					evidence: priorEvidence(steps, i, candidates),
				};
			}
		}
	}

	return null;
}
