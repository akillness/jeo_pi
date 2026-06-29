# Plan: M6 — Runtime Replay Cutover and Parser Quarantine

## Context

M3 delivered structured tools, M4 updated skill docs, M5 made the footer read from structured state. M6 makes structured snapshot/event replay the primary runtime session-restore path and quarantines markdown/prose parsing behind an explicit legacy boundary.

## Success Criteria

- [ ] `session_start` hydrates progress from `state.json` plus structured custom events.
- [ ] Primary runtime no longer infers progress from assistant prose, tool args, plan markdown, `state.md`, or `todo.md`.
- [ ] Legacy markdown import, if retained, is explicit and never automatic.
- [ ] Tests prove structured replay works without parser-derived events.
- [ ] Runtime tests cover fresh session, resumed session, branch replay, and completed workflow.
- [ ] `cd extensions/agentic-harness && npm run build && npm test` passes.

## Verification Strategy

- **Level:** test-suite + build
- **Command:** `cd extensions/agentic-harness && npm run build && npm test`
- **What it validates:** TypeScript correctness and full regression suite including new replay and parser-isolation tests.

## Tasks

### Task 1: Create `legacy-import-markdown.ts`

Create `extensions/agentic-harness/legacy-import-markdown.ts` that re-exports the parser-derived reconstruction functions with explicit legacy markers:

```ts
/**
 * LEGACY MODULE — Parser-derived session reconstruction.
 *
 * These functions infer progress from assistant prose, tool args,
 * plan markdown, state.md, and todo.md. They are fragile and should
 * NOT be used as the primary session-restore path.
 *
 * Primary path: HarnessState snapshot + HARNESS_STATE_EVENT_CUSTOM_TYPE replay.
 *
 * This module exists only for backwards compatibility with sessions
 * that predate structured state. New code must use structured tools.
 */

export {
  reconstructPlanProgressFromSessionEntries,
  reconstructMilestoneProgressFromSessionEntries,
  loadPlanFromAssistantMessageEnd,
  loadPlanFromToolResultEvent,
  loadMilestonesFromAssistantMessage,
  detectMilestonesFromToolResult,
  reloadPlanFromSubagentArgs,
  startPlanSubagentTasks,
  completePlanSubagentTasks,
  extractPlanPathsFromArgs,
  extractMilestonePathsFromArgs,
  startMilestonesFromSubagentArgs,
  subagentItemRecords,
  getToolExecutionArgs,
} from "./plan-progress-events.js";

export { isCompletionFilePath, extractMilestoneId } from "./milestone-tracker.js";
```

### Task 2: Modify `index.ts` session_start for structured-first restore

In `extensions/agentic-harness/index.ts`, modify the `session_start` handler:

**Before (current):**
- Calls `reconstructPlanProgressFromSessionEntries` (parser-derived)
- Looks for `MILESTONE_PROGRESS_CUSTOM_TYPE` entries (hybrid)
- Calls `reconstructMilestoneProgressFromSessionEntries` (parser-derived)
- Creates `HarnessProgressProvider` and detects runId

**After (M6):**
1. First, scan `branchEntries` for `HARNESS_STATE_EVENT_CUSTOM_TYPE` entries. Extract the `runId`.
2. If a `runId` is found:
   a. Load the `HarnessState` snapshot from disk via `readHarnessStateSnapshot`.
   b. Replay all `HARNESS_STATE_EVENT_CUSTOM_TYPE` events onto the snapshot via `replayHarnessEvents` (from `harness-events.ts`).
   c. Extract milestone statuses from the reconstructed state → `milestoneTracker.restoreMilestoneStatuses(...)`.
   d. Extract plan task statuses → `planProgress.loadPlan(...)` from plan markdown if available, then `planProgress.restoreTaskStatuses(...)`.
   e. Extract todos → set on the milestone tracker if applicable.
   f. Skip all parser-derived reconstruction calls.
3. If no `runId` is found (legacy session):
   a. Run the existing parser-derived reconstruction as before (explicit legacy path).
   b. Add a clear comment: `// LEGACY PATH — parser-derived reconstruction for pre-structured sessions`
4. The `HarnessProgressProvider` creation remains unchanged.

**Key import changes:**
- Replace direct imports from `plan-progress-events.ts` with imports from `legacy-import-markdown.ts` for the parser functions.
- Add imports for `readHarnessStateSnapshot`, `harnessStateSnapshotPath`, `replayHarnessEvents`, `defaultHarnessStateRoot` from storage/events modules.

### Task 3: Quarantine parser-derived tool_result handlers

In `index.ts` `tool_result` handler, the existing logic that calls `loadPlanFromToolResultEvent` and `detectMilestonesFromToolResult` (parser-derived) should be gated:

- Only run parser-derived logic when no structured state exists for the current session (check `harnessProgress?.hasState()`).
- If structured state exists, skip the parser-derived plan/milestone loading entirely — the structured tools handle state updates.

### Task 4: Create `tests/session-replay.test.ts`

Create tests proving structured replay works:

1. **Fresh session with no state:** No crash, no progress shown.
2. **Resumed session with structured snapshot:** Snapshot is loaded, milestones/plans are restored from structured state, not from parser entries.
3. **Branch replay with events:** Events after the snapshot are replayed, state is correct.
4. **Completed workflow:** All milestones completed, plan tasks completed, state matches.

Each test creates a mock `HarnessState` snapshot + replay events, then verifies the `session_start` handler produces the correct `PlanProgressTracker` and `MilestoneTracker` state.

### Task 5: Create `tests/parser-isolation.test.ts`

Create tests proving parser-derived paths are quarantined:

1. **Legacy import module exists and exports expected functions.** Verify `legacy-import-markdown.ts` re-exports all needed functions.
2. **Structured-first path skips parser reconstruction.** When `HARNESS_STATE_EVENT_CUSTOM_TYPE` entries exist, the session_start handler does NOT call `reconstructPlanProgressFromSessionEntries`.
3. **No direct imports of parser functions from index.ts.** Source-level check: `index.ts` imports from `legacy-import-markdown.ts`, not directly from `plan-progress-events.ts`.

### Task 6: Build and full test suite

Run:
```bash
cd extensions/agentic-harness && npm run build && npm test
```

Fix any TypeScript errors, test failures, or build issues.

## Self-Review

- Are we modifying completed milestone files? No — M1-M5 files are read-only.
- Is the parser-derived code deleted? No — quarantined behind explicit legacy module.
- Are existing tests preserved? Yes — they should all still pass; the runtime behavior for legacy sessions is unchanged.
- Is `index.ts` kept clean? Yes — the session_start handler becomes structured-first with a clear legacy fallback.
