# Dependency Review: Powerline UI

Assuming milestones:

- **M1:** UI settings/presets + shared width/segment utilities.
- **M2:** Powerline footer redesign + `footerData.getExtensionStatuses()` rendering.
- **M3:** Welcome header/overlay.
- **M4:** Editor stash save/clear/restore commands.
- **M5:** Fixed editor/editor-border status wrapper.
- **M6:** Final integration/verification/docs.

## Dependency DAG

```text
M1 UI settings/presets + segment utilities
 ├─→ M2 Powerline footer + extension statuses
 ├─→ M3 Welcome UI
 ├─→ M4 Editor stash
 └─→ M5 Editor/editor-border status wrapper
        │
        └──────────────┐
M2 ────────────────────┤
M3 ────────────────────┤
M4 ────────────────────┤
                       ↓
              M6 Integration + full verification
```

If each milestone directly edits `index.ts` as it goes, then M2–M5 become mostly serialized because they all touch the same `session_start` UI wiring.

## File conflict matrix

| File | Milestones | Ordering constraint |
|------|-----------|-------------------|
| `extensions/agentic-harness/ui-settings.ts` / new preset module | M1, consumed by M2–M5 | M1 before M2–M5 |
| `extensions/agentic-harness/footer.ts` | M2 | M1 before M2; preserve plan/milestone rendering |
| `extensions/agentic-harness/index.ts` | M2, M3, M4, M5, M6 | High-conflict file. Prefer M6-only integration, or serialize edits |
| `extensions/agentic-harness/welcome-ui.ts` / new file | M3 | M1 before M3 |
| `extensions/agentic-harness/editor-stash.ts` / new file | M4 | M1 before M4 if preset-gated |
| `extensions/agentic-harness/editor-status.ts` / new file | M5 | M1 before M5; must wrap existing editor factory |
| `extensions/agentic-harness/tests/footer.test.ts` | M2 | Depends on M1 utilities |
| `extensions/agentic-harness/tests/welcome-ui.test.ts` | M3 | Depends on M1 settings mocks |
| `extensions/agentic-harness/tests/editor-stash.test.ts` | M4 | Independent except shared test helpers |
| `extensions/agentic-harness/tests/editor-status.test.ts` | M5 | Must cover composition with existing factory |
| `extensions/agentic-harness/tests/extension.test.ts` | M2–M6 if central mocks change | Avoid broad edits; otherwise serialize |
| `extensions/fff-search/index.ts` | Should not be modified | M5 must compose via `ctx.ui.getEditorComponent()`/`setEditorComponent()` instead |
| `extensions/agentic-harness/package.json` / lockfile | Ideally none | Do not add `pi-powerline-footer` runtime dependency |

## Parallelizable groups

- **Group A:** M1 foundation first.
- **Group B:** M2, M3, M4, M5 module work can run concurrently only if each avoids `index.ts` wiring.
- **Group C:** M6 final integration after Group B.
- For fully user-visible milestones, M2–M5 should be serialized.

## External dependencies

- `@mariozechner/pi-coding-agent`: already dependency.
- `@mariozechner/pi-tui`: already dependency.
- Pi UI APIs: footer/header/custom/status/editor component/editor text APIs; feature-detect optional APIs where possible.
- Session state APIs: needed by stash if persistence is desired.
- Vitest/TypeScript: already present.
- `pi-powerline-footer`: inspiration only; no runtime dependency.

## Verification command

```bash
npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build
```
