# Plan: M5 — Footer and Progress Cutover

## Context

M3 delivered structured harness tools (`harness_milestone`, `harness_plan`, `harness_todo`) that write canonical state to JSON snapshots. M5 makes the footer read live milestone/plan/todo progress from structured state selectors instead of markdown/prose-derived `PlanProgressTracker` and `MilestoneTracker`.

The old parser-derived trackers remain as fallback when no structured state exists.

## Success Criteria

- [ ] `HarnessProgressProvider` exposes read-only milestone, plan, active task, and todo summaries from structured state.
- [ ] Store changes trigger `tui.requestRender()` through the existing invalidation path.
- [ ] Spinner behavior remains driven by structured running-task state.
- [ ] Footer tests cover live progress updates, session restore display, and disposal cleanup.
- [ ] Existing `PlanProgressTracker` / `MilestoneTracker` are fallback only; structured state is primary when present.
- [ ] `cd extensions/agentic-harness && npm run build && npm test` passes for footer/progress integration tests.

## Out of Scope

- Skill/prompt contract updates (M4).
- Parser removal or quarantine (M6).
- Legacy cleanup (M7).

## Verification Strategy

- **Level:** test-suite + build
- **Command:** `cd extensions/agentic-harness && npm run build && npm test`
- **What it validates:** TypeScript correctness and full regression suite, including new provider and footer integration tests.

## Tasks

### Task 1: Create `harness-progress.ts`

Create `extensions/agentic-harness/harness-progress.ts` with a `HarnessProgressProvider` class:

**Constructor:**
- `new HarnessProgressProvider(options?: { runId?: string; rootDir?: string })`
- Internally stores `runId`, `rootDir`, and a cached `HarnessState | null`.

**State loading:**
- `private async reload(): Promise<void>` — reads snapshot via `readHarnessStateSnapshot(harnessStateSnapshotPath(...))`. If missing, sets cached state to `null`.
- `hasState(): boolean` — true if cached state is non-null.
- `setRunId(runId: string): void` — sets the runId and triggers `reload()` + `notifyChanged()`.

**Render methods (mirror existing tracker output):**
- `renderMilestones(theme: Theme, maxWidth: number): string[]`:
  - If no state, return `[]`.
  - Use `selectMilestoneSummary(state)` for counts.
  - Render progress bar (`completed/total`) and milestone icon grid (same icons/colors as `MilestoneTracker`).
  - Use `selectActiveMilestone(state)` to get active milestone.
  - If active milestone has todos (via `selectTodosForOwner`), render todo progress bar and top 5 todos (same format as `MilestoneTracker`).
- `renderPlan(theme: Theme, maxWidth: number): string[]`:
  - If no state, return `[]`.
  - Use `selectActivePlan(state)` or first plan as fallback.
  - Use `selectPlanSummary(state, planId)` for counts.
  - Render goal header, progress bar, and task list with spinner for running tasks (same format as `PlanProgressTracker`).
  - Running tasks use the same spinner frames and interval.

**Spinner / running-task detection:**
- `hasRunningTasks(): boolean` — true if any plan task has status `"running"`.
- `getProgress(): { completed: number; total: number; failed: number; running: number; pending: number }` — from plan summary.

**Change notification:**
- `subscribeOnChange(listener: () => void): () => void` — same pattern as trackers.
- `invalidate(): void` — calls `reload()` then `notifyChanged()`.

**Type imports:**
- Import from `harness-state.ts`, `harness-storage.ts`, `harness-render.ts`.

### Task 2: Wire provider into `footer.ts`

In `extensions/agentic-harness/footer.ts`:

1. Add import for `HarnessProgressProvider`.
2. Add optional constructor parameter:
   ```ts
   harnessProgress?: HarnessProgressProvider | null
   ```
3. Store `harnessProgress` as a field.
4. Subscribe to provider changes:
   ```ts
   this.unsubscribeHarnessProgress = this.harnessProgress?.subscribeOnChange(() => this.schedulePlanRender()) ?? null;
   ```
