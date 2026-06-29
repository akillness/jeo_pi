# Runtime Replay, Subagent Status Bridge, and Footer Cutover Audit

## Commands Run
- `cd extensions/agentic-harness && set -o pipefail && mkdir -p ../../docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands node_modules/.tmp/audit-runtime-footer && TMPDIR=$PWD/node_modules/.tmp/audit-runtime-footer npm exec -- vitest run tests/session-replay.test.ts tests/harness-progress.test.ts tests/harness-runtime-progress.test.ts tests/footer.test.ts tests/extension.test.ts 2>&1 | tee ../../docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/runtime-replay-footer-tests.log`

## Files Reviewed
- `extensions/agentic-harness/index.ts`
- `extensions/agentic-harness/harness-events.ts`
- `extensions/agentic-harness/harness-progress.ts`
- `extensions/agentic-harness/harness-runtime-progress.ts`
- `extensions/agentic-harness/footer.ts`

## Checks Performed
- session replay source of truth
- snapshot versus custom-event ordering
- parser fallback gating
- subagent task status updates
- footer structured provider cutover

## Findings

### Finding 1: Structured session restore replays malformed custom entries without validation
- **Severity:** High
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/index.ts:2020` collects every `harness-state-event` custom entry whose `data` is merely an object and passes those objects directly to `replayHarnessEvents` at `extensions/agentic-harness/index.ts:2024`. `extensions/agentic-harness/harness-events.ts:101` provides `extractHarnessReplayEventsFromSessionEntries` to ignore malformed entries, but this restore path does not use it.
- **Impact:** A malformed custom entry for the same run can throw during `session_start`, preventing controlled resume and footer reconstruction.
- **Recommendation:** Use `extractHarnessReplayEventsFromSessionEntries` for session restore and derive `structuredRunId` only from validated replay events, or catch and report replay validation errors without aborting startup.

### Finding 2: Structured footer reload can show stale snapshot state after resume
- **Severity:** High
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/index.ts:2024` reconstructs state from snapshot plus custom events, but later `extensions/agentic-harness/index.ts:2118` only calls `harnessProgress.setRunId(data.runId)`. `extensions/agentic-harness/harness-progress.ts:70` reloads only `snapshot?.state`, so replayed post-snapshot events used for `reconstructedState` are not reflected in the structured footer provider cache.
- **Impact:** After session resume, the footer can display older task or milestone progress than live execution/replay state until another structured tool write refreshes the snapshot.
- **Recommendation:** Persist the reconstructed state back to the snapshot during restore or add a provider hydrate path that seeds `HarnessProgressProvider` with the replayed state.

### Finding 3: Structured subagent status bridge falls back to the first plan on ambiguous plan path matches
- **Severity:** Medium
- **Confidence:** Medium
- **Evidence:** `extensions/agentic-harness/harness-runtime-progress.ts:18` selects a matching `planFile` but falls back to `state.plans[0]` when no supplied path matches. `extensions/agentic-harness/index.ts:1886` uses that selection before applying task status updates, so a multi-plan state with missing or mismatched subagent plan paths can update task IDs on the wrong plan.
- **Impact:** Concurrent or resumed multi-plan workflows can mark the wrong plan task as running, completed, or failed when subagent metadata is incomplete or path normalization does not match.
- **Recommendation:** Require an exact plan match when more than one structured plan exists, or carry explicit `planId` metadata through subagent lifecycle events and skip ambiguous updates.
