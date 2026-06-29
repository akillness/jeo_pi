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

    // --auto non-interactive interview (reflected from deep-interview) must
    // still honor the ambiguity gate, not bypass it.
    expect(src).toContain("--auto");
    expect(src).toMatch(/non-interactive/i);
    expect(src).toMatch(/never bypasses the ambiguity gate/i);
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

describe("spec-deep-dive skill docs reflected from jeo-code", () => {
  it("documents the trace → inject → clarify two-stage pipeline", () => {
    const src = readSkill("spec-deep-dive");

    expect(src).toContain("name: spec-deep-dive");
    expect(src).toMatch(/description:.*trace/i);

    // The pipeline stages must appear in order: trace (why) then clarify (what).
    const traceIdx = src.indexOf("Stage 1 — Trace");
    const injectIdx = src.indexOf("Stage 2 — 3-point injection");
    const clarifyIdx = src.indexOf("Stage 3 — Clarify");
    expect(traceIdx).toBeGreaterThan(-1);
    expect(injectIdx).toBeGreaterThan(traceIdx);
    expect(clarifyIdx).toBeGreaterThan(injectIdx);

    // Three parallel investigation lanes are the trace contract.
    for (const lane of ["Map", "Unknowns", "Root cause"]) {
      expect(src).toContain(lane);
    }

    // It must bridge the existing debugging + clarification skills, not replace them.
    expect(src).toContain("agentic-systematic-debugging");
    expect(src).toContain("agentic-clarification");

    // Same ambiguity gate and verify-before-done invariant as spec-stack.
    expect(src).toContain("Ambiguity ≤ 0.2");
    expect(src).toContain("Goal Contract");
    expect(src).toContain("do not weaken the acceptance criteria");
  });
});

describe("spec-blueprint skill docs reflected from jeo-code ralplan", () => {
  it("documents the parallel critique → merge → handoff stages", () => {
    const src = readSkill("spec-blueprint");

    expect(src).toContain("name: spec-blueprint");
    expect(src).toMatch(/description:.*ralplan/i);

    // Stages must appear in order: critique, then merge, then handoff.
    const critiqueIdx = src.indexOf("Stage 1 — Parallel critique");
    const mergeIdx = src.indexOf("Stage 2 — Merge");
    const handoffIdx = src.indexOf("Stage 3 — Handoff");
    expect(critiqueIdx).toBeGreaterThan(-1);
    expect(mergeIdx).toBeGreaterThan(critiqueIdx);
    expect(handoffIdx).toBeGreaterThan(mergeIdx);

    // All three planning roles must drive the critique lanes.
    for (const role of ["Planner", "Architect", "Critic"]) {
      expect(src).toContain(role);
    }

    // The defining ralplan invariant: disagreements are preserved, not collapsed.
    expect(src).toContain("do not collapse the split to");
    expect(src).toMatch(/human judgment call/i);

    // It must sit after clarification/deep-dive and feed execution, not replace them.
    expect(src).toContain("spec-stack");
    expect(src).toContain("spec-deep-dive");

    // Same verify-before-done invariant as the rest of the spec-* family.
    expect(src).toContain("do not weaken the acceptance criteria");
  });
});

describe("spec-execute skill docs reflected from jeo-code team", () => {
  it("documents the per-task executor loop with verify-before-advance", () => {
    const src = readSkill("spec-execute");

    expect(src).toContain("name: spec-execute");
    expect(src).toMatch(/description:.*team/i);

    // The defining team invariants must be present.
    expect(src).toContain("bounded subgoal");
    expect(src).toMatch(/verify one before starting the next/i);
    expect(src).toContain("feed the facts");
    expect(src).toMatch(/no blind retries/i);

    // It consumes a blueprint and uses the executor's output contract.
    expect(src).toContain("spec-blueprint");
    expect(src).toContain("Changed Files:");
    expect(src).toContain("Open Risks:");

    // Same verify-before-done invariant as the rest of the spec-* family.
    expect(src).toContain("do not weaken the acceptance criteria");
  });
});

describe("spec-verify skill docs reflected from jeo-code ultragoal", () => {
  it("documents evidence-backed acceptance verification and the report", () => {
    const src = readSkill("spec-verify");

    expect(src).toContain("name: spec-verify");
    expect(src).toMatch(/description:.*ultragoal/i);

    // It verifies the frozen seed's acceptance criteria, with evidence.
    expect(src).toContain("acceptance_criteria");
    expect(src).toContain(".ouroboros/seeds/");
    expect(src).toMatch(/only when backed by evidence/i);
    expect(src).toMatch(/drift/i);

    // PASS / NOT PASS gate and a completion report.
    expect(src).toContain("PASS");
    expect(src).toContain("NOT PASS");
    expect(src).toMatch(/completion report/i);

    // Consumes the execute stage and bars goal substitution.
    expect(src).toContain("spec-execute");
    expect(src).toMatch(/No goal substitution/i);

    // Same verify-before-done invariant as the rest of the spec-* family.
    expect(src).toContain("do not weaken the acceptance criteria");
  });
});