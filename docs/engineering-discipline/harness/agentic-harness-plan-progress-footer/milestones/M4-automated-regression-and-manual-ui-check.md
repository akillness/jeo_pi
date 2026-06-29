# Milestone: Automated Regression and Manual UI Check

**ID:** M4
**Status:** pending
**Dependencies:** M1, M2, M3
**Risk:** Medium
**Effort:** Small

## Goal

Verify lifecycle, footer, visibility, and extension wiring regression together.

## Success Criteria

- [ ] `cd extensions/agentic-harness && npm run build` passes.
- [ ] `cd extensions/agentic-harness && npm test` passes.
- [ ] Relevant suites pass, including plan progress events, extension wiring, footer, and working visibility tests.
- [ ] Manual/session-level note confirms no footer-induced downward scrolling during active spinner updates.

## Files Affected

- Create: none expected
- Modify: none expected; verification only unless regressions require follow-up fixes.

## User Value

Merge-ready confidence with automated and terminal-level validation.

## Abort Point

Yes.

## Notes

- This milestone should be read-mostly; implementation work here should be limited to fixing regressions discovered during verification.
