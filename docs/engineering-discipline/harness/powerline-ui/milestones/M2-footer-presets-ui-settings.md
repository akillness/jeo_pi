# Milestone: Footer Presets and UI Settings Resolver

**ID:** M2
**Status:** pending
**Dependencies:** M1
**Risk:** Medium
**Effort:** Medium

## Goal

Add `default`, `compact`, and `minimal` UI presets through a small typed settings resolver.

## Success Criteria

- [ ] `default`, `compact`, and `minimal` presets produce distinct, width-safe footer layouts.
- [ ] Missing or invalid config falls back to the default preset.
- [ ] Preset logic is data-driven and not scattered through footer rendering.
- [ ] Tests verify preset behavior at narrow and normal widths.

## Files Affected

- Create: `extensions/agentic-harness/ui-settings.ts` or equivalent module
- Modify: `extensions/agentic-harness/footer.ts`
- Modify: `extensions/agentic-harness/index.ts`
- Create: focused preset/settings tests under `extensions/agentic-harness/tests/`

## User Value

User can choose footer density and visual style early.

## Abort Point

Yes — configurable Powerline-style footer is complete enough to stop.

## Notes

Keep settings small and backward-compatible. Avoid adding extra presets before feedback.
