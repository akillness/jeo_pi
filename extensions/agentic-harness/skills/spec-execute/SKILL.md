---
name: spec-execute
description: Per-task executor loop for jeo_pi. Use when a blueprint exists and you must implement the concrete tasks one bounded subgoal at a time, verifying each before the next. Reflected from jeo-code's team workflow — failures feed forward into the next task instead of blind retries.
---

# Spec Execute

A blueprint is not a result. `spec-execute` is jeo_pi's execution stage, adapted
from jeo-code's `team` workflow: it drives the blueprint's tasks through a
per-task executor loop, keeping each task isolated and verified before the next
one starts.

text
Blueprint tasks
     │
     ▼
 ┌─► pick next task (bounded subgoal)
 │      │
 │      ▼
 │   executor implements + verifies
 │      │
 │      ├─ PASS ─► record status ─┐
 │      └─ FAIL ─► feed facts forward, adjust next input
 │                                 │
 └─────────────────────────────────┘ until all tasks done


## When to use

- A `spec-blueprint` plan exists and tasks are ready to implement.
- Work is large enough to **decompose into ordered subgoals**.
- You need task-level isolation and per-task verification, not one big diff.

## Do not use when

- There is no plan yet — run `spec-blueprint` (or `spec-stack`) first.
- The change is a single trivial edit — just make it and verify directly.

## The loop

1. **Decompose** large work into ordered, bounded subgoals; each task is one
   coherent change with its own verification.
2. **Execute one task** with the `executor` agent (or `team` tool), which
   declares its `Changed Files:`, `Verification:`, and `Open Risks:` contract.
3. **Verify before advancing** — do not start the next task until the current
   one passes its checks. Verify one before starting the next.
4. **Feed failures forward** — when a task fails, feed the facts that failure
   exposed into the inputs of the following task instead of retrying the same
   approach unchanged.

## Invariants

- Task-level isolation: a task's changes and verification stand on their own.
- No blind retries: a repeated failure must change the next attempt's inputs.
- Verify-before-done: do not weaken the acceptance criteria to make a check pass.
- Running task state: keep the loop's goal, constraints, confirmed evidence,
  failed approaches with their cause, and open candidates updated as you go,
  instead of re-reading the whole history before each task.

## Handoff

When every task passes, hand the implemented change set to `spec-verify` for
final acceptance-criteria verification. The durable `/goal` runtime stays
canonical for user-facing next steps.
