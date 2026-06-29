# Plan: M7 — Legacy Cleanup and Regression Stabilization

## Context

M6 quarantined parser-derived paths behind `legacy-import-markdown.ts` and made structured state the primary restore path. M7 finalizes the cleanup: verifies isolation, adds end-to-end structured workflow tests, and stabilizes the regression suite.

## Success Criteria

- [ ] Obsolete parser-derived progress tests are migrated or deleted after equivalent structured coverage exists.
- [ ] No primary runtime imports automatic markdown/prose progress parsers.
- [ ] End-to-end structured workflow tests cover reducer, storage, replay, tools, renderers, footer, and skills.
- [ ] Existing parser modules are deleted or renamed/isolated behind explicit legacy import.
- [ ] `cd extensions/agentic-harness && npm run build && npm test` passes.

## Tasks

### Task 1: Verify parser isolation (source-level check)

Add a test in `tests/parser-isolation.test.ts` that verifies:
- `index.ts` does NOT directly import from `plan-progress-events.ts`
- `index.ts` imports parser functions only from `legacy-import-markdown.ts`
- `plan-progress-events.ts` is only imported by `legacy-import-markdown.ts` (not by any other non-test module)

### Task 2: Add end-to-end structured workflow test

Create `tests/e2e-structured-workflow.test.ts` that exercises the full structured path:

1. Create a `HarnessState` with milestones, plans, tasks, todos
2. Persist to snapshot
3. Replay events onto the state
4. Load from snapshot + events (simulating session restore)
5. Verify milestone statuses are correct
6. Verify plan task statuses are correct
7. Verify todo statuses are correct
8. Render milestones, plan, and todos — verify output contains expected content
9. Apply a `set_plan_task_status` command — verify state updates
10. Invalidate provider — verify change listener fires

### Task 3: Migrate/delete obsolete tests

Check if any existing tests test parser-derived functions that are now covered by structured tests. If equivalent structured coverage exists, mark the parser test as "legacy" with a comment. If not, keep the test.

Key tests to check:
- `plan-progress-events.test.ts` — tests parser functions. Keep (legacy path still exists).
- `plan-progress.test.ts` — tests PlanProgressTracker. Keep (still used for footer fallback).
- `milestone-tracker.test.ts` — tests MilestoneTracker. Keep (still used).

Since all parser modules are still needed for the legacy path, no tests need to be deleted. Add "LEGACY" markers to tests that only test parser-derived behavior.

### Task 4: Build and full test suite

Run:
```bash
cd extensions/agentic-harness && npm run build && npm test
```

Fix any issues.

## Self-Review

- Are we deleting parser modules? No — they're isolated behind `legacy-import-markdown.ts`, not deleted.
- Are existing tests preserved? Yes — only adding new tests and markers.
- Is `plan-parser.ts` kept? Yes — it's used for validator template building (not progress inference).
