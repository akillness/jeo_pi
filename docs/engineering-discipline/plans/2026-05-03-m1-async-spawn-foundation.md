# Plan: M1 — Async Spawn Foundation

**Goal:** Prove that `runAgent()` can execute asynchronously by spawning a background process and returning a runId immediately, with a process registry to track it.

**Scope:**
- In: Async fire-and-forget spawn, process registry, type formalization
- Out: Status/interrupt (M2), notification (M3), tool schema integration (M4)

**Verification:** `npm test && npm run build`

---

## Task 0: Spike — Extension API Early Return

**Goal:** Verify that `registerTool.execute` can return a value before the child process exits.

**Steps:**
1. Read `extensions/agentic-harness/index.ts` to find how `registerTool` works
2. Create a minimal test: in the execute handler, `setTimeout(() => { /* child process work */ }, 5000)` and return immediately
3. Verify the tool returns the immediate value and the timeout continues in background
4. Document findings. If spike fails → STOP. Report to user.

**Success:** Tool returns before background work completes.
**Files:** None (read-only spike)

---

## Task 1: Define Types in `types.ts`

**Goal:** Add `ToolActivity`, `RunProgress`, `AsyncRunRecord` types and formalize `lastActivity` on `SingleResult`.

**Changes to `extensions/agentic-harness/types.ts`:**

```typescript
// After UsageStats interface (line 11), add:

export interface ToolActivity {
  name: string;
  args: Record<string, unknown>;
  timestamp: number;
}

export type AsyncRunStatus = "spawning" | "running" | "completed" | "failed" | "interrupted";

export interface RunProgress {
  lastActivity?: ToolActivity;
  usage: UsageStats;
  elapsedMs: number;
  startedAt: number;
}

export interface AsyncRunRecord {
  schemaVersion: 1;
  runId: string;
  agent: string;
  task: string;
  status: AsyncRunStatus;
  pid?: number;
  progress: RunProgress;
  result?: SingleResult;
  createdAt: string;
  updatedAt: string;
  backend: "native" | "tmux";
}
```

**In `SingleResult` interface (line 50), add:**
```typescript
lastActivity?: ToolActivity;
asyncRunId?: string;
```

**Success:** Types compile, no existing code breaks (all new fields are optional).
**Files:** `extensions/agentic-harness/types.ts`

---

## Task 2: Formalize `lastActivity` in `runner-events.ts`

**Goal:** Make the existing dynamic `result.lastActivity` assignment type-safe.

**Changes to `extensions/agentic-harness/runner-events.ts`:**

1. Import `ToolActivity` from `./types.js`
2. In `processPiEvent()` (line ~151), the existing code already sets `result.lastActivity`. With the type added in Task 1, this becomes type-safe automatically. No logic changes needed.

**Success:** `result.lastActivity = { name, args, timestamp }` compiles without `any` cast.
**Files:** `extensions/agentic-harness/runner-events.ts`

---

## Task 3: Create `async-registry.ts` — RunRegistry

**Goal:** Build the in-memory process registry that tracks async runs.

**New file `extensions/agentic-harness/async-registry.ts`:**

