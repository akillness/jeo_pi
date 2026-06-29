# Milestone: Index Snapshot and Replay Consistency

**ID:** M2
**Status:** pending
**Dependencies:** M1
**Risk:** High
**Effort:** Medium

## Goal

Ensure live execution, persistence, and replay use the corrected lifecycle contract.

## Success Criteria

- [ ] `index.ts` persists `plan-progress` snapshots after actual completion/failure, not only when `matchedTaskIds` existed.
- [ ] Explicit `planTaskId` validator completion survives session snapshot persistence.
- [ ] Replay preserves stale `running → pending` behavior.
- [ ] `extension.test.ts` covers missing/empty `matchedTaskIds`, explicit `planTaskId`, and ignored non-plan events through tool start/end wiring.

## Files Affected

- Create: none expected
- Modify:
  - `extensions/agentic-harness/index.ts`
  - `extensions/agentic-harness/tests/extension.test.ts`

## User Value

Restart/replay behavior remains consistent with what users saw during live execution.

## Abort Point

No — this milestone depends on M1 and is primarily an integration consistency step.

## Notes

- Snapshot persistence should be based on actual affected task IDs/state changes, not only start-time `matchedTaskIds`.
- Keep existing replay behavior that demotes stale `running` tasks to `pending`.
