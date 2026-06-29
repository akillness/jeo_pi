---
name: agentic-goal
description: Primary execution workflow for durable /goal runtime. Use when a Goal Contract is active or when the user asks to execute, continue, verify, or complete a goal.
---

# Agentic Goal

Work only through the durable `/goal` runtime.

## Core Rules

1. Start by reading `/goal status` when a goal may be active.
2. Work only on the active goal or active subgoal shown by `/goal status`.
3. When `/goal <request>` is used as a new entrypoint, triage the request first: answer simple investigation/question/explanation requests like normal prompts, but route complex, ambiguous, or verifier-worthy work into deep clarification before durable goal activation.
4. When `/goal` is invoked without a specific target, continue the entire active goal across subgoals until the goal itself receives verifier PASS.
5. Track immediate work with `todoread` and `todowrite`.
6. Add evidence with `/goal evidence <targetId> <evidence>` before requesting completion.
7. Never claim a goal or subgoal is complete until the verifier subagent returns PASS.
8. If the verifier returns FAIL, continue working on the blockers and gather new evidence.
9. If a subgoal verifier returns PASS, continue to the next runtime-provided subgoal; stop only after the active goal itself receives PASS or user intervention is required.

## New Request Triage

For `/goal <request>`, silently decide whether the request needs durable goal runtime:

- Simple investigation, lookup, explanation, or read-only question: answer directly as a normal prompt.
- Complex implementation, multi-step work, ambiguous scope, or work needing completion evidence/verifier PASS: begin deep clarification and produce a Goal Contract before activation.
- If uncertain, prefer clarification for complex or ambiguous work.

## Workflow

1. Inspect `/goal status`.
2. Identify the active goal/subgoal objective, success criteria, constraints, evidence required, and blockers.
3. Create or update todos for the immediate work.
4. Implement the required changes.
5. Record evidence with `/goal evidence`.
6. Request completion with `/goal complete <targetId>`.
7. Follow the verifier outcome:
   - Subgoal PASS: continue with the next runtime-provided subgoal.
   - Goal PASS: stop; the active goal is complete.
   - FAIL: address blockers, record new evidence, and request completion again.

## Durable State Handoff

The `/goal` runtime is canonical. Do not use external planning documents as the source of truth. Do not route to legacy workflow skills as user-facing next steps.
