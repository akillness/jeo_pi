# Synthesis Review: Powerline UI

## Conflict Resolution Log

| Conflict | Resolution | Rationale |
|----------|-----------|-----------|
| First milestone: dependency reviewer proposed foundation/settings first; value/risk reviewers wanted footer/status MVP first. | Make M1 a user-visible footer MVP that also creates the width-safe segment foundation. | User value and risk reasoning are stronger: the known broken gap is hidden `ctx.ui.setStatus(...)`, and M1 must be minimum viable/useful. |
| Whether to split status bridge, segment utilities, and Powerline footer into separate milestones. | Combine them into M1, but keep implementation incremental inside `RoachFooter`. | Splitting would reduce risk, but a foundation-only milestone has low user value. Tests mitigate the footer regression risk. |
| Presets before or after footer redesign. | Put presets/settings in M2, after the default footer MVP exists. | Architecture/value agree presets should consume a stable footer contract; M1 can hard-code default behavior first. |
| Editor stash vs editor composition ordering. | Implement stash commands first; add shortcuts/editor-border integration later. | Architecture and user value are stronger: stash can be command-only and avoids `setEditorComponent()` risk. |
| Fixed editor vs safer editor-border wrapper. | Treat safe editor-border/composition as the target; true fixed editor is optional only if prototype proves safe. | Feasibility and risk both flag true fixed editor as uncertain/high-risk. |
| Parallel work vs `index.ts` conflicts. | Recommended execution is serialized for fully integrated milestones. Parallelism is only safe for isolated module/test work with deferred wiring. | Dependency analysis is strongest: `index.ts` and singleton UI APIs are shared conflict points. |
| Welcome overlay richness. | Start with non-blocking header or optional dismissible overlay with fallback. | Risk analysis is stronger: startup focus stealing is worse than a simpler welcome UI. |

## Milestone DAG

### M1: Footer Status Bridge + Powerline MVP
- **Goal:** Restore extension status visibility and introduce a width-safe default Powerline-style footer while preserving existing progress panels.
- **Success Criteria:**
  - [ ] `footerData.getExtensionStatuses()` renders visible statuses for none/one/multiple/long/cleared states.
  - [ ] Footer visible width never exceeds `render(width)` across narrow/wide test cases.
  - [ ] Existing cwd/git/model/context/cache/tools/plan/milestone information remains visible according to priority.
  - [ ] `RoachFooter` lifecycle, subscriptions, timers, and `dispose()` behavior remain covered by tests.
- **Dependencies:** None
- **Files:** `extensions/agentic-harness/footer.ts`, new segment/width utility module if needed, `extensions/agentic-harness/tests/footer.test.ts`, minimal `extensions/agentic-harness/index.ts` wiring if constructor/options change.
- **Risk:** High
- **Effort:** Medium
- **User Value:** User immediately sees the segmented footer and hidden `ctx.ui.setStatus(...)` messages become visible again.
- **Abort Point:** Yes

### M2: Footer Presets and UI Settings Resolver
- **Goal:** Add `default`, `compact`, and `minimal` UI presets through a small typed settings resolver.
- **Success Criteria:**
  - [ ] `default`, `compact`, and `minimal` presets produce distinct, width-safe footer layouts.
  - [ ] Missing/invalid config falls back to the current default preset.
  - [ ] Preset logic is data-driven and not scattered through footer rendering.
  - [ ] Tests verify preset behavior at narrow and normal widths.
- **Dependencies:** M1
- **Files:** `extensions/agentic-harness/ui-settings.ts` or equivalent new module, `extensions/agentic-harness/footer.ts`, preset tests, `extensions/agentic-harness/index.ts`.
- **Risk:** Medium
- **Effort:** Medium
- **User Value:** User can choose the density/visual style of the footer early.
- **Abort Point:** Yes

### M3: Welcome Header / Optional Overlay Controller
- **Goal:** Add a dismissible welcome experience that does not block startup input or conflict with the footer.
- **Success Criteria:**
  - [ ] Welcome UI appears on startup using `setHeader` or feature-detected overlay support.
  - [ ] User can dismiss and restore the welcome UI.
  - [ ] Overlay fallback path uses non-blocking header behavior if overlay support is unavailable/unsafe.
  - [ ] Tests cover show/dismiss/restore and no duplicate competing header registration.
- **Dependencies:** M2
- **Files:** `extensions/agentic-harness/welcome-ui.ts`, `extensions/agentic-harness/tests/welcome-ui.test.ts`, `extensions/agentic-harness/index.ts`.
- **Risk:** Medium
- **Effort:** Medium
- **User Value:** User gets a polished startup/welcome experience without losing editor focus.
- **Abort Point:** No

### M4: Editor Stash Commands
- **Goal:** Add command-first editor stash save, clear, and restore behavior using existing editor text APIs.
- **Success Criteria:**
  - [ ] `/stash-save`, `/stash-clear`, and `/stash-restore` or equivalent commands work.
  - [ ] Save captures exact editor text; clear empties the editor; restore replaces text predictably.
  - [ ] Initial implementation is session-scoped single-slot stash.
  - [ ] Tests cover empty text, overwrite, restore, clear, and long/multiline text.
