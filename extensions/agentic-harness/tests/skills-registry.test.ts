import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skillsDir = new URL("../skills/", import.meta.url);

function registry(): string {
  return readFileSync(new URL("AGENTS.md", skillsDir), "utf-8");
}

function skillDirs(): string[] {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(new URL(`${e.name}/SKILL.md`, skillsDir)))
    .map((e) => e.name)
    .sort();
}

describe("skills AGENTS.md registry", () => {
  it("documents every skill directory that has a SKILL.md", () => {
    const doc = registry();
    const dirs = skillDirs();
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      expect(doc, `skills/AGENTS.md missing entry for ${dir}/`).toContain(`\`${dir}/\``);
    }
  });

  it("does not reference skill directories that no longer exist", () => {
    const doc = registry();
    const present = new Set(skillDirs());
    const referenced = [...doc.matchAll(/`([a-z][a-z0-9-]*)\/`/g)].map((m) => m[1]);
    for (const ref of referenced) {
      expect(present.has(ref), `skills/AGENTS.md references missing skill ${ref}/`).toBe(true);
    }
  });
});
