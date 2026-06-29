# Checkpoint: M4 — Tool Schema Integration & Live Progress

**Completed:** 2026-05-03
**Attempts:** 1

## Test Results
- 43 test files passed
- 527 tests passed
- `npx tsc --noEmit` — zero errors

## Files Changed

**Modified:**
- `extensions/agentic-harness/types.ts` — Added `asyncRun?: AsyncRunRecord` to `SubagentDetails`
- `extensions/agentic-harness/index.ts` — Async spawn return includes `details.asyncRun` from registry
- `extensions/agentic-harness/tests/async-registry.test.ts` — Full lifecycle E2E test + interrupt lifecycle test

## State After Milestone

All 4 async subagent features are fully integrated:

1. **Async spawn**: `{ async: true }` → returns runId immediately, background execution
2. **Status query**: `{ action: "status" }` / `{ action: "status", id }` → run details with live progress
3. **Interrupt**: `{ action: "interrupt", id }` → SIGTERM/C-c with escalation
4. **Completion notification**: `pi.sendUserMessage()` on background completion
5. **Live progress**: current tool, token count, elapsed time via `AsyncRunRecord.progress`
6. **Disk persistence**: runs survive session restart
7. **Session cleanup**: `session_shutdown` aborts all running async processes
8. **Backward compatible**: `{ agent, task }` without `async` works identically
