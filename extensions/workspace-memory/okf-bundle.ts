/**
 * OKF bundle layer — mirrors workspace memories into a human/git/graphify-readable
 * Open Knowledge Format v0.1 bundle, reflected from jeo-code's `.jeo/memory/`
 * bundle design (docs/jeo-pi/okf-memory.md).
 *
 * The JSON store (storage.ts) stays the operational source of truth for recall;
 * this bundle is an additive, durable knowledge layer. Each saved memory mirrors
 * to a concept document; `index.md` (progressive disclosure) and `log.md` (ISO
 * 8601 change history) are maintained on every change. All writes are atomic
 * (`*.tmp → rename`). `JEO_NO_MEMORY=1` disables the mirror entirely.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	renameSync,
	rmSync,
	readdirSync,
} from "fs";
import { join } from "path";
import type { Memory, MemoryTemplate } from "./types";
import {
	type Frontmatter,
	type BundleFile,
	type ConformanceReport,
	conceptId,
	isReservedFile,
	slugify,
	parseConcept,
	serializeConcept,
	validateBundle,
} from "./okf";
import {
	type GraphConcept,
	type GraphLintReport,
	buildConceptGraph,
	expandByGraph,
	lintConceptGraph,
} from "./okf-graph";

const BUNDLE_DIR_NAME = ".jeo";
const MEMORY_SUBDIR = "memory";

/** Map a jeo-pi template to its OKF `type` value. */
export const TEMPLATE_TO_TYPE: Record<MemoryTemplate, string> = {
	"post-mortem": "PostMortem",
	"decision-record": "DecisionRecord",
	"compact-note": "CompactNote",
};

/** Map a jeo-pi template to its concept directory inside the bundle. */
export const TEMPLATE_TO_DIR: Record<MemoryTemplate, string> = {
	"post-mortem": "post-mortems",
	"decision-record": "decisions",
	"compact-note": "notes",
};

/** True when memory persistence is disabled (jeo-code's kill switch). */
export function isMemoryDisabled(): boolean {
	return process.env.JEO_NO_MEMORY === "1";
}

/** Bundle root for a workspace: `<cwd>/.jeo/memory`. */
export function getBundleDir(cwd: string): string {
	return join(cwd, BUNDLE_DIR_NAME, MEMORY_SUBDIR);
}

function ensureDir(dir: string): void {
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Atomic write: write to `<path>.tmp` then rename over the target. */
function atomicWrite(path: string, content: string): void {
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, content, "utf8");
	renameSync(tmp, path);
}

// ── Memory ⇄ concept mapping ─────────────────────────────────────────────────

function shortId(memoryId: string): string {
	const parts = memoryId.split("-");
	return parts[parts.length - 1] || memoryId;
}

/** Deterministic bundle-relative concept path for a memory. */
export function conceptRelPath(memory: Memory, summary: string): string {
	const dir = TEMPLATE_TO_DIR[memory.template];
	const base = slugify(summary || memory.template);
	return `${dir}/${base}-${shortId(memory.id)}.md`;
}

function renderBody(memory: Memory): string {
	const { template, content } = memory;
	const sections: string[] = [];
	const push = (heading: string, value: string) => {
		if (value && value.trim()) sections.push(`# ${heading}\n\n${value.trim()}`);
	};
	if (template === "post-mortem") {
		const c = content as { problem: string; rootCause: string; fix: string; prevention: string };
		push("Problem", c.problem);
		push("Root Cause", c.rootCause);
		push("Fix", c.fix);
		push("Prevention", c.prevention);
	} else if (template === "decision-record") {
		const c = content as {
			context: string;
			decision: string;
			rationale: string;
			alternativesConsidered: string;
		};
		push("Context", c.context);
		push("Decision", c.decision);
		push("Rationale", c.rationale);
		push("Alternatives Considered", c.alternativesConsidered);
	} else {
		const c = content as { summary: string; keyPoints: string[] };
		push("Summary", c.summary);
		if (c.keyPoints?.length) {
			push("Key Points", c.keyPoints.map((p) => `- ${p}`).join("\n"));
		}
	}
	return sections.join("\n\n");
}

/** Build the OKF concept document (frontmatter + body) for a memory. */
export function memoryToConcept(
	memory: Memory,
	summary: string
): { relPath: string; frontmatter: Frontmatter; body: string } {
	const title = (summary || memory.template).slice(0, 120);
	const frontmatter: Frontmatter = {
		type: TEMPLATE_TO_TYPE[memory.template],
		title,
		description: summary || title,
		tags: memory.metadata.tags,
		timestamp: memory.metadata.createdAt,
		memory_id: memory.id,
		links: [],
	};
	return { relPath: conceptRelPath(memory, summary), frontmatter, body: renderBody(memory) };
}

