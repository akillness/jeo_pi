# Checkpoint: M6 — Runtime Replay Cutover and Parser Quarantine

**Completed:** 2026-05-06 23:42
**Attempts:** 1

## Plan File

`docs/engineering-discipline/plans/2026-05-06-m6-runtime-replay-cutover-and-parser-quarantine.md`

## Review File

`docs/engineering-discipline/reviews/2026-05-06-m6-runtime-replay-cutover-and-parser-quarantine-review.md`

## Test Results

- `npx vitest run tests/session-replay.test.ts`: PASS — 4 tests passed
- `npx vitest run tests/parser-isolation.test.ts`: PASS — 4 tests passed
- `./node_modules/.bin/tsc --noEmit`: PASS — clean build
- `npx vitest run` (full suite): PASS — 671 tests passed, 57 files

## Files Changed

- **Created:** `extensions/agentic-harness/legacy-import-markdown.ts`
- **Modified:** `extensions/agentic-harness/index.ts`
- **Created:** `extensions/agentic-harness/tests/session-replay.test.ts`
- **Created:** `extensions/agentic-harness/tests/parser-isolation.test.ts`

## Interface Contracts Established

- `legacy-import-markdown.ts` re-exports all parser-derived functions with explicit legacy markers.
- `session_start` loads from `HarnessState` snapshot + replay events when structured state exists; falls back to parser-derived reconstruction only for pre-structured sessions.
- `tool_result` and `message_end` handlers skip parser-derived plan/milestone loading when `harnessProgress.hasState()` is true.
- Subagent tracking (tool_execution_start/end) remains active for real-time progress in both modes.

## State After Milestone

Structured snapshot/event replay is now the primary runtime path. Parser-derived reconstruction is quarantined behind an explicit legacy module and only runs for pre-structured sessions. Ready for M7 (legacy cleanup).
