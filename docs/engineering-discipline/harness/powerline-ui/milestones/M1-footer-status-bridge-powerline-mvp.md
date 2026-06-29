# Milestone: Footer Status Bridge + Powerline MVP

**ID:** M1
**Status:** pending
**Dependencies:** None
**Risk:** High
**Effort:** Medium

## Goal

Restore extension status visibility and introduce a width-safe default Powerline-style footer while preserving existing progress panels.

## Success Criteria

- [ ] `footerData.getExtensionStatuses()` renders visible statuses for none, one, multiple, long, and cleared states.
- [ ] Footer visible width never exceeds `render(width)` across narrow and wide test cases.
- [ ] Existing cwd, git, model, context, cache, tools, plan, and milestone information remains visible according to priority.
- [ ] `RoachFooter` lifecycle, subscriptions, timers, and `dispose()` behavior remain covered by tests.

## Files Affected

- Modify: `extensions/agentic-harness/footer.ts`
- Modify: `extensions/agentic-harness/index.ts` only if constructor/options wiring changes
- Create: `extensions/agentic-harness/tests/footer.test.ts`
- Create: optional segment/width utility module under `extensions/agentic-harness/`

## User Value

User immediately sees a segmented footer, and hidden `ctx.ui.setStatus(...)` messages become visible again.

## Abort Point

Yes — status visibility is fixed and the footer is visibly improved.

## Notes

Implement incrementally inside `RoachFooter`; preserve plan/milestone panel ordering and lifecycle behavior.
