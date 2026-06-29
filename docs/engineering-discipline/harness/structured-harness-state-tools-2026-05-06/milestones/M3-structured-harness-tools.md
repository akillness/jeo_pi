# Milestone: Structured Harness Tools

**ID:** M3
**Status:** pending
**Dependencies:** M1, M2
**Risk:** High
**Effort:** Large

## Goal

Expose `harness_milestone`, `harness_plan`, and `harness_todo` as the agent-facing API over the structured store.

## Success Criteria

- [ ] Tools support small validated create/load/update/render action sets for milestones, plans, and todos.
- [ ] Tool calls dispatch reducer events, persist snapshots, append replay events, and return structured summaries.
- [ ] Render commands generate markdown from structured state only.
- [ ] `index.ts` only performs thin registration/wiring; tool logic lives in `harness-tools.ts`.
- [ ] Tool schemas use strict enums and agent-readable validation errors.
- [ ] Tests cover tool registration, schema shape, successful executes, invalid input, persistence calls, and render outputs.
- [ ] `cd extensions/agentic-harness && npm run build && npm test` passes for added tool tests.

## Files Affected

- Create: `extensions/agentic-harness/harness-tools.ts`
- Modify: `extensions/agentic-harness/index.ts`
- Create: `extensions/agentic-harness/tests/harness-tools.test.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

## User Value

Agents can begin updating milestones, plans, and todos through reliable tools instead of editing parse-sensitive markdown manually.

## Abort Point

Yes — tools can coexist with old parser-derived runtime until cutover.

## Notes

Avoid god-tool ambiguity. Expose three agent-facing tools but share one internal reducer/state model.
