---
name: spec-deep-dive
description: Two-stage trace → clarify pipeline for jeo_pi. Use when a bug or problem has an unknown root cause and you must investigate WHY before defining WHAT to do. Runs parallel causal investigation, then injects the findings into the clarification loop. Reflected from jeo-code's deep-dive workflow.
---

# Spec Deep Dive

When you have a problem but not a root cause, do not jump to a Goal Contract on
guesses. `spec-deep-dive` is jeo_pi's two-stage pipeline, adapted from
jeo-code's deep-dive workflow: first investigate WHY (trace), then define WHAT
to do (clarify) — with the trace evidence injected into the interview so the
clarification loop never re-explores what is already known.

text
Trace (3 parallel lanes) ──► 3-point injection ──► Clarify (Goal Contract)
   why did it happen?            carry evidence         what to do about it


## When to use

- A bug, regression, or unexpected behavior has an **unknown root cause**.
- You need investigation **before** requirements can be written.
- Guess-first fixes have already failed and you need structured evidence.

## Do not use when

- The root cause is already known and reproducible — go straight to
  `agentic-systematic-debugging` to lock it with a failing test.
- The request is a greenfield feature with no defect to trace — use
  `spec-stack` (`/clarify` → seed → execute).

## Stage 1 — Trace (WHY)

Run causal investigation across **three parallel read-only lanes** using the
`subagent`/`team` tools, so independent hypotheses are not collapsed early:

| Lane | Question it answers |
|------|---------------------|
| Map | Which system areas and files are on the failure path? |
| Unknowns | What critical facts are still unverified? |
| Root cause | Which hypothesis is supported by reproducible evidence? |

Honor the `agentic-systematic-debugging` hard gates while tracing: reproduce or
observe the failure first, state one hypothesis at a time, and never claim a
cause without evidence.

## Stage 2 — 3-point injection

Transfer the trace findings directly into the clarification start so no work is
repeated:

1. **Enrich the starting point** — seed `/clarify` with the confirmed problem
   statement, not the original vague report.
2. **Provide system context** — hand over the mapped files/areas as the
   technical context the interview would otherwise have to rediscover.
3. **Seed initial questions** — turn the remaining unknowns into the first
   clarification questions.

## Stage 3 — Clarify (WHAT)

Run the `agentic-clarification` loop on the injected starting point. Skip
redundant exploration, focus on unresolved unknowns, and hold the same
ambiguity gate as `spec-stack`: do not emit a Goal Contract until
**Ambiguity ≤ 0.2**. The output is a Goal Contract ready for the durable
`/goal` runtime, with the root cause already established as evidence.

## Handoff

The trace evidence and Goal Contract feed `spec-stack`'s Execute stage. Hold
the verify-before-done invariant: do not weaken the acceptance criteria to make
a check pass, and do not route to legacy workflow skills as user-facing next
steps — the `/goal` runtime is canonical.
