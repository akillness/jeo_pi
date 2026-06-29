# Checkpoint: M1 — Async Spawn Foundation

**Completed:** 2026-05-03
**Attempts:** 1

## Plan File
`docs/engineering-discipline/plans/2026-05-03-m1-async-spawn-foundation.md`

## Test Results
- 42 test files passed
- 499 tests passed (including 15 new async-registry tests)
- `npx tsc --noEmit` — zero errors

## Files Changed

**Created:**
- `extensions/agentic-harness/async-registry.ts` — RunRegistry class with register/update/complete/getStatus/listActive/abort/subscribe

**Modified:**
- `extensions/agentic-harness/types.ts` — Added ToolActivity, AsyncRunStatus, RunProgress, AsyncRunRecord interfaces; extended SingleResult with lastActivity and asyncRunId
- `extensions/agentic-harness/subagent.ts` — Added spawnAsync() fire-and-forget wrapper around runAgent(); imported RunRegistry
- `extensions/agentic-harness/index.ts` — Added `async` boolean to SubagentParams schema; added async branch in single-mode execute handler
- `extensions/agentic-harness/runner-events.ts` — (no logic change, lastActivity assignment now type-safe via SingleResult.lastActivity)

**Created (tests):**
- `extensions/agentic-harness/tests/async-registry.test.ts` — 15 unit tests for RunRegistry

## Interfaces Established

- `ToolActivity { name, args, timestamp }`
- `AsyncRunStatus = "spawning" | "running" | "completed" | "failed" | "interrupted"`
- `RunProgress { lastActivity?, usage, elapsedMs, startedAt }`
- `AsyncRunRecord { schemaVersion, runId, agent, task, status, pid?, pgid?, progress, result?, createdAt, updatedAt, backend }`
- `RunRegistry` class with full lifecycle management
- `SpawnAsyncResult { runId, status }`

## State After Milestone

- `{ agent: "reviewer", task: "...", async: true }` returns runId immediately via spawnAsync()
- RunRegistry tracks runs in-memory with subscribe/notify pattern
- Existing blocking `{ agent, task }` calls work identically (backward compatible)
- All new fields on SingleResult are optional (no breaking changes)
