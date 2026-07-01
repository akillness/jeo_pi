import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { recordFailedAttempt, createAndSaveMemory } from "../save.js";
import { rankMemoriesByRelevance, recallMemories } from "../recall.js";
import { getCachedIndex, invalidateCache, loadMemory } from "../storage.js";
import { FAILURE_TAG } from "../types.js";

const tempRoots: string[] = [];
function tempCwd(): string {
	const root = mkdtempSync(join(tmpdir(), "failure-first-test-"));
	tempRoots.push(root);
	return root;
}

afterEach(() => {
	delete process.env.JEO_NO_MEMORY;
	for (const root of tempRoots.splice(0, tempRoots.length)) {
		invalidateCache(root);
		rmSync(root, { recursive: true, force: true });
	}
});

describe("recordFailedAttempt", () => {
	it("records a failure-tagged post-mortem with parsed structured content", () => {
		const cwd = tempCwd();
		const res = recordFailedAttempt(
			{ task: "port the OKF failure-first logic into jeo-pi", why: "consecutive failing tool calls", steps: 5, stopClass: "consecutive_failure" },
			cwd
		);
		expect(res.recorded).toBe(true);
		expect(res.memory).toBeDefined();

		invalidateCache(cwd);
		const index = getCachedIndex(cwd);
		expect(index.memories.length).toBe(1);
		const entry = index.memories[0];
		expect(entry.template).toBe("post-mortem");
		expect(entry.tags).toContain(FAILURE_TAG);
		expect(entry.summary.startsWith("Stalled on:")).toBe(true);

		const mem = loadMemory(entry.id, cwd);
		expect(mem?.template).toBe("post-mortem");
		const content = mem?.content as { problem: string; rootCause: string; fix: string; prevention: string };
		expect(content.problem).toBe("Stalled on: port the OKF failure-first logic into jeo-pi");
		expect(content.rootCause).toContain("consecutive failing tool calls");
		expect(content.rootCause).toContain("5 tool steps");
		expect(content.prevention).toContain("Do NOT repeat");
	});

	it("dedupes an identical stall instead of re-recording it", () => {
		const cwd = tempCwd();
		const attempt = { task: "fix the flaky test", why: "repeating the same tool call", steps: 4, stopClass: "repeat" };
		expect(recordFailedAttempt(attempt, cwd).recorded).toBe(true);
		const second = recordFailedAttempt(attempt, cwd);
		expect(second.recorded).toBe(false);
		expect(second.skipped).toContain("duplicate");

		invalidateCache(cwd);
		expect(getCachedIndex(cwd).memories.length).toBe(1);
	});

	it("truncates a long task into a bounded excerpt", () => {
		const cwd = tempCwd();
		const longTask = "x".repeat(200);
		const res = recordFailedAttempt({ task: longTask, why: "cycling through the same tool calls", steps: 6, stopClass: "cycle" }, cwd);
		expect(res.recorded).toBe(true);
		const content = res.memory?.content as { problem: string };
		expect(content.problem.endsWith("…")).toBe(true);
		expect(content.problem.length).toBeLessThan(90);
	});

	it("honours the JEO_NO_MEMORY kill switch", () => {
		const cwd = tempCwd();
		process.env.JEO_NO_MEMORY = "1";
		const res = recordFailedAttempt({ task: "anything", why: "repeating the same tool call", steps: 4, stopClass: "repeat" }, cwd);
		expect(res.recorded).toBe(false);
		expect(res.skipped).toContain("JEO_NO_MEMORY");
		invalidateCache(cwd);
		expect(getCachedIndex(cwd).memories.length).toBe(0);
	});

	it("skips an empty task", () => {
		const cwd = tempCwd();
		expect(recordFailedAttempt({ task: "   ", why: "repeat", steps: 4, stopClass: "repeat" }, cwd).recorded).toBe(false);
	});
});

describe("failure-first recall priority", () => {
	it("surfaces a query-relevant failure memory ahead of a non-failure candidate", () => {
		const cwd = tempCwd();
		// Non-failure memory that also matches the keyword "parser".
		createAndSaveMemory({ content: "parser refactor went smoothly", template: "compact-note", tags: ["parser"] }, cwd);
		// Failure memory for a stall on a parser task (task tokens include "parser").
		recordFailedAttempt({ task: "rewrite the parser tokenizer", why: "consecutive failing tool calls", steps: 5, stopClass: "consecutive_failure" }, cwd);

		invalidateCache(cwd);
		const index = getCachedIndex(cwd);
		const ranked = rankMemoriesByRelevance(index, ["parser"]);
		expect(ranked.length).toBe(2);
		expect(ranked[0].tags).toContain(FAILURE_TAG);
		expect(ranked[1].tags).not.toContain(FAILURE_TAG);
	});

	it("does not hoist an unrelated failure the query never hit", () => {
		const cwd = tempCwd();
		createAndSaveMemory({ content: "database migration notes", template: "compact-note", tags: ["database"] }, cwd);
		recordFailedAttempt({ task: "unrelated networking retry loop", why: "cycling through the same tool calls", steps: 6, stopClass: "cycle" }, cwd);

		invalidateCache(cwd);
		const index = getCachedIndex(cwd);
		// Query only matches the database note; the failure is not a candidate at all.
		const ranked = rankMemoriesByRelevance(index, ["database"]);
		expect(ranked.length).toBe(1);
		expect(ranked[0].tags).toContain("database");
	});

	it("end-to-end: recallMemories injects the failure memory first", async () => {
		const cwd = tempCwd();
		createAndSaveMemory({ content: "tokenizer parser cleanup", template: "compact-note", tags: ["tokenizer"] }, cwd);
		recordFailedAttempt({ task: "fix the tokenizer edge case", why: "consecutive failing tool calls", steps: 5, stopClass: "consecutive_failure" }, cwd);

		invalidateCache(cwd);
		const index = getCachedIndex(cwd);
		const { text, recalledIds } = await recallMemories(index, "working on the tokenizer again", cwd);
		expect(recalledIds.length).toBe(2);
		// The failure memory's problem line appears before the compact note's summary.
		const failurePos = text.indexOf("Stalled on: fix the tokenizer edge case");
		const notePos = text.indexOf("tokenizer parser cleanup");
		expect(failurePos).toBeGreaterThanOrEqual(0);
		expect(notePos).toBeGreaterThanOrEqual(0);
		expect(failurePos).toBeLessThan(notePos);
	});
});
