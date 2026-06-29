# Milestone: Final Integration, Regression Tests, and Verification

**ID:** M6
**Status:** pending
**Dependencies:** M1, M2, M3, M4, M5
**Risk:** Low
**Effort:** Medium

## Goal

Harden the full UI feature set across widths, presets, progress states, welcome lifecycle, stash behavior, and editor composition.

## Success Criteria

- [ ] Full test suite passes: `npm --prefix extensions/agentic-harness test`.
- [ ] Build passes: `npm --prefix extensions/agentic-harness run build`.
- [ ] Manual or focused verification covers narrow footer widths, active statuses, plan/milestone progress, welcome dismissal, stash restore, and `fff-search` editor composition.
- [ ] No new runtime dependency such as `pi-powerline-footer` is added.

## Files Affected

- Modify: `extensions/agentic-harness/tests/extension.test.ts` if central mocks need final coverage
- Modify: focused tests created in prior milestones as needed
- Modify: `extensions/agentic-harness/index.ts` cleanup as needed
- Modify: docs/README if needed

## User Value

User gets confidence that the full polished UI works reliably.

## Abort Point

No — this is a hardening milestone.

## Notes

Do not add scope beyond regression coverage, wiring cleanup, and documentation updates.