- **Dependencies:** M2
- **Files:** `extensions/agentic-harness/editor-stash.ts`, `extensions/agentic-harness/tests/editor-stash.test.ts`, `extensions/agentic-harness/index.ts`.
- **Risk:** Medium
- **Effort:** Medium
- **User Value:** User can temporarily save prompt text, clear the editor, and restore it later.
- **Abort Point:** Yes

### M5: Editor Composition Layer + Border Status / Stash Shortcuts
- **Goal:** Safely enhance the editor with border/status behavior and optional stash shortcuts without breaking existing editor wrappers such as `fff-search`.
- **Success Criteria:**
  - [ ] Wrapper uses `ctx.ui.getEditorComponent()` and composes with the previous factory instead of replacing blindly.
  - [ ] Tests prove composition with a mock existing editor wrapper.
  - [ ] `extensions/fff-search/index.ts` is not modified.
  - [ ] Stash shortcuts call the command-tested stash operations.
  - [ ] If true fixed-editor behavior is unsafe, documented fallback uses safer border/status behavior.
- **Dependencies:** M2, M4
- **Files:** `extensions/agentic-harness/editor-status.ts` or `editor-composition.ts`, `extensions/agentic-harness/tests/editor-status.test.ts`, `extensions/agentic-harness/index.ts`; explicitly avoid modifying `extensions/fff-search/index.ts`.
- **Risk:** High
- **Effort:** Large
- **User Value:** User gets improved editor status/border behavior while autocomplete/editor integrations remain stable.
- **Abort Point:** Yes

### M6: Final Integration, Regression Tests, and Verification
- **Goal:** Harden the full UI feature set across widths, presets, progress states, welcome lifecycle, stash behavior, and editor composition.
- **Success Criteria:**
  - [ ] Full test suite passes: `npm --prefix extensions/agentic-harness test`.
  - [ ] Build passes: `npm --prefix extensions/agentic-harness run build`.
  - [ ] Manual/focused verification covers narrow footer widths, active statuses, plan/milestone progress, welcome dismissal, stash restore, and `fff-search` editor composition.
  - [ ] No new runtime dependency such as `pi-powerline-footer` is added.
- **Dependencies:** M1, M2, M3, M4, M5
- **Files:** `extensions/agentic-harness/tests/extension.test.ts`, focused test files from prior milestones, docs/README if needed, final `extensions/agentic-harness/index.ts` cleanup.
- **Risk:** Low
- **Effort:** Medium
- **User Value:** User gets confidence that the full polished UI works reliably.
- **Abort Point:** No

### M_final: Integration Verification
- **Goal:** Validate that all milestones work together as a complete system.
- **Success Criteria:**
  - [ ] Highest-level verification passes: `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build`.
  - [ ] All milestone success criteria remain valid after full integration.
  - [ ] No regressions in pre-existing functionality.
  - [ ] Cross-milestone interfaces are exercised end-to-end.
- **Dependencies:** M1, M2, M3, M4, M5, M6
- **Files:** None (read-only verification)
- **Risk:** Medium
- **Effort:** Small
- **User Value:** Confidence that the system works as a whole, not just per-milestone.
- **Abort Point:** No

## DAG Validation

- **No circular dependencies:** Yes. Dependencies flow from M1 → M2 → M3/M4 → M5 → M6 → M_final.
- **Valid topological ordering exists:** Yes: `M1, M2, M3, M4, M5, M6, M_final`.
- **No file conflicts between parallel milestones:** Recommended integrated execution has no parallel milestones because `index.ts` and UI singleton APIs are shared.
- **Each milestone leaves system working:** Yes. Each milestone must pass focused tests and keep the extension buildable before proceeding.
- **First milestone is minimum viable:** Yes. M1 directly fixes status visibility and delivers the visible Powerline footer MVP.

## Execution Order

```text
Phase 1: M1
Phase 2: M2
Phase 3: M3
Phase 4: M4
Phase 5: M5
Phase 6: M6
Phase 7: M_final
```

Parallel note: M3 and M4 module/test development can run in parallel only if `index.ts` wiring is deferred or coordinated. For the safest fully integrated path, execute serially as above.

## Rejected Proposals

| Proposal | Source | Reason for rejection |
|----------|--------|---------------------|
| Foundation/settings-only first milestone | Dependency Analysis | Does not satisfy minimum viable user value; folded width utilities into M1 instead. |
| Full fixed-editor replacement as required deliverable | Feasibility/Risk | Public Pi APIs may not support it safely; safer editor-border composition is acceptable first release. |
| Blindly replacing `setEditorComponent()` | Architecture/Risk | Would conflict with `fff-search`; must wrap existing factory. |
| Modifying `extensions/fff-search/index.ts` | Dependency Analysis | Composition should happen from agentic-harness without changing another extension. |
| Adding `pi-powerline-footer` runtime dependency | Dependency Analysis | Use as inspiration only; avoid unnecessary dependency. |
| Elaborate modal welcome overlay | User Value/Risk | Low value and can steal focus; non-blocking header/optional overlay is safer. |
| Extra presets beyond `default`, `compact`, `minimal` | User Value | Scope creep; three presets are enough for initial feedback. |
| One large all-in-one visual redesign milestone | Risk Analysis | High recovery cost; split into independently verifiable milestones. |