```typescript
import { randomBytes } from "crypto";
import type { AsyncRunRecord, AsyncRunStatus, RunProgress, SingleResult, UsageStats } from "./types.js";

export type RunRegistryListener = (runId: string, record: AsyncRunRecord) => void;

interface RunEntry {
  record: AsyncRunRecord;
  abortController?: AbortController;
  listeners: Set<RunRegistryListener>;
}

export class RunRegistry {
  private runs = new Map<string, RunEntry>();
  private globalListeners = new Set<RunRegistryListener>();

  /** Register a new async run. Returns runId. */
  register(agent: string, task: string, backend: "native" | "tmux", abortController?: AbortController): string {
    const runId = randomBytes(8).toString("hex");
    const now = new Date().toISOString();
    const record: AsyncRunRecord = {
      schemaVersion: 1,
      runId,
      agent,
      task,
      status: "spawning",
      progress: { usage: emptyUsage(), elapsedMs: 0, startedAt: Date.now() },
      createdAt: now,
      updatedAt: now,
      backend,
    };
    this.runs.set(runId, { record, abortController, listeners: new Set() });
    this.notify(runId, record);
    return runId;
  }

  /** Update run status and progress. */
  update(runId: string, patch: Partial<Pick<AsyncRunRecord, "status" | "pid">> & { progress?: Partial<RunProgress>; result?: SingleResult }): void {
    const entry = this.runs.get(runId);
    if (!entry) return;
    const now = new Date().toISOString();
    if (patch.status) entry.record.status = patch.status;
    if (patch.pid !== undefined) entry.record.pid = patch.pid;
    if (patch.progress) {
      entry.record.progress = { ...entry.record.progress, ...patch.progress };
    }
    if (patch.result) entry.record.result = patch.result;
    entry.record.updatedAt = now;
    // Update elapsed
    entry.record.progress.elapsedMs = Date.now() - entry.record.progress.startedAt;
    this.notify(runId, entry.record);
  }

  /** Mark run as terminal (completed/failed/interrupted) with final result. */
  complete(runId: string, status: "completed" | "failed" | "interrupted", result?: SingleResult): void {
    this.update(runId, { status, result });
    // Cleanup: remove from active runs after a delay to allow status queries
    setTimeout(() => this.runs.delete(runId), 60_000).unref?.();
  }

  /** Get single run status. */
  getStatus(runId: string): AsyncRunRecord | undefined {
    return this.runs.get(runId)?.record;
  }

  /** List all active runs. */
  listActive(): AsyncRunRecord[] {
    return Array.from(this.runs.values()).map(e => e.record);
  }

  /** Abort a running process. */
  abort(runId: string): boolean {
    const entry = this.runs.get(runId);
    if (!entry?.abortController) return false;
    entry.abortController.abort();
    return true;
  }

  /** Subscribe to all run updates. Returns unsubscribe function. */
  subscribe(listener: RunRegistryListener): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  private notify(runId: string, record: AsyncRunRecord): void {
    for (const listener of this.globalListeners) {
      try { listener(runId, record); } catch { /* ignore */ }
    }
    const entry = this.runs.get(runId);
    if (entry) {
      for (const listener of entry.listeners) {
        try { listener(runId, record); } catch { /* ignore */ }
      }
    }
  }
}

function emptyUsage(): UsageStats {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

/** Singleton registry for the current process. */
let defaultRegistry: RunRegistry | undefined;
export function getDefaultRegistry(): RunRegistry {
  if (!defaultRegistry) defaultRegistry = new RunRegistry();
  return defaultRegistry;
}
```

**Success:** RunRegistry compiles, `register`/`update`/`complete`/`getStatus`/`listActive`/`abort`/`subscribe` work.
**Files:** `extensions/agentic-harness/async-registry.ts` (new)

---

## Task 4: Create `spawnAsync()` Wrapper in `subagent.ts`

**Goal:** Add a fire-and-forget wrapper that starts `runAgent()` in the background and returns immediately.

**Changes to `extensions/agentic-harness/subagent.ts`:**

1. Import `getDefaultRegistry` from `./async-registry.js`
2. Add new function after `runAgent()`:

```typescript
export interface SpawnAsyncResult {
  runId: string;
  status: "spawning" | "running";
}

export async function spawnAsync(
  opts: RunAgentOptions,
  registry = getDefaultRegistry(),
): Promise<SpawnAsyncResult> {
  const abortController = new AbortController();
  const runId = registry.register(
    opts.agentName,
    opts.task,
    opts.executionMode === "tmux" ? "tmux" : "native",
    abortController,
  );

  // Fire-and-forget: start runAgent() without awaiting
  Promise.resolve().then(async () => {
    // Merge abort signal
    const mergedOpts: RunAgentOptions = {
      ...opts,
      signal: abortController.signal,
      onLifecycleEvent: (event) => {
        if (event.type === "spawn") {
          registry.update(runId, { pid: event.pid, status: "running" });
        }
        opts.onLifecycleEvent?.(event);
      },
      onUpdate: (partial) => {
        // Update registry progress from partial results
        const r = partial.details?.results?.[0];
        if (r) {
          registry.update(runId, {
            progress: {
              lastActivity: r.lastActivity,
              usage: r.usage,
            },
          });
        }
        opts.onUpdate?.(partial);
      },
    };

    try {
      const result = await runAgent(mergedOpts);
      registry.complete(runId, result.exitCode === 0 ? "completed" : "failed", result);
    } catch (err) {
      registry.complete(runId, "failed");
    }
  });

  return { runId, status: "spawning" };
}
```

