# Milestone: Footer and Progress Cutover

**ID:** M5
**Status:** pending
**Dependencies:** M3
**Risk:** High
**Effort:** Large

## Goal

Make the footer read live progress from structured state selectors instead of markdown/prose-derived trackers.

## Success Criteria

- [ ] A read-only progress provider exposes milestone, plan, active task, and todo summaries from structured state.
- [ ] Store changes trigger `tui.requestRender(true)` or the existing render invalidation equivalent.
- [ ] Spinner behavior remains driven by structured running-task state.
- [ ] Footer tests cover live progress updates, session restore display, and disposal cleanup.
- [ ] Existing `PlanProgressTracker` / `MilestoneTracker` parser-derived behavior is not the primary footer source once structured state exists.
- [ ] `cd extensions/agentic-harness && npm run build && npm test` passes for footer/progress integration tests.

## Files Affected

- Modify: `extensions/agentic-harness/footer.ts`
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/plan-progress.ts`
- Modify: `extensions/agentic-harness/milestone-tracker.ts`
- Modify/Create: `extensions/agentic-harness/tests/footer.test.ts`
- Modify/Create: `extensions/agentic-harness/tests/plan-progress.test.ts`

## User Value

Users see live structured milestone/plan/todo progress in the UI, independent of markdown formatting.

## Abort Point

Yes — structured tools remain usable even if footer cutover needs adjustment.

## Notes

Preserve existing render notification and spinner cleanup behavior. This milestone can run in parallel with M4.
