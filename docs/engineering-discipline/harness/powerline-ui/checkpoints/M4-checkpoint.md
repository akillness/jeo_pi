# Checkpoint: M4 — Editor Stash Commands

**Completed:** 2026-05-03 21:20
**Attempts:** 1

## Plan File

`docs/engineering-discipline/plans/2026-05-03-editor-stash-commands.md`

## Review File

`docs/engineering-discipline/reviews/2026-05-03-editor-stash-commands-review.md`

## Test Results

- `npm --prefix extensions/agentic-harness test -- --run tests/editor-stash.test.ts tests/extension.test.ts` — PASS (58/58 tests)
- `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build` — PASS (563/563 tests; `tsc --noEmit` passed)
- `git diff -- extensions/agentic-harness/package.json extensions/agentic-harness/package-lock.json extensions/fff-search/index.ts` — PASS (no diff)

## Files Changed

- Created: `extensions/agentic-harness/editor-stash.ts`
- Created: `extensions/agentic-harness/tests/editor-stash.test.ts`
- Modified: `extensions/agentic-harness/index.ts`
- Modified: `extensions/agentic-harness/tests/extension.test.ts`

## Interface Contracts Established

- `EditorStash` is a session-scoped single-slot in-memory stash.
- Empty string is a valid saved stash value.
- `saveEditorToStash(ui)` reads `ui.getEditorText()` exactly.
- `clearEditorText(ui)` calls `ui.setEditorText("")` and does not clear the stash.
- `restoreEditorFromStash(ui)` returns `false` and leaves editor text untouched when no stash exists.
- `/stash-save`, `/stash-clear`, and `/stash-restore` are registered.

## State After Milestone

Users can save prompt text, clear the editor, and restore the saved text later in the same session. This provides the command layer that M5 can surface in editor status/shortcut affordances.
