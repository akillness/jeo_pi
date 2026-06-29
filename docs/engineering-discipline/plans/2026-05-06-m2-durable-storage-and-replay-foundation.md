# M2 Durable Storage and Replay Foundation Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking. Do not create git commits for this plan.

**Goal:** Persist and restore structured harness state using atomic snapshots plus replayable session events.

**Architecture:** Build persistence and replay as standalone modules over the M1 pure state kernel. `harness-storage.ts` owns versioned `state.json` paths, normalization, and atomic temp-write/rename. `harness-events.ts` owns replayable event records, session custom-entry extraction, and snapshot-plus-event restore. Runtime wiring and tool registration remain out of scope.

**Tech Stack:** TypeScript, Vitest, Node `fs/promises`, existing `HarnessState` / `HarnessCommand` / `applyHarnessCommand` APIs from M1.

**Work Scope:**
- **In scope:** durable snapshot file helpers, state normalization, atomic write, replay event schema, event replay, snapshot+event restore, tests for missing/corrupt snapshots and replay ordering.
- **Out of scope:** tool registration, footer integration, live session handler wiring in `index.ts`, markdown parsing/import, parser removal.

**Completed Milestone Context:**
- M1 established `HarnessState`, `HarnessCommand`, `HarnessStateEvent`, `applyHarnessCommand`, selector APIs, and pure markdown renderers.
- M1 files changed: `harness-state.ts`, `harness-render.ts`, `tests/harness-state.test.ts`, `tests/harness-render.test.ts`.
- M1 verification passed: `cd extensions/agentic-harness && npm run build && npm test`.

**Verification Strategy:**
- **Level:** test-suite + build
- **Command:** `cd extensions/agentic-harness && npm run build && npm test`
- **What it validates:** TypeScript correctness and full agentic-harness regression coverage including new storage/replay tests.

---

## File Structure Mapping

- Create `extensions/agentic-harness/harness-storage.ts`
  - Versioned snapshot record, default state root/path helpers, read/write helpers, atomic write.
- Create `extensions/agentic-harness/harness-events.ts`
  - Replay event record types, event creation, event sorting/filtering, replay helpers, snapshot+event restore.
- Create `extensions/agentic-harness/tests/harness-storage.test.ts`
  - Missing/corrupt snapshot behavior, round-trip, atomic temp cleanup expectation, path helpers.
- Create `extensions/agentic-harness/tests/harness-events.test.ts`
  - Event creation, deterministic replay order, stale event filtering, corrupt event ignored/rejected behavior, snapshot+event recovery.

---

### Task 1: Add durable snapshot storage

**Dependencies:** None
**Files:**
- Create: `extensions/agentic-harness/harness-storage.ts`
- Create: `extensions/agentic-harness/tests/harness-storage.test.ts`

- [ ] **Step 1: Implement storage module**

Create `extensions/agentic-harness/harness-storage.ts` exporting:

- `HARNESS_STATE_FILE = "state.json"`
- `PI_HARNESS_STATE_ROOT_ENV = "PI_HARNESS_STATE_ROOT"`
- `HarnessStateSnapshot` interface with:
  - `schemaVersion: typeof HARNESS_STATE_SCHEMA_VERSION`
  - `state: HarnessState`
  - `snapshotSeq: number`
  - `writtenAt: string`
- `defaultHarnessStateRoot(cwd = process.cwd()): string`
  - returns `process.env.PI_HARNESS_STATE_ROOT` if set
  - otherwise returns `join(cwd, ".pi", "agent", "harness-state")`
- `harnessStateSnapshotPath(rootDir: string, runId: string): string`
  - returns `join(rootDir, runId, HARNESS_STATE_FILE)`
- `createHarnessStateSnapshot(state: HarnessState, options?: { now?: string }): HarnessStateSnapshot`
  - `snapshotSeq` equals `state.eventSeq`
- `readHarnessStateSnapshot(path: string): Promise<HarnessStateSnapshot | null>`
  - returns `null` for missing file
  - throws clear `Error` for invalid JSON or unsupported schema
- `writeHarnessStateSnapshot(path: string, snapshot: HarnessStateSnapshot): Promise<void>`
  - creates parent directories
  - writes to a unique temp file in the same directory
  - renames temp file to final path

- [ ] **Step 2: Add storage tests**

Create `extensions/agentic-harness/tests/harness-storage.test.ts` covering:

- default root uses env override and fallback path.
- snapshot path is `root/runId/state.json`.
- read missing snapshot returns `null`.
- write then read round-trips state and `snapshotSeq`.
- corrupt JSON throws an error containing the path.
- unsupported schema throws an error mentioning schema.
- write creates parent directories.

Run: `cd extensions/agentic-harness && npm exec -- vitest run tests/harness-storage.test.ts`
Expected: PASS.

---

### Task 2: Add replay event model and reducer replay

