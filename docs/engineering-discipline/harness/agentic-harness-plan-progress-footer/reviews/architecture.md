# Architecture Analysis

## Suggested milestones

### 1. **Name:** Plan lifecycle event contract hardening

- **Architectural rationale:**  
  Natural boundary is the adapter from `subagent` lifecycle events to `PlanProgressTracker` state. This spans `extensions/agentic-harness/plan-progress-events.ts` and the relevant `index.ts` wiring because `matchedTaskIds`, `planTaskId`, and snapshot persistence form one contract.

- **Interfaces defined:**  
  - Only plan execution agents may mutate plan progress: `plan-compliance`, `plan-worker`, `plan-validator`.
  - `planTaskId` is authoritative when present.
  - Text matching fallback should be allowed only for plan execution agents, not reviewers/general workers.
  - `plan-compliance` / `plan-worker` success keeps task `running`.
  - `plan-validator` success completes the corresponding task.
  - Any plan-stage failure marks the corresponding running task failed.
  - Explicit `planTaskId` completion must work even when `matchedTaskIds` is missing or empty.
  - Snapshot persistence should be based on actual affected task IDs/state changes, not only on start-time `matchedTaskIds`.

- **Depends on:** None.

- **Leaves system in working state:**  
  **Yes** — tracker state semantics improve immediately, existing footer still renders, and regression tests can lock the expected `1/4 │ 1 running` behavior before render stabilization.

---

### 2. **Name:** Footer render invalidation stabilization

- **Architectural rationale:**  
  Rendering is a separate presentation boundary. `RoachFooter` should consume tracker state but not influence task lifecycle semantics. This milestone isolates terminal redraw behavior in `extensions/agentic-harness/footer.ts`.

- **Interfaces defined:**  
  - `RoachFooter` subscribes to `PlanProgressTracker` / `MilestoneTracker` changes.
  - Tracker changes and spinner ticks request non-forced renders: `requestRender()` or `requestRender(false)`, not `requestRender(true)`.
  - Spinner timer runs only while plan tasks are running.
  - `dispose()` clears timers and unsubscribes.
  - `render(width)` remains pure and width-safe.

- **Depends on:** None strictly, but should be verified together with milestone 1.

- **Leaves system in working state:**  
  **Yes** — Task Progress Tracker remains visible; only render scheduling changes. Existing tests should be updated from expecting `requestRender(true)` to expecting non-forced render requests.

---

### 3. **Name:** End-to-end regression and replay verification

- **Architectural rationale:**  
  Final boundary is cross-component data flow: tool events → tracker state → snapshot/replay → footer rendering. This should happen after lifecycle and render contracts are stable.

- **Interfaces defined:**  
  - Live tool execution and session replay follow the same plan-progress rules.
  - Persisted `plan-progress` snapshots represent completed validator-gated tasks.
  - Stale `running` tasks are still demoted to `pending` on replay.
  - Non-plan/reviewer/nested subagent events do not start or complete plan tasks.
  - Full verification command remains:  
    `cd extensions/agentic-harness && npm run build && npm test`

- **Depends on:** Milestones 1 and 2.

- **Leaves system in working state:**  
  **Yes** — validates the complete success criteria across unit, extension, footer, and replay tests.

---

## Interface risks

- `completePlanSubagentTasks()` currently returns `number[]`, but that can mean “matched”, “considered”, or “actually changed.” Snapshot persistence needs a clear “affected/changed task IDs” contract.
- `matchedTaskIds` loses per-agent association in mixed chains. If one chain contains worker task 2 and validator task 1, the API must avoid completing both accidentally.
- `PlanProgressTracker.completeTask()` only completes `running` tasks. Decide whether validator success with explicit `planTaskId` should complete a pending task or first force it through `running`.
- Nested `tasks` / `chain` schema should explicitly support `planFile` and `planTaskId` if the lifecycle depends on them.
- Confirm TUI semantics for `requestRender(false)` vs omitted argument; the fix depends on non-forced redraw still repainting the footer.

## Pattern conflicts

- Existing behavior allows non-plan `worker` text like “Task 3” to start plan progress; new scope intentionally forbids that.
- Existing footer tests/patterns expect `requestRender(true)`; those must change.
- Existing mixed-chain completion behavior may complete all matched IDs when any validator exists; stricter validator-correlated completion may require test updates.
- Avoid reverting to single-listener `setOnChange`; footer and `WorkingVisibilityController` rely on multi-subscriber `subscribeOnChange`.
