---
name: spec-stack
description: Spec-first Ouroboros development loop for jeo_pi. Use when a vague request needs a Socratic interview, an immutable seed/spec before coding, a verify-before-done loop, or drift measurement against the original contract. Reflected from jeo-code's deep-interview → ralplan → team → ultragoal workflow.
---

# Spec Stack

Stop prompting. Start specifying. `spec-stack` is jeo_pi's portable spec-first
loop, adapted from jeo-code's Ouroboros workflow into this extension's
`/clarify` → `/goal` → subagent → verifier machinery.

text
Interview → Seed → Execute → Evaluate → Evolve
                     ↓
            goal-continuation
        (persist until verified)


## When to use

- A vague request needs a Socratic interview before any code is written.
- Requirements should become an **immutable seed/spec** before implementation.
- The task needs a **verify-before-done** loop, not a one-shot answer.
- You want to **keep going until completion is actually verified**.
- You need to **measure drift** against the original contract.

## Do not use when

- The task is a single trivial edit with no ambiguity.
- The task is platform/runtime setup only (use `/setup`).

## The five stages

### 1. Interview — clarify before coding

Route ambiguous work through `/clarify` first. Reduce ambiguity until the
contract is concrete. Greenfield weighting is Goal 40% + Constraints 30% +
Success 30%; brownfield adds Context 15% (Goal 35% / Constraints 25% /
Success 25% / Context 15%). Do not freeze the seed until **Ambiguity ≤ 0.2**.

The `/clarify` output produces a Goal Contract with non-goals, success
criteria, edge cases, and the technical context required to proceed.

When an interactive dialogue is not possible (CI, batch, or unattended runs),
use the **`--auto` non-interactive mode**: the interview answers its own
clarifying questions from the available context and stated assumptions instead
of blocking on a human. `--auto` reduces ambiguity without a human in the loop
but **never bypasses the ambiguity gate** — it still must reach Ambiguity ≤ 0.2
before a seed is frozen, and it records the assumptions it made so drift stays
auditable.

### 2. Seed — freeze the spec

Capture the frozen contract under `.ouroboros/seeds/<name>-seed.yaml`:

yaml
goal: "One sentence describing the outcome"
constraints:
  - "Concrete, testable constraint"
acceptance_criteria:
  - "Observable behavior that proves completion"
verification:
  - "The exact command/check that proves each criterion"


The seed is **immutable** once frozen. Changes go into a new seed revision, not
edits to the frozen one — that is how drift stays measurable.

### 3. Execute — work against the seed

Drive the work through the durable `/goal` runtime. Decompose into subgoals,
delegate bounded slices to the role subagents, and finish-and-verify one
subgoal before starting the next.

| Role | Agent | Capability | Job |
|------|-------|------------|-----|
| Planner | `planner` | read-only | Evidence-backed, execution-ready plan |
| Architect | `architect` | read-only | Architecture/maintainability/spec-compliance review |
| Critic | `critic` | read-only | Decide whether the plan is actionable before execution |
| Executor | `executor` | write | Smallest correct change, verified before done |

Use the `subagent` and `team` tools to fan out read-only roles (planner,
architect, critic) in parallel; run the write-capable executor serially.

### 4. Evaluate — verify before claiming done

Never claim a goal or subgoal complete until the verifier subagent returns
`PASS`. Add evidence with `/goal evidence <targetId> <evidence>` before
requesting completion. If the verifier returns `FAIL`, keep working the
blockers and gather new evidence — do not weaken the acceptance criteria to
make a check pass.

### 5. Evolve — measure drift and iterate

Compare the verified outcome against the frozen seed. Record drift (what the
implementation does that the seed did not specify, and vice versa). On repeated
failure, run a structured unstuck step — split the stuck subgoal into a smaller
one and feed the lesson into the next attempt — instead of blind retries.

## Role disagreement

When planner / architect / critic disagree, do not collapse the split to a
single verdict: record each contested decision with the competing options and
their rationale, and flag the points that need a human judgment call rather than
auto-resolving them.
