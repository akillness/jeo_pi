# Plan: M2 — Status Query & Interrupt

**Goal:** Give the parent visibility into and control over running subagents — query status, view progress, and interrupt execution.

**Verification:** `npm test`

---

## Task 1: Extend AsyncRunRecord with tmux metadata

**Changes to `types.ts`:**
- Add `paneId?`, `sessionName?`, `tmuxBinary?` to `AsyncRunRecord`

## Task 2: Update spawnAsync() to pass tmux metadata

**Changes to `subagent.ts`:**
- In `onLifecycleEvent` callback, when `phase === "spawned"` and backend is tmux, extract pane metadata from event and store in registry

## Task 3: Add disk persistence to RunRegistry

**Changes to `async-registry.ts`:**
- Add `persist(runId)`, `load(runId)`, `listPersisted()` methods
- Atomic JSON write pattern from team-state.ts: write to `.tmp` → `rename()`
- Path: `.pi/agent/runs/<runId>/async-run.json`

## Task 4: Add interrupt() method to RunRegistry

**Changes to `async-registry.ts`:**
- `interrupt(runId)`: native → `process.kill(-pgid, "SIGTERM")` then SIGKILL after 5s; tmux → `send-keys C-c` then `kill-pane` after 5s
- Store pid/pgid on update so interrupt can use them

## Task 5: Wire status/interrupt actions in index.ts

**Changes to `index.ts`:**
- Add `action` and `id` to SubagentParams schema
- Route `{ action: "status" }` → `registry.listActive()`
- Route `{ action: "status", id }` → `registry.getStatus(id)`
- Route `{ action: "interrupt", id }` → `registry.interrupt(id)`

## Task 6: session_shutdown cleanup

**Changes to `index.ts`:**
- In existing `session_shutdown` handler, add cleanup for async runs (abort running processes)

## Task 7: Tests + build verification
