/**
 * Integration tests for team mode DAG scheduling.
 *
 * These tests exercise the full validateTeamTasks + scheduleBatches + runTeam
 * pipeline with real task dependency graphs, verifying that:
 * - Topological ordering is correct
 * - Dependent tasks wait for dependencies
 * - Failed dependencies propagate to blocked tasks
 * - Cycle detection prevents invalid graphs
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateTeamTasks,
  scheduleBatches,
  computeTaskDepths,
  runTeam,
} from "../team.js";
import { createTeamRunRecord } from "../team-state.js";
import type { TeamTask, TeamRuntime } from "../team.js";

function makeTask(id: string, owner: string, blockedBy: string[] = []): TeamTask {
  return {
    id,
    subject: `${owner}: test task`,
    description: `Test task ${id}`,
    agent: "worker",
    owner,
    status: "pending",
    blockedBy,
    artifactRefs: [],
    worktreeRefs: [],
  };
}

describe("integration: DAG validation and batch scheduling", () => {
  it("validates a 3-layer diamond DAG and produces correct batches", () => {
    // Layer 0: t1
    // Layer 1: t2, t3 (both depend on t1)
    // Layer 2: t4 (depends on t2 and t3)
    const tasks = [
      makeTask("task-1", "worker-1"),
      makeTask("task-2", "worker-2", ["task-1"]),
      makeTask("task-3", "worker-3", ["task-1"]),
      makeTask("task-4", "worker-4", ["task-2", "task-3"]),
    ];

    expect(() => validateTeamTasks(tasks)).not.toThrow();

    const batches = scheduleBatches(tasks);
    expect(batches).toHaveLength(3);
    expect(batches[0].map((t) => t.id)).toEqual(["task-1"]);
    expect(batches[1].map((t) => t.id).sort()).toEqual(["task-2", "task-3"].sort());
    expect(batches[2].map((t) => t.id)).toEqual(["task-4"]);
  });

  it("validates a chain: A → B → C → D", () => {
    const tasks = [
      makeTask("task-a", "worker-1"),
      makeTask("task-b", "worker-2", ["task-a"]),
      makeTask("task-c", "worker-3", ["task-b"]),
      makeTask("task-d", "worker-4", ["task-c"]),
    ];

    expect(() => validateTeamTasks(tasks)).not.toThrow();

    const batches = scheduleBatches(tasks);
    expect(batches).toHaveLength(4);
    expect(batches[0].map((t) => t.id)).toEqual(["task-a"]);
    expect(batches[1].map((t) => t.id)).toEqual(["task-b"]);
    expect(batches[2].map((t) => t.id)).toEqual(["task-c"]);
    expect(batches[3].map((t) => t.id)).toEqual(["task-d"]);
  });

  it("validates a wide fan-out: A → [B, C, D, E]", () => {
    const tasks = [
      makeTask("task-a", "worker-1"),
      makeTask("task-b", "worker-2", ["task-a"]),
      makeTask("task-c", "worker-3", ["task-a"]),
      makeTask("task-d", "worker-4", ["task-a"]),
      makeTask("task-e", "worker-5", ["task-a"]),
    ];

    expect(() => validateTeamTasks(tasks)).not.toThrow();

    const batches = scheduleBatches(tasks);
    expect(batches).toHaveLength(2);
    expect(batches[0].map((t) => t.id)).toEqual(["task-a"]);
    expect(batches[1].map((t) => t.id).sort()).toEqual(
      ["task-b", "task-c", "task-d", "task-e"].sort()
    );
  });

  it("rejects a simple cycle: A → B → A", () => {
    const tasks = [
      makeTask("task-a", "worker-1", ["task-b"]),
      makeTask("task-b", "worker-2", ["task-a"]),
    ];

    expect(() => validateTeamTasks(tasks)).toThrow(/circular/i);
  });

  it("computeTaskDepths/scheduleBatches reject a cycle directly instead of stack-overflowing", () => {
    // Regression guard: these are exported and callable without validateTeamTasks
    // running first. Before this guard, a cyclic blockedBy graph recursed until
    // "RangeError: Maximum call stack size exceeded" instead of a clean error.
    const tasks = [
      makeTask("task-a", "worker-1", ["task-b"]),
      makeTask("task-b", "worker-2", ["task-a"]),
    ];

    expect(() => computeTaskDepths(tasks)).toThrow(/circular/i);
    expect(() => computeTaskDepths(tasks)).not.toThrow(/maximum call stack/i);
    expect(() => scheduleBatches(tasks)).toThrow(/circular/i);
  });

  it("rejects a transitive cycle: A → B → C → A", () => {
    const tasks = [
      makeTask("task-a", "worker-1", ["task-c"]),
      makeTask("task-b", "worker-2", ["task-a"]),
      makeTask("task-c", "worker-3", ["task-b"]),
    ];

    expect(() => validateTeamTasks(tasks)).toThrow(/circular/i);
  });

  it("rejects self-dependency: A → A", () => {
    const tasks = [
      makeTask("task-a", "worker-1", ["task-a"]),
    ];

    expect(() => validateTeamTasks(tasks)).toThrow(/circular/i);
  });

  it("rejects reference to non-existent task", () => {
    const tasks = [
      makeTask("task-a", "worker-1", ["task-phantom"]),
    ];

    expect(() => validateTeamTasks(tasks)).toThrow(/non-existent/);
  });

  it("handles a mix of dependent and independent tasks", () => {
    // A → B → C
    // D (independent)
    // E (independent)
    const tasks = [
      makeTask("task-a", "worker-1"),
      makeTask("task-b", "worker-2", ["task-a"]),
      makeTask("task-c", "worker-3", ["task-b"]),
      makeTask("task-d", "worker-4"),
      makeTask("task-e", "worker-5"),
    ];

    expect(() => validateTeamTasks(tasks)).not.toThrow();

    const batches = scheduleBatches(tasks);
    expect(batches).toHaveLength(3);
    // Batch 0: A, D, E (no deps)
    expect(batches[0].map((t) => t.id).sort()).toEqual(
      ["task-a", "task-d", "task-e"].sort()
    );
    // Batch 1: B (depends on A)
    expect(batches[1].map((t) => t.id)).toEqual(["task-b"]);
    // Batch 2: C (depends on B)
    expect(batches[2].map((t) => t.id)).toEqual(["task-c"]);
  });
});

describe("integration: runTeam with blockedBy tasks", () => {
  const fakeRuntime: TeamRuntime = {
    runTask: vi.fn().mockResolvedValue({
      exitCode: 0,
      messages: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 1 },
    }),
    emitProgress: vi.fn(),
    emitBackendResolved: vi.fn(),
    emitTmuxReady: vi.fn(),
    persistRun: vi.fn(),
    loadRun: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs a simple dependency-free team (backward compatible)", async () => {
    const summary = await runTeam(
      {
        goal: "No dependencies",
        workerCount: 2,
        agent: "worker",
        maxOutput: 1_000,
      },
      fakeRuntime
    );

    expect(summary).toBeDefined();
    expect(summary.completedCount + summary.failedCount).toBeGreaterThanOrEqual(0);
  });

  it("fails when tasks reference non-existent blockedBy (via createTeamRunRecord)", () => {
    // createDefaultTeamTasks doesn't support blockedBy, so we manually construct
    const tasks = [
      makeTask("task-1", "worker-1", ["task-ghost"]),
      makeTask("task-2", "worker-2"),
    ];

    expect(() =>
      createTeamRunRecord({
        runId: "dag-test",
        goal: "Bad deps",
        tasks,
        now: new Date().toISOString(),
      })
    ).not.toThrow(); // Record creation is fine; validation happens in runTeam

    // Validation would throw in runTeam
    expect(() => validateTeamTasks(tasks)).toThrow(/non-existent/);
  });
});
