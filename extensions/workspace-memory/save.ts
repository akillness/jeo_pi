/**
 * Unified memory creation and persistence
 */

import type { Memory, MemoryIndexEntry, MemoryTemplate } from "./types";
import { FAILURE_TAG } from "./types";
import {
	getCachedIndex,
	setCachedIndex,
	saveMemory,
	saveIndex,
	deleteMemoryFile,
	generateMemoryId,
	upsertIndexEntry,
} from "./storage";
import { parseMemoryContent, getSummary, normalizeTemplate } from "./utils";
import { detectKeywords, selectTemplateFromKeywords } from "./templates";
import { recalculateAllScores, evictIfNeeded } from "./scoring";
import { mirrorMemory, removeMemoryConcept } from "./okf-bundle";

export interface CreateMemoryInput {
	content: string;
	template?: string;
	tags?: string[];
}

export interface CreateMemoryResult {
	memory: Memory;
	entry: MemoryIndexEntry;
	evictedCount: number;
}

/**
 * Create a new memory, persist it, and handle eviction if over limit.
 * This is the single source of truth for saving memories from both
 * the LLM tool and the /memory command.
 */
export function createAndSaveMemory(
	input: CreateMemoryInput,
	cwd: string
): CreateMemoryResult {
	const index = getCachedIndex(cwd);

	const detectedKeywords = detectKeywords(input.content);
	const template: MemoryTemplate =
		input.template
			? normalizeTemplate(input.template)
			: selectTemplateFromKeywords(detectedKeywords);

	const memoryId = generateMemoryId();
	const now = new Date().toISOString();
	const structuredContent = parseMemoryContent(input.content, template);
	const tags = [...new Set([...(input.tags || []), ...detectedKeywords])].slice(0, 10);

	const summary = getSummary(structuredContent, template);

	const memory: Memory = {
		id: memoryId,
		template,
		metadata: {
			createdAt: now,
			tags,
			triggerKeywords: detectedKeywords,
		},
		content: structuredContent,
	};

	const entry: MemoryIndexEntry = {
		id: memoryId,
		file: `${memoryId}.json`,
		template,
		summary,
		tags,
		createdAt: now,
		lastRecalledAt: null,
		recallCount: 0,
		score: 0,
	};

	// Persist memory file
	saveMemory(memory, cwd);

	// Update index
	upsertIndexEntry(index, entry);

	// Recalculate scores and evict if needed
	recalculateAllScores(index);
	const evicted = evictIfNeeded(index, cwd);

	// Persist index BEFORE deleting evicted files (crash safety)
	saveIndex(index, cwd);
	setCachedIndex(cwd, index);

	// Delete evicted files after index is saved
	for (const mem of evicted) {
		deleteMemoryFile(mem.id, cwd);
	}

	// Mirror the new memory into the OKF knowledge bundle (additive, durable).
	// Failures here must never break the operational JSON store.
	try {
		mirrorMemory(memory, summary, cwd);
		for (const mem of evicted) {
			removeMemoryConcept(mem.id, cwd);
		}
	} catch {
		// Bundle mirror is best-effort; the JSON store remains authoritative.
	}

	return {
		memory,
		entry,
		evictedCount: evicted.length,
	};
}

export interface FailedAttemptInput {
	/** The task the turn stalled on (last user prompt). */
	task: string;
	/** Why it stalled (e.g. "consecutive failing tool calls"). */
	why: string;
	/** Number of tool steps observed before giving up. */
	steps: number;
	/** Classification: consecutive_failure | repeat | cycle. */
	stopClass: string;
}

export interface RecordFailedAttemptResult {
	recorded: boolean;
	skipped?: string;
	memory?: Memory;
}

/**
 * Deterministic (no-LLM) mid-session capture of a dead end — jeo-pi's port of
 * jeo-code's `recordFailedAttempt` (jeo-code/src/agent/memory.ts).
 *
 * The session-exit distill only learns AFTER a session ends; a turn that stalled
 * (consecutive-failure / cycle / repeat) is a dead end the *next turn of the same
 * session* should already avoid. This writes ONE failure memory immediately,
 * tagged {@link FAILURE_TAG}, so the per-turn recall (which surfaces a
 * query-relevant failure FIRST) reminds the model what NOT to repeat — the exact
 * failure-first loop the user asked to preserve: each iteration gets sharper by
 * building on accumulated failure knowledge.
 *
 * Stored as a post-mortem memory (reusing the existing pipeline). Deduped by the
 * `Stalled on: …` problem summary so a persistent stall is not re-recorded every
 * turn. Best-effort: honours `JEO_NO_MEMORY=1` and swallows write failures.
 */
export function recordFailedAttempt(
	input: FailedAttemptInput,
	cwd: string
): RecordFailedAttemptResult {
	if (process.env.JEO_NO_MEMORY === "1") {
		return { recorded: false, skipped: "disabled (JEO_NO_MEMORY=1)" };
	}
	const task = input.task.replace(/\s+/g, " ").trim();
	if (!task) return { recorded: false, skipped: "empty task" };

	const excerpt = task.length > 70 ? task.slice(0, 70) + "…" : task;
	const problem = `Stalled on: ${excerpt}`;

	// Dedupe: skip if an identical failure record already exists (summary is the
	// first 120 chars of the problem line — see getSummary for post-mortem).
	const index = getCachedIndex(cwd);
	const summaryKey = problem.slice(0, 120);
	const duplicate = index.memories.some(
		(e) =>
			e.template === "post-mortem" &&
			e.tags.includes(FAILURE_TAG) &&
			e.summary === summaryKey
	);
	if (duplicate) return { recorded: false, skipped: "duplicate stall already recorded" };

	// Task tokens as tags (mirrors jeo-code launch.ts's tag derivation).
	const taskTokens = Array.from(
		new Set(task.toLowerCase().match(/[a-z0-9][a-z0-9_-]{3,}/g) ?? [])
	).slice(0, 8);

	// Heading-per-line markdown so parseMemoryContent captures each section
	// (inline `Problem: …` would be swallowed by the heading parser).
	const content =
		`## Problem\n${problem}\n\n` +
		`## Root Cause\nA prior turn stalled (${input.why}) on this task and could not recover after ${input.steps} tool steps.\n\n` +
		`## Fix\nChange approach before retrying — try a different decomposition, tool, or verification path.\n\n` +
		`## Prevention\nDo NOT repeat the same line of attack on this task.`;

	try {
		const { memory } = createAndSaveMemory(
			{ content, template: "post-mortem", tags: [FAILURE_TAG, ...taskTokens] },
			cwd
		);
		return { recorded: true, memory };
	} catch (err) {
		return {
			recorded: false,
			skipped: `record failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}