3. Add `pid` to `RunLifecycleEvent` if not already present (check the type definition).

**Key design:** `runAgent()` is NOT modified. The wrapper uses `Promise.resolve().then()` to detach execution. The `onLifecycleEvent` callback captures the PID when spawn happens. The `onUpdate` callback feeds progress to the registry.

**Success:** `spawnAsync()` returns within 2 seconds with a runId. Background `runAgent()` continues and completes.
**Files:** `extensions/agentic-harness/subagent.ts`

---

## Task 5: Wire `async: true` in `index.ts` Execute Handler

**Goal:** Add `async` parameter to `SubagentParams` and route to `spawnAsync()` when set.

**Changes to `extensions/agentic-harness/index.ts`:**

1. Add to `SubagentParams` TypeBox schema:
```typescript
async: Type.Optional(Type.Boolean({ description: "Execute in background, return runId immediately" })),
```

2. Import `spawnAsync` from `./subagent.js` and `getDefaultRegistry` from `./async-registry.js`

3. In the single-mode execute path, before the existing `runAgent()` call, add:
```typescript
if (params.async) {
  const { runId } = await spawnAsync({
    agent: singleAgent,
    agentName: agent,
    task: effectiveTask,
    cwd: cwd || defaultCwd,
    depthConfig,
    sandbox: sandboxFor(cwd || defaultCwd),
    makeDetails: makeDetails("single"),
    maxOutput,
    output,
    reads,
    progress,
    contextMode: context,
  });
  return {
    content: [{ type: "text" as const, text: `Async run started: ${runId}` }],
    details: makeDetails("single")([{
      agent,
      agentSource: singleAgent?.source ?? "unknown",
      task: effectiveTask,
      exitCode: 0,
      messages: [],
      stderr: "",
      usage: emptyUsage(),
      asyncRunId: runId,
    }]),
  };
}
```

4. Validate: `async: true` only works with single-mode (`agent` + `task`). Return error if combined with `tasks` or `chain`.

**Success:** `{ agent: "reviewer", task: "...", async: true }` returns runId immediately. Existing calls without `async` work unchanged.
**Files:** `extensions/agentic-harness/index.ts`

---

## Task 6: Tests

**Goal:** Verify async spawn end-to-end.

**Test cases in `tests/subagent.test.ts` or new `tests/async-registry.test.ts`:**

1. **RunRegistry unit tests:**
   - `register()` creates entry with status "spawning"
   - `update()` changes status and progress
   - `complete()` sets terminal status
   - `getStatus()` returns correct record
   - `listActive()` returns all non-completed runs
   - `subscribe()` receives notifications
   - `abort()` triggers AbortController

2. **spawnAsync() integration test:**
   - Returns `{ runId, status: "spawning" }` within 2 seconds
   - Background process completes and registry shows "completed"
   - Existing blocking `runAgent()` still works (regression)

3. **Tool schema test:**
   - `{ async: true }` triggers async path
   - `{ async: true, tasks: [...] }` returns error
   - `{}` (no async) uses blocking path

**Success:** All tests pass. `npm test` green.
**Files:** `tests/async-registry.test.ts` (new), `tests/subagent.test.ts` (modify)

---

## Task 7: Build Verification

**Goal:** Confirm the full build passes with all changes.

**Steps:**
1. `npm run build` — TypeScript compilation succeeds
2. `npm test` — all existing + new tests pass
3. Manual verification: `{ async: true }` returns runId, background completes

**Success:** Clean build + green tests.
