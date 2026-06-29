# Milestone: Runtime Replay Cutover and Parser Quarantine

**ID:** M6
**Status:** pending
**Dependencies:** M4, M5
**Risk:** High
**Effort:** Large

## Goal

Make structured snapshot/event replay the primary runtime path and move markdown/prose parsing behind an explicit legacy/manual boundary.

## Success Criteria

- [ ] `session_start` hydrates progress from `state.json` plus structured custom events.
- [ ] Primary runtime no longer infers progress from assistant prose, tool args, plan markdown, `state.md`, or `todo.md`.
- [ ] Legacy markdown import, if retained, is explicit and never automatic.
- [ ] Tests prove structured replay works without parser-derived events.
- [ ] Runtime tests cover fresh session, resumed session, branch replay, and completed workflow.
- [ ] `cd extensions/agentic-harness && npm run build && npm test` passes after parser quarantine.

## Files Affected

- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/plan-progress-events.ts`
- Modify: `extensions/agentic-harness/milestone-tracker.ts`
- Create/Modify: `extensions/agentic-harness/legacy-import-markdown.ts` if any legacy import remains
- Create/Modify: `extensions/agentic-harness/tests/session-replay.test.ts`
- Create/Modify: `extensions/agentic-harness/tests/parser-isolation.test.ts`

## User Value

Resumed sessions and progress tracking become deterministic and independent of fragile markdown/prose inference.

## Abort Point

Yes — if parser quarantine exposes gaps, structured tools/footer remain available while replay logic is corrected.

## Notes

Do not delete parser-derived paths until M3, M4, and M5 are complete and verified.