// ── Bundle scanning ──────────────────────────────────────────────────────────

interface ScannedConcept {
	relPath: string;
	frontmatter: Frontmatter;
	body: string;
}

/** Recursively list `.md` files under a directory, returning bundle-relative paths. */
function listMarkdown(root: string, sub = ""): string[] {
	const dir = sub ? join(root, sub) : root;
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const rel = sub ? `${sub}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...listMarkdown(root, rel));
		else if (entry.name.endsWith(".md")) out.push(rel);
	}
	return out;
}

/** Load all non-reserved concept docs in the bundle. */
export function loadConcepts(cwd: string): ScannedConcept[] {
	const root = getBundleDir(cwd);
	const out: ScannedConcept[] = [];
	for (const rel of listMarkdown(root)) {
		if (isReservedFile(rel)) continue;
		const parsed = parseConcept(readFileSync(join(root, rel), "utf8"));
		out.push({ relPath: rel, frontmatter: parsed.frontmatter, body: parsed.body });
	}
	return out;
}

function asGraphConcepts(concepts: ScannedConcept[]): GraphConcept[] {
	return concepts.map((c) => ({
		relPath: c.relPath,
		body: c.body,
		title: typeof c.frontmatter.title === "string" ? c.frontmatter.title : undefined,
	}));
}

// ── index.md / log.md maintenance ────────────────────────────────────────────

const TYPE_HEADINGS: Array<{ type: string; heading: string }> = [
	{ type: "PostMortem", heading: "Post-mortems" },
	{ type: "DecisionRecord", heading: "Decisions" },
	{ type: "CompactNote", heading: "Notes" },
	{ type: "Reference", heading: "References" },
];

/** Rebuild `index.md` from the concept docs (OKF progressive disclosure). */
export function rebuildIndex(cwd: string): void {
	const root = getBundleDir(cwd);
	ensureDir(root);
	const concepts = loadConcepts(cwd);
	const byType = new Map<string, ScannedConcept[]>();
	for (const c of concepts) {
		const type = typeof c.frontmatter.type === "string" ? c.frontmatter.type : "Reference";
		const bucket = byType.get(type) ?? [];
		bucket.push(c);
		byType.set(type, bucket);
	}
	const lines: string[] = ['---', 'okf_version: "0.1"', "---", "", "# Index", ""];
	const orderedTypes = [
		...TYPE_HEADINGS,
		...[...byType.keys()]
			.filter((t) => !TYPE_HEADINGS.some((h) => h.type === t))
			.map((t) => ({ type: t, heading: t })),
	];
	let any = false;
	for (const { type, heading } of orderedTypes) {
		const bucket = byType.get(type);
		if (!bucket || bucket.length === 0) continue;
		any = true;
		lines.push(`## ${heading}`);
		bucket.sort((a, b) => a.relPath.localeCompare(b.relPath));
		for (const c of bucket) {
			const title = typeof c.frontmatter.title === "string" ? c.frontmatter.title : conceptId(c.relPath);
			const desc = typeof c.frontmatter.description === "string" ? c.frontmatter.description : "";
			const suffix = desc && desc !== title ? ` — ${desc}` : "";
			lines.push(`- [${title}](/${c.relPath})${suffix}`);
		}
		lines.push("");
	}
	if (!any) lines.push("_No concepts yet._", "");
	atomicWrite(join(root, "index.md"), lines.join("\n").replace(/\n+$/, "\n"));
}

function isoDate(d = new Date()): string {
	return d.toISOString().slice(0, 10);
}

