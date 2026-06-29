# Milestone: Legacy Cleanup and Regression Stabilization

**ID:** M7
**Status:** pending
**Dependencies:** M6
**Risk:** Medium
**Effort:** Large

## Goal

Remove obsolete parser paths or lock them to explicit legacy import, then stabilize the full structured-state regression suite.

## Success Criteria

- [ ] Obsolete parser-derived progress tests are migrated or deleted after equivalent structured coverage exists.
- [ ] No primary runtime imports automatic markdown/prose progress parsers.
- [ ] End-to-end structured workflow tests cover reducer, storage, replay, tools, renderers, footer, and skills.
- [ ] Existing parser modules are deleted or renamed/isolated behind explicit legacy import.
- [ ] `cd extensions/agentic-harness && npm run build && npm test` passes.

## Files Affected

- Modify/Delete: `extensions/agentic-harness/plan-parser.ts`
- Modify/Delete: `extensions/agentic-harness/plan-progress-events.ts`
- Modify: `extensions/agentic-harness/milestone-tracker.ts`
- Modify: `extensions/agentic-harness/tests/*`
- Modify: `extensions/agentic-harness/package.json` only if test scripts need adjustment.

## User Value

Final stable architecture with structured state as the only normal source of truth.

## Abort Point

Yes — parser cleanup can be reverted independently if final regression exposes a hidden dependency.

## Notes

This is the destructive cleanup milestone. Do not start until structured workflow has passed runtime/replay/footer verification.
