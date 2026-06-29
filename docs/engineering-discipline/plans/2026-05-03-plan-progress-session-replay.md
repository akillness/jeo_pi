# Plan Progress Session Replay Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Rebuild the Task Progress Tracker from the active session branch on `/reload`, `/resume`, and startup so completed subagent plan tasks do not remain visually stuck as `running`.

**Architecture:** Add a pure reconstruction layer that scans persisted session message entries in branch order and drives the existing plan-progress reducer helpers. Wire that reconstruction into `session_start` after clearing transient state and before footer/working-row controllers are installed. The implementation must use `ctx.sessionManager.getBranch()` because pi does not replay historical extension events during reload.

**Tech Stack:** TypeScript, pi Extension API `ctx.sessionManager`, Vitest, existing `PlanProgressTracker`, existing `plan-progress-events.ts` helpers.

**Work Scope:**
- **In scope:** Reconstruct plan markdown loading, read/write tool result plan loading, subagent start/end completion, failed subagent results, and active-branch-only behavior from persisted session entries.
- **In scope:** Wire reconstruction into `extensions/agentic-harness/index.ts` on `session_start`.
- **In scope:** Add unit and integration tests proving mixed `plan-compliance → plan-worker → plan-validator` chains become completed after replay.
- **Out of scope:** Persisting custom extension state entries, changing pi core session format, replaying streaming `tool_execution_update` events, modifying team mode, and adding any `thinking_level_select` behavior.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm test -- --run tests/plan-progress-events.test.ts tests/extension.test.ts && npm run build`
- **What it validates:** Session-entry reconstruction logic, extension `session_start` wiring, and TypeScript type safety for the agentic-harness extension.

**Project Capability Discovery:**
- Bundled subagents available: `explorer`, `plan-compliance`, `plan-worker`, `plan-validator`, `worker`.
- Useful skill: `agentic-systematic-debugging` for bug reproduction discipline.
- Highest relevant verification is the agentic-harness Vitest suite plus TypeScript build.

---

## File Structure Mapping

- Modify `extensions/agentic-harness/plan-progress-events.ts`
  - Add session-entry replay helper and small private extractors for assistant tool calls and tool-result messages.
  - Keep it pure and reusable by tests; do not import UI or extension runtime objects.
- Modify `extensions/agentic-harness/tests/plan-progress-events.test.ts`
  - Add regression tests for branch replay: successful mixed subagent chain, failed subagent result, and read/write plan loading from persisted tool call/result pairs.
- Modify `extensions/agentic-harness/index.ts`
  - Call the replay helper inside `session_start` after clearing transient maps and before installing `WorkingVisibilityController` and footer.
- Modify `extensions/agentic-harness/tests/extension.test.ts`
  - Add an integration test that invokes the registered `session_start` handler with a mock `sessionManager.getBranch()` and verifies the footer renders completed progress after reload.

---

## Task 1: Add pure session-entry reconstruction helper

**Dependencies:** None

**Files:**
- Modify: `extensions/agentic-harness/plan-progress-events.ts`
- Test: `extensions/agentic-harness/tests/plan-progress-events.test.ts`

- [ ] **Step 1: Import the new helper in the test file**

In `extensions/agentic-harness/tests/plan-progress-events.test.ts`, update the existing import from `../plan-progress-events.js` to include `reconstructPlanProgressFromSessionEntries`:

```ts
import {
  completePlanSubagentTasks,
  extractPlanPathsFromArgs,
  getToolExecutionArgs,
  loadPlanFromAssistantMessageEnd,
  loadPlanFromToolResultEvent,
  reconstructPlanProgressFromSessionEntries,
  reloadPlanFromSubagentArgs,
  startPlanSubagentTasks,
} from "../plan-progress-events.js";
```

- [ ] **Step 2: Add failing replay tests**

Append this `describe` block before `describe("content-based fallback for non-standard paths", ...)` in `extensions/agentic-harness/tests/plan-progress-events.test.ts`:

```ts
describe("plan progress session-entry reconstruction", () => {
  function messageEntry(message: unknown) {
    return { type: "message", message };
  }

  it("reconstructs a completed task from a mixed compliance-worker-validator subagent chain", async () => {
    const tracker = new PlanProgressTracker();
    const args = {
      chain: [
        { agent: "plan-compliance", task: "check compliance", planFile: PLAN_PATH, planTaskId: 1 },
        { agent: "plan-worker", task: "implement task", planFile: PLAN_PATH, planTaskId: 1 },
        { agent: "plan-validator", task: "validate", planFile: PLAN_PATH, planTaskId: 1 },
      ],
    };

    await reconstructPlanProgressFromSessionEntries(tracker, [
      messageEntry({ role: "assistant", content: [{ type: "text", text: trackingPlan() }] }),
      messageEntry({ role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "subagent", arguments: args }] }),
      messageEntry({ role: "toolResult", toolCallId: "call-1", toolName: "subagent", content: [{ type: "text", text: "PASS" }], isError: false }),
    ], ".");

    expect(tracker.hasPlan()).toBe(true);
    expect(tracker.getProgress()).toMatchObject({ completed: 1, running: 0, pending: 2 });
  });

  it("reconstructs a failed task from an errored subagent tool result", async () => {
    const tracker = new PlanProgressTracker();
    const args = { agent: "plan-worker", task: "Task 2", planTaskId: 2 };

    await reconstructPlanProgressFromSessionEntries(tracker, [
      messageEntry({ role: "assistant", content: [{ type: "text", text: trackingPlan() }] }),
      messageEntry({ role: "assistant", content: [{ type: "toolCall", id: "call-2", name: "subagent", arguments: args }] }),
      messageEntry({ role: "toolResult", toolCallId: "call-2", toolName: "subagent", content: [{ type: "text", text: "FAILED" }], isError: true }),
    ], ".");

    expect(tracker.getProgress()).toMatchObject({ failed: 1, running: 0, pending: 2 });
  });

  it("reconstructs a plan from persisted write tool call arguments", async () => {
    const tracker = new PlanProgressTracker();
    const markdown = samplePlan("Loaded from replayed write");

    await reconstructPlanProgressFromSessionEntries(tracker, [
      messageEntry({
        role: "assistant",
        content: [{ type: "toolCall", id: "write-plan", name: "write", arguments: { path: PLAN_PATH, content: markdown } }],
      }),
      messageEntry({ role: "toolResult", toolCallId: "write-plan", toolName: "write", content: [{ type: "text", text: "Wrote file" }], isError: false }),
    ], ".");

    expect(tracker.hasPlan()).toBe(true);
    expect(tracker.getGoal()).toBe("Loaded from replayed write");
  });
});
```

- [ ] **Step 3: Run the focused test and confirm it fails**

Run:

```bash
cd extensions/agentic-harness
npm test -- --run tests/plan-progress-events.test.ts -t "session-entry reconstruction"
```

Expected: FAIL because `reconstructPlanProgressFromSessionEntries` is not implemented/exported yet.

- [ ] **Step 4: Add the reconstruction helper**

In `extensions/agentic-harness/plan-progress-events.ts`, add these types and functions after `loadPlanFromToolResultEvent(...)` and before `reloadPlanFromSubagentArgs(...)`:

```ts
type SessionMessageEntryLike = {
  type?: unknown;
  message?: unknown;
};

