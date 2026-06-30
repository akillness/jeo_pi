import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
	formatMemoriesForContext,
	recallMemories,
	MAX_RECALL_CONTEXT_CHARS,
	MAX_RECALL_MEMORY_CHARS,
	MEMORIES_OMITTED_MARKER,
	MEMORY_TRUNCATED_MARKER,
} from "../recall.js";
import { createAndSaveMemory } from "../save.js";
import { conceptRelPath } from "../okf-bundle.js";
import { getCachedIndex, invalidateCache } from "../storage.js";
import type { Memory } from "../types.js";

const tempRoots: string[] = [];
function tempCwd(): string {
	const root = mkdtempSync(join(tmpdir(), "recall-test-"));
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

function makeMemory(id: string, summary: string, tags: string[] = []): Memory {
	return {
		id,
		template: "compact-note",
		metadata: {
			createdAt: "2026-05-03T00:00:00.000Z",
			tags,
			triggerKeywords: [],
		},
		content: {
			summary,
			keyPoints: [],
		},
	};
}

describe("formatMemoriesForContext", () => {
	it("returns empty context when no memories are provided", () => {
		expect(formatMemoriesForContext([])).toBe("");
	});

	it("keeps normal memory context unmodified below the prompt budget", () => {
		const text = formatMemoriesForContext([
			makeMemory("mem-1-abcd", "short useful memory", ["memory"]),
		]);

		expect(text).toContain("## Workspace Memories");
		expect(text).toContain("short useful memory");
		expect(text).toContain("**Tags:** memory");
		expect(text).not.toContain(MEMORY_TRUNCATED_MARKER);
		expect(text.length).toBeLessThanOrEqual(MAX_RECALL_CONTEXT_CHARS);
	});

	it("truncates a single oversized memory before injection", () => {
		const text = formatMemoriesForContext([
			makeMemory("mem-1-abcd", "x".repeat(MAX_RECALL_MEMORY_CHARS * 2)),
		]);

		expect(text).toContain(MEMORY_TRUNCATED_MARKER);
		expect(text.length).toBeLessThanOrEqual(MAX_RECALL_CONTEXT_CHARS);
	});

	it("omits additional memories when the total context budget is exhausted", () => {
		const memories = Array.from({ length: 10 }, (_, index) =>
			makeMemory(`mem-${index}-abcd`, `memory-${index} ${"x".repeat(MAX_RECALL_MEMORY_CHARS)}`)
		);

		const text = formatMemoriesForContext(memories);

		expect(text).toContain(MEMORIES_OMITTED_MARKER);
		expect(text.length).toBeLessThanOrEqual(MAX_RECALL_CONTEXT_CHARS);
	});
});
describe("recallMemories graph expansion", () => {
	it("pulls a 1-hop OKF neighbour into a spare slot even with no lexical match", async () => {
		const cwd = tempCwd();
		// Memory B: not lexically related to the query below.
		const b = createAndSaveMemory(
			{ content: "Connection pool exhausted at peak load", template: "post-mortem" },
			cwd
		);
		const relB = conceptRelPath(b.memory, b.entry.summary);
		// Memory A: matches the query AND links to B's concept, creating an edge.
		const a = createAndSaveMemory(
			{ content: `widgetflux throughput tuning references [pool finding](/${relB})`, template: "compact-note" },
			cwd
		);

		const index = getCachedIndex(cwd);
		const { recalledIds } = await recallMemories(index, "widgetflux throughput tuning", cwd);

		// A is the lexical hit; B surfaces only via the concept-graph channel.
		expect(recalledIds).toContain(a.memory.id);
		expect(recalledIds).toContain(b.memory.id);
	});

	it("does not surface an unlinked memory that fails the lexical filter", async () => {
		const cwd = tempCwd();
		createAndSaveMemory(
			{ content: "Connection pool exhausted at peak load", template: "post-mortem" },
			cwd
		);
		const a = createAndSaveMemory(
			{ content: "widgetflux throughput tuning has no links", template: "compact-note" },
			cwd
		);

		const index = getCachedIndex(cwd);
		const { recalledIds } = await recallMemories(index, "widgetflux throughput tuning", cwd);

		expect(recalledIds).toEqual([a.memory.id]);
	});

	it("surfaces a neighbour linked by a relative (../) markdown link", async () => {
		const cwd = tempCwd();
		const b = createAndSaveMemory(
			{ content: "Connection pool exhausted at peak load", template: "post-mortem" },
			cwd
		);
		// post-mortem B lives in post-mortems/; the note lives in notes/, so the
		// link from the note is a relative ../post-mortems/... reference.
		const relB = conceptRelPath(b.memory, b.entry.summary);
		const a = createAndSaveMemory(
			{ content: `widgetflux throughput tuning see [pool](../${relB})`, template: "compact-note" },
			cwd
		);

		const index = getCachedIndex(cwd);
		const { recalledIds } = await recallMemories(index, "widgetflux throughput tuning", cwd);

		expect(recalledIds).toContain(a.memory.id);
		expect(recalledIds).toContain(b.memory.id);
	});

	it("does not expand the graph when lexical hits already fill every slot", async () => {
		const cwd = tempCwd();
		// A non-matching memory that IS linked from a lexical hit — it must stay
		// out because there are no spare injection slots (spare === 0).
		const z = createAndSaveMemory(
			{ content: "Connection pool exhausted at peak load", template: "post-mortem" },
			cwd
		);
		const relZ = conceptRelPath(z.memory, z.entry.summary);
		// Five lexical hits all matching the query → fills MAX_RECALL_MEMORIES (5).
		const lexicalIds: string[] = [];
		for (let i = 0; i < 5; i++) {
			const body =
				i === 0
					? `widgetflux throughput tuning ${i} linking [pool](/${relZ})`
					: `widgetflux throughput tuning ${i}`;
			const m = createAndSaveMemory({ content: body, template: "compact-note" }, cwd);
			lexicalIds.push(m.memory.id);
		}

		const index = getCachedIndex(cwd);
		const { recalledIds } = await recallMemories(index, "widgetflux throughput tuning", cwd);

		expect(recalledIds).toHaveLength(5);
		expect(recalledIds).not.toContain(z.memory.id);
		for (const id of recalledIds) {
			expect(lexicalIds).toContain(id);
		}
	});
});