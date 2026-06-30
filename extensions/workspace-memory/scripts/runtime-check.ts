/**
 * Real-runtime verification driver for workspace-memory OKF recall.
 *
 * Drives the public API exactly as the extension does (createAndSaveMemory →
 * recallMemories), against a fresh temp workspace, then inspects the on-disk
 * `.jeo/memory` bundle and the recall result. Not a unit test — it exercises the
 * real filesystem mirror + graph-expansion channel and asserts observable
 * behavior. Run: npx tsx scripts/runtime-check.ts
 */
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createAndSaveMemory } from "../save.js";
import { recallMemories } from "../recall.js";
import { conceptRelPath, getBundleDir, lintBundle } from "../okf-bundle.js";
import { getCachedIndex, invalidateCache } from "../storage.js";

let failures = 0;
function check(label: string, cond: boolean, detail?: string): void {
	const mark = cond ? "\u2713" : "\u2717";
	if (!cond) failures++;
	console.log(`  ${mark} ${label}${cond ? "" : `  <-- FAIL ${detail ?? ""}`}`);
}

function listBundle(root: string, sub = ""): string[] {
	const dir = sub ? join(root, sub) : root;
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const rel = sub ? `${sub}/${e.name}` : e.name;
		if (e.isDirectory()) out.push(...listBundle(root, rel));
		else out.push(rel);
	}
	return out.sort();
}

async function withTemp(fn: (cwd: string) => void | Promise<void>): Promise<void> {
	const cwd = mkdtempSync(join(tmpdir(), "wm-runtime-"));
	try {
		await fn(cwd);
	} finally {
		invalidateCache(cwd);
		rmSync(cwd, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	// ── Scenario 1: save mirrors to a real OKF bundle on disk ────────────────
	console.log("Scenario 1: save \u2192 on-disk OKF bundle");
	await withTemp((cwd) => {
		const r = createAndSaveMemory(
			{ content: "Redis connection timeout under load; raised pool size to fix.", template: "post-mortem" },
			cwd
		);
		const bundle = getBundleDir(cwd);
		const files = listBundle(bundle);
		check("bundle dir created", existsSync(bundle), bundle);
		check("index.md written", files.includes("index.md"), files.join());
		check("log.md written", files.includes("log.md"), files.join());
		const rel = conceptRelPath(r.memory, r.entry.summary);
		check("concept doc mirrored", files.includes(rel), `${rel} not in ${files.join()}`);
		const concept = readFileSync(join(bundle, rel), "utf8");
		check("concept carries memory_id frontmatter", concept.includes(`memory_id: ${r.memory.id}`), concept.slice(0, 200));
		check("concept carries OKF type", concept.includes("type: PostMortem"), concept.slice(0, 200));
		const index = readFileSync(join(bundle, "index.md"), "utf8");
		check("index lists concept link", index.includes(`(/${rel})`), index);
	});

	// ── Scenario 2: graph-expansion recall surfaces a linked neighbour ──────
	console.log("Scenario 2: recall graph expansion (linked neighbour)");
	await withTemp(async (cwd) => {
		const b = createAndSaveMemory(
			{ content: "Connection pool exhausted at peak load", template: "post-mortem" },
			cwd
		);
		const relB = conceptRelPath(b.memory, b.entry.summary);
		const a = createAndSaveMemory(
			{ content: `widgetflux throughput tuning references [pool finding](/${relB})`, template: "compact-note" },
			cwd
		);
		const index = getCachedIndex(cwd);
		const res = await recallMemories(index, "widgetflux throughput tuning", cwd);
		check("lexical hit A recalled", res.recalledIds.includes(a.memory.id), res.recalledIds.join());
		check("neighbour B surfaced via graph", res.recalledIds.includes(b.memory.id), res.recalledIds.join());
		check("injected text contains both", res.text.includes("widgetflux") && res.text.includes("Connection pool"), "missing one");
	});

	// ── Scenario 3: unlinked memory stays out of recall ─────────────────────
	console.log("Scenario 3: recall without links (no false expansion)");
	await withTemp(async (cwd) => {
		createAndSaveMemory({ content: "Connection pool exhausted at peak load", template: "post-mortem" }, cwd);
		const a = createAndSaveMemory({ content: "widgetflux throughput tuning has no links", template: "compact-note" }, cwd);
		const index = getCachedIndex(cwd);
		const res = await recallMemories(index, "widgetflux throughput tuning", cwd);
		check("only lexical hit recalled", JSON.stringify(res.recalledIds) === JSON.stringify([a.memory.id]), res.recalledIds.join());
	});

	// ── Scenario 4: JEO_NO_MEMORY kill switch suppresses the bundle ─────────
	console.log("Scenario 4: JEO_NO_MEMORY kill switch");
	await withTemp((cwd) => {
		process.env.JEO_NO_MEMORY = "1";
		try {
			createAndSaveMemory({ content: "should not mirror", template: "compact-note" }, cwd);
			check("no bundle dir created when disabled", !existsSync(getBundleDir(cwd)), getBundleDir(cwd));
		} finally {
			delete process.env.JEO_NO_MEMORY;
		}
	});

	// ── Scenario 5: lint is clean for a well-formed linked bundle ───────────
	console.log("Scenario 5: lint clean for valid linked bundle");
	await withTemp((cwd) => {
		const b = createAndSaveMemory({ content: "Connection pool exhausted at peak load", template: "post-mortem" }, cwd);
		const relB = conceptRelPath(b.memory, b.entry.summary);
		createAndSaveMemory(
			{ content: `tuning note linking [pool](/${relB})`, template: "compact-note" },
			cwd
		);
		const report = lintBundle(cwd);
		check("no broken links", report.graph.brokenLinks.length === 0, JSON.stringify(report.graph.brokenLinks));
		check("conformance ok", report.conformance.conformant === true, JSON.stringify(report.conformance).slice(0, 200));
	});

	console.log(failures === 0 ? "\nALL RUNTIME CHECKS PASSED" : `\n${failures} RUNTIME CHECK(S) FAILED`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
