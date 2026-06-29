# Architecture Review: Powerline UI

## Key interfaces and data flow

- **Footer render boundary:** `ctx.ui.setFooter(factory)` creates `RoachFooter`; `RoachFooter.render(width)` must return only width-safe lines.
- **Footer data inputs:** `footerData.getGitBranch()`, `footerData.getExtensionStatuses()`, `FooterContext`, `cacheStats`, `activeTools`, `PlanProgressTracker`, `MilestoneTracker`.
- **Status flow:** `ctx.ui.setStatus(...)` → Pi-owned footer status registry → `footerData.getExtensionStatuses()` → custom footer segments/panel.
- **Progress flow:** plan/milestone events → trackers → `subscribeOnChange()` → footer `requestRender()`.
- **Settings flow:** user config/preset/env/command → resolved UI settings → footer/welcome/editor modules.
- **Editor flow:** existing editor factory from `ctx.ui.getEditorComponent()` → wrapper factory → `ctx.ui.setEditorComponent()`; must compose with `extensions/fff-search/index.ts`.
- **Stash flow:** `ctx.ui.getEditorText()` → stash store/session entry → `setEditorText()` or `pasteToEditor()`.

## Suggested milestones

### 1. Powerline footer core + status bridge
- **Architectural rationale:** The footer is the primary convergence point for cwd, git, model, context, cache, tool, plan, milestone, and extension status data. Reworking it as one milestone avoids splitting the `render(width)` contract across phases.
- **Interfaces defined:** `FooterPresetName`, internal segment model, width-safe segment renderer contract, extension status formatting contract, preserved `RoachFooter` constructor inputs.
- **Depends on:** None.
- **Leaves system in working state:** Yes — default Powerline-style footer, plan/milestone panels preserved, `ctx.ui.setStatus(...)` visible.

### 2. UI preset/settings resolution
- **Architectural rationale:** Preset selection is a configuration boundary, not a rendering concern. The footer should consume resolved settings.
- **Interfaces defined:** `AgenticUiSettings`, `resolveUiSettings(...)`, preset source, optional preset command, stable default behavior.
- **Depends on:** Milestone 1.
- **Leaves system in working state:** Yes — selectable variants with default fallback.

### 3. Welcome UI controller
- **Architectural rationale:** Welcome UI uses `setHeader` or overlay APIs and should not be entangled with footer rendering.
- **Interfaces defined:** `WelcomeController`, `show()`, `dismiss()`, `restore()`, dismissal state, `/welcome`, header fallback.
- **Depends on:** Milestone 2 if configurable.
- **Leaves system in working state:** Yes.

### 4. Editor stash commands and session state
- **Architectural rationale:** Stash can use editor text APIs without touching editor component composition.
- **Interfaces defined:** `EditorStash`, stash storage methods, session/custom-entry type if needed, commands, restore semantics.
- **Depends on:** None strictly; optionally Milestone 2.
- **Leaves system in working state:** Yes.

### 5. Editor composition layer, border status, and stash shortcuts
- **Architectural rationale:** `setEditorComponent()` work is high-risk because `fff-search` already wraps the editor. Isolate behind a reusable composition layer.
- **Interfaces defined:** `wrapEditorFactory(previousFactory, enhancements)`, editor enhancement contract, shortcut binding contract, restore/disable behavior, composition tests.
- **Depends on:** Milestone 2 and Milestone 4.
- **Leaves system in working state:** Yes.

## Interface risks

- `footerData.getExtensionStatuses()` shape may need inspection.
- Printable width with ANSI styling must use visible width.
- Preset contract may need tuning after real narrow-width tests.
- Settings source could conflict unless centralized.
- Multiple extensions wrapping `setEditorComponent()` can race by load order.
- Welcome dismissal persistence should be explicit.

## Pattern conflicts

- Existing `RoachFooter` is monolithic; segment renderer is justified by width/preset complexity.
- Existing startup already calls `setHeader`; welcome must control that path, not compete.
- `fff-search` has editor wrapper state; new wrapper must be load-order-safe and reversible.
- Many UI commands in `index.ts` may worsen file size unless feature modules are introduced.
- Current footer does not truncate all lines; new work must enforce strict width invariants.
