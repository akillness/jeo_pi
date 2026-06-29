# Milestone: Durable Storage and Replay Foundation

**ID:** M2
**Status:** completed
**Dependencies:** M1
**Risk:** High
**Effort:** Large

## Goal

Persist and restore structured harness state using atomic snapshots plus replayable session events.

## Success Criteria

- [ ] `state.json` read/write uses versioned records and atomic temp-write/rename.
- [ ] Session custom entries append reducer events with ordering metadata.
- [ ] Resume loads snapshot as base and replays later custom events deterministically.
- [ ] Tests cover missing snapshot, corrupt snapshot, replay ordering, branch replay, and recovery.
- [ ] Storage/event modules do not parse markdown or assistant prose.
- [ ] `cd extensions/agentic-harness && npm run build && npm test` passes for added storage/replay tests.

## Files Affected

- Create: `extensions/agentic-harness/harness-storage.ts`
- Create: `extensions/agentic-harness/harness-events.ts`
- Create: `extensions/agentic-harness/tests/harness-storage.test.ts`
- Create: `extensions/agentic-harness/tests/harness-events.test.ts`
- Modify: `extensions/agentic-harness/index.ts` only if needed for session lifecycle wiring tests.

## User Value

Structured progress can survive session restart internally, though it is not yet exposed through tools/UI.

## Abort Point

Yes — storage and replay can be validated independently before agent-facing APIs are exposed.

## Notes

Snapshot is durable base; custom reducer events replay after the snapshot point. Markdown must never be primary input.
