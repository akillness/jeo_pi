# Milestone: Status Query & Interrupt

**ID:** M2
**Status:** pending
**Dependencies:** M1
**Risk:** Medium
**Effort:** Medium

## Goal

Give the parent visibility into and control over running subagents — query status, view progress, and interrupt execution.

## Success Criteria

- [ ] `subagent({ action: "status" })` returns list of active runs with: runId, agent, task, status, elapsed time, current tool activity
- [ ] `subagent({ action: "status", id: "..." })` returns detailed status for a single run
- [ ] `subagent({ action: "interrupt", id: "..." })` sends SIGTERM to process group (native) or C-c to tmux pane, with 5s grace period then SIGKILL
- [ ] Interrupted run's AsyncRunRecord status updates to "interrupted"
- [ ] Tmux backend interrupt works end-to-end
- [ ] Status query returns accurate data for both native and tmux backends
- [ ] RunRegistry persists AsyncRunRecord to disk (reuse team-state.ts atomic JSON write pattern) for cross-session survival
- [ ] Orphaned run cleanup on session shutdown (PID/pane check)

## Files Affected

- Modify: `extensions/agentic-harness/async-registry.ts`
- Modify: `extensions/agentic-harness/subagent.ts`
- Modify: `extensions/agentic-harness/types.ts`
- Modify: `extensions/agentic-harness/index.ts`

## User Value

Parent can ask "what's running?" and "stop that." Progress visibility during execution. Runs survive session restart.

## Abort Point

No — core control plane.

## Notes

- Interrupt semantics: SIGTERM to process group (native) / C-c to tmux pane, 5s grace then SIGKILL.
- Resume deferred to future milestone — too complex (requires serializing full RunAgentOptions).
- Persistence follows team-state.ts pattern: atomic write to `.pi/agent/runs/<runId>/async-run.json`.
- Orphan cleanup: register session_shutdown handler, check PID/pane liveness.
