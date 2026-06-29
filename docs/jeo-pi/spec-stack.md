# jeo_pi spec-stack

jeo_pi reflects [jeo-code](https://github.com/akillness/jeo-code)'s spec-first
**Ouroboros** workflow into roach-pi's native agentic-harness machinery, instead
of bolting on a parallel framework.

## Mapping

| jeo-code (spec-stack) | jeo_pi (this repo) |
|-----------------------|--------------------|
| `deep-interview` (ambiguity gate ≤ 0.2) | `/clarify` runtime → Goal Contract |
| Frozen `seed.yaml` | `.ouroboros/seeds/*.yaml` (immutable) |
| `ralplan` (planner/architect/critic) | read-only role agents in `agents/` |
| `team` / executor | `team` tool + `executor` agent (write) |
| `ultragoal` (verify) | `/goal` runtime + verifier subagent (PASS gate) |

## The loop

```text
Interview → Seed → Execute → Evaluate → Evolve
                     ↓
            goal-continuation (persist until verified)
```

1. **Interview** — route ambiguous work through `/clarify`; do not freeze the
   seed until Ambiguity ≤ 0.2.
2. **Seed** — freeze the contract under `.ouroboros/seeds/<name>-seed.yaml`. It
   is immutable; revisions create new entries, keeping drift measurable.
3. **Execute** — drive via `/goal`; delegate bounded slices to role subagents.
4. **Evaluate** — never claim done until the verifier returns `PASS`; attach
   evidence with `/goal evidence`. Do not weaken acceptance criteria to pass.
5. **Evolve** — compare the outcome to the seed, record drift, and run a
   structured unstuck step on repeated failure instead of blind retries.

## Roles

| Role | Agent file | Capability | Output contract |
|------|-----------|------------|-----------------|
| Planner | `agents/planner.md` | read-only | Summary / In Scope / Out of Scope / File-level Changes / Sequencing / Acceptance Criteria / Verification / Risks |
| Architect | `agents/architect.md` | read-only | Summary / Findings / Inspected / Recommendations / Architectural Status / Code Review Recommendation |
| Critic | `agents/critic.md` | read-only | Verdict / Justification / Summary / Required Fixes |
| Executor | `agents/executor.md` | write | Summary / Changed Files / Verification / Open Risks |

## Verification

```bash
bun install
bun run test                         # 804/804 extension tests via vitest
npx vitest run extensions/agentic-harness/tests/spec-stack-docs.test.ts
```

`pi-core-changes/` tests require the upstream pi-mono `src/` tree and are out of
scope for standalone runs (`bun run test:core`).
