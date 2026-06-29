# Milestone: Editor Composition Layer + Border Status / Stash Shortcuts

**ID:** M5
**Status:** pending
**Dependencies:** M2, M4
**Risk:** High
**Effort:** Large

## Goal

Safely enhance the editor with border/status behavior and optional stash shortcuts without breaking existing editor wrappers such as `fff-search`.

## Success Criteria

- [ ] Wrapper uses `ctx.ui.getEditorComponent()` and composes with the previous factory instead of replacing blindly.
- [ ] Tests prove composition with a mock existing editor wrapper.
- [ ] `extensions/fff-search/index.ts` is not modified.
- [ ] Stash shortcuts call the command-tested stash operations.
- [ ] If true fixed-editor behavior is unsafe, documented fallback uses safer border/status behavior.

## Files Affected

- Create: `extensions/agentic-harness/editor-status.ts` or `extensions/agentic-harness/editor-composition.ts`
- Create: `extensions/agentic-harness/tests/editor-status.test.ts`
- Modify: `extensions/agentic-harness/index.ts`
- Do not modify: `extensions/fff-search/index.ts`

## User Value

User gets improved editor status/border behavior while autocomplete/editor integrations remain stable.

## Abort Point

Yes — full intended feature set is present before final polish.

## Notes

Treat true fixed-editor behavior as optional. The safer editor-border/status fallback is acceptable for the first release.