**Dependencies:** Task 1
**Files:**
- Create: `extensions/agentic-harness/harness-events.ts`
- Create: `extensions/agentic-harness/tests/harness-events.test.ts`

- [ ] **Step 1: Implement event module**

Create `extensions/agentic-harness/harness-events.ts` exporting:

- `HARNESS_STATE_EVENT_CUSTOM_TYPE = "harness-state-event"`
- `HarnessReplayEvent` interface with:
  - `schemaVersion: 1`
  - `runId: string`
  - `seq: number`
  - `at: string`
  - `command: HarnessCommand`
- `createHarnessReplayEvent(state: HarnessState, command: HarnessCommand, options?: { now?: string }): HarnessReplayEvent`
  - event `seq` is `state.eventSeq + 1`
- `isHarnessReplayEvent(value: unknown): value is HarnessReplayEvent`
- `sortHarnessReplayEvents(events: HarnessReplayEvent[]): HarnessReplayEvent[]`
  - sorts by `seq`, then `at`
- `replayHarnessEvents(baseState: HarnessState, events: HarnessReplayEvent[]): HarnessState`
  - ignores events for other `runId`
  - ignores events with `seq <= baseState.eventSeq`
  - applies remaining events in deterministic order using `applyHarnessCommand`
  - uses each event's `at` as reducer timestamp
- `extractHarnessReplayEventsFromSessionEntries(entries: unknown[]): HarnessReplayEvent[]`
  - extracts custom entries where `type === "custom"`, `customType === HARNESS_STATE_EVENT_CUSTOM_TYPE`, and `data` is a valid replay event

- [ ] **Step 2: Add event/replay tests**

Create `extensions/agentic-harness/tests/harness-events.test.ts` covering:

- `createHarnessReplayEvent` uses next sequence number.
- `sortHarnessReplayEvents` orders by `seq` then timestamp.
- replay applies milestone/plan/todo commands to base state.
- replay ignores other `runId` events.
- replay ignores stale events with `seq <= baseState.eventSeq`.
- extraction reads valid custom entries and ignores unrelated/malformed entries.

Run: `cd extensions/agentic-harness && npm exec -- vitest run tests/harness-events.test.ts`
Expected: PASS.

---

### Task 3: Add snapshot-plus-event recovery helper

**Dependencies:** Task 1, Task 2
**Files:**
- Modify: `extensions/agentic-harness/harness-events.ts`
- Modify: `extensions/agentic-harness/tests/harness-events.test.ts`

- [ ] **Step 1: Implement restore helper**

In `harness-events.ts`, export:

```ts
export function restoreHarnessStateFromSnapshotAndEvents(
  snapshot: HarnessStateSnapshot | null,
  fallbackState: HarnessState,
  events: HarnessReplayEvent[],
): HarnessState
```

Behavior:

- Uses `snapshot.state` when snapshot is present.
- Uses `fallbackState` when snapshot is `null`.
- Replays events after the chosen base state's `eventSeq`.
- Does not parse markdown or assistant prose.

Import `HarnessStateSnapshot` from `harness-storage.ts` as a type-only import.

- [ ] **Step 2: Add recovery tests**

Extend `harness-events.test.ts` with tests covering:

- restore uses fallback state when snapshot is missing.
- restore uses snapshot as base when present.
- restore applies only events newer than snapshot `eventSeq`.
- restore ignores stale pre-snapshot events.
- source file text for `harness-events.ts` does not include `parseStateMd`, `parsePlan`, `parseTodoMd`, or `extractMessageText`.

Run: `cd extensions/agentic-harness && npm exec -- vitest run tests/harness-events.test.ts`
Expected: PASS.

---

### Task 4 (Final): M2 verification

**Dependencies:** Task 1, Task 2, Task 3
**Files:**
- Test: `extensions/agentic-harness/harness-storage.ts`
- Test: `extensions/agentic-harness/harness-events.ts`
- Test: `extensions/agentic-harness/tests/harness-storage.test.ts`
- Test: `extensions/agentic-harness/tests/harness-events.test.ts`

- [ ] **Step 1: Run targeted tests**

Run: `cd extensions/agentic-harness && npm exec -- vitest run tests/harness-storage.test.ts tests/harness-events.test.ts`
Expected: PASS.

- [ ] **Step 2: Run full verification**

Run: `cd extensions/agentic-harness && npm run build && npm test`
Expected: PASS.

- [ ] **Step 3: Confirm scope isolation**

Verify expected files changed for M2 are only:

- `extensions/agentic-harness/harness-storage.ts`
- `extensions/agentic-harness/harness-events.ts`
- `extensions/agentic-harness/tests/harness-storage.test.ts`
- `extensions/agentic-harness/tests/harness-events.test.ts`

Expected: no tool registration, footer integration, skill updates, runtime parser removal, or markdown import behavior in this milestone.
