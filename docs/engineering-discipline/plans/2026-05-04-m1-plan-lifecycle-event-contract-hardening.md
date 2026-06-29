# M1 Plan Lifecycle Event Contract Hardening Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking. Do not create git commits for this plan.

**Goal:** Make `PlanProgressTracker` task state changes correct and limited to intended plan execution agents.

**Architecture:** Harden the event-to-progress adapter in `plan-progress-events.ts`. Only whitelisted plan agents (`plan-compliance`, `plan-worker`, `plan-validator`) may mutate task state; `planTaskId` is authoritative when present; successful completion is gated by `plan-validator`, while failures mark the corresponding plan-stage task failed.

**Tech Stack:** TypeScript, Vitest, existing `PlanProgressTracker` and `plan-progress-events.ts` helpers.

**Work Scope:**
- **In scope:** `completePlanSubagentTasks` fallback completion, plan-agent filtering, mixed-chain over-completion guard, regression tests.
- **Out of scope:** `index.ts` snapshot persistence, footer rendering, pi TUI core changes.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm exec -- vitest run tests/plan-progress-events.test.ts`
- **What it validates:** Plan progress event lifecycle semantics and regression coverage for validator completion / non-plan agent guarding.

---

## File Structure Mapping

- Modify `extensions/agentic-harness/plan-progress-events.ts`
  - Add a plan-progress agent allowlist/helper.
  - Update `startPlanSubagentTasks` and `completePlanSubagentTasks` to use only whitelisted plan agents.
  - Make `planTaskId` completion work without `matchedTaskIds`.
  - Return task IDs only when completion/failure should be persisted.
- Modify `extensions/agentic-harness/tests/plan-progress-events.test.ts`
  - Update old permissive non-plan matching expectations.
  - Add explicit regression tests for missing `matchedTaskIds` and mixed-chain over-completion.

---

### Task 1: Harden lifecycle event semantics

**Dependencies:** None
**Files:**
- Modify: `extensions/agentic-harness/plan-progress-events.ts`
- Modify: `extensions/agentic-harness/tests/plan-progress-events.test.ts`

- [ ] **Step 1: Add/adjust regression tests**

In `extensions/agentic-harness/tests/plan-progress-events.test.ts`, update and add tests under `describe("plan progress subagent task tracking", ...)` so these behaviors are asserted:

1. The existing non-plan agent test must expect generic `worker` to be ignored even when task text is `Task 3`:

```ts
expect(startPlanSubagentTasks(tracker, {
  agent: "worker",
  task: "Task 3",
})).toEqual([]);
expect(tracker.getProgress()).toMatchObject({ running: 0, pending: 3 });
```

2. Add a regression where a task is already running from `plan-worker`, then a successful `plan-validator` with explicit `planTaskId` and **no** `matchedTaskIds` completes it:

```ts
it("completes explicit validator planTaskId even when matchedTaskIds are absent", () => {
  const tracker = loadTrackingPlan();

  const workerIds = startPlanSubagentTasks(tracker, {
    agent: "plan-worker",
    task: "implement task",
    planFile: PLAN_PATH,
    planTaskId: 1,
  });
  expect(workerIds).toEqual([1]);

  const workerCompleted = completePlanSubagentTasks(tracker, {
    agent: "plan-worker",
    task: "implement task",
    planFile: PLAN_PATH,
    planTaskId: 1,
  }, true, workerIds);
  expect(workerCompleted).toEqual([]);
  expect(tracker.getProgress()).toMatchObject({ completed: 0, running: 1, pending: 2 });

  const validatorCompleted = completePlanSubagentTasks(tracker, {
    agent: "plan-validator",
    task: "validate",
    planFile: PLAN_PATH,
    planTaskId: 1,
  }, true);

  expect(validatorCompleted).toEqual([1]);
  expect(tracker.getProgress()).toMatchObject({ completed: 1, running: 0, pending: 2 });
});
```

3. Add a regression where a successful validator with explicit `planTaskId` can complete a pending task by internally moving it to completed:

```ts
it("completes pending explicit validator planTaskId without a prior start", () => {
  const tracker = loadTrackingPlan();

  const completedIds = completePlanSubagentTasks(tracker, {
    agent: "plan-validator",
    task: "validate",
    planFile: PLAN_PATH,
    planTaskId: 2,
  }, true);

  expect(completedIds).toEqual([2]);
  expect(tracker.getProgress()).toMatchObject({ completed: 1, running: 0, pending: 2 });
});
```

4. Add/adjust a mixed-chain regression so a worker for Task 1 and validator for Task 2 completes only Task 2, leaving Task 1 running:

```ts
expect(tracker.getProgress()).toMatchObject({ completed: 1, running: 1, pending: 1 });
```

5. Add a nested/reviewer guard regression:

```ts
it("ignores reviewer and nested non-plan agents even when text names a task", () => {
  const tracker = loadTrackingPlan();

  expect(startPlanSubagentTasks(tracker, {
    tasks: [
      { agent: "reviewer-bug", task: "Task 1" },
      { agent: "explorer", task: "Task 2" },
      { agent: "worker", task: "Task 3" },
    ],
  })).toEqual([]);
  expect(tracker.getProgress()).toMatchObject({ running: 0, pending: 3, completed: 0 });
});
```

- [ ] **Step 2: Verify tests fail before implementation**

Run:

```bash
cd extensions/agentic-harness && npm exec -- vitest run tests/plan-progress-events.test.ts
```

Expected before implementation: at least the new/updated regression assertions fail.

- [ ] **Step 3: Implement whitelisted plan-agent filtering and validator completion fallback**

In `extensions/agentic-harness/plan-progress-events.ts`:

1. Add a local allowlist for plan-progress mutating agents:

```ts
const PLAN_PROGRESS_AGENTS = new Set(["plan-compliance", "plan-worker", "plan-validator"]);

