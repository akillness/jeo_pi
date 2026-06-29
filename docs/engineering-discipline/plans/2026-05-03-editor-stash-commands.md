# Editor Stash Commands Implementation Plan

**Goal:** Add command-first, session-scoped editor stash save, clear, and restore behavior using Pi editor text APIs.

**Architecture:** Introduce a small `EditorStash` module with a single in-memory slot and register three commands. Keep shortcut/editor-wrapper integration out of M4; M5 will compose status/shortcuts on top of this tested command layer.

**Verification Strategy:**
- Focused: `npm --prefix extensions/agentic-harness test -- --run tests/editor-stash.test.ts tests/extension.test.ts`
- Full: `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build`
- Scope guard: `git diff -- extensions/agentic-harness/package.json extensions/agentic-harness/package-lock.json extensions/fff-search/index.ts`

## Files

- Create: `extensions/agentic-harness/editor-stash.ts`
- Create: `extensions/agentic-harness/tests/editor-stash.test.ts`
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

---

### Task 1: Create Editor Stash Module and Focused Tests

**Dependencies:** None
**Files:**
- Create: `extensions/agentic-harness/editor-stash.ts`
- Create: `extensions/agentic-harness/tests/editor-stash.test.ts`

- [ ] Add `EditorStash`, `defaultEditorStash`, editor UI type, `saveEditorToStash`, `clearEditorText`, `restoreEditorFromStash`, and `registerEditorStashCommands`.
- [ ] Ensure an empty string is a valid saved stash value.
- [ ] Ensure restore without a stash does not modify editor text and returns false.
- [ ] Add tests for empty text, overwrite, restore, clear, and long/multiline text.
- [ ] Run focused stash tests.

### Task 2: Wire Stash Commands into the Extension

**Dependencies:** Task 1
**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] Import and call `registerEditorStashCommands(pi)` during extension registration.
- [ ] Verify `/stash-save`, `/stash-clear`, and `/stash-restore` are registered.
- [ ] Run focused extension/stash tests.

### Task 3: End-to-End Verification

**Dependencies:** Task 2
**Files:** None

- [ ] Run `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build`.
- [ ] Run dependency/scope guard diff command.
- [ ] Verify milestone success criteria manually against implementation and tests.
