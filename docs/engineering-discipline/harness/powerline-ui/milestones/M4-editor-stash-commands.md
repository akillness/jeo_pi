# Milestone: Editor Stash Commands

**ID:** M4
**Status:** pending
**Dependencies:** M2
**Risk:** Medium
**Effort:** Medium

## Goal

Add command-first editor stash save, clear, and restore behavior using existing editor text APIs.

## Success Criteria

- [ ] `/stash-save`, `/stash-clear`, and `/stash-restore` or equivalent commands work.
- [ ] Save captures exact editor text; clear empties the editor; restore replaces text predictably.
- [ ] Initial implementation is session-scoped single-slot stash.
- [ ] Tests cover empty text, overwrite, restore, clear, and long/multiline text.

## Files Affected

- Create: `extensions/agentic-harness/editor-stash.ts`
- Create: `extensions/agentic-harness/tests/editor-stash.test.ts`
- Modify: `extensions/agentic-harness/index.ts`

## User Value

User can temporarily save prompt text, clear the editor, and restore it later.

## Abort Point

Yes — footer, welcome, and stash deliver visible workflow value.

## Notes

Start with a single session-scoped stash slot. Add shortcut integration only after command behavior is tested.
