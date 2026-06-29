# Risk Review: Powerline UI

- **Risk:** Footer rewrite breaks existing plan/milestone progress rendering, spinner lifecycle, or render subscriptions.
- **Severity:** High
- **Affected milestone(s):** Powerline footer core; plan/milestone integration preservation
- **Mitigation:** Redesign incrementally inside `RoachFooter`; preserve progress panel ordering, `dispose()`, timers, subscriptions. Add regression tests.

- **Risk:** `footerData.getExtensionStatuses()` remains hidden or renders poorly.
- **Severity:** High
- **Affected milestone(s):** Status visibility; Powerline footer core
- **Mitigation:** Make status integration part of M1. Add fake `footerData` tests for none/one/multiple/long/cleared statuses.

- **Risk:** ANSI-colored Powerline strings exceed terminal width.
- **Severity:** High
- **Affected milestone(s):** Footer core; presets; status rendering; welcome/header UI
- **Mitigation:** Build a visible-width segment/truncation helper. Define degradation order: hide low-value segments, truncate labels, never overflow.

- **Risk:** Preset/settings requirements grow unexpectedly.
- **Severity:** Medium
- **Affected milestone(s):** Preset/settings support
- **Mitigation:** Implement only `default`, `minimal`, and `compact`; keep resolver typed and data-driven.

- **Risk:** Editor changes conflict with `extensions/fff-search/index.ts`.
- **Severity:** Critical
- **Affected milestone(s):** Fixed editor/editor-border; stash shortcuts
- **Mitigation:** Compose with `ctx.ui.getEditorComponent()` and test load-order-like behavior. Prefer editor-border first.

- **Risk:** Welcome overlay steals focus or blocks startup.
- **Severity:** Medium
- **Affected milestone(s):** Welcome UI
- **Mitigation:** Start with non-blocking header or optional overlay. Make dismissal reversible. Avoid modal startup unless explicitly enabled.

- **Risk:** Editor stash semantics are ambiguous.
- **Severity:** Medium
- **Affected milestone(s):** Editor stash
- **Mitigation:** Implement command-first, session-scoped, single-slot stash. Restore by replacing current text predictably.

- **Risk:** Workflow visibility regresses for planning/review/team status, active tools, cache stats, model/context.
- **Severity:** High
- **Affected milestone(s):** Status visibility; footer core; presets
- **Mitigation:** Keep data sources unchanged; add focused tests for current footer information.

- **Risk:** Pi UI APIs differ or are optional.
- **Severity:** Medium
- **Affected milestone(s):** Welcome UI; editor composition; stash; status visibility
- **Mitigation:** Feature-detect optional APIs and provide fallbacks.

- **Risk:** One large redesign has high recovery cost.
- **Severity:** High
- **Affected milestone(s):** Full Powerline UI layer
- **Mitigation:** Split into demonstrable milestones that leave extension buildable and usable.

## Overall risk-ordered milestone sequence

1. Status visibility + footer safety harness
2. Segment layout/truncation foundation
3. Powerline footer core preserving existing progress panels
4. Preset/settings resolver
5. Editor composition spike / safer editor-border status
6. Editor stash command behavior
7. Welcome header/overlay
8. Full verification and regression pass
