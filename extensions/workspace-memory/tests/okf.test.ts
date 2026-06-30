import { describe, it, expect } from "vitest";
import {
	conceptId,
	slugify,
	isReservedFile,
	parseConcept,
	serializeConcept,
	validateFile,
	validateBundle,
	type Frontmatter,
} from "../okf";

describe("conceptId", () => {
	it("strips .md and normalizes separators", () => {
		expect(conceptId("post-mortems/redis.md")).toBe("post-mortems/redis");
		expect(conceptId("notes\\x.MD")).toBe("notes/x");
		expect(conceptId("./decisions/a.md")).toBe("decisions/a");
	});
});

describe("slugify", () => {
	it("kebab-cases ASCII titles", () => {
		expect(slugify("Redis Timeout Fix!")).toBe("redis-timeout-fix");
		expect(slugify("  a -- b  ")).toBe("a-b");
	});
	it("preserves non-ASCII word chars (Korean)", () => {
		expect(slugify("버그 수정")).toBe("버그-수정");
	});
	it("falls back to untitled for empty/punctuation-only input", () => {
		expect(slugify("")).toBe("untitled");
		expect(slugify("!!!")).toBe("untitled");
	});
});

describe("isReservedFile", () => {
	it("recognizes index.md and log.md anywhere", () => {
		expect(isReservedFile("index.md")).toBe(true);
		expect(isReservedFile("a/b/log.md")).toBe(true);
		expect(isReservedFile("notes/x.md")).toBe(false);
	});
});

describe("frontmatter round-trip", () => {
	it("preserves key order, types, and extension keys", () => {
		const fm: Frontmatter = {
			type: "Command",
			title: "bun test",
			tags: ["test", "bun"],
			timestamp: "2026-06-23T07:21:15.001Z",
			confidence: "high",
			count: 3,
			enabled: true,
		};
		const doc = serializeConcept(fm, "# Body\n\nhello");
		const parsed = parseConcept(doc);
		expect(parsed.hasFrontmatter).toBe(true);
		expect(parsed.frontmatter).toEqual(fm);
		expect(parsed.body).toBe("# Body\n\nhello");
		// idempotent
		expect(serializeConcept(parsed.frontmatter, parsed.body)).toBe(doc);
	});

	it("quotes scalars that would otherwise reparse as number/bool", () => {
		const doc = serializeConcept({ type: "Reference", v: "0.1", b: "true" }, "x");
		expect(doc).toContain('v: "0.1"');
		expect(doc).toContain('b: "true"');
		const parsed = parseConcept(doc);
		expect(parsed.frontmatter.v).toBe("0.1");
		expect(parsed.frontmatter.b).toBe("true");
	});

	it("parses empty inline list", () => {
		const parsed = parseConcept(serializeConcept({ type: "Reference", links: [] }, "x"));
		expect(parsed.frontmatter.links).toEqual([]);
	});

	it("is tolerant of missing frontmatter block", () => {
		const parsed = parseConcept("# No frontmatter\n\nbody");
		expect(parsed.hasFrontmatter).toBe(false);
		expect(parsed.body).toBe("# No frontmatter\n\nbody");
	});
});

describe("validateFile", () => {
	it("errors when a concept doc has no frontmatter", () => {
		const issues = validateFile({ path: "notes/x.md", content: "no fm" });
		expect(issues.some((i) => i.level === "error")).toBe(true);
	});

	it("errors when type is missing/empty", () => {
		const issues = validateFile({ path: "notes/x.md", content: "---\ntitle: x\n---\nbody" });
		expect(issues.find((i) => i.message.includes("`type`"))?.level).toBe("error");
	});

	it("warns (never errors) on unknown type and missing title/description", () => {
		const issues = validateFile({ path: "facts/x.md", content: "---\ntype: RepoFact\n---\nbody" });
		expect(issues.every((i) => i.level === "warning")).toBe(true);
		expect(issues.some((i) => i.message.includes('unknown type "RepoFact"'))).toBe(true);
	});

	it("never errors on reserved index.md", () => {
		expect(validateFile({ path: "index.md", content: "# Index" })).toEqual([]);
	});

	it("errors on non-ISO date heading in log.md", () => {
		const issues = validateFile({ path: "log.md", content: "# Log\n\n## 6/23/2026\n- x" });
		expect(issues.some((i) => i.level === "error")).toBe(true);
		const ok = validateFile({ path: "log.md", content: "# Log\n\n## 2026-06-23\n- x" });
		expect(ok).toEqual([]);
	});
});

describe("validateBundle", () => {
	it("is conformant when only warnings exist", () => {
		const report = validateBundle([
			{ path: "index.md", content: "# Index" },
			{ path: "facts/x.md", content: "---\ntype: RepoFact\n---\nbody" },
		]);
		expect(report.conformant).toBe(true);
		expect(report.issues.length).toBeGreaterThan(0); // warnings present
	});

	it("is non-conformant when any error exists", () => {
		const report = validateBundle([{ path: "notes/x.md", content: "no frontmatter" }]);
		expect(report.conformant).toBe(false);
	});
});
