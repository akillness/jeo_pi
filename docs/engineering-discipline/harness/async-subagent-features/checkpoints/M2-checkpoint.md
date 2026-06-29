# Checkpoint: M2 — Status Query & Interrupt

**Completed:** 2026-05-03
**Attempts:** 1

## Plan File
`docs/engineering-discipline/plans/2026-05-03-m2-status-query-interrupt.md`

## Test Results
- 42 test files passed
- 512 tests passed
- `npx tsc --noEmit` — zero errors

## Files Changed

**Modified:**
- `extensions/agentic-harness/types.ts` — Added paneId, sessionName, tmuxBinary to AsyncRunRecord
- `extensions/agentic-harness/async-registry.ts` — Added interrupt() (native SIGTERM/SIGKILL, tmux C-c/kill-pane), disk persistence (persist/load/listPersisted), abortAll() for session cleanup, extended update() with tmux metadata
- `extensions/agentic-harness/subagent.ts` — Updated spawnAsync() to pass tmux metadata (paneId, sessionName, tmuxBinary) to registry on lifecycle events
- `extensions/agentic-harness/index.ts` — Added `action` (status/interrupt) and `id` params to SubagentParams; wired status query and interrupt dispatch; added session_shutdown cleanup via registry.abortAll()

## Interfaces Established

- `RunRegistry.interrupt(runId)` — sends SIGTERM (native) / C-c (tmux) with SIGKILL/kill-pane escalation
- `RunRegistry.persist(runId)` — atomic JSON write to `.pi/agent/runs/<runId>/async-run.json`
- `RunRegistry.load(runId)` / `listPersisted()` — disk-backed read
- `RunRegistry.abortAll()` — shutdown cleanup
- Tool schema: `action: "status" | "interrupt"`, `id: string`

## State After Milestone

- `subagent({ action: "status" })` lists active runs with runId, agent, task, status, elapsed, last tool
- `subagent({ action: "status", id: "..." })` returns detailed single-run status
- `subagent({ action: "interrupt", id: "..." })` sends SIGTERM/C-c with 5s SIGKILL/kill-pane escalation
- Runs persist to disk for cross-session survival
- session_shutdown cleans up all running async processes
- Existing blocking mode unchanged
