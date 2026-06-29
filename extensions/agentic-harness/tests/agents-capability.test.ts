import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../agents.js";

// Reflected from jeo-code src/prompts/agents/AGENTS.md discipline:
//   "Non-mutating agents MUST NOT be given mutating tools."
// This test ties the documented capability column in agents/AGENTS.md to the
// actual `tools` frontmatter of every bundled agent prompt, so a read-only role
// can never silently gain edit/write access (and a write role can never be
// silently downgraded).

const agentsDir = new URL("../agents/", import.meta.url);

// Tools that mutate the repository. A read-only role must declare none of these.
const MUTATING_TOOLS = ["edit", "write", "apply_patch", "multiedit", "str_replace"];

function tools(file: string): string[] | undefined {
  const content = readFileSync(new URL(file, agentsDir), "utf-8");
  const { frontmatter } = parseFrontmatter(content);
  if (typeof frontmatter.tools !== "string") return undefined;
  return frontmatter.tools
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/** Parse the agents/AGENTS.md capability table into file -> capability. */
function capabilityTable(): Map<string, string> {
  const doc = readFileSync(new URL("AGENTS.md", agentsDir), "utf-8");
  const map = new Map<string, string>();
  const rowRe = /^\|\s*`([a-z][a-z0-9-]*\.md)`\s*\|\s*(read-only|write)\s*\|/gim;
  for (const m of doc.matchAll(rowRe)) {
    map.set(m[1], m[2].toLowerCase());
  }
  return map;
}

function agentFiles(): string[] {
  return readdirSync(agentsDir)
    .filter((name) => name.endsWith(".md") && name !== "AGENTS.md")
    .sort();
}

describe("agent capability invariant", () => {
  it("documents a capability for every agent file", () => {
    const table = capabilityTable();
    const files = agentFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(
        table.has(file),
        `agents/AGENTS.md has no read-only/write capability row for ${file}`,
      ).toBe(true);
    }
  });

  it("read-only agents declare a tools list with no mutating tools", () => {
    const table = capabilityTable();
    for (const [file, capability] of table) {
      if (capability !== "read-only") continue;
      const declared = tools(file);
      expect(declared, `read-only ${file} must declare a restricted tools list`).toBeDefined();
      for (const tool of declared!) {
        expect(
          MUTATING_TOOLS.includes(tool),
          `read-only ${file} must not declare mutating tool "${tool}"`,
        ).toBe(false);
      }
    }
  });

  it("write agents are not downgraded to a read-only tools list", () => {
    const table = capabilityTable();
    for (const [file, capability] of table) {
      if (capability !== "write") continue;
      const declared = tools(file);
      // A write role either inherits the full toolset (no tools line) or, if it
      // restricts tools, must keep at least one mutating tool available.
      if (declared === undefined) continue;
      const keepsMutating = declared.some((t) => MUTATING_TOOLS.includes(t));
      expect(
        keepsMutating,
        `write agent ${file} declares a tools list that strips every mutating tool`,
      ).toBe(true);
    }
  });
});
