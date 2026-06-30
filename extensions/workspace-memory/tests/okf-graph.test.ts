import { describe, it, expect } from "vitest";
import {
	resolveLinkTarget,
	buildConceptGraph,
	expandByGraph,
	lintConceptGraph,
	type GraphConcept,
} from "../okf-graph";

describe("resolveLinkTarget", () => {
	it("resolves bundle-absolute links", () => {
		expect(resolveLinkTarget("notes/a", "/decisions/x.md")).toBe("decisions/x");
	});
	it("resolves relative links against the source dir", () => {
		expect(resolveLinkTarget("post-mortems/a", "../notes/b.md")).toBe("notes/b");
		expect(resolveLinkTarget("notes/a", "./c.md")).toBe("notes/c");
	});
	it("strips anchors and query strings", () => {
		expect(resolveLinkTarget("notes/a", "/notes/b.md#section?x=1")).toBe("notes/b");
	});
	it("rejects external/protocol/anchor links and escapes", () => {
		expect(resolveLinkTarget("notes/a", "https://x.com")).toBeNull();
		expect(resolveLinkTarget("notes/a", "#frag")).toBeNull();
		expect(resolveLinkTarget("notes/a", "../../escape.md")).toBeNull();
	});
});

const concepts: GraphConcept[] = [
	{ relPath: "notes/a.md", title: "A", body: "see [b](/notes/b.md) and [ghost](/notes/ghost.md)" },
	{ relPath: "notes/b.md", title: "B", body: "see [c](./c.md)" },
	{ relPath: "notes/c.md", title: "C", body: "no links here" },
	{ relPath: "notes/d.md", title: "A", body: "orphan, duplicate title of A" },
];

describe("buildConceptGraph", () => {
	it("records real edges and tolerates broken links", () => {
		const g = buildConceptGraph(concepts);
		expect(g.nodes.has("notes/a")).toBe(true);
		expect([...(g.edges.get("notes/a") ?? [])]).toContain("notes/b");
		expect([...(g.broken.get("notes/a") ?? [])]).toContain("notes/ghost");
	});
});

describe("expandByGraph", () => {
	it("expands seeds along 1 hop (undirected)", () => {
		const g = buildConceptGraph(concepts);
		const out = expandByGraph(["notes/a"], g, 1);
		expect(out.has("notes/a")).toBe(true);
		expect(out.has("notes/b")).toBe(true);
		expect(out.has("notes/c")).toBe(false); // 2 hops away
	});
	it("reaches 2 hops with hops=2", () => {
		const g = buildConceptGraph(concepts);
		const out = expandByGraph(["notes/a"], g, 2);
		expect(out.has("notes/c")).toBe(true);
	});
	it("drops seeds that are not nodes", () => {
		const g = buildConceptGraph(concepts);
		expect(expandByGraph(["notes/missing"], g, 1).size).toBe(0);
	});
});

describe("lintConceptGraph", () => {
	it("reports orphans, broken links, and duplicate titles", () => {
		const g = buildConceptGraph(concepts);
		const report = lintConceptGraph(concepts, g);
		expect(report.orphans).toContain("notes/d");
		expect(report.brokenLinks).toContainEqual({ from: "notes/a", to: "notes/ghost" });
		const dup = report.duplicates.find((d) => d.title === "A");
		expect(dup?.ids).toEqual(["notes/a", "notes/d"]);
	});
});
