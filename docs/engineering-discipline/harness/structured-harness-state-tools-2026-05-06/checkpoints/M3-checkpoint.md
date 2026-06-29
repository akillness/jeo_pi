# Checkpoint: M3 — Structured Harness Tools

**Completed:** 2026-05-06 22:48
**Attempts:** 1

## Plan File

`docs/engineering-discipline/plans/2026-05-06-m3-structured-harness-tools.md`

## Review File

`docs/engineering-discipline/reviews/2026-05-06-m3-structured-harness-tools-review.md`

## Test Results

- `cd extensions/agentic-harness && ./node_modules/.bin/tsc --noEmit`: PASS — clean build, zero errors.
- `npx vitest run tests/harness-tools.test.ts`: PASS — 27 tests passed.
- `npx vitest run tests/extension.test.ts`: PASS — 57 tests passed.
- `npx vitest run` (full suite): PASS — 650 tests passed, 53 files.

## Files Changed

- **Created:** `extensions/agentic-harness/harness-tools.ts`
- **Created:** `extensions/agentic-harness/tests/harness-tools.test.ts`
- **Modified:** `extensions/agentic-harness/index.ts` (one import + one `registerHarnessTools(pi)` call)
- **Modified:** `extensions/agentic-harness/tests/extension.test.ts` (4 assertions for harness tool registration)

## Interface Contracts Established

- `registerHarnessTools(pi)` — thin registration function; all tool logic lives in `harness-tools.ts`.
- `harness_milestone` tool — actions: `create`, `update`, `set_status`, `load`, `render`.
- `harness_plan` tool — actions: `attach`, `define_tasks`, `set_task_status`, `load`, `render`.
- `harness_todo` tool — actions: `set`, `update_status`, `clear`, `load`, `render`.
- Shared helpers: `loadHarnessState`, `persistHarnessState`, `emitHarnessEvent`, `applyAndPersist`.
- Write actions dispatch reducer commands → persist atomic JSON snapshot → append `HARNESS_STATE_EVENT_CUSTOM_TYPE` replay event.
- Read actions return structured JSON summaries or rendered markdown from pure state.
- Auto-creation of default `HarnessState` when snapshot is missing on first write.

## State After Milestone

Agents can now create, update, load, and render milestones, plans, and todos through structured tools instead of hand-editing parse-sensitive markdown. The tools coexist with the old parser-derived runtime. M1/M2 files remain untouched. Ready for M4 (skill/prompt contract update) and M5 (footer/progress cutover) in parallel.
