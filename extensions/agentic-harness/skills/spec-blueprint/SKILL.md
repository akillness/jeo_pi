---
name: spec-blueprint
description: Multi-agent Planner/Architect/Critic blueprint for jeo-pi. Use when requirements are already clear (a frozen seed or Goal Contract exists) and you need a robust execution plan with risks, tasks, and files before writing code. Reflected from jeo-code's ralplan workflow — contested decisions are preserved, not collapsed.
---

# Spec Blueprint

Once the seed is frozen (Ambiguity ≤ 0.2), do not jump straight to editing
files. `spec-blueprint` is jeo-pi's planning stage, adapted from jeo-code's
`ralplan` workflow: three role agents critique the seed in parallel, then their
views are merged into one execution blueprint — **without erasing the points
where they disagree**.

text
Seed / Goal Contract
        │
        ├─► Planner    (tasks, acceptance criteria, sequencing)
        ├─► Architect  (structure, reuse, code-review posture)
        └─► Critic     (risks, gaps, verdict)
        │
        ▼
   Blueprint  (consensus + preserved disagreements)
        │
        ▼
   Execute (team / executor)


## When to use

- A seed or Goal Contract is **already frozen** and you need a plan before code.
- The change touches multiple files or systems and needs **risk-first** sequencing.
- You want independent critique instead of a single optimistic plan.

## Do not use when

- Requirements are still vague — run `spec-stack` (`/clarify`) to the ambiguity
  gate first.
- The root cause is unknown — run `spec-deep-dive` to trace WHY first.
- The change is a one-line, low-risk edit — plan inline and go straight to execution.

## Stage 1 — Parallel critique (three roles)

Run the `planner`, `architect`, and `critic` agents as **parallel read-only
lanes** via the `subagent`/`team` tools so no single view dominates early. Each
role emits its declared output contract:

| Role | Lane question | Output contract |
|------|---------------|-----------------|
| Planner | What tasks, in what order, with what acceptance criteria? | Acceptance Criteria / Verification / Risks |
| Architect | Does the structure reuse existing patterns and survive review? | Architectural Status / Code Review Recommendation / Inspected |
| Critic | What is most likely to fail or be missed? | Verdict / Required Fixes |

## Stage 2 — Merge without collapsing dissent

Combine the three views into one blueprint that lists risks, tasks, and the
files each task touches. **When the roles disagree, do not collapse the split to
a single verdict:** record each contested decision with the competing options
and their rationale, and flag the points that need a human judgment call rather
than auto-resolving them. A blueprint that hides disagreement is a defect.

## Stage 3 — Handoff to execution

The blueprint feeds `spec-stack`'s Execute stage and the `team`/`executor`
loop, one task at a time. Hold the verify-before-done invariant: do not weaken the acceptance criteria to make a check pass, and treat the `critic`'s `Verdict:` as a gate, not advice. The durable `/goal` runtime stays canonical for user-facing next steps.