5. In `dispose()`, unsubscribe from provider.
6. In `render()`, change the milestone/plan rendering logic:
   ```ts
   const hasStructuredMilestones = this.harnessProgress?.hasState() ?? false;
   const hasStructuredPlan = this.harnessProgress?.hasState() ?? false;
   const hasMilestones = hasStructuredMilestones || (this.milestoneTracker?.hasMilestones() ?? false);
   const hasPlan = hasStructuredPlan || (this.planProgress?.hasPlan() ?? false);

   if (hasMilestones || hasPlan) {
     // ...
     if (hasMilestones) {
       if (this.harnessProgress?.hasState()) {
         lines.push(...this.harnessProgress.renderMilestones(this.theme, pw).map((l) => fitLine(l, width)));
       } else if (this.milestoneTracker) {
         lines.push(...this.milestoneTracker.render(this.theme, pw).map((l) => fitLine(l, width)));
       }
       // ...
     }
     if (hasPlan) {
       if (this.harnessProgress?.hasState()) {
         lines.push(...this.harnessProgress.renderPlan(this.theme, pw).map((l) => fitLine(l, width)));
       } else if (this.planProgress) {
         lines.push(...this.planProgress.render(this.theme, pw).map((l) => fitLine(l, width)));
       }
     }
   }
   ```
7. In `updateSpinnerTimer()`, drive spinner from provider when active:
   ```ts
   const hasRunning = (this.harnessProgress?.hasState() && this.harnessProgress?.hasRunningTasks())
     || (this.planProgress?.getProgress().running ?? 0) > 0;
   ```

### Task 3: Wire provider into `index.ts`

In `extensions/agentic-harness/index.ts`:

1. Import `HarnessProgressProvider` from `./harness-progress.js`.
2. In the main function body, add a module-level or closure variable:
   ```ts
   let harnessProgress: HarnessProgressProvider | null = null;
   ```
3. In `session_start` handler:
   - Create `harnessProgress = new HarnessProgressProvider()`.
   - Try to detect the runId from existing `HARNESS_STATE_EVENT_CUSTOM_TYPE` entries in the session branch (the first replay event has `runId`).
   - If found, call `harnessProgress.setRunId(runId)`.
   - Pass `harnessProgress` to `RoachFooter` constructor.
4. In `tool_result` handler:
   - When `event.toolName` is `harness_milestone`, `harness_plan`, or `harness_todo`:
     - If `harnessProgress` exists and doesn't have a runId yet, extract `runId` from `event.input.runId` and call `setRunId()`.
     - Call `harnessProgress.invalidate()`.
5. In `session_shutdown` handler:
   - Clear `harnessProgress = null`.

### Task 4: Create `harness-progress.test.ts`

Create `extensions/agentic-harness/tests/harness-progress.test.ts`:

1. **Provider creation:**
   - `new HarnessProgressProvider()` has no state initially.
   - `hasState()` returns false.

2. **State loading:**
   - Create a snapshot with milestones and plans via harness tools.
   - Set runId on provider.
   - `hasState()` returns true.
   - `renderMilestones()` returns non-empty lines containing milestone IDs.
   - `renderPlan()` returns non-empty lines containing task names.

3. **Running task detection:**
   - State with a running task → `hasRunningTasks()` returns true.
   - State with no running tasks → `hasRunningTasks()` returns false.

4. **Change notification:**
   - Subscribe a listener.
   - Call `invalidate()`.
   - Listener fires.
   - Unsubscribe works.

5. **Render output correctness:**
   - Rendered milestones contain expected progress counts.
   - Rendered plan contains goal header and task list.
   - Spinner icon appears for running tasks.

6. **Empty state:**
   - No snapshot → all render methods return `[]`.

Use temporary directories for snapshots. Use the harness tools to seed state, or write snapshots directly.

### Task 5: Update `footer.test.ts`

In `extensions/agentic-harness/tests/footer.test.ts`:

Add tests verifying:

1. When `HarnessProgressProvider` has state, footer uses its render output instead of tracker output.
2. When provider has no state, footer falls back to existing trackers.
3. `dispose()` unsubscribes from provider change listeners.
4. Spinner timer is driven by `hasRunningTasks()` when provider is active.

Mock the provider's methods for unit isolation.

### Task 6: Build and full test suite

Run:
```bash
cd extensions/agentic-harness && npm run build && npm test
```

Fix any TypeScript errors, test failures, or build issues.

## Self-Review

- Are we modifying completed milestone files? No — M1/M2/M3 files are read-only.
- Is `index.ts` kept thin? Yes — only provider creation, runId detection, and invalidation wiring.
- Do existing trackers remain intact? Yes — they are fallback only.
- Are there file conflicts with M4? No — M4 touches skill docs; M5 touches runtime/footer.
- Is the provider truly read-only? Yes — it only loads snapshots, never writes.
