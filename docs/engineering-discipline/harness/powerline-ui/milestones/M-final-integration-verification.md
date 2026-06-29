# Milestone: Integration Verification

**ID:** M_final
**Status:** pending
**Dependencies:** M1, M2, M3, M4, M5, M6
**Risk:** Medium
**Effort:** Small

## Goal

Validate that all milestones work together as a complete system.

## Success Criteria

- [ ] Highest-level verification passes: `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build`.
- [ ] All milestone success criteria remain valid after full integration.
- [ ] No regressions in pre-existing functionality.
- [ ] Cross-milestone interfaces are exercised end-to-end.

## Files Affected

- Create: none
- Modify: none

## User Value

Confidence that the system works as a whole, not just per-milestone.

## Abort Point

No — this is the final gate.

## Notes

Read-only verification milestone. If verification fails, return to the relevant earlier milestone rather than changing code here.
