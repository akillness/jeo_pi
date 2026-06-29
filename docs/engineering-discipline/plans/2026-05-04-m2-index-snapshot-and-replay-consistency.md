# M2 Index Snapshot and Replay Consistency Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking. Do not create git commits.

**Goal:** Ensure live execution, persistence, and replay use the corrected M1 lifecycle contract.

**Architecture:** `index.ts` should persist plan-progress snapshots based on the actual task IDs affected by `completePlanSubagentTasks`, not only IDs captured during `tool_execution_start`. Extension-level tests should exercise live `tool_execution_end` paths where explicit `planTaskId` completion happens without start-time `matchedTaskIds`.

**Tech Stack:** TypeScript, Vitest, mocked extension event handlers in `tests/extension.test.ts`.

**Completed Milestone Context:**
- M1 modified `extensions/agentic-harness/plan-progress-events.ts` and `extensions/agentic-harness/tests/plan-progress-events.test.ts`.
- M1 established that `completePlanSubagentTasks` returns deduplicated task IDs only when completion/failure should be persisted.
- M1 established that explicit validator `planTaskId` can complete a task even without `matchedTaskIds`.

**Work Scope:**
- **In scope:** `index.ts` persistence trigger after completion/failure, extension-level regression tests for explicit `planTaskId` without matched IDs and ignored non-plan events.
- **Out of scope:** Changing M1 lifecycle semantics, footer rendering, pi TUI core changes.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm exec -- vitest run tests/extension.test.ts tests/plan-progress-events.test.ts`
- **What it validates:** Extension tool event wiring uses M1 lifecycle semantics and persists snapshots after actual completion/failure.

---

## File Structure Mapping

- Modify `extensions/agentic-harness/index.ts`
  - Capture the return value of `completePlanSubagentTasks` in `tool_execution_end`.
  - Persist progress snapshots when that return value is non-empty, even if `matchedTaskIds` is missing or empty.
- Modify `extensions/agentic-harness/tests/extension.test.ts`
  - Add live event wiring tests for explicit validator completion without `matchedTaskIds`.
  - Add live event wiring test proving generic non-plan subagent events do not start/persist plan task state.

---

### Task 1: Persist snapshots from actual completion/failure IDs

**Dependencies:** M1 completed
**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Add extension-level regression tests**

In `extensions/agentic-harness/tests/extension.test.ts`, add tests near the existing plan progress snapshot/replay tests.

Test A: explicit validator completion without matched IDs persists a completed snapshot.

Use this structure:

```ts
it("persists plan progress when validator completion has planTaskId but no matched ids", async () => {
  const { mockPi, events } = createMockPi();
  extension(mockPi);

  const planMarkdown = [
    "# Snapshot Plan",
    "",
    "**Goal:** Persist explicit validator completion",
    "",
    "---",
    "",
    "### Task 1: Persist validator completion",
    "",
    "**Dependencies:** None",
    "**Files:**",
    "- Modify: `extensions/agentic-harness/index.ts`",
    "",
    "- [ ] **Step 1: Complete**",
    "",
    "Run: `npm test -- --run tests/extension.test.ts`",
    "Expected: pass",
  ].join("\n");

  const customEntries: Array<{ customType: string; data?: any }> = [];
  let footerFactory: any;
  const mockSessionManager = {
    getBranch: () => [
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: planMarkdown }] } },
    ],
    appendCustomEntry: (customType: string, data?: unknown) => {
      customEntries.push({ customType, data });
      return "snap-id";
    },
  };

  await events.get("session_start")![0]({ type: "session_start", reason: "reload" } as any, {
    cwd: ".",
    ui: {
      setHeader: vi.fn(),
      setFooter: (fn: any) => { footerFactory = fn; },
      notify: vi.fn(),
      setWorkingVisible: vi.fn(),
    },
    sessionManager: mockSessionManager,
    model: { name: "test" },
    getContextUsage: () => undefined,
  } as any);

  await events.get("tool_execution_end")![0]({
    toolCallId: "validator-without-start",
    toolName: "subagent",
    args: { agent: "plan-validator", task: "validate", planTaskId: 1 },
    isError: false,
  }, {
    cwd: ".",
    sessionManager: mockSessionManager,
  } as any);

  const planSnapshots = customEntries.filter((entry) => entry.customType === "plan-progress");
  expect(planSnapshots.length).toBeGreaterThan(0);
  expect(planSnapshots.at(-1)?.data?.taskStatuses).toEqual([{ id: 1, status: "completed" }]);

  const footer = footerFactory({ requestRender: vi.fn() }, {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as any, { getGitBranch: () => undefined } as any);
  const rendered = footer.render(120).join("\n");
  expect(rendered).toContain("1/1");
  expect(rendered).toContain("✓ Persist validator completion");
  footer.dispose?.();
});
```

Test B: generic non-plan agents do not start or persist plan progress through extension wiring.

Use this structure:

```ts
it("ignores non-plan subagent events in plan progress tool wiring", async () => {
  const { mockPi, events } = createMockPi();
  extension(mockPi);

  const planMarkdown = [
    "# Ignore Non Plan Agent",
    "",
    "**Goal:** Ignore worker task text",
    "",
    "---",
    "",
    "### Task 1: Should stay pending",
    "",
    "**Dependencies:** None",
    "**Files:**",
    "- Modify: `extensions/agentic-harness/index.ts`",
    "",
    "- [ ] **Step 1: Stay pending**",
    "",
    "Run: `npm test -- --run tests/extension.test.ts`",
    "Expected: pass",
  ].join("\n");

  const customEntries: Array<{ customType: string; data?: unknown }> = [];
  let footerFactory: any;
  const mockSessionManager = {
    getBranch: () => [
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: planMarkdown }] } },
    ],
    appendCustomEntry: (customType: string, data?: unknown) => {
      customEntries.push({ customType, data });
      return "snap-id";
    },
  };

  await events.get("session_start")![0]({ type: "session_start", reason: "reload" } as any, {
    cwd: ".",
    ui: {
      setHeader: vi.fn(),
      setFooter: (fn: any) => { footerFactory = fn; },
      notify: vi.fn(),
      setWorkingVisible: vi.fn(),
    },
    sessionManager: mockSessionManager,
    model: { name: "test" },
    getContextUsage: () => undefined,
  } as any);

  await events.get("tool_execution_start")![0]({
    toolCallId: "worker-non-plan",
    toolName: "subagent",
    args: { agent: "worker", task: "Task 1" },
  }, { cwd: "." } as any);

  await events.get("tool_execution_end")![0]({
    toolCallId: "worker-non-plan",
    toolName: "subagent",
    args: { agent: "worker", task: "Task 1" },
    isError: false,
  }, {
    cwd: ".",
    sessionManager: mockSessionManager,
  } as any);

  expect(customEntries.filter((entry) => entry.customType === "plan-progress")).toEqual([]);

  const footer = footerFactory({ requestRender: vi.fn() }, {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as any, { getGitBranch: () => undefined } as any);
  const rendered = footer.render(120).join("\n");
  expect(rendered).toContain("0/1");
  expect(rendered).toContain("○ Should stay pending");
  expect(rendered).not.toContain("running");
  footer.dispose?.();
});
```

- [ ] **Step 2: Verify tests fail before implementation**

Run:

```bash
cd extensions/agentic-harness && npm exec -- vitest run tests/extension.test.ts tests/plan-progress-events.test.ts
```

Expected before implementation: Test A fails because no snapshot is persisted when `matchedTaskIds` is missing.

- [ ] **Step 3: Update index.ts persistence trigger**

In `extensions/agentic-harness/index.ts`, inside the `tool_execution_end` subagent branch, replace:

```ts
completePlanSubagentTasks(planProgress, args, !(event.isError ?? false), matchedTaskIds);
if (matchedTaskIds && matchedTaskIds.length > 0) {
  persistProgressSnapshot(ctx);
}
```

with:

```ts
const affectedTaskIds = completePlanSubagentTasks(planProgress, args, !(event.isError ?? false), matchedTaskIds);
if (affectedTaskIds.length > 0) {
  persistProgressSnapshot(ctx);
}
```

Do not change milestone completion logic except for using the existing `success` variable as already done below that block.

- [ ] **Step 4: Run targeted extension tests**

Run:

```bash
cd extensions/agentic-harness && npm exec -- vitest run tests/extension.test.ts tests/plan-progress-events.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 5: Run TypeScript build**

Run:

```bash
cd extensions/agentic-harness && npm run build
```

Expected: TypeScript build passes.

### Task 2 (Final): M2 Verification

**Dependencies:** Task 1
**Files:** None (read-only verification)

- [ ] **Step 1: Run M2 highest-level verification**

Run:

```bash
cd extensions/agentic-harness && npm exec -- vitest run tests/extension.test.ts tests/plan-progress-events.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run build**

Run:

```bash
cd extensions/agentic-harness && npm run build
```

Expected: TypeScript build passes.

- [ ] **Step 3: Verify M2 success criteria**

Manually confirm:
- [ ] `index.ts` persists `plan-progress` snapshots after actual completion/failure, not only when `matchedTaskIds` existed.
- [ ] Explicit `planTaskId` validator completion survives session snapshot persistence.
- [ ] Replay preserves stale `running → pending` behavior.
- [ ] `extension.test.ts` covers missing/empty `matchedTaskIds`, explicit `planTaskId`, and ignored non-plan events through tool start/end wiring.
