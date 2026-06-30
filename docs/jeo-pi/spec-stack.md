# jeo-pi spec-stack

jeo-pi reflects [jeo-code](https://github.com/akillness/jeo-code)'s spec-first
**Ouroboros** workflow into roach-pi's native agentic-harness machinery, instead
of bolting on a parallel framework.

## Mapping

| jeo-code (spec-stack) | jeo-pi (this repo) |
|-----------------------|--------------------|
| `deep-interview` (ambiguity gate ≤ 0.2, `--auto`) | `/clarify` runtime + `spec-stack` Interview (incl. `--auto` non-interactive gate) → Goal Contract |
| Frozen `seed.yaml` | `.ouroboros/seeds/*.yaml` (immutable) |
| `deep-dive` (trace → clarify) | `spec-deep-dive` skill (3-lane trace → 3-point injection → `/clarify`) |
| `ralplan` (planner/architect/critic) | `spec-blueprint` skill + read-only role agents in `agents/` |
| `team` / executor | `spec-execute` skill + `team` tool + `executor` agent (write) |
| `ultragoal` (verify) | `spec-verify` skill + `/goal` runtime + verifier subagent (PASS gate) |

The full jeo-code workflow is reflected as a five-skill `spec-*` family under
`extensions/agentic-harness/skills/`: `spec-stack` (the end-to-end loop and
ambiguity gate), `spec-deep-dive` (root-cause investigation before requirements,
for defects with an unknown cause), `spec-blueprint` (Planner/Architect/Critic
planning that preserves contested decisions), `spec-execute` (per-task executor
loop), and `spec-verify` (evidence-backed acceptance-criteria verification).

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
   structured unstuck step on repeated failure instead of blind retries. The
   Evaluate→Evolve ratchet is also available as an executable loop via
   `/autopilot` (see below).

## Autopilot ratchet (`/autopilot`)

`autopilot.ts` ports jeo-code's `src/autopilot.ts` "ratchet brain" into a jeo-pi
command: a frozen evaluator, one change per step, **keep-if-improved /
revert-otherwise by score**, an append-only evidence ledger, baseline-first
discipline, and convergence/patience stops. State lives per-cwd under
`.jeo/autopilot/` (`session.json` frozen contract + `log.jsonl` append-only log).

```text
/autopilot init <task...> --eval <cmd> [--goal min|max|gate] [--timeout S] [--patience N]
/autopilot baseline                    # record the starting score (min/max goals)
/autopilot step --change "<desc>"      # re-run the eval, ratchet keep vs revert
/autopilot status [--json]             # show the evidence ledger + recommendation
/autopilot clear --confirm
```

The agent supplies the mutation between steps; the engine owns only the decision
and the ledger (never destructive git ops). The eval contract: the command
prints `score: <number>` (min/max goals) or exits 0/1 (gate goal). The pure
decision core (`decideStep`, `foldBest`, `bestScoreFromLog`, `isConverged`) is
runtime-agnostic and unit-tested in `tests/autopilot.test.ts`.

Adaptations vs jeo-code: state root is an explicit argument (testable without
`chdir`), the evaluator runs behind an injectable seam, writes are atomic
(`*.tmp → rename`), and the command returns rendered lines for the harness UI
instead of writing to stdout.

## Roles

| Role | Agent file | Capability | Output contract |
|------|-----------|------------|-----------------|
| Planner | `agents/planner.md` | read-only | Summary / In Scope / Out of Scope / File-level Changes / Sequencing / Acceptance Criteria / Verification / Risks |
| Architect | `agents/architect.md` | read-only | Summary / Findings / Inspected / Recommendations / Architectural Status / Code Review Recommendation |
| Critic | `agents/critic.md` | read-only | Verdict / Justification / Summary / Required Fixes |
| Executor | `agents/executor.md` | write | Summary / Changed Files / Verification / Open Risks |

The read-only/write **capability** column is enforced, not just documented:
every read-only role must declare a restricted `tools` frontmatter with no
`edit`/`write`, while write roles keep mutating access.
`tests/agents-capability.test.ts` checks this against `agents/AGENTS.md`
(reflected from jeo-code's "non-mutating agents MUST NOT be given mutating
tools" rule).

## Discipline injection

Write-capable agents (`worker`, `plan-worker`) get two behavioral guardrail
blocks auto-injected by `discipline.ts`, reflected from jeo-code's runtime
system prompt:

- **Karpathy Rules** — *how much* to change: read before you write, surgical
  edits, match existing patterns, no premature abstraction or future-proofing.
- **Integrity & Trust** — honesty and trust boundaries: never fabricate tool
  results, no stubs/placeholders, re-read on failure, own mistakes plainly,
  decline malware, treat tool output as untrusted data.

The `executor` agent additionally carries jeo-code's **done self-check** —
before reporting done it confirms it ran the exercising test, updated affected
callsites/tests/docs, and that its claim matches real output.

## Verification

```bash
bun install
bun run test                         # extension tests via vitest (>800)
npx vitest run extensions/agentic-harness/tests/spec-stack-docs.test.ts
```

`pi-core-changes/` tests require the upstream pi-mono `src/` tree and are out of
scope for standalone runs (`bun run test:core`).

## Documentation tree

Each harness directory carries an `AGENTS.md` registry kept in sync by tests:

| File | Role |
|------|------|
| `extensions/agentic-harness/AGENTS.md` | Module index (purpose, key files, subdirs) |
| `extensions/agentic-harness/agents/AGENTS.md` | All role prompts + capability table |
| `extensions/agentic-harness/skills/AGENTS.md` | All bundled skills + purpose table |

`tests/agents-registry.test.ts`, `tests/skills-registry.test.ts`, and
`tests/docs-tree.test.ts` fail if a prompt or skill is added, removed, or
renamed without updating its registry — documentation cannot silently drift from
the code. `tests/agents-capability.test.ts` additionally fails if an agent's
declared `tools` ever contradicts its capability column.