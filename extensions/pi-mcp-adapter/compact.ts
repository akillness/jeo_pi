// Compact, Claude-Code-style rendering for MCP tool calls and results.
//
// This module is intentionally dependency-free (no TUI, no upstream adapter
// imports) so the rendering logic is fully owned by this repo and unit-testable
// in isolation. The thin wrapper in ./index.ts feeds these helpers into the
// vendored `pi-mcp-adapter` via an intercepted `registerTool`.

export interface CompactTheme {
  fg: (name: string, text: string) => string;
  bold?: (text: string) => string;
}

export interface CompactResultOptions {
  expanded?: boolean;
  isError?: boolean;
}

/** Collapse whitespace and hard-cap a string to a single inline fragment. */
export function truncateInline(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * One-line title for a tool call. Direct MCP tools use their prefixed name; the
 * `mcp` proxy tool derives a concise intent line (mirrors the upstream proxy
 * first line) so the verbose JSON args block is dropped.
 */
export function compactCallTitle(name: string, args: Record<string, unknown>): string {
  if (name !== "mcp") return name;
  const a = args ?? {};
  if (typeof a.tool === "string" && a.tool)
    return typeof a.server === "string" && a.server ? `mcp call ${a.tool} @ ${a.server}` : `mcp call ${a.tool}`;
  if (typeof a.connect === "string" && a.connect) return `mcp connect ${a.connect}`;
  if (typeof a.describe === "string" && a.describe) return `mcp describe ${a.describe}`;
  if (typeof a.search === "string" && a.search) return `mcp search ${a.search}`;
  if (typeof a.server === "string" && a.server) return `mcp list ${a.server}`;
  if (typeof a.action === "string" && a.action) return `mcp ${a.action}`;
  return "mcp status";
}

function argsHint(args: Record<string, unknown>): string {
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length === 0) return "";
  try {
    return JSON.stringify(args);
  } catch {
    return "";
  }
}

/** Render a tool call as a single line: bold title + a truncated inline arg hint. */
export function compactCallText(
  name: string,
  args: Record<string, unknown>,
  theme: CompactTheme,
  maxHint = 96,
): string {
  const title = compactCallTitle(name, args) || name || "mcp";
  const styledTitle = theme.fg("toolTitle", theme.bold ? theme.bold(title) : title);
  // The proxy title already carries intent; only direct tools need an arg hint.
  const hintSource = name === "mcp" ? "" : argsHint(args);
  const hint = hintSource ? truncateInline(hintSource, maxHint) : "";
  return hint ? `${styledTitle} ${theme.fg("muted", hint)}` : styledTitle;
}

/**
 * Render a tool result compactly: one line for success, a few lines for errors
 * (so failures stay legible), with a "(Ctrl+O to expand)" hint when truncated.
 */
export function compactResultText(
  contentText: string,
  options: CompactResultOptions,
  theme: CompactTheme,
  maxLines = 1,
): string {
  const expanded = Boolean(options.expanded);
  const isError = Boolean(options.isError);
  const allLines = contentText.length > 0 ? contentText.split("\n") : ["(empty result)"];
  const cap = isError ? Math.max(maxLines, 3) : Math.max(1, maxLines);
  const truncated = !expanded && allLines.length > cap;
  const shown = truncated ? [...allLines.slice(0, cap), "…"] : allLines;
  const fg = isError ? "error" : "toolOutput";
  const body = shown.map((line) => (line === "…" ? theme.fg("muted", line) : theme.fg(fg, line))).join("\n");
  const hint = truncated ? `\n${theme.fg("muted", "(Ctrl+O to expand)")}` : "";
  return `${body}${hint}`;
}
