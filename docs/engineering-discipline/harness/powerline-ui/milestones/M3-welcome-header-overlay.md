# Milestone: Welcome Header / Optional Overlay Controller

**ID:** M3
**Status:** pending
**Dependencies:** M2
**Risk:** Medium
**Effort:** Medium

## Goal

Add a dismissible welcome experience that does not block startup input or conflict with the footer.

## Success Criteria

- [ ] Welcome UI appears on startup using `setHeader` or feature-detected overlay support.
- [ ] User can dismiss and restore the welcome UI.
- [ ] Overlay fallback path uses non-blocking header behavior if overlay support is unavailable or unsafe.
- [ ] Tests cover show, dismiss, restore, and no duplicate competing header registration.

## Files Affected

- Create: `extensions/agentic-harness/welcome-ui.ts`
- Create: `extensions/agentic-harness/tests/welcome-ui.test.ts`
- Modify: `extensions/agentic-harness/index.ts`

## User Value

User gets a polished startup/welcome experience without losing editor focus.

## Abort Point

No — useful polish, but not a standalone stopping point compared with footer/stash milestones.

## Notes

Prefer non-blocking header first. Only use overlay if dismiss/focus behavior is safe.
