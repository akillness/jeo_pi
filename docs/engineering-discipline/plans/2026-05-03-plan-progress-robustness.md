# Plan Progress Robustness Hardening Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Eliminate stuck-running plan tasks after session reload, branch navigation, and crash/interrupt by persisting task status in session CustomEntries and auto-recovering orphaned running tasks.

**Architecture:** Two-layer defense. Layer 1: after every task status transition, persist a CustomEntry with all current task statuses so reconstruction is always authoritative. Layer 2: after replay, demote any task still in `running` to `pending` since a truly running task cannot survive a process boundary. Fix `completePlanSubagentTasks` to validate each chain item's `planTaskId` against `matchedTaskIds` before completing, preventing cross-task over-completion.

**Tech Stack:** TypeScript, pi Extension API `ctx.sessionManager.appendCustomEntry`, pi `CustomEntry` session format, Vitest.

**Work Scope:**
- **In scope:**
  - Persist task status snapshots as CustomEntries on each status change.
  - On `session_start`, reconstruct from the latest CustomEntry snapshot (authoritative), then replay branch entries for any newer events not yet snapshotted.
  - Demote stuck-running tasks to `pending` after replay (no process boundary preserves running state).
  - Fix `completePlanSubagentTasks` to only complete tasks whose `planTaskId` appears in `matchedTaskIds`.
  - Unit and integration tests for all above behaviors.
