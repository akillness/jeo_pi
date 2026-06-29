# Editor Composition Layer + Border Status / Stash Shortcuts Implementation Plan

**Goal:** Safely enhance the editor with status/border behavior and stash shortcuts while composing with existing editor wrappers such as `fff-search`.

**Architecture:** Add a compositional editor wrapper module that captures the previous editor factory with `ctx.ui.getEditorComponent?.()` and installs a new factory through `ctx.ui.setEditorComponent(...)`. The wrapper decorates an existing editor when present and falls back to `CustomEditor` only when no previous factory exists. It adds a small width-safe status line and Ctrl-key shortcuts that call the M4 command-tested stash helpers.

**Fallback Decision:** True fixed-editor behavior is intentionally deferred for first release. The implemented fallback is safer border/status composition.

**Verification Strategy:**
- Focused: `npm --prefix extensions/agentic-harness test -- --run tests/editor-composition.test.ts tests/editor-stash.test.ts tests/extension.test.ts`
- Full: `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build`
- Scope guard: `git diff -- extensions/fff-search/index.ts extensions/agentic-harness/package.json extensions/agentic-harness/package-lock.json`

## Files

- Create: `extensions/agentic-harness/editor-composition.ts`
- Create: `extensions/agentic-harness/tests/editor-composition.test.ts`
- Modify: `extensions/agentic-harness/index.ts`
- Do not modify: `extensions/fff-search/index.ts`

---

### Task 1: Add Editor Composition Module and Tests

- [ ] Create `editor-composition.ts` with `installEditorComposition(ui, options?)`.
- [ ] Capture previous factory using `ui.getEditorComponent?.()` before `setEditorComponent`.
- [ ] Decorate existing editors without replacing methods blindly.
- [ ] Add status line showing stash availability and shortcuts.
- [ ] Add Ctrl+S save, Ctrl+R restore, and Ctrl+K clear shortcuts calling M4 helpers.
- [ ] Tests prove composition with a mock existing editor wrapper, shortcut behavior, width safety, and fallback editor factory creation.

### Task 2: Wire Composition into Extension Startup

- [ ] Import `installEditorComposition` in `index.ts`.
- [ ] Call it during `session_start` after welcome/footer setup is safe.
- [ ] Ensure extension tests still pass.

### Task 3: End-to-End Verification

- [ ] Run focused tests.
- [ ] Run full test suite and build.
- [ ] Verify `extensions/fff-search/index.ts` remains unmodified.
