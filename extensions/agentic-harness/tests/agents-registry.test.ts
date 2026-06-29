import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const agentsDir = new URL("../agents/", import.meta.url);

function registry(): string {
  return readFileSync(new URL("AGENTS.md", agentsDir), "utf-8");
}

function agentFiles(): string[] {
  return readdirSync(agentsDir)
    .filter((name) => name.endsWith(".md") && name !== "AGENTS.md")
    .sort();
}

describe("agents AGENTS.md registry", () => {
  it("documents every agent file in the directory", () => {
    const doc = registry();
    const files = agentFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(doc, `agents/AGENTS.md missing entry for ${file}`).toContain(`\`${file}\``);
    }
  });

  it("does not reference agent files that no longer exist", () => {
    const doc = registry();
    const present = new Set(agentFiles());
    const referenced = [...doc.matchAll(/`([a-z][a-z0-9-]*\.md)`/g)].map((m) => m[1]);
    for (const ref of referenced) {
      expect(present.has(ref), `agents/AGENTS.md references missing file ${ref}`).toBe(true);
    }
  });
});