/** Prepend a dated entry to `log.md` (ISO 8601 date heading, newest first). */
export function appendLog(cwd: string, entry: string): void {
	const root = getBundleDir(cwd);
	ensureDir(root);
	const logPath = join(root, "log.md");
	const today = isoDate();
	const bullet = `- ${entry}`;
	let existing = existsSync(logPath) ? readFileSync(logPath, "utf8") : "# Log\n";
	if (!existing.startsWith("# Log")) existing = `# Log\n\n${existing}`;

	const lines = existing.split("\n");
	// Find an existing heading for today to append under, else insert a new one.
	const headingIdx = lines.findIndex((l) => l.trim() === `## ${today}`);
	if (headingIdx >= 0) {
		lines.splice(headingIdx + 1, 0, bullet);
	} else {
		// Insert a fresh dated section right after the `# Log` title (newest first).
		let insertAt = lines.findIndex((l) => l.startsWith("# Log"));
		insertAt = insertAt === -1 ? 0 : insertAt + 1;
		lines.splice(insertAt, 0, "", `## ${today}`, bullet);
	}
	atomicWrite(logPath, lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n"));
}

// ── Public mutations ─────────────────────────────────────────────────────────

/** Mirror a saved memory into the bundle: write the concept, refresh index, log. */
export function mirrorMemory(memory: Memory, summary: string, cwd: string): string | null {
	if (isMemoryDisabled()) return null;
	const root = getBundleDir(cwd);
	const { relPath, frontmatter, body } = memoryToConcept(memory, summary);
	const full = join(root, relPath);
	ensureDir(join(full, ".."));
	atomicWrite(full, serializeConcept(frontmatter, body));
	rebuildIndex(cwd);
	appendLog(cwd, `saved [${frontmatter.type}] ${conceptId(relPath)}`);
	return relPath;
}

/** Remove the concept doc(s) mirroring a memory id, then refresh index + log. */
export function removeMemoryConcept(memoryId: string, cwd: string): boolean {
	if (isMemoryDisabled()) return false;
	const root = getBundleDir(cwd);
	let removed = false;
	for (const c of loadConcepts(cwd)) {
		if (c.frontmatter.memory_id === memoryId) {
			rmSync(join(root, c.relPath), { force: true });
			removed = true;
		}
	}
	if (removed) {
		rebuildIndex(cwd);
		appendLog(cwd, `removed memory ${memoryId}`);
	}
	return removed;
}

// ── Recall expansion ─────────────────────────────────────────────────────────

/**
 * Bundle-backed recall expansion (jeo-code's concept-graph recall channel): map
 * the recalled memory ids to their concept nodes, expand 1-hop along the
 * cross-link graph, and return the neighbouring memories' ids (excluding the
 * seeds), deterministically ordered and capped at `limit`.
 *
 * Returns `[]` when memory is disabled, the bundle is absent, the seeds map to
 * no concept node, or no cross-links exist — so a link-free bundle is inert and
 * a strongly-linked neighbour surfaces only when memories actually reference each
 * other (edges come from markdown links in concept bodies, exactly as in
 * jeo-code). Callers use it to fill spare injection slots, never to crowd out
 * lexical hits.
 */
export function expandRecallByGraph(seedMemoryIds: string[], cwd: string, limit = 3): string[] {
	if (isMemoryDisabled() || limit <= 0 || seedMemoryIds.length === 0) return [];
	if (!existsSync(getBundleDir(cwd))) return [];
	const concepts = loadConcepts(cwd);
	if (concepts.length === 0) return [];

	const conceptToMemory = new Map<string, string>();
	const memoryToConceptId = new Map<string, string>();
	for (const c of concepts) {
		const mid = typeof c.frontmatter.memory_id === "string" ? c.frontmatter.memory_id : undefined;
		if (!mid) continue;
		const cid = conceptId(c.relPath);
		conceptToMemory.set(cid, mid);
		memoryToConceptId.set(mid, cid);
	}

	const seedSet = new Set(seedMemoryIds);
	const seedConceptIds = seedMemoryIds
		.map((m) => memoryToConceptId.get(m))
		.filter((x): x is string => x !== undefined);
	if (seedConceptIds.length === 0) return [];
	const seedConceptSet = new Set(seedConceptIds);

	const graph = buildConceptGraph(asGraphConcepts(concepts));
	const reachable = [...expandByGraph(seedConceptIds, graph, 1)].sort();

	const out: string[] = [];
	const seenMem = new Set<string>();
	for (const cid of reachable) {
		if (seedConceptSet.has(cid)) continue;
		const mid = conceptToMemory.get(cid);
		if (!mid || seedSet.has(mid) || seenMem.has(mid)) continue;
		seenMem.add(mid);
		out.push(mid);
		if (out.length >= limit) break;
	}
	return out;
}

// ── Lint ─────────────────────────────────────────────────────────────────────

export interface BundleLintReport {
	conformance: ConformanceReport;
	graph: GraphLintReport;
}

/** Run OKF conformance + graph lint over the whole bundle (advisory). */
export function lintBundle(cwd: string): BundleLintReport {
	const root = getBundleDir(cwd);
	const files: BundleFile[] = [];
	for (const rel of listMarkdown(root)) {
		files.push({ path: rel, content: readFileSync(join(root, rel), "utf8") });
	}
	const concepts = loadConcepts(cwd);
	const graphConcepts = asGraphConcepts(concepts);
	const graph = buildConceptGraph(graphConcepts);
	return {
		conformance: validateBundle(files),
		graph: lintConceptGraph(graphConcepts, graph),
	};
}
