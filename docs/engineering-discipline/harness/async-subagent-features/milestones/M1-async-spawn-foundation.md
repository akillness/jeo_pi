# Milestone: Async Spawn Foundation

**ID:** M1
**Status:** pending
**Dependencies:** None
**Risk:** High
**Effort:** Large

## Goal

Prove that `runAgent()` can execute asynchronously by spawning a background process and returning a runId immediately, with a process registry to track it.

## Success Criteria

- [ ] Spike: `registerTool.execute` callback can return before child process exits (verified via minimal test)
- [ ] `RunRegistry` class in `async-registry.ts` with `spawnAsync()`, `getStatus()`, `listActive()`, `subscribe()` methods
- [ ] `AsyncRunRecord` interface defined in `types.ts` with runId, status, progress, pid, startTime, backend
- [ ] `ToolActivity` and `RunProgress` types formalize lastActivity/usage data
- [ ] `SingleResult` extended with `lastActivity` field (backward compatible)
- [ ] `{ agent: "reviewer", task: "...", async: true }` returns `{ runId, status: "running" }` within 2 seconds
- [ ] Background process completes and updates AsyncRunRecord status to "completed" or "failed"
- [ ] Existing blocking `{ agent: "...", task: "..." }` (no async flag) works identically to before
- [ ] Native backend works end-to-end

## Files Affected

- Create: `extensions/agentic-harness/async-registry.ts`
- Modify: `extensions/agentic-harness/types.ts`
- Modify: `extensions/agentic-harness/subagent.ts`
- Modify: `extensions/agentic-harness/runner-events.ts`

## User Value

Parent can fire off a background subagent and continue working. This is the architectural pivot that enables everything else.

## Abort Point

Yes — if spike fails at step 1, entire async story is dead. Stop immediately.

## Notes

- runAgent() is ~450 lines monolithic function. Extract spawn wrapper, keep runAgent() untouched if possible.
- Worktree/sandbox cleanup must still execute reliably in background mode.
- Tmux backend has existing 25ms log-polling pattern — easier to make async but native is simpler to prove first.
- Process registry follows team-state.ts atomic JSON write pattern.
