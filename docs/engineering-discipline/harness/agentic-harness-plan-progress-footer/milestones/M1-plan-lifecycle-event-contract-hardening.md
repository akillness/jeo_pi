# Milestone: Plan Lifecycle Event Contract Hardening

**ID:** M1
**Status:** pending
**Dependencies:** None
**Risk:** High
**Effort:** Medium

## Goal

Make plan task state changes correct and limited to intended plan execution agents.

## Success Criteria

- [ ] `plan-validator` success with explicit `planTaskId` completes the correct task even when `matchedTaskIds` is missing or empty.
- [ ] Regression test proves expected state such as Task 1 completed and Task 2 still running: `1/4 │ 1 running`.
- [ ] `plan-compliance` and `plan-worker` success leave tasks running; failures mark the corresponding task failed.
- [ ] Reviewers, explorer, generic worker, nested non-plan agents, and incidental “Task N” text do not mutate plan task state.

## Files Affected

- Create: none expected
- Modify:
  - `extensions/agentic-harness/plan-progress-events.ts`
  - `extensions/agentic-harness/tests/plan-progress-events.test.ts`

## User Value

The tracker becomes trustworthy: validator success advances the task, while unrelated agents no longer corrupt progress.

## Abort Point

Yes — after this milestone, the main user-visible correctness bug should be fixed even before render stabilization.

## Notes

- `planTaskId` should be authoritative when present.
- Only `plan-compliance`, `plan-worker`, and `plan-validator` should mutate plan task progress.
- `plan-compliance` / `plan-worker` success must not mark completed; `plan-validator` success remains the completion gate.
