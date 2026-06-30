import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Memory } from "../types";
import {
	getBundleDir,
	mirrorMemory,
	removeMemoryConcept,
	rebuildIndex,
	appendLog,
	lintBundle,
	memoryToConcept,
	expandRecallByGraph,
	TEMPLATE_TO_TYPE,
} from "../okf-bundle";
import { parseConcept, validateBundle, type BundleFile } from "../okf";

const tempRoots: string[] = [];
function tempCwd(): string {
	const root = mkdtempSync(join(tmpdir(), "okf-bundle-test-"));
	tempRoots.push(root);
	return root;
}

afterEach(() => {
	delete process.env.JEO_NO_MEMORY;
	for (const root of tempRoots.splice(0, tempRoots.length)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function postMortem(id: string): Memory {
	return {
		id,
		template: "post-mortem",
		metadata: { createdAt: "2026-06-23T07:21:15.001Z", tags: ["redis", "timeout"], triggerKeywords: ["bug"] },
		content: {
			problem: "Redis connection times out under load",
			rootCause: "Pool exhausted",
			fix: "Raise max pool size to 50",
			prevention: "Add a pool-saturation alert",
		},
	};
}

function decision(id: string): Memory {
	return {
		id,
		template: "decision-record",
		metadata: { createdAt: "2026-06-24T08:00:00.000Z", tags: ["arch"], triggerKeywords: ["decision"] },
		content: {
			context: "Need a queue",
			decision: "Use Redis streams",
			rationale: "Already a dependency",
			alternativesConsidered: "Kafka, SQS",
		},
	};
}

describe("memoryToConcept", () => {
	it("maps template to OKF type, dir, and structured body", () => {
		const { relPath, frontmatter, body } = memoryToConcept(postMortem("mem-1-abcd"), "Redis timeout");
		expect(frontmatter.type).toBe(TEMPLATE_TO_TYPE["post-mortem"]);
		expect(relPath.startsWith("post-mortems/")).toBe(true);
		expect(relPath.endsWith("-abcd.md")).toBe(true);
		expect(frontmatter.memory_id).toBe("mem-1-abcd");
		expect(body).toContain("# Problem");
		expect(body).toContain("# Fix");
		expect(body).toContain("Raise max pool size to 50");
	});
});

describe("mirrorMemory", () => {
	it("writes a conformant concept doc, index.md, and log.md", () => {
		const cwd = tempCwd();
		const rel = mirrorMemory(postMortem("mem-1-abcd"), "Redis timeout", cwd);
		const root = getBundleDir(cwd);
		expect(rel).toBeTruthy();
		expect(existsSync(join(root, rel!))).toBe(true);

		// Concept doc parses and is conformant.
		const parsed = parseConcept(readFileSync(join(root, rel!), "utf8"));
		expect(parsed.frontmatter.type).toBe("PostMortem");

		// index.md is reserved (okf_version) and links the concept.
		const index = readFileSync(join(root, "index.md"), "utf8");
		expect(index).toContain('okf_version: "0.1"');
		expect(index).toContain("## Post-mortems");
		expect(index).toContain(`(/${rel})`);

		// log.md has an ISO date heading and a saved entry.
		const log = readFileSync(join(root, "log.md"), "utf8");
		expect(/^## \d{4}-\d{2}-\d{2}$/m.test(log)).toBe(true);
		expect(log).toContain("saved [PostMortem]");

		// Whole bundle is OKF-conformant.
		const files: BundleFile[] = readdirSyncRecursive(root).map((p) => ({
			path: p,
			content: readFileSync(join(root, p), "utf8"),
		}));
		expect(validateBundle(files).conformant).toBe(true);
	});

	it("groups multiple types under their headings in index.md", () => {
		const cwd = tempCwd();
		mirrorMemory(postMortem("mem-1-aaaa"), "PM one", cwd);
		mirrorMemory(decision("mem-2-bbbb"), "Use Redis streams", cwd);
		const index = readFileSync(join(getBundleDir(cwd), "index.md"), "utf8");
		expect(index).toContain("## Post-mortems");
		expect(index).toContain("## Decisions");
	});

	it("does nothing when JEO_NO_MEMORY=1", () => {
		const cwd = tempCwd();
		process.env.JEO_NO_MEMORY = "1";
		expect(mirrorMemory(postMortem("mem-1-abcd"), "x", cwd)).toBeNull();
		expect(existsSync(getBundleDir(cwd))).toBe(false);
	});
});

describe("removeMemoryConcept", () => {
	it("removes the concept and refreshes the index", () => {
		const cwd = tempCwd();
		const rel = mirrorMemory(postMortem("mem-1-abcd"), "Redis timeout", cwd)!;
		expect(removeMemoryConcept("mem-1-abcd", cwd)).toBe(true);
		expect(existsSync(join(getBundleDir(cwd), rel))).toBe(false);
		const index = readFileSync(join(getBundleDir(cwd), "index.md"), "utf8");
		expect(index).not.toContain(`(/${rel})`);
	});

	it("returns false for an unknown memory id", () => {
		const cwd = tempCwd();
		mirrorMemory(postMortem("mem-1-abcd"), "x", cwd);
		expect(removeMemoryConcept("mem-9-zzzz", cwd)).toBe(false);
	});
});

describe("appendLog", () => {
	it("groups same-day entries under one ISO heading, newest first", () => {
		const cwd = tempCwd();
		appendLog(cwd, "first");
		appendLog(cwd, "second");
		const log = readFileSync(join(getBundleDir(cwd), "log.md"), "utf8");
		const headings = log.match(/^## \d{4}-\d{2}-\d{2}$/gm) ?? [];
		expect(headings.length).toBe(1);
		expect(log.indexOf("second")).toBeLessThan(log.indexOf("first"));
	});
});

describe("lintBundle", () => {
	it("reports conformance and graph health", () => {
		const cwd = tempCwd();
		mirrorMemory(postMortem("mem-1-abcd"), "Redis timeout", cwd);
		const report = lintBundle(cwd);
		expect(report.conformance.conformant).toBe(true);
		// A single auto-saved memory has no cross-links → it is an orphan.
		expect(report.graph.orphans.length).toBe(1);
		expect(report.graph.brokenLinks.length).toBe(0);
	});
});

describe("rebuildIndex", () => {
	it("creates an empty-but-valid index when there are no concepts", () => {
		const cwd = tempCwd();
		rebuildIndex(cwd);
		const index = readFileSync(join(getBundleDir(cwd), "index.md"), "utf8");
		expect(index).toContain('okf_version: "0.1"');
		expect(index).toContain("No concepts yet");
	});
});

describe("expandRecallByGraph", () => {
	// Mirror two memories where A's body links to B's concept (edges come from
	// markdown links in concept bodies), then assert 1-hop neighbour discovery.
	function linkBundle(cwd: string): { relB: string } {
		const relB = mirrorMemory(postMortem("mem-b-bbbb"), "Pool exhausted", cwd)!;
		const memA: Memory = {
			id: "mem-a-aaaa",
			template: "decision-record",
			metadata: { createdAt: "2026-06-24T08:00:00.000Z", tags: ["arch"], triggerKeywords: ["decision"] },
			content: {
				context: "Need a queue",
				decision: "Use Redis streams",
				rationale: `Builds on the earlier finding [pool exhaustion](/${relB}).`,
				alternativesConsidered: "Kafka",
			},
		};
		mirrorMemory(memA, "Use Redis streams", cwd);
		return { relB };
	}

	it("returns the linked neighbour's memory id from a seed", () => {
		const cwd = tempCwd();
		linkBundle(cwd);
		expect(expandRecallByGraph(["mem-a-aaaa"], cwd)).toEqual(["mem-b-bbbb"]);
	});

	it("is undirected: the neighbour also reaches the source", () => {
		const cwd = tempCwd();
		linkBundle(cwd);
		expect(expandRecallByGraph(["mem-b-bbbb"], cwd)).toEqual(["mem-a-aaaa"]);
	});

	it("excludes the seeds themselves and respects the limit", () => {
		const cwd = tempCwd();
		linkBundle(cwd);
		expect(expandRecallByGraph(["mem-a-aaaa", "mem-b-bbbb"], cwd)).toEqual([]);
		expect(expandRecallByGraph(["mem-a-aaaa"], cwd, 0)).toEqual([]);
	});

	it("is inert for a link-free bundle, unknown seeds, or disabled memory", () => {
		const cwd = tempCwd();
		mirrorMemory(postMortem("mem-1-abcd"), "Redis timeout", cwd);
		expect(expandRecallByGraph(["mem-1-abcd"], cwd)).toEqual([]);
		expect(expandRecallByGraph(["mem-9-zzzz"], cwd)).toEqual([]);
		const linked = tempCwd();
		linkBundle(linked);
		process.env.JEO_NO_MEMORY = "1";
		expect(expandRecallByGraph(["mem-a-aaaa"], linked)).toEqual([]);
	});
});

// Helper: recursive list of bundle-relative paths.
function readdirSyncRecursive(root: string, sub = ""): string[] {
	const dir = sub ? join(root, sub) : root;
	const out: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const rel = sub ? `${sub}/${e.name}` : e.name;
		if (e.isDirectory()) out.push(...readdirSyncRecursive(root, rel));
		else out.push(rel);
	}
	return out;
}