type ToolCallRecord = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

function extractAssistantToolCalls(message: unknown): ToolCallRecord[] {
  if (!message || typeof message !== "object") return [];
  if ((message as { role?: unknown }).role !== "assistant") return [];

  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];

  const calls: ToolCallRecord[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const record = item as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
    if (record.type !== "toolCall") continue;
    if (typeof record.id !== "string" || typeof record.name !== "string") continue;
    if (!record.arguments || typeof record.arguments !== "object") continue;
    calls.push({
      id: record.id,
      name: record.name,
      args: record.arguments as Record<string, unknown>,
    });
  }
  return calls;
}

function getMessageFromEntry(entry: unknown): unknown {
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as SessionMessageEntryLike;
  if (record.type !== "message") return undefined;
  return record.message;
}

export async function reconstructPlanProgressFromSessionEntries(
  tracker: PlanProgressTracker,
  entries: unknown[],
  cwd?: string,
  sessionPlanPaths: Set<string> = new Set<string>(),
): Promise<void> {
  const toolCallArgsById = new Map<string, Record<string, unknown>>();

  for (const entry of entries) {
    const message = getMessageFromEntry(entry);
    if (!message || typeof message !== "object") continue;

    const role = (message as { role?: unknown }).role;

    if (role === "assistant") {
      await loadPlanFromAssistantMessageEnd(tracker, { message }, cwd, sessionPlanPaths);
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
}
```

- [ ] **Step 5: Run the focused replay tests and full plan-progress event tests**

Run:

```bash
cd extensions/agentic-harness
npm test -- --run tests/plan-progress-events.test.ts -t "session-entry reconstruction"
npm test -- --run tests/plan-progress-events.test.ts
```

Expected: PASS. The new replay tests and all existing plan-progress event tests pass.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add extensions/agentic-harness/plan-progress-events.ts extensions/agentic-harness/tests/plan-progress-events.test.ts
git commit -m "feat: reconstruct plan progress from session entries"
```

---

## Task 2: Wire reconstruction into extension session_start

**Dependencies:** Runs after Task 1 completes

**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Test: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Import the replay helper**

In `extensions/agentic-harness/index.ts`, update the existing `./plan-progress-events.js` import to include `reconstructPlanProgressFromSessionEntries`:

```ts
import {
  completePlanSubagentTasks,
  getToolExecutionArgs,
  loadPlanFromAssistantMessageEnd,
  loadPlanFromToolResultEvent,
  reconstructPlanProgressFromSessionEntries,
  reloadPlanFromSubagentArgs,
  startPlanSubagentTasks,
} from "./plan-progress-events.js";
```

- [ ] **Step 2: Reconstruct after clearing transient state in session_start**

In the existing `pi.on("session_start", async (_event, ctx) => { ... })` handler, immediately after this block:

```ts
toolCallArgsById.clear();
planTaskIdsByToolCallId.clear();
sessionPlanPaths.clear();
planProgress.clear();
```

insert:

```ts
const branchEntries = ctx.sessionManager?.getBranch?.() ?? [];
await reconstructPlanProgressFromSessionEntries(
  planProgress,
  branchEntries,
  ctx.cwd,
  sessionPlanPaths,
);
```

This placement ensures:
- previous in-memory state is removed;
- active-branch history is replayed before footer rendering;
- `sessionPlanPaths` is repopulated from historical writes/assistant plan path mentions;
- completed tasks do not start the working-row hider.

- [ ] **Step 3: Add a session_start integration test**

Append this test inside `describe("No Global State File", ...)` in `extensions/agentic-harness/tests/extension.test.ts`, after the existing `session_start must not read any state file...` test:

```ts
it("session_start reconstructs completed plan progress from the active session branch", async () => {
  const { mockPi, events } = createMockPi();
  extension(mockPi);

  const handlers = events.get("session_start");
  expect(handlers?.length).toBeGreaterThan(0);

  const planMarkdown = [
    "# Replay Plan",
    "",
    "**Goal:** Rebuild progress on reload",
    "",
    "---",
    "",
    "### Task 1: Replay mixed chain",
    "",
    "**Dependencies:** None",
    "**Files:**",
    "- Modify: `extensions/agentic-harness/index.ts`",
    "",
    "- [ ] **Step 1: Reconstruct**",
    "",
    "Run: `npm test -- --run tests/extension.test.ts`",
    "Expected: pass",
    "",
  ].join("\n");
  const subagentArgs = {
    chain: [
      { agent: "plan-compliance", task: "check", planTaskId: 1 },
      { agent: "plan-worker", task: "work", planTaskId: 1 },
      { agent: "plan-validator", task: "validate", planTaskId: 1 },
    ],
  };

  let footerFactory: any;
  await handlers![0]({ type: "session_start", reason: "reload" } as any, {
    cwd: ".",
    ui: {
      setHeader: vi.fn(),
      setFooter: (fn: any) => { footerFactory = fn; },
      notify: vi.fn(),
      setWorkingVisible: vi.fn(),
    },
    sessionManager: {
      getBranch: () => [
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: planMarkdown }] } },
        { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "subagent-call", name: "subagent", arguments: subagentArgs }] } },
        { type: "message", message: { role: "toolResult", toolCallId: "subagent-call", toolName: "subagent", content: [{ type: "text", text: "PASS" }], isError: false } },
      ],
    },
    model: { name: "test" },
    getContextUsage: () => undefined,
  } as any);

  expect(footerFactory).toBeTypeOf("function");

  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as any;
  const footerData = { getGitBranch: () => undefined } as any;
  const footer = footerFactory({ requestRender: vi.fn() }, theme, footerData);
  const rendered = footer.render(120).join("\n");

  expect(rendered).toContain("Rebuild progress on reload");
  expect(rendered).toContain("1/1");
  expect(rendered).toContain("✓ Replay mixed chain");
  expect(rendered).not.toContain("running");

  footer.dispose?.();
});
```

- [ ] **Step 4: Run the extension integration test**

Run:

```bash
cd extensions/agentic-harness
npm test -- --run tests/extension.test.ts -t "session_start reconstructs completed plan progress"
```

Expected: PASS. The footer created after `session_start` renders the plan as completed, not running.

- [ ] **Step 5: Run the focused combined tests**

Run:

```bash
cd extensions/agentic-harness
npm test -- --run tests/plan-progress-events.test.ts tests/extension.test.ts
npm run build
```

Expected: PASS. Both tests and TypeScript build pass.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add extensions/agentic-harness/index.ts extensions/agentic-harness/tests/extension.test.ts
git commit -m "fix: rebuild plan progress on session start"
```

---

## Task 3 (Final): End-to-End Verification

**Dependencies:** Runs after Task 1 and Task 2 complete

**Files:** None (read-only verification)

- [ ] **Step 1: Run highest-level verification for this plan**

Run:

```bash
cd extensions/agentic-harness
npm test -- --run tests/plan-progress-events.test.ts tests/extension.test.ts
npm run build
```

Expected: ALL PASS.

- [ ] **Step 2: Verify implementation criteria manually**

Check these criteria:

- [ ] `extensions/agentic-harness/plan-progress-events.ts` exports `reconstructPlanProgressFromSessionEntries`.
- [ ] The helper scans only supplied branch entries and does not read session files directly.
- [ ] The helper reconstructs assistant text plan loading.
- [ ] The helper reconstructs read/write plan loading from persisted tool calls/results.
- [ ] The helper reconstructs successful mixed `plan-compliance → plan-worker → plan-validator` subagent chains as completed.
- [ ] The helper reconstructs errored subagent results as failed.
- [ ] `extensions/agentic-harness/index.ts` calls reconstruction during `session_start` after clearing transient maps/state and before footer setup.
- [ ] No code changes touch `extensions/agentic-harness/team.ts`.
- [ ] No code adds or handles `thinking_level_select`.

- [ ] **Step 3: Run full agentic-harness regression suite**

Run:

```bash
cd extensions/agentic-harness
npm test
npm run build
```

Expected: No regressions — all pre-existing tests still pass.

- [ ] **Step 4: Check diff hygiene**

Run:

```bash
git diff --check
git diff -- extensions/agentic-harness/team.ts
grep -R "thinking_level_select" extensions/agentic-harness || true
```

Expected:
- `git diff --check` has no output.
- `git diff -- extensions/agentic-harness/team.ts` has no output.
- `grep` has no matches.

- [ ] **Step 5: Commit final verification note only if files changed during verification**

If no files changed, do not commit. If documentation or test expectation corrections were required during final verification, commit only those files:

```bash
git add <changed-files>
git commit -m "test: verify plan progress session replay"
```

---

## Self-Review

**Spec coverage:** The plan covers reload/session-start reconstruction using `ctx.sessionManager.getBranch()`, not nonexistent event replay. It covers assistant plan loading, read/write plan loading, successful subagent completion, failed subagent completion, wiring, and footer-observable behavior.

**Placeholder scan:** No unresolved placeholder markers are present. Every task has exact files, code snippets, commands, and expected results.

**Type consistency:** The planned helper uses `PlanProgressTracker`, `Record<string, unknown>`, `unknown[]`, and existing exported helper names consistently. Tool call content uses the documented persisted shape `{ type: "toolCall", id, name, arguments }`.

**Dependency verification:** Task 1 modifies `plan-progress-events.ts` and its tests. Task 2 depends on Task 1 because it imports the new helper and modifies `index.ts` plus `extension.test.ts`. No parallel file conflicts are present.

**Verification coverage:** The final task runs focused tests, full agentic-harness tests, TypeScript build, diff hygiene checks, and excluded-scope checks.
