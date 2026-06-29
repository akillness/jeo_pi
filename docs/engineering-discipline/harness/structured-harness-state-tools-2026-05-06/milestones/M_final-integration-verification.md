# Milestone: Integration Verification

**ID:** M_final
**Status:** pending
**Dependencies:** M1, M2, M3, M4, M5, M6, M7
**Risk:** Medium
**Effort:** Small

## Goal

Validate that the structured harness state migration works end-to-end as a complete system.

## Success Criteria

- [ ] `cd extensions/agentic-harness && npm run build && npm test` passes.
- [ ] New structured milestone/plan/todo workflow works without markdown parsing.
- [ ] Session resume restores progress from structured state and structured custom events.
- [ ] Footer displays structured progress live for milestones, plans, and todos.
- [ ] Rendered markdown is generated from structured state and is not parsed as primary input.
- [ ] All milestone success criteria remain valid after full integration.

## Files Affected

None. Read-only verification milestone.

## User Value

Confidence that the migration works as a full system, not just as independently passing pieces.

## Abort Point

No — this is the final verification gate.

## Notes

If this milestone fails, diagnose cross-milestone integration rather than adding new features.
