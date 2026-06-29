# Feasibility Review: Powerline UI

Yes — this is broadly feasible with the stated Pi extension/TUI APIs and current `agentic-harness` structure. The main uncertainty is the “fixed editor” portion: a safer editor-border/status wrapper is likely feasible, but a truly fixed editor layout may depend on Pi TUI internals and should be spiked first.

## Component feasibility / effort

| Component | Feasibility | Effort | Notes |
|---|---:|---:|---|
| Powerline segmented footer | Feasible | Medium | Existing `RoachFooter` already owns rendering/lifecycle. Main work is width-safe segmented layout and preserving plan/milestone panels. |
| Render `footerData.getExtensionStatuses()` | Feasible | Small | Clear current gap. Need know exact status shape and truncate safely. |
| Presets/settings: default/minimal/compact | Feasible | Medium | Need define config precedence: Pi settings vs flag/env/default. Risk is scope creep in theme/layout options. |
| Welcome header / dismissible overlay | Feasible | Small–Medium | `setHeader` already used. Overlay dismissal behavior may require light prototype to avoid focus stealing. |
| Editor stash save/clear/restore | Feasible | Medium | APIs exist for editor text. Commands are straightforward; shortcuts/keybindings may require checking Pi command/keybinding mechanism. |
| Fixed editor / editor-border status | Partly uncertain | Uncertain | Must compose with `fff-search` editor wrapper. Border variant likely feasible; true fixed editor may not be exposed cleanly by extension APIs. |
| Tests/build verification | Feasible | Medium | Need focused footer render tests, preset tests, command tests, and editor wrapper composition tests/mocks. |

## Suggested milestones

### 1. Footer status restoration + Powerline foundation
- **Effort:** Medium
- **Feasibility risk:** Low–Medium — current footer is already centralized, but width-aware segmented rendering must be careful.
- **Key deliverable:** `RoachFooter` renders a Powerline-inspired segmented line, preserves existing plan/milestone panels, and includes `footerData.getExtensionStatuses()` so `ctx.ui.setStatus(...)` remains visible.

### 2. Footer presets and settings
- **Effort:** Medium
- **Feasibility risk:** Medium — config precedence and narrow-width behavior can grow unexpectedly.
- **Key deliverable:** Default/minimal/compact variants selectable through extension settings/flag/config, with tests proving each preset fits the requested render width.

### 3. Welcome UI polish
- **Effort:** Small–Medium
- **Feasibility risk:** Medium — header is easy; dismissible overlay needs care to avoid startup focus/interaction issues.
- **Key deliverable:** Startup welcome header or optional overlay that can be dismissed and restored safely, without blocking normal input.

### 4. Editor stash commands
- **Effort:** Medium
- **Feasibility risk:** Medium — text APIs exist, but shortcut registration and session persistence semantics need decisions.
- **Key deliverable:** Commands/shortcut for stash save, clear, restore; uses `getEditorText()`, `setEditorText()`, `pasteToEditor()`, and optionally records state via `pi.appendEntry()`/session branch.

### 5. Safe editor-border status / editor composition
- **Effort:** Uncertain
- **Feasibility risk:** High — must compose with existing `fff-search` `setEditorComponent()` wrapper and avoid singleton conflicts. True fixed-editor behavior may not be possible without lower-level Pi TUI support.
- **Key deliverable:** Either a safe editor-border status wrapper that composes with existing editor factories, or a documented decision to defer true fixed-editor behavior after prototype findings.

### 6. Verification and regression hardening
- **Effort:** Medium
- **Feasibility risk:** Low — test/build commands already exist.
- **Key deliverable:** Focused Vitest coverage plus full test/build pass.

## Spike candidates

- Exact return shape and rendering expectations for `footerData.getExtensionStatuses()`.
- Dismissible overlay behavior using `ctx.ui.custom(..., { overlay: true })`.
- Shortcut/keybinding registration for editor stash.
- Editor wrapper composition with `ctx.ui.getEditorComponent()` / `setEditorComponent()` alongside `fff-search`.
- Whether “fixed editor” is actually supported by public Pi APIs, or whether only an editor-border/status variant is practical.

## Underestimation risks

- Width-safe ANSI/themed string truncation in Powerline segments.
- Preserving plan/milestone footer panels while changing base footer layout.
- Multiple extensions wrapping `setEditorComponent()` in different load orders.
- Overlay focus/keyboard dismissal behavior.
- Config precedence and migration expectations for presets.
- Tests requiring realistic TUI/editor mocks rather than simple string assertions.
