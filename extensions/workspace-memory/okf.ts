/**
 * OKF (Open Knowledge Format) v0.1 foundation for jeo-pi workspace memory.
 *
 * Reflected from jeo-code's `src/agent/memory-okf.ts` and adapted to jeo-pi's
 * `workspace-memory` template vocabulary. Pure schema/format layer: YAML-
 * frontmatter parse/serialize (extension keys round-trip preserved), concept-ID
 * computation, slugging, and a tolerant v0.1 conformance validator.
 *
 * Why a bespoke YAML subset (not a dependency): OKF frontmatter is intentionally
 * tiny — flat `key: value` pairs with scalars and inline `[a, b]` lists. A
 * focused parser keeps the extension dependency-light and gives exact round-trip
 * control over extension keys (`memory_id`, `confidence`, `source_session`).
 *
 * Design contract: docs/jeo-pi/okf-memory.md
 */

/** jeo-pi's `type` vocabulary, adapted from its memory templates. OKF requires no
 *  central registry; unknown types (e.g. jeo-code's RepoFact/Command/Gotcha) are
 *  TOLERATED by the validator (lenient consumption model). */
export const JEO_PI_TYPES = [
	"PostMortem",
	"DecisionRecord",
	"CompactNote",
	"Reference",
] as const;

export type JeoPiType = (typeof JEO_PI_TYPES)[number];

/** Reserved OKF filenames — never concept documents. */
export const RESERVED_FILES = ["index.md", "log.md"] as const;

/** A parsed frontmatter value: scalar or inline list of strings. */
export type FrontmatterValue = string | number | boolean | string[];
/** Ordered frontmatter map (JS string-key insertion order is preserved). */
export type Frontmatter = Record<string, FrontmatterValue>;

export interface ParsedConcept {
	/** Frontmatter map, key order preserved. Empty when no frontmatter block. */
	frontmatter: Frontmatter;
	/** Markdown body after the closing `---` (leading newlines trimmed). */
	body: string;
	/** True when a `---`-delimited frontmatter block was found and parsed. */
	hasFrontmatter: boolean;
}

// ── Concept identity ────────────────────────────────────────────────────────

/** Concept ID = bundle-relative path with `.md` stripped and separators
 *  normalized to `/` (OKF rule: `post-mortems/x.md` → `post-mortems/x`). */
export function conceptId(bundleRelativePath: string): string {
	const norm = bundleRelativePath.replace(/\\/g, "/").replace(/^\.?\/+/, "");
	return norm.replace(/\.md$/i, "");
}

/** Basename of a bundle-relative path (handles both separators). */
function basename(p: string): string {
	const norm = p.replace(/\\/g, "/");
	const i = norm.lastIndexOf("/");
	return i === -1 ? norm : norm.slice(i + 1);
}

/** True when a path's filename is an OKF reserved file (`index.md`/`log.md`). */
export function isReservedFile(bundleRelativePath: string): boolean {
	const base = basename(bundleRelativePath).toLowerCase();
	return (RESERVED_FILES as readonly string[]).includes(base);
}

/** kebab-case slug for a concept filename: lowercased, non-alphanumerics → `-`,
 *  collapsed and trimmed. Non-ASCII (e.g. Korean) is preserved as Unicode word
 *  characters so localized titles stay legible. Empty input yields `untitled`. */
export function slugify(title: string): string {
	const slug = title
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");
	return slug || "untitled";
}

// ── Frontmatter parse / serialize (round-trip preserving) ────────────────────

function unquote(raw: string): string {
	const s = raw.trim();
	if (
		s.length >= 2 &&
		((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))
	) {
		return s.slice(1, -1);
	}
	return s;
}

/** Parse a single scalar token into the narrowest faithful JS value. */
function parseScalar(raw: string): FrontmatterValue {
	const s = raw.trim();
	if (s.length === 0) return "";
	// Quoted strings are ALWAYS strings (preserve e.g. okf_version "0.1").
	if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) {
		return unquote(s);
	}
	if (s === "true") return true;
	if (s === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(s)) {
		const n = Number(s);
		if (Number.isFinite(n)) return n;
	}
	return s;
}

/** Parse one frontmatter value, supporting inline `[a, b, c]` lists. */
function parseValue(raw: string): FrontmatterValue {
	const s = raw.trim();
	if (s.startsWith("[") && s.endsWith("]")) {
		const inner = s.slice(1, -1).trim();
		if (inner === "") return [];
		return inner.split(",").map((item) => unquote(item.trim()));
	}
	return parseScalar(s);
}

/**
 * Parse an OKF concept document into `{ frontmatter, body, hasFrontmatter }`.
 * Tolerant: a document without a `---` block yields an empty frontmatter and the
 * whole text as body (conformance is judged separately by the validator).
 */