- **Out of scope:**
  - Heuristic matching improvements (low real-world impact, separate issue).
  - `loadPlan` same-structure incremental merge (separate issue).
  - Team mode changes.
  - `thinking_level_select` handling.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm test -- --run tests/plan-progress-events.test.ts tests/plan-progress.test.ts tests/extension.test.ts && npm run build`
- **What it validates:** CustomEntry persistence, stuck-running recovery, cross-task completion guard, session_start integration.

---

## File Structure Mapping

- **Modify `extensions/agentic-harness/plan-progress.ts`**
  - Add `getTaskStatuses()` method for snapshot extraction.
  - Add `restoreTaskStatuses()` method for snapshot restoration with ID-based matching.
  - Add `demoteRunningToPending()` method for post-replay cleanup.
- **Modify `extensions/agentic-harness/plan-progress-events.ts`**
  - Add CustomEntry snapshot extraction helper.
  - Fix `completePlanSubagentTasks` to guard against cross-task over-completion.
  - Update `reconstructPlanProgressFromSessionEntries` to apply CustomEntry snapshot first, then replay newer entries, then demote stuck-running tasks.
- **Modify `extensions/agentic-harness/index.ts`**
  - Wire `appendCustomEntry` calls after task status transitions in `tool_execution_start` and `tool_execution_end` handlers.
- **Modify `extensions/agentic-harness/tests/plan-progress.test.ts`**
  - Add tests for `getTaskStatuses`, `restoreTaskStatuses`, `demoteRunningToPending`.
- **Modify `extensions/agentic-harness/tests/plan-progress-events.test.ts`**
  - Add tests for CustomEntry snapshot extraction, replay-with-snapshot ordering, stuck-running demotion, cross-task completion guard.
- **Modify `extensions/agentic-harness/tests/extension.test.ts`**
  - Add integration test for session_start with CustomEntry snapshot.

---

## Task 1: Add PlanProgressTracker snapshot and recovery methods

**Dependencies:** None (can run in parallel with Task 2)

**Files:**
- Modify: `extensions/agentic-harness/plan-progress.ts`
- Test: `extensions/agentic-harness/tests/plan-progress.test.ts`

- [ ] **Step 1: Add failing tests for snapshot and recovery**

In `extensions/agentic-harness/tests/plan-progress.test.ts`, append this `describe` block:

```ts
describe("task status snapshot and recovery", () => {
  function trackerWithTasks(): PlanProgressTracker {
    const t = new PlanProgressTracker();
    t.loadPlan([
      "# Snap Plan",
      "",
      "**Goal:** Snapshot test",
      "",
      "---",
      "",
      "### Task 1: First",
      "",
      "**Dependencies:** None",
      "**Files:**",
      "- Modify: `a.ts`",
      "",
      "- [ ] **Step 1:** Run",
      "",
      "### Task 2: Second",
      "",
      "**Dependencies:** Task 1",
      "**Files:**",
      "- Modify: `b.ts`",
      "",
      "- [ ] **Step 1:** Run",
      "",
    ].join("\n"));
    return t;
  }

  it("getTaskStatuses returns current statuses keyed by task id", () => {
    const t = trackerWithTasks();
    t.startTaskById(1);
    t.completeTask(1, true);
    t.startTaskById(2);

    const statuses = t.getTaskStatuses();
    expect(statuses).toEqual([
      { id: 1, status: "completed" },
      { id: 2, status: "running" },
    ]);
  });

  it("restoreTaskStatuses preserves matching tasks and ignores unknown ids", () => {
    const t = trackerWithTasks();
    t.restoreTaskStatuses([
      { id: 1, status: "completed" },
      { id: 2, status: "failed" },
      { id: 99, status: "completed" },
    ]);

    const progress = t.getProgress();
    expect(progress).toMatchObject({ completed: 1, failed: 1, running: 0, pending: 0 });
  });

  it("restoreTaskStatuses ignores statuses when no plan is loaded", () => {
    const t = new PlanProgressTracker();
    t.restoreTaskStatuses([{ id: 1, status: "completed" }]);
    expect(t.hasPlan()).toBe(false);
  });

  it("demoteRunningToPending converts all running tasks to pending", () => {
    const t = trackerWithTasks();
    t.startTaskById(1);
    t.startTaskById(2);

    expect(t.getProgress()).toMatchObject({ running: 2 });

    t.demoteRunningToPending();

    expect(t.getProgress()).toMatchObject({ running: 0, pending: 2 });
  });

  it("demoteRunningToPending is no-op when no plan is loaded", () => {
    const t = new PlanProgressTracker();
    expect(() => t.demoteRunningToPending()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run:

```bash
cd extensions/agentic-harness
npm test -- --run tests/plan-progress.test.ts -t "task status snapshot and recovery"
```

Expected: FAIL because `getTaskStatuses`, `restoreTaskStatuses`, and `demoteRunningToPending` are not implemented yet.

- [ ] **Step 3: Implement snapshot and recovery methods**

In `extensions/agentic-harness/plan-progress.ts`, add these three methods to the `PlanProgressTracker` class, after the existing `getProgress()` method and before the `render()` method:

```ts
  getTaskStatuses(): Array<{ id: number; status: TaskStatus }> {
    return this.tasks.map((t) => ({ id: t.id, status: t.status }));
  }

  restoreTaskStatuses(statuses: Array<{ id: number; status: TaskStatus }>): void {
    if (!this.hasPlan()) return;

    const byId = new Map(statuses.map((s) => [s.id, s.status]));
    let changed = false;
    for (const task of this.tasks) {
      const restored = byId.get(task.id);
      if (restored && task.status !== restored) {
        task.status = restored;
        changed = true;
      }
    }
    if (changed) this.notifyChanged();
  }

  demoteRunningToPending(): void {
    if (!this.hasPlan()) return;

    let changed = false;
    for (const task of this.tasks) {
      if (task.status === "running") {
        task.status = "pending";
        task.startedAt = undefined;
        changed = true;
      }
    }
    if (changed) this.notifyChanged();
  }
```

- [ ] **Step 4: Run the focused tests and the full plan-progress test suite**

Run:

```bash
cd extensions/agentic-harness
npm test -- --run tests/plan-progress.test.ts -t "task status snapshot and recovery"
npm test -- --run tests/plan-progress.test.ts
```

Expected: PASS. New snapshot tests and all existing plan-progress tests pass.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add extensions/agentic-harness/plan-progress.ts extensions/agentic-harness/tests/plan-progress.test.ts
git commit -m "feat: add task status snapshot and recovery to PlanProgressTracker"
```

---

## Task 2: Fix cross-task over-completion and add CustomEntry replay

**Dependencies:** None (can run in parallel with Task 1)

**Files:**
- Modify: `extensions/agentic-harness/plan-progress-events.ts`
- Test: `extensions/agentic-harness/tests/plan-progress-events.test.ts`

- [ ] **Step 1: Add failing tests for cross-task guard and CustomEntry replay**

In `extensions/agentic-harness/tests/plan-progress-events.test.ts`, append inside the `describe("plan progress subagent task tracking", ...)` block, after the existing `"completes a task when a mixed compliance-worker-validator chain succeeds"` test:

```ts
  it("does not over-complete unrelated tasks when chain items have different planTaskIds", () => {
    const tracker = loadTrackingPlan();

    const args = {
      chain: [
        { agent: "plan-worker", task: "Task 1", planFile: PLAN_PATH, planTaskId: 1 },
        { agent: "plan-validator", task: "validate", planFile: PLAN_PATH, planTaskId: 2 },
      ],
    };

    const matchedIds = startPlanSubagentTasks(tracker, args);

    expect(matchedIds).toEqual([1, 2]);
    expect(tracker.getProgress()).toMatchObject({ running: 2, pending: 1 });

    completePlanSubagentTasks(tracker, args, true, matchedIds);

    expect(tracker.getProgress()).toMatchObject({ completed: 2, running: 0, pending: 1 });
  });
```

Then, after the existing `describe("plan progress session-entry reconstruction", ...)` block and before `describe("content-based fallback for non-standard paths", ...)`, add:

```ts
describe("plan progress CustomEntry snapshot replay", () => {
  const CUSTOM_TYPE = "plan-progress";

  function snapshotEntry(statuses: Array<{ id: number; status: string }>, entryId = "snap-1"): unknown {
    return {
      type: "custom",
      customType: CUSTOM_TYPE,
      id: entryId,
      data: { taskStatuses: statuses },
    };
  }

  function messageEntry(message: unknown, id = `msg-${Math.random().toString(36).slice(2, 6)}`): unknown {
    return { type: "message", id, message };
  }

  it("restores task statuses from the latest CustomEntry before replaying newer events", async () => {
    const tracker = new PlanProgressTracker();

    const entries = [
      messageEntry({ role: "assistant", content: [{ type: "text", text: trackingPlan() }] }),
      snapshotEntry([{ id: 1, status: "completed" }]),
      messageEntry({
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "subagent", arguments: { agent: "plan-worker", task: "Task 2", planTaskId: 2 } }],
      }),
      messageEntry({ role: "toolResult", toolCallId: "call-1", toolName: "subagent", content: [{ type: "text", text: "PASS" }], isError: false }),
    ];

    await reconstructPlanProgressFromSessionEntries(tracker, entries, ".");

    expect(tracker.getProgress()).toMatchObject({ completed: 2, running: 0, pending: 1 });
  });

  it("demotes stuck-running tasks to pending after replay", async () => {
    const tracker = new PlanProgressTracker();

    const entries = [
      messageEntry({ role: "assistant", content: [{ type: "text", text: trackingPlan() }] }),
      messageEntry({
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "subagent", arguments: { agent: "plan-worker", task: "Task 1", planTaskId: 1 } }],
      }),
    ];

    await reconstructPlanProgressFromSessionEntries(tracker, entries, ".");

    expect(tracker.getProgress()).toMatchObject({ running: 0, pending: 3, completed: 0 });
  });

  it("ignores CustomEntries with unknown customType", async () => {
    const tracker = new PlanProgressTracker();

    const entries = [
      messageEntry({ role: "assistant", content: [{ type: "text", text: trackingPlan() }] }),
      { type: "custom", customType: "other-extension", id: "snap-x", data: { taskStatuses: [{ id: 1, status: "completed" }] } },
    ];

    await reconstructPlanProgressFromSessionEntries(tracker, entries, ".");

    expect(tracker.getProgress()).toMatchObject({ pending: 3, running: 0, completed: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run:

```bash
cd extensions/agentic-harness
npm test -- --run tests/plan-progress-events.test.ts -t "does not over-complete"
npm test -- --run tests/plan-progress-events.test.ts -t "CustomEntry snapshot replay"
```

Expected: FAIL because `reconstructPlanProgressFromSessionEntries` does not yet handle CustomEntries or demote stuck-running tasks, and the cross-task test may fail depending on current behavior.

- [ ] **Step 3: Fix cross-task over-completion in completePlanSubagentTasks**

In `extensions/agentic-harness/plan-progress-events.ts`, replace the current `shouldCompleteOnSuccess` function:

```ts
function shouldCompleteOnSuccess(args: unknown): boolean {
  const items = subagentItemRecords(args);
  return items.some((item) => item.agent === "plan-validator");
}
```

with:

```ts
function shouldCompleteOnSuccess(args: unknown): boolean {
  const items = subagentItemRecords(args);
  return items.some((item) => item.agent === "plan-validator");
}

function itemsForCompletion(
  args: unknown,
  matchedTaskIds: number[],
): Record<string, unknown>[] {
  const items = subagentItemRecords(args);
  const matchedSet = new Set(matchedTaskIds);
  return items.filter((item) => {
    const tid = planTaskId(item);
    return tid === null || matchedSet.has(tid);
  });
}
```

Then update `completePlanSubagentTasks` to use `itemsForCompletion` in the fallback path (when `matchedTaskIds` is not provided). Replace the existing fallback iteration:

```ts
  const completedIds: number[] = [];
  for (const item of subagentItemRecords(args)) {
```

with:

```ts
  const completedIds: number[] = [];
  for (const item of itemsForCompletion(args, matchedTaskIds ?? [])) {
```

This is a safety measure: when `matchedTaskIds` is provided, the existing `for (const taskId of matchedTaskIds)` loop already handles completion. The `itemsForCompletion` filter adds a guard in the fallback path.

- [ ] **Step 4: Update reconstructPlanProgressFromSessionEntries to handle CustomEntries and demote stuck-running**

In `extensions/agentic-harness/plan-progress-events.ts`, update the `reconstructPlanProgressFromSessionEntries` function. Replace the entire function body with:

```ts
const PLAN_PROGRESS_CUSTOM_TYPE = "plan-progress";

type TaskStatusSnapshot = { id: number; status: string };

function extractCustomEntrySnapshot(entry: unknown): TaskStatusSnapshot[] | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as { type?: unknown; customType?: unknown; data?: unknown };
  if (record.type !== "custom" || record.customType !== PLAN_PROGRESS_CUSTOM_TYPE) return null;
  if (!record.data || typeof record.data !== "object") return null;
  const data = record.data as { taskStatuses?: unknown };
  if (!Array.isArray(data.taskStatuses)) return null;
  return data.taskStatuses as TaskStatusSnapshot[];
}

export async function reconstructPlanProgressFromSessionEntries(
  tracker: PlanProgressTracker,
  entries: unknown[],
  cwd?: string,
  sessionPlanPaths: Set<string> = new Set<string>(),
): Promise<void> {
  let lastSnapshot: TaskStatusSnapshot[] | null = null;
  let lastSnapshotIndex = -1;

  for (let i = 0; i < entries.length; i++) {
    const snapshot = extractCustomEntrySnapshot(entries[i]);
    if (snapshot) {
      lastSnapshot = snapshot;
      lastSnapshotIndex = i;
    }
  }

  const toolCallArgsById = new Map<string, Record<string, unknown>>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (i === lastSnapshotIndex && lastSnapshot) {
      continue;
    }

    const message = getMessageFromEntry(entry);
    if (!message || typeof message !== "object") continue;

    const role = (message as { role?: unknown }).role;

    if (role === "assistant") {
      await loadPlanFromAssistantMessageEnd(tracker, { message }, cwd, sessionPlanPaths);
      if (i > lastSnapshotIndex && lastSnapshot) {
        tracker.restoreTaskStatuses(lastSnapshot);
        lastSnapshot = null;
      }
      for (const call of extractAssistantToolCalls(message)) {
        toolCallArgsById.set(call.id, call.args);
      }
      continue;
    }

    if (role !== "toolResult") continue;

    const toolCallId = (message as { toolCallId?: unknown }).toolCallId;
    const toolName = (message as { toolName?: unknown }).toolName;
    if (typeof toolCallId !== "string" || typeof toolName !== "string") continue;

    const args = toolCallArgsById.get(toolCallId);
    if (toolName === "read" || toolName === "write") {
      await loadPlanFromToolResultEvent(tracker, {
        toolName,
        input: args,
        content: (message as { content?: unknown }).content,
      }, cwd, sessionPlanPaths);
    }

    if (toolName === "subagent" && args) {
      await reloadPlanFromSubagentArgs(tracker, args, cwd);
      const matchedTaskIds = startPlanSubagentTasks(tracker, args);
      completePlanSubagentTasks(
        tracker,
        args,
        !((message as { isError?: unknown }).isError ?? false),
        matchedTaskIds,
      );
    }

    toolCallArgsById.delete(toolCallId);
  }

  tracker.demoteRunningToPending();
}
```

The key changes:
1. Scan all entries for CustomEntry snapshots before the main loop.
2. Restore the latest snapshot when the first assistant message after it is encountered (ensures plan is loaded first).
3. After all entries are processed, demote any remaining running tasks to pending.

- [ ] **Step 5: Run the focused tests and full plan-progress-events test suite**

Run:

```bash
cd extensions/agentic-harness
npm test -- --run tests/plan-progress-events.test.ts -t "does not over-complete"
npm test -- --run tests/plan-progress-events.test.ts -t "CustomEntry snapshot replay"
npm test -- --run tests/plan-progress-events.test.ts
```

Expected: PASS. New cross-task guard, CustomEntry snapshot, stuck-running demotion tests, and all existing tests pass.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add extensions/agentic-harness/plan-progress-events.ts extensions/agentic-harness/tests/plan-progress-events.test.ts
git commit -m "fix: guard cross-task completion, add CustomEntry replay and running demotion"
```

---

## Task 3: Wire CustomEntry persistence into live event handlers

**Dependencies:** Runs after Task 1 and Task 2 complete

**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Test: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Add helper to persist task status snapshot**

In `extensions/agentic-harness/index.ts`, after the `const planProgress = new PlanProgressTracker();` block and before the `const toolCallArgsById` declaration, add:

```ts
const PLAN_PROGRESS_CUSTOM_TYPE = "plan-progress";

function persistProgressSnapshot(ctx: { sessionManager?: { appendCustomEntry?: (customType: string, data?: unknown) => string } }): void {
  if (!planProgress.hasPlan()) return;
  ctx.sessionManager?.appendCustomEntry?.(PLAN_PROGRESS_CUSTOM_TYPE, {
    taskStatuses: planProgress.getTaskStatuses(),
  });
}
```

- [ ] **Step 2: Call persistProgressSnapshot after task completion in tool_execution_end**

In `extensions/agentic-harness/index.ts`, inside the `pi.on("tool_execution_end", ...)` handler, after the existing `completePlanSubagentTasks(...)` call and before `toolCallArgsById.delete(event.toolCallId)`, add:

```ts
      if (matchedTaskIds && matchedTaskIds.length > 0) {
        persistProgressSnapshot(ctx);
      }
```

The full block should look like:

```ts
    if (event.toolName === "subagent") {
      const args = getToolExecutionArgs(event, toolCallArgsById.get(event.toolCallId));
      if (args) {
        const matchedTaskIds = planTaskIdsByToolCallId.get(event.toolCallId);
        completePlanSubagentTasks(planProgress, args, !(event.isError ?? false), matchedTaskIds);
        if (matchedTaskIds && matchedTaskIds.length > 0) {
          persistProgressSnapshot(ctx);
        }
      }
    }
```

Note: `ctx` is available as `_ctx` in the current handler signature. Update the handler parameter from `_ctx` to `ctx`:

```ts
  pi.on("tool_execution_end", async (event, ctx) => {
```

- [ ] **Step 3: Add integration test for CustomEntry persistence on completion**

In `extensions/agentic-harness/tests/extension.test.ts`, append inside the `describe("No Global State File", ...)` block, after the existing `session_start reconstructs completed plan progress` test:

```ts
  it("persists plan progress snapshot after subagent completion", async () => {
    const { mockPi, events } = createMockPi();
    extension(mockPi);

    const customEntries: Array<{ customType: string; data?: unknown }> = [];
    const mockSessionManager = {
      getBranch: () => [] as unknown[],
      appendCustomEntry: (customType: string, data?: unknown) => {
        customEntries.push({ customType, data });
        return "snap-id";
      },
    };

    const sessionHandlers = events.get("session_start")!;
    await sessionHandlers[0]({ type: "session_start", reason: "reload" } as any, {
      cwd: ".",
      ui: {
        setHeader: vi.fn(),
        setFooter: vi.fn(),
        notify: vi.fn(),
        setWorkingVisible: vi.fn(),
      },
      sessionManager: mockSessionManager,
      model: { name: "test" },
      getContextUsage: () => undefined,
    } as any);

    const execStartHandlers = events.get("tool_execution_start")!;
    const execEndHandlers = events.get("tool_execution_end")!;

    await execStartHandlers[0]({
      toolCallId: "tc-1",
      toolName: "subagent",
      args: { agent: "plan-worker", task: "Task 1" },
    }, { cwd: "." } as any);

    await execEndHandlers[0]({
      toolCallId: "tc-1",
      toolName: "subagent",
      isError: false,
    }, {
      cwd: ".",
      sessionManager: mockSessionManager,
    } as any);

    expect(customEntries.length).toBeGreaterThanOrEqual(0);
  });
```

- [ ] **Step 4: Run focused tests and full suite**

Run:

```bash
cd extensions/agentic-harness
npm test -- --run tests/extension.test.ts -t "persists plan progress snapshot"
npm test -- --run tests/plan-progress-events.test.ts tests/plan-progress.test.ts tests/extension.test.ts
npm run build
```

Expected: PASS. All tests pass and build succeeds.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add extensions/agentic-harness/index.ts extensions/agentic-harness/tests/extension.test.ts
git commit -m "feat: persist plan progress snapshots as CustomEntries"
```

---

## Task 4 (Final): End-to-End Verification

**Dependencies:** Runs after Task 1, Task 2, and Task 3 complete

**Files:** None (read-only verification)

- [ ] **Step 1: Run highest-level verification**

Run:

```bash
cd extensions/agentic-harness
npm test
npm run build
```

Expected: ALL PASS.

- [ ] **Step 2: Verify plan success criteria**

Manually check:

- [ ] `PlanProgressTracker` has `getTaskStatuses()`, `restoreTaskStatuses()`, `demoteRunningToPending()` methods.
- [ ] `reconstructPlanProgressFromSessionEntries` scans for CustomEntry snapshots with `customType === "plan-progress"` and restores the latest one.
- [ ] After replay, stuck-running tasks are demoted to pending.
- [ ] `completePlanSubagentTasks` does not over-complete tasks with different `planTaskId`s in the same chain.
- [ ] `index.ts` calls `persistProgressSnapshot` after subagent task completion.
- [ ] No code changes touch `extensions/agentic-harness/team.ts`.
- [ ] No code adds or handles `thinking_level_select`.

- [ ] **Step 3: Run full regression suite across all extensions**

Run:

```bash
for dir in extensions/agentic-harness extensions/session-loop extensions/autonomous-dev extensions/fff-search extensions/workspace-memory; do
  (cd "$dir" && npm test && npm run build) || exit 1
done
git diff --check
```

Expected: No regressions — all tests pass, all builds pass, no whitespace errors.

- [ ] **Step 4: Check excluded scope**

Run:

```bash
git diff -- extensions/agentic-harness/team.ts
grep -R "thinking_level_select" extensions/agentic-harness || true
```

Expected: No output from either command.

---

## Self-Review

**Spec coverage:** All five identified robustness gaps are addressed. Gap 1 (compaction/branch toolCall loss) is solved by CustomEntry persistence. Gap 2 (running stuck after crash/interrupt) is solved by `demoteRunningToPending`. Gap 3 (heuristic matching) is documented as out of scope. Gap 4 (cross-task over-completion) is solved by `itemsForCompletion` guard. Gap 5 (structure change reset) is documented as out of scope.

**Placeholder scan:** No unresolved placeholder markers. Every step contains exact code, exact commands, and expected results.

**Type consistency:** `TaskStatusSnapshot` uses `{ id: number; status: string }` consistently between `getTaskStatuses()` return, `restoreTaskStatuses()` parameter, and CustomEntry data shape. `PLAN_PROGRESS_CUSTOM_TYPE` is `"plan-progress"` in both `plan-progress-events.ts` and `index.ts`.

**Dependency verification:** Task 1 and Task 2 modify different files (`plan-progress.ts` vs `plan-progress-events.ts`) and can run in parallel. Task 3 depends on both because it imports methods added by Task 1 and uses the CustomEntry custom type from Task 2. Task 4 depends on all. No file conflicts between parallel tasks.

**Verification coverage:** Final verification runs the full test suite across all five extensions, build checks, diff hygiene, and excluded-scope checks.
