import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const harnessDir = new URL("../", import.meta.url);

function read(rel: string): string {
  return readFileSync(new URL(rel, harnessDir), "utf-8");
}

function parentLink(doc: string): string | undefined {
  return doc.match(/<!--\s*Parent:\s*(\S+)\s*-->/)?.[1];
}

describe("AGENTS.md documentation tree integrity", () => {
  it("has a parent AGENTS.md for the harness module", () => {
    expect(existsSync(new URL("AGENTS.md", harnessDir))).toBe(true);
  });

  it("parent lists the documented child subdirectories", () => {
    const parent = read("AGENTS.md");
    for (const child of ["agents/", "skills/"]) {
      expect(parent, `parent AGENTS.md missing ${child}`).toContain(`\`${child}\``);
    }
  });

  it("child registries link to an existing parent AGENTS.md", () => {
    for (const child of ["agents/AGENTS.md", "skills/AGENTS.md"]) {
      const doc = read(child);
      const link = parentLink(doc);
      expect(link, `${child} missing Parent link`).toBeDefined();
      const resolved = new URL(link!, new URL(child, harnessDir));
      expect(existsSync(resolved), `${child} Parent link ${link} does not resolve`).toBe(true);
    }
  });
});
