import { describe, it, expect } from "vitest";
import { forgePersona, JEO_PI_PERSONA } from "../persona.js";
import { WELCOME_WORKFLOW_STEPS } from "../welcome-ui.js";

describe("forgePersona", () => {
  const base = "You are a coding assistant.";

  it("preserves the base prompt and appends the persona block", () => {
    const forged = forgePersona(base);
    expect(forged.startsWith(base)).toBe(true);
    expect(forged).toContain(JEO_PI_PERSONA);
    expect(forged.length).toBeGreaterThan(base.length);
  });

  it("is deterministic so the system-prompt suffix never perturbs prompt-cache keys", () => {
    expect(forgePersona(base)).toBe(forgePersona(base));
  });
});

describe("JEO_PI_PERSONA content", () => {
  it("establishes the jeo-pi identity", () => {
    expect(JEO_PI_PERSONA).toContain("jeo-pi");
    expect(JEO_PI_PERSONA).toMatch(/## Identity: jeo-pi/);
  });

  it("encodes the four-stage clarify -> plan -> build -> verify loop", () => {
    expect(JEO_PI_PERSONA).toMatch(/Clarify/);
    expect(JEO_PI_PERSONA).toMatch(/Plan/);
    expect(JEO_PI_PERSONA).toMatch(/Build/);
    expect(JEO_PI_PERSONA).toMatch(/Verify/);
  });

  it("gates completion on a verifier PASS, not optimism", () => {
    expect(JEO_PI_PERSONA).toMatch(/verifier PASS/);
  });

  it("references every welcome-screen workflow command so banner and identity agree", () => {
    for (const step of WELCOME_WORKFLOW_STEPS) {
      expect(JEO_PI_PERSONA).toContain(step.command);
    }
  });
});
