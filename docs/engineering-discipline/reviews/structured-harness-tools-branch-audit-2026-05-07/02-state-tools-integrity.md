# Structured State, Storage, Render, and Tool Integrity Audit

## Commands Run
- `cd extensions/agentic-harness && set -o pipefail && mkdir -p ../../docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands node_modules/.tmp/audit-state-tools && TMPDIR=$PWD/node_modules/.tmp/audit-state-tools npm exec -- vitest run tests/harness-state.test.ts tests/harness-storage.test.ts tests/harness-render.test.ts tests/harness-events.test.ts tests/harness-tools.test.ts tests/e2e-structured-workflow.test.ts 2>&1 | tee ../../docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/state-tools-tests.log`

## Files Reviewed
- `extensions/agentic-harness/harness-state.ts`
- `extensions/agentic-harness/harness-storage.ts`
- `extensions/agentic-harness/harness-render.ts`
- `extensions/agentic-harness/harness-events.ts`
- `extensions/agentic-harness/harness-tools.ts`

## Checks Performed
- reducer command coverage
- snapshot durability and path safety
- tool parameter validation
- mutating action persistence and replay event emission
- load/render read-only behavior

## Findings

### Finding 1: Todo reducer lacks plan_task owner test coverage
- **Severity:** Low
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/harness-state.ts:7` defines `HarnessTodoOwnerType = "milestone" | "plan" | "plan_task"`; `extensions/agentic-harness/harness-state.ts:335` and `extensions/agentic-harness/harness-state.ts:372` handle `set_todos` and `clear_todos` for the generic owner type, but `extensions/agentic-harness/tests/harness-state.test.ts:230` only exercises milestone and plan owners, and `grep "ownerType: \"plan_task\"" extensions/agentic-harness/tests/harness-state.test.ts` returned no matches.
- **Impact:** A regression in plan-task-owned todos could pass reducer tests and break task-scoped todo progress.
- **Recommendation:** Add `harness-state` reducer tests that set, update, select, and clear todos for a `plan_task` owner.

### Finding 2: Todo status updates are ambiguous across owners
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/harness-tools.ts:616` accepts `update_status` with only `todoId` and `status`; `extensions/agentic-harness/harness-state.ts:357` checks only `todo.id === command.todoId`, and `extensions/agentic-harness/harness-state.ts:364` updates every todo whose ID matches that value, regardless of `ownerType` or `ownerId`.
- **Impact:** If two milestone, plan, or plan-task owners use the same todo ID, a single `harness_todo update_status` call can update the wrong todo or multiple todos at once.
- **Recommendation:** Require owner context for `update_status` or enforce globally unique todo IDs, then add a regression test with duplicate todo IDs under different owners.
