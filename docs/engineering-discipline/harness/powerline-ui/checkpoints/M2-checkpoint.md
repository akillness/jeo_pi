# Checkpoint: M2 — Footer Presets and UI Settings Resolver

**Completed:** 2026-05-03 20:56
**Duration:** 22m
**Attempts:** 1

## Plan File

`docs/engineering-discipline/plans/2026-05-03-footer-presets-ui-settings.md`

## Review File

`docs/engineering-discipline/reviews/2026-05-03-footer-presets-ui-settings-review.md`

## Test Results

- `npm --prefix extensions/agentic-harness test -- --run tests/ui-settings.test.ts` — PASS (8/8 tests)
- `npm --prefix extensions/agentic-harness test -- --run tests/footer.test.ts tests/ui-settings.test.ts` — PASS (16/16 tests)
- `npm --prefix extensions/agentic-harness test -- --run tests/ui-settings.test.ts tests/footer.test.ts tests/extension.test.ts` — PASS (66/66 tests)
- `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build` — PASS (552/552 tests; `tsc --noEmit` passed)
- `git diff -- extensions/agentic-harness/package.json extensions/agentic-harness/package-lock.json extensions/fff-search/index.ts` — PASS (no diff)

## Files Changed

- Created: `extensions/agentic-harness/ui-settings.ts`
- Created: `extensions/agentic-harness/tests/ui-settings.test.ts`
- Modified: `extensions/agentic-harness/footer.ts`
- Modified: `extensions/agentic-harness/tests/footer.test.ts`
- Modified: `extensions/agentic-harness/index.ts`
- Modified: `extensions/agentic-harness/tests/extension.test.ts`
- Created: `docs/engineering-discipline/plans/2026-05-03-footer-presets-ui-settings.md`
- Created: `docs/engineering-discipline/reviews/2026-05-03-footer-presets-ui-settings-review.md`

## Interface Contracts Established

- `FooterPresetName` supports exactly `default`, `compact`, and `minimal`.
- `resolveAgenticUiSettings({ cwd })` resolves footer presets from `PI_AGENTIC_FOOTER_PRESET`, project `.pi/settings.json`, global `~/.pi/agent/settings.json`, and default fallback.
- Supported settings namespaces are `agenticHarness` and `powerlineUi`, with `footerPreset` or `preset` keys.
- `RoachFooter` accepts optional final constructor options `{ preset?: FooterPresetName }` and defaults to `default`.
- Preset layouts are centralized in `FOOTER_PRESET_DEFINITIONS`.

## State After Milestone

The Powerline footer now supports configurable density through three tested presets. The extension resolves settings on session start and passes the selected preset into the footer while preserving M1 width-safety and status rendering behavior.

## Notes

The repository still contains unrelated dirty/untracked files from separate work. M2 was validated against planned files plus explicit out-of-scope guards.
