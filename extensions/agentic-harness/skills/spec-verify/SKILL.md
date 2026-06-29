---
name: spec-verify
description: Final acceptance-criteria verification and completion report for jeo_pi. Use when tasks are implemented and you need a high-level check that the frozen seed's acceptance criteria are actually met, with evidence. Reflected from jeo-code's ultragoal workflow — a criterion is PASS only with evidence, never by assertion.
---

# Spec Verify

Implemented is not the same as done. `spec-verify` is jeo_pi's final stage,
adapted from jeo-code's `ultragoal` workflow: it checks the implemented change
set against the **acceptance criteria frozen in the seed**, runs the checks, and
writes a completion report with the verification evidence.

text
Implemented change set + seed acceptance_criteria
                 │
                 ▼
   for each criterion: run check ─► PASS (with evidence) | FAIL
                 │
                 ▼
   Completion report (changes + evidence)  ─►  PASS / NOT PASS gate


## When to use

- Tasks from `spec-execute` are implemented and need final sign-off.
- You must confirm the **original** acceptance criteria are met, not a drifted
  substitute.
- A handoff or commit needs an evidence-backed completion summary.

## Do not use when

- Tasks are still in flight — finish the `spec-execute` loop first.
- Requirements were never frozen — there is nothing to verify against; run
  `spec-stack` to the seed first.

## The verification pass

1. **Load the contract** — read the `acceptance_criteria` from the frozen seed
   (`.ouroboros/seeds/`). These are the bar; the rule is the same as every
   spec-* stage: do not weaken the acceptance criteria to make a check pass.
2. **Check each criterion** — run the tests, validations, or observations that
   exercise it. Re-run, do not recall.
3. **Require evidence** — a criterion is `PASS` only when backed by evidence
   (test output, command result, observed behavior). No evidence → `NOT PASS`.
4. **Measure drift** — flag any place where the implementation diverged from the
   original contract instead of silently accepting it.

## Completion report

Generate a report outlining the changes and the verification evidence:

- **Changes** — the files and behavior that changed.
- **Verification** — per-criterion result with the evidence that backs it.
- **Verdict** — overall `PASS` only when every criterion passes with evidence;
  otherwise `NOT PASS` with the specific gaps.

File the report into the llm-wiki knowledge base so the evidence is durable.

## Invariants

- Verify-before-done: never claim `PASS` without evidence.
- No goal substitution: verify the frozen criteria, not an easier adjacent one.
- The durable `/goal` runtime stays canonical for user-facing next steps.
