# Checkpoint: M5 — Editor Composition Layer + Border Status / Stash Shortcuts

**Completed:** 2026-05-03 21:27
**Attempts:** 1

## Plan File

`docs/engineering-discipline/plans/2026-05-03-editor-composition-border-status-shortcuts.md`

## Review File

`docs/engineering-discipline/reviews/2026-05-03-editor-composition-border-status-shortcuts-review.md`

## Test Results

- `npm --prefix extensions/agentic-harness test -- --run tests/editor-composition.test.ts tests/editor-stash.test.ts tests/extension.test.ts` — PASS (63/63 tests)
- `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build` — PASS (568/568 tests; `tsc --noEmit` passed)
- `git diff -- extensions/fff-search/index.ts extensions/agentic-harness/package.json extensions/agentic-harness/package-lock.json` — PASS (no diff)

## Files Changed

- Created: `extensions/agentic-harness/editor-composition.ts`
- Created: `extensions/agentic-harness/tests/editor-composition.test.ts`
- Modified: `extensions/agentic-harness/index.ts`

## Interface Contracts Established

- `installEditorComposition(ui)` captures previous editor factory via `ui.getEditorComponent?.()`.
- When a previous factory exists, the wrapper decorates its returned editor.
- When no previous factory exists, the wrapper falls back to `CustomEditor`.
- Appended status line shows stash availability and shortcuts (`^S save`, `^R restore`, `^K clear`).
- Status line is width-safe via `truncateToWidth`.
- Ctrl+S/Ctrl+R/Ctrl+K call M4 stash helpers exactly.
- `fff-search` is untouched.

## State After Milestone

The editor now has compositional border/status behavior and stash shortcuts. The first release uses the safer border/status fallback; true fixed-editor behavior is deferred and documented.
