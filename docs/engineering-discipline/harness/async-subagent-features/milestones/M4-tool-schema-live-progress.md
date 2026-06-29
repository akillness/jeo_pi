# Milestone: Tool Schema Integration & Live Progress

**ID:** M4
**Status:** pending
**Dependencies:** M3
**Risk:** Medium
**Effort:** Medium

## Goal

Expose all async features through a backward-compatible `subagent` tool schema with live progress reporting.

## Success Criteria

- [ ] TypeBox schema extended with discriminated union: `async`, `action`, `id` fields (backward compatible — omitting them triggers existing blocking behavior)
- [ ] `{ agent: "...", task: "..." }` (no async/action) continues to work identically — zero breaking change
- [ ] `{ agent: "...", task: "...", async: true }` triggers async spawn (from M1)
- [ ] `{ action: "status" }` and `{ action: "interrupt", id: "..." }` work through tool schema (from M2)
- [ ] Live progress queryable: current tool name, tool args summary, token count, elapsed time, last activity timestamp
- [ ] `SubagentDetails` type updated to include `asyncRun?: AsyncRunRecord` alongside existing `results: SingleResult[]`
- [ ] All features work end-to-end through the `subagent` tool (not just internal APIs)

## Files Affected

- Modify: `extensions/agentic-harness/types.ts`
- Modify: `extensions/agentic-harness/subagent.ts`
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/runner-events.ts`

## User Value

Everything works through the `subagent` tool interface. Users can spawn, monitor, interrupt, and get notified — all through the same tool they already use.

## Abort Point

No — final integration milestone.

## Notes

- Schema backward compatibility is main concern. All new fields are Type.Optional.
- `async: true` only works with single-mode `{ agent, task }`. Returns error for parallel/chain + async.
- Discriminated union on `action` field: status/interrupt don't use agent/task.
- Live progress uses formalized `lastActivity` from M1 + existing usage stats.
