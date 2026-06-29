import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadAgentsFromDir } from "../agents.js";

function readSkill(name: string): string {
  return readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf-8");
}

const agentsDir = fileURLToPath(new URL("../agents/", import.meta.url));

describe("spec-stack skill docs", () => {
  it("documents the five-stage Ouroboros loop reflected from jeo-code", () => {
    const src = readSkill("spec-stack");

    // Frontmatter contract so the runtime can surface the skill.
    expect(src).toContain("name: spec-stack");
    expect(src).toMatch(/description:.*spec-first/i);

    // The five stages must all be present and ordered.
    const stages = ["Interview", "Seed", "Execute", "Evaluate", "Evolve"];
    let cursor = -1;
    for (const stage of stages) {
      const idx = src.indexOf(stage, cursor + 1);
      expect(idx, `stage "${stage}" missing or out of order`).toBeGreaterThan(cursor);
      cursor = idx;
    }

    // Ambiguity gate is the freeze precondition.
    expect(src).toContain("Ambiguity ≤ 0.2");
    expect(src).toContain(".ouroboros/seeds/");

    // Verify-before-done invariant must not be softened away.
    expect(src).toContain("PASS");
    expect(src).toContain("do not weaken the acceptance criteria");

    // The four role agents must be referenced by name.
    for (const role of ["planner", "architect", "critic", "executor"]) {
      expect(src).toContain(role);
    }
  });
});

describe("spec-stack role agents reflected from jeo-code", () => {
  const requiredSections: Record<string, string[]> = {
    planner: ["Acceptance Criteria:", "Verification:", "Risks:"],
    architect: ["Architectural Status:", "Code Review Recommendation:", "Inspected:"],
    critic: ["Verdict:", "Required Fixes:"],
    executor: ["Changed Files:", "Verification:", "Open Risks:"],
  };
  const readOnlyRoles = ["planner", "architect", "critic"];

  it("loads all four roles with valid frontmatter and output contracts", async () => {
    const agents = await loadAgentsFromDir(agentsDir, "bundled");
    const byName = new Map(agents.map((a) => [a.name, a]));

    for (const [role, sections] of Object.entries(requiredSections)) {
      const agent = byName.get(role);
      expect(agent, `agent "${role}" not loaded`).toBeDefined();
      expect(agent!.description.length).toBeGreaterThan(0);
      for (const section of sections) {
        expect(agent!.systemPrompt, `${role} missing "${section}"`).toContain(section);
      }
    }
  });

  it("keeps read-only roles tool-restricted and the executor write-capable", async () => {
    const agents = await loadAgentsFromDir(agentsDir, "bundled");
    const byName = new Map(agents.map((a) => [a.name, a]));

    for (const role of readOnlyRoles) {
      const tools = byName.get(role)!.tools ?? [];
      expect(tools.length, `${role} should declare a restricted toolset`).toBeGreaterThan(0);
      expect(tools, `${role} must not have write/edit tools`).not.toContain("edit");
      expect(tools, `${role} must not have write tools`).not.toContain("write");
    }

    // Executor declares no tools line → inherits full (write-capable) toolset.
    const executor = byName.get("executor")!;
    expect(executor.tools ?? []).toHaveLength(0);
  });
});
