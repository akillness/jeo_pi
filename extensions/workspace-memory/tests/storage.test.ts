import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadIndex } from "../storage.js";

/**
 * Regression: a fresh (file-absent) index must own its own `memories` array.
 * Previously loadIndex spread a module-level DEFAULT_INDEX whose `memories: []`
 * was shared by reference, so two distinct empty workspaces aliased the same
 * list and leaked entries across workspaces in-process.
 */
describe("loadIndex default-index isolation", () => {
	function freshCwd(): string {
		// A path with no index.json on disk → loadIndex returns a default index.
		return join(mkdtempSync(join(tmpdir(), "storage-test-")), "nonexistent-workspace");
	}

	it("gives each empty workspace an independent memories array", () => {
		const cwdA = freshCwd();
		const cwdB = freshCwd();
		try {
			const a = loadIndex(cwdA);
			const b = loadIndex(cwdB);

			expect(a.memories).toEqual([]);
			expect(b.memories).toEqual([]);
			// Distinct array instances — mutating one must not touch the other.
			expect(a.memories).not.toBe(b.memories);

			a.memories.push({
				id: "mem-1-aaaa",
				file: "mem-1-aaaa.json",
				template: "compact-note",
				summary: "leak probe",
				tags: [],
				createdAt: "2026-01-01T00:00:00.000Z",
				lastRecalledAt: null,
				recallCount: 0,
				score: 0,
			});

			expect(b.memories).toEqual([]);
			// A subsequently-built default index must also stay clean.
			expect(loadIndex(freshCwd()).memories).toEqual([]);
		} finally {
			rmSync(join(cwdA, ".."), { recursive: true, force: true });
			rmSync(join(cwdB, ".."), { recursive: true, force: true });
		}
	});

	it("stamps the requested workspace onto the default index", () => {
		const cwd = freshCwd();
		try {
			expect(loadIndex(cwd).workspace).toBe(cwd);
		} finally {
			rmSync(join(cwd, ".."), { recursive: true, force: true });
		}
	});
});
