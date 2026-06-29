<!-- Parent: ../AGENTS.md -->

# skills

## Purpose

Bundled workflow skills offering specialized, multi-step procedures. The
`spec-*` family reflects jeo-code's Ouroboros workflow (deep-interview →
ralplan → team → ultragoal, and deep-dive) into jeo_pi's native
`/clarify` → `/goal` → subagent → verifier runtime.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `spec-stack/` | Spec-first Interview → Seed → Execute → Evaluate → Evolve loop |
| `spec-deep-dive/` | Two-stage trace → inject → clarify pipeline for unknown root causes |
| `spec-blueprint/` | Planner/Architect/Critic blueprint that preserves contested decisions |
| `agentic-clarification/` | Socratic ambiguity loop producing a Goal Contract |
| `agentic-goal/` | Primary durable `/goal` execution workflow with verifier PASS gate |
| `agentic-systematic-debugging/` | Reproduce-first, root-cause-first debugging gates |
| `agentic-brainstorming/` | Divergent idea generation before convergence |
| `agentic-simplify/` | Review changed code for reuse, quality, and inefficiency |
| `agentic-karpathy/` | Guardrails against common LLM coding mistakes |
| `agentic-rob-pike/` | Rob Pike's 5 Rules of Programming as a decision framework |

## For AI Agents

### Working In This Directory

- Each skill must have a `SKILL.md` file with frontmatter `name` + `description`.
- Changes to bundled skills directly impact the workflows surfaced via `/skill`.
- The durable `/goal` runtime is canonical — do not route to legacy public
  workflow skills as user-facing next steps.

### Testing Requirements

- `tests/skill-docs.test.ts` asserts skill content invariants and that legacy
  skill names are absent from the discovery surface.
- `tests/spec-stack-docs.test.ts` covers the `spec-stack` and `spec-deep-dive`
  skill contracts.
- `tests/skills-registry.test.ts` keeps this table in sync with the directory.

## Dependencies

### Internal

- Skill discovery walks this directory for `*/SKILL.md`.

### External

- None.