function isPlanProgressAgent(item: Record<string, unknown>): boolean {
  return typeof item.agent === "string" && PLAN_PROGRESS_AGENTS.has(item.agent);
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}
```

2. Update `startPlanSubagentTasks` so it skips any item where `!isPlanProgressAgent(item)`.

3. Update `completePlanSubagentTasks` so it uses only plan-progress items and follows this contract:
   - If there is no plan or no plan-progress item, return `[]`.
   - If `success === false`, fail `matchedTaskIds` when available; otherwise fail explicit `planTaskId` items or running tasks matched by task text. Return the affected IDs.
   - If `success === true` and no item has `agent === "plan-validator"`, do not complete anything and return `[]`.
   - If `success === true`, complete only validator-related tasks:
     - If validator items have explicit `planTaskId`, call `tracker.startTaskById(id)` first, then `tracker.completeTask(id, true)`, and return the IDs that existed and were completed.
     - Else if `matchedTaskIds` exists, complete those matched IDs as a fallback.
     - Else complete by validator task text match.
   - Do not complete worker/compliance task IDs merely because a validator item exists elsewhere in the same mixed chain.
   - Deduplicate returned IDs with `uniqueNumbers`.

- [ ] **Step 4: Run targeted tests**

Run:

```bash
cd extensions/agentic-harness && npm exec -- vitest run tests/plan-progress-events.test.ts
```

Expected: all tests in `tests/plan-progress-events.test.ts` pass.

- [ ] **Step 5: Run TypeScript build**

Run:

```bash
cd extensions/agentic-harness && npm run build
```

Expected: TypeScript build passes.

### Task 2 (Final): M1 Verification

**Dependencies:** Task 1
**Files:** None (read-only verification)

- [ ] **Step 1: Run M1 highest-level verification**

Run:

```bash
cd extensions/agentic-harness && npm exec -- vitest run tests/plan-progress-events.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run build**

Run:

```bash
cd extensions/agentic-harness && npm run build
```

Expected: TypeScript build passes.

- [ ] **Step 3: Verify M1 success criteria**

Manually confirm:
- [ ] `plan-validator` success with explicit `planTaskId` completes the correct task even when `matchedTaskIds` is missing or empty.
- [ ] Regression tests prove Task 1 completed and Task 2 running can render as `1/4 │ 1 running` at the tracker state level.
- [ ] `plan-compliance` and `plan-worker` success leave tasks running; failures mark the corresponding task failed.
- [ ] Reviewers, explorer, generic worker, nested non-plan agents, and incidental `Task N` text do not mutate plan task state.
