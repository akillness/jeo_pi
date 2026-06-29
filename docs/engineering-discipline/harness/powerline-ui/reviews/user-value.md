# User Value Review: Powerline UI

## Value-ordered milestone sequence

1. **Powerline footer MVP with extension statuses** — **Value:** User immediately sees the new segmented footer, and `ctx.ui.setStatus(...)` messages are no longer hidden. Existing cwd/git/model/context/tools/progress remain visible. — **Demo:** Run Pi with agentic-harness, trigger any extension status, resize terminal narrow/wide, confirm footer fits width and plan/milestone panels still render.

2. **Footer presets/settings: default, compact, minimal** — **Value:** User can tune the UI density and visual style early, which is the highest-feedback design area. — **Demo:** Switch presets via config/settings and confirm footer layout changes without breaking status/progress rendering.

3. **Dismissible welcome header/overlay** — **Value:** User sees a polished startup/welcome experience without focus stealing. — **Demo:** Start Pi, confirm welcome appears, dismiss it, restart/restore safely, verify editor focus remains usable.

4. **Editor stash commands/shortcuts** — **Value:** User can save current prompt text, clear the editor, and restore later. This is practical daily workflow value. — **Demo:** Type prompt text, run stash-save/clear, verify editor clears, restore and confirm exact text returns; optionally verify transcript/session note via `pi.appendEntry()`.

5. **Safer editor-border/fixed status behavior with editor composition** — **Value:** Status/border behavior improves without breaking existing autocomplete/editor wrappers. — **Demo:** Enable agentic-harness plus `fff-search`, verify autocomplete still works, editor renders correctly, and status/border behavior remains stable.

6. **Polish and verification pass** — **Value:** Confidence that the UI works across widths, presets, progress states, editor composition, and lifecycle disposal. — **Demo:** Run `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build`.

## Minimum viable milestone

Milestone 1: **Powerline footer MVP with extension statuses**. It proves the core approach: custom segmented rendering, width-safe layout, preservation of existing plan/milestone progress, and the known status-visibility gap fix.

## Natural abort points

- After milestone 1: useful because status visibility is fixed and the footer is visibly improved.
- After milestone 2: strong stopping point; configurable Powerline-style footer is complete.
- After milestone 4: footer, welcome, and stash all deliver visible workflow value.
- After milestone 5: full intended feature set is present before final polish.

## Low-value milestones

- Overly elaborate welcome overlay behavior.
- Extra presets beyond default/minimal/compact.
- Full fixed-editor replacement if safer editor-border composition satisfies the need.
- Any internal theming framework not required for the three presets.
