# Context Brief: Agentic Harness Powerline UI

### Goal
Add a first-class Powerline-inspired UI layer to `agentic-harness`: attractive status/footer, welcome UI, editor stash, and fixed editor/editor-border status behavior.

### Scope
- **In scope**:
  - Redesign the existing `RoachFooter` as a Powerline-style segmented footer/status line.
  - Add preset/settings support for the new footer UI.
  - Render extension statuses from `footerData.getExtensionStatuses()` so `ctx.ui.setStatus(...)` remains visible under the custom footer.
  - Add a welcome header or overlay using Pi UI APIs.
  - Add editor stash shortcut/command support for save/clear/restore behavior.
  - Add fixed editor or editor-border status behavior, with careful composition around existing editor wrappers.
- **Out of scope**:
  - Copying or vendoring `pi-powerline-footer` implementation code.
  - Adding `pi-powerline-footer` as a runtime dependency.
  - Cloning unrelated features such as bash mode, shell ghost suggestions, working vibes, prompt history, or shell transcript.
  - Reworking unrelated agent/subagent behavior.

### Technical Context
- `extensions/agentic-harness/footer.ts` defines the current custom `RoachFooter`. It renders cwd, git branch, model, context usage, cache rate, active tools, and plan/milestone progress.
- `extensions/agentic-harness/index.ts` registers the footer with `ctx.ui.setFooter(...)` on `session_start`, tracks cache stats and active tools, and already uses UI APIs such as `setHeader`, `setFooter`, `setStatus`, and working visibility control.
- `RoachFooter` currently calls `footerData.getGitBranch()` but does not render `footerData.getExtensionStatuses()`, so statuses from this and other extensions can be hidden by the custom footer.
- Pi exposes the required primitives:
  - `ctx.ui.setFooter(factory)` for replacing the footer.
  - `ctx.ui.setHeader(factory)` and `ctx.ui.custom(..., { overlay: true })` for welcome UI.
  - `ctx.ui.setEditorComponent(factory)` plus `CustomEditor` for editor composition.
  - `ctx.ui.getEditorText()`, `setEditorText()`, and `pasteToEditor()` for editor stash behavior.
  - `pi.appendEntry()` and `ctx.sessionManager.getBranch()` for session-persistent extension state.
- `extensions/fff-search/index.ts` already wraps `setEditorComponent()` for custom autocomplete, so fixed editor/editor-border work must compose with existing editor factories.
- Existing tests include broad Vitest coverage under `extensions/agentic-harness/tests/`, but there are no dedicated tests yet for Powerline footer segments, extension status rendering, editor wrapper composition, welcome overlay lifecycle, or editor stash persistence.

### Constraints
- Use `pi-powerline-footer` only as design/feature inspiration. Implement new code in this repository's style.
- Preserve existing plan/milestone progress footer behavior.
- Keep the UI robust under narrow terminal widths; every rendered footer/header/editor line must fit the provided width.
- Avoid focus-stealing startup behavior unless dismissible and optional.
- Avoid singleton editor conflicts by wrapping any existing editor factory rather than replacing it blindly.
- Prefer incremental milestones because this is cross-cutting UI work.

### Success Criteria
- Footer/status line has a Powerline-style segmented design and works with narrow terminal widths.
- Existing plan and milestone progress rendering remains visible and correct.
- `footerData.getExtensionStatuses()` statuses are represented in the custom footer.
- Users can select or configure at least default/minimal/compact style presets.
- Welcome UI appears on startup or command without blocking normal use and can be dismissed/restored safely.
- Editor stash lets users save current prompt text, clear the editor, and restore it later via shortcut/command.
- Fixed editor/editor-border status behavior either works safely with existing editor wrappers or is explicitly implemented as the safer editor-border variant.
- Focused tests, `npm --prefix extensions/agentic-harness test`, and `npm --prefix extensions/agentic-harness run build` pass.

### Open Questions
- Final visual palette and exact glyph/icon choices can be tuned during implementation.
- If fixed editor internals prove too risky through public APIs, the first release may implement editor-border status instead while preserving future extensibility.

### Complexity Assessment

| Signal | Score |
|---|---:|
| Scope breadth | 3 |
| File impact | 3 |
| Interface boundaries | 3 |
| Dependency depth | 3 |
| Risk surface | 3 |

**Score:** 15/15
**Verdict:** Complex
**Rationale:** The work spans footer rendering, UI settings, header/overlay, editor component composition, shortcuts, and persistence. It should be decomposed into milestones before implementation.

### Suggested Next Step
Proceed to `agentic-milestone-planning` because the task requires multiple implementation phases with meaningful dependency ordering.
