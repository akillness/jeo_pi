import { describe, expect, it } from "vitest";
import {
  compactCallText,
  compactCallTitle,
  compactResultText,
  truncateInline,
} from "../compact.ts";

const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };

describe("compactCallText", () => {
  it("renders a direct tool as one line: name + truncated arg hint", () => {
    const text = compactCallText(
      "codegraph_context",
      { task: "Read tool output formatting implementation", maxNodes: 10, includeCode: true },
      theme,
      40,
    );
    expect(text.split("\n")).toHaveLength(1);
    expect(text.startsWith("codegraph_context")).toBe(true);
    expect(text).toContain("…");
  });

  it("drops the arg block for the mcp proxy tool, keeping intent", () => {
    const text = compactCallText("mcp", { tool: "xcodebuild_list", args: '{"a":1}' }, theme);
    expect(text).toBe("mcp call xcodebuild_list");
  });

  it("shows just the name when a direct tool has no args", () => {
    expect(compactCallText("codegraph_status", {}, theme)).toBe("codegraph_status");
  });
});

describe("compactCallTitle", () => {
  it("derives proxy intent lines", () => {
    expect(compactCallTitle("mcp", { tool: "t", server: "s" })).toBe("mcp call t @ s");
    expect(compactCallTitle("mcp", { search: "foo" })).toBe("mcp search foo");
    expect(compactCallTitle("mcp", {})).toBe("mcp status");
  });

  it("passes direct tool names through unchanged", () => {
    expect(compactCallTitle("codegraph_context", { task: "x" })).toBe("codegraph_context");
  });
});

describe("compactResultText", () => {
  it("collapses success output to one line plus an expand hint", () => {
    const text = compactResultText("a\nb\nc\nd", { expanded: false, isError: false }, theme, 1);
    const lines = text.split("\n");
    expect(lines[0]).toBe("a");
    expect(lines).toContain("…");
    expect(text).toContain("(Ctrl+O to expand)");
  });

  it("shows the full output when expanded", () => {
    expect(compactResultText("a\nb\nc", { expanded: true, isError: false }, theme, 1)).toBe("a\nb\nc");
  });

  it("gives errors a few lines before truncating", () => {
    const text = compactResultText("e1\ne2\ne3\ne4\ne5", { expanded: false, isError: true }, theme, 1);
    expect(text.split("\n").slice(0, 3)).toEqual(["e1", "e2", "e3"]);
    expect(text).toContain("…");
  });

  it("does not truncate when within the cap", () => {
    const text = compactResultText("only", { expanded: false, isError: false }, theme, 1);
    expect(text).toBe("only");
    expect(text).not.toContain("Ctrl+O");
  });
});

describe("truncateInline", () => {
  it("flattens whitespace and caps length", () => {
    expect(truncateInline("a\n  b\t c", 80)).toBe("a b c");
    expect(truncateInline("abcdef", 4)).toBe("abc…");
  });
});
