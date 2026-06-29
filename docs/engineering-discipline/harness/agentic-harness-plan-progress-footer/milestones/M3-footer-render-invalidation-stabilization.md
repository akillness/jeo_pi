# Milestone: Footer Render Invalidation Stabilization

**ID:** M3
**Status:** pending
**Dependencies:** None
**Risk:** High
**Effort:** Medium

## Goal

Stop footer progress updates and spinner ticks from forcing full TUI redraws while keeping progress visible.

## Success Criteria

- [ ] Tracker changes and spinner ticks request non-forced renders via `requestRender()` or `requestRender(false)`.
- [ ] Tests assert `requestRender(true)` is not used for repeated footer progress/spinner updates.
- [ ] Spinner timer starts only while plan tasks are running and stops/cleans up on completion or `dispose()`.
- [ ] Existing footer rendering remains width-safe and visible.

## Files Affected

- Create: none expected
- Modify:
  - `extensions/agentic-harness/footer.ts`
  - `extensions/agentic-harness/tests/plan-progress.test.ts`
  - `extensions/agentic-harness/tests/footer.test.ts`

## User Value

Terminal output should stop visibly scrolling downward during plan progress updates while keeping Task Progress Tracker visible.

## Abort Point

Yes, once M1/M2 are also complete.

## Notes

- Avoid pi TUI core changes.
- The key invariant is “do not use forced full redraw for repeated footer progress/spinner updates.”
- Unit tests can verify extension-level render request behavior; manual/session-level validation may still be needed for terminal visual behavior.
