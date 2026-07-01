/**
 * Type definitions for workspace-memory extension
 */

export type MemoryTemplate = "post-mortem" | "decision-record" | "compact-note";

/**
 * Reserved tag marking a memory as a jeo-code-style FailedAttempt: a
 * deterministically-captured dead end (a turn that stalled — repeated / cycled /
 * consecutively failed without recovering). It is the jeo-pi analogue of
 * jeo-code's `type: "FailedAttempt"` concept. Two behaviours hinge on it:
 *   1. Failure-first recall priority — a query-relevant failure surfaces AHEAD of
 *      every other memory (recall.ts), because resurfacing a known dead end is
 *      higher-leverage than reinforcing what already works.
 *   2. Dedupe — recordFailedAttempt (save.ts) skips re-recording an identical stall.
 * Stored as a normal post-mortem memory so the existing parse/format/scoring
 * pipeline is reused unchanged; only the tag distinguishes it.
 */
export const FAILURE_TAG = "failed-attempt";

export interface MemoryIndexEntry {
	id: string;
	file: string;
	template: MemoryTemplate;
	summary: string;
	tags: string[];
	createdAt: string;
	lastRecalledAt: string | null;
	recallCount: number;
	score: number;
}

export interface MemoryIndex {
	version: number;
	workspace: string;
	lastUpdated: string;
	memories: MemoryIndexEntry[];
}

export interface MemoryMetadata {
	createdAt: string;
	tags: string[];
	triggerKeywords: string[];
}

export interface PostMortemContent {
	problem: string;
	rootCause: string;
	fix: string;
	prevention: string;
}

export interface DecisionRecordContent {
	context: string;
	decision: string;
	rationale: string;
	alternativesConsidered: string;
}

export interface CompactNoteContent {
	summary: string;
	keyPoints: string[];
}

export type MemoryContent = PostMortemContent | DecisionRecordContent | CompactNoteContent;

export interface Memory {
	id: string;
	template: MemoryTemplate;
	metadata: MemoryMetadata;
	content: MemoryContent;
}