export function parseConcept(text: string): ParsedConcept {
	const lines = text.split("\n");
	// A frontmatter block must START at line 0 with a bare `---`.
	if (lines[0]?.trim() !== "---") {
		return { frontmatter: {}, body: text, hasFrontmatter: false };
	}
	let end = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === "---") {
			end = i;
			break;
		}
	}
	if (end === -1) {
		// Opening `---` with no close: not a valid block — treat as bodyless content.
		return { frontmatter: {}, body: text, hasFrontmatter: false };
	}
	const frontmatter: Frontmatter = {};
	for (let i = 1; i < end; i++) {
		const line = lines[i] ?? "";
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		const colon = line.indexOf(":");
		if (colon === -1) continue; // skip malformed lines tolerantly
		const key = line.slice(0, colon).trim();
		if (!key) continue;
		frontmatter[key] = parseValue(line.slice(colon + 1));
	}
	const body = lines
		.slice(end + 1)
		.join("\n")
		.replace(/^\n+/, "");
	return { frontmatter, body, hasFrontmatter: true };
}

/** True when a string scalar must be quoted to round-trip as a string (i.e. it
 *  would otherwise parse back as a number/bool, or has fragile edges). */
function needsQuoting(s: string): boolean {
	if (s === "") return true;
	if (s === "true" || s === "false") return true;
	if (/^-?\d+(\.\d+)?$/.test(s)) return true;
	if (s !== s.trim()) return true; // leading/trailing whitespace
	if (/[:#\[\]{}",']/.test(s)) return true;
	return false;
}

function serializeScalar(v: string | number | boolean): string {
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	return needsQuoting(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

function serializeValue(v: FrontmatterValue): string {
	if (Array.isArray(v)) {
		return `[${v.map((item) => (needsQuoting(item) ? `"${item.replace(/"/g, '\\"')}"` : item)).join(", ")}]`;
	}
	return serializeScalar(v);
}

/**
 * Serialize frontmatter + body back into an OKF concept document.
 * Key order is preserved; `serialize(parse(x))` is idempotent for documents this
 * module produced. Body gets exactly one blank line after the block.
 */
export function serializeConcept(frontmatter: Frontmatter, body: string): string {
	const fmLines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${serializeValue(v)}`);
	const block = ["---", ...fmLines, "---"].join("\n");
	const trimmedBody = body.replace(/^\n+/, "");
	return trimmedBody ? `${block}\n\n${trimmedBody}` : `${block}\n`;
}

// ── OKF v0.1 conformance ─────────────────────────────────────────────────────

export interface BundleFile {
	/** Bundle-relative path, e.g. `post-mortems/redis-timeout.md`. */
	path: string;
	/** Raw file contents. */
	content: string;
}

export interface ConformanceIssue {
	path: string;
	/** `error` fails conformance; `warning` is a lenient-guide hint only. */
	level: "error" | "warning";
	message: string;
}

export interface ConformanceReport {
	conformant: boolean;
	issues: ConformanceIssue[];
}

const ISO_DATE_HEADING = /^#{1,6}\s+(\d{4}-\d{2}-\d{2})/;

/**
 * Validate one file against OKF v0.1 + jeo-pi conventions.
 *
 * Errors (reject conformance):
 *  - non-reserved `.md` missing a parseable frontmatter block.
 *  - frontmatter with missing or empty `type`.
 *  - `log.md` date heading that is not ISO 8601 `YYYY-MM-DD`.
 *
 * Warnings (lenient guides — never reject):
 *  - unknown `type` value.
 *  - missing recommended fields (`title`, `description`).
 */
export function validateFile(file: BundleFile): ConformanceIssue[] {
	const issues: ConformanceIssue[] = [];
	const base = basename(file.path).toLowerCase();

	if (base === "log.md") {
		for (const line of file.content.split("\n")) {
			if (!/^#{1,6}\s+\S+/.test(line)) continue;
			// Only enforce on headings that look like dates; tolerate prose headings.
			if (/^#{1,6}\s+\d/.test(line) && !ISO_DATE_HEADING.test(line)) {
				issues.push({
					path: file.path,
					level: "error",
					message: `log.md date heading not ISO 8601 (YYYY-MM-DD): "${line.trim()}"`,
				});
			}
		}
		return issues;
	}

	if (base === "index.md") {
		// Reserved: index.md needs no frontmatter; nothing to reject.
		return issues;
	}

	// Concept document.
	const parsed = parseConcept(file.content);
	if (!parsed.hasFrontmatter) {
		issues.push({
			path: file.path,
			level: "error",
			message: "concept document missing YAML frontmatter block",
		});
		return issues;
	}
	const type = parsed.frontmatter.type;
	if (typeof type !== "string" || type.trim() === "") {
		issues.push({
			path: file.path,
			level: "error",
			message: "frontmatter `type` is required and must be non-empty",
		});
	} else if (!(JEO_PI_TYPES as readonly string[]).includes(type)) {
		issues.push({
			path: file.path,
			level: "warning",
			message: `unknown type "${type}" (tolerated; not in jeo-pi vocabulary)`,
		});
	}
	if (!parsed.frontmatter.title) {
		issues.push({ path: file.path, level: "warning", message: "missing recommended field `title`" });
	}
	if (!parsed.frontmatter.description) {
		issues.push({
			path: file.path,
			level: "warning",
			message: "missing recommended field `description`",
		});
	}
	return issues;
}

/** Validate a whole bundle. Conformant iff there are zero `error`-level issues
 *  (warnings never reject — OKF's tolerant consumption model). */
export function validateBundle(files: BundleFile[]): ConformanceReport {
	const issues = files.flatMap(validateFile);
	return { conformant: !issues.some((i) => i.level === "error"), issues };
}
