import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PARALLEL_TASKS } from "../subagent.js";
import type { TmuxAvailability } from "../tmux.js";
import { emptyUsage, type SingleResult } from "../types.js";
const tmuxMock = vi.hoisted(() => ({
  detectTmux: vi.fn(async (): Promise<TmuxAvailability> => ({ available: false })),
  createWorkerPanes: vi.fn(),
  killTmuxSession: vi.fn(async () => undefined),
  killTmuxPane: vi.fn(async () => undefined),
}));

vi.mock("../tmux.js", () => tmuxMock);

import {
  buildTeamWorkerPrompt,
  createDefaultTeamTasks,
  formatTeamRunSummary,
  runTeam,
  cleanupActiveTeamTmuxResources,
  resolveTeamWorktreePolicy,
  synthesizeTeamRun,
  validateTeamTasks,
  scheduleBatches,
} from "../team.js";

afterEach(async () => {
  // Drain any tmux resources a test deliberately left retained (e.g. a
  // failed-run session kept alive for inspection) so module-level state in
  // team.ts never leaks across test cases.
  await cleanupActiveTeamTmuxResources();
  tmuxMock.detectTmux.mockReset().mockResolvedValue({ available: false });
  tmuxMock.createWorkerPanes.mockReset();
  tmuxMock.killTmuxSession.mockReset().mockResolvedValue(undefined);
  tmuxMock.killTmuxPane.mockReset().mockResolvedValue(undefined);
});


function fakeResult(agent: string, task: string, text: string, overrides: Partial<SingleResult> = {}): SingleResult {
  return {
    agent,
    agentSource: "bundled",
    task,
    exitCode: 0,
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text }],
      },
    ],
    stderr: "",
    usage: emptyUsage(),
    stopReason: "stop",
    ...overrides,
  };
}

describe("createDefaultTeamTasks", () => {
  it("creates stable dependency-free task records assigned to the selected agent", () => {
    const tasks = createDefaultTeamTasks("Add lightweight team mode", 3, "worker");

    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => task.id)).toEqual(["task-1", "task-2", "task-3"]);
    expect(tasks.map((task) => task.owner)).toEqual(["worker-1", "worker-2", "worker-3"]);
    expect(tasks.every((task) => task.agent === "worker")).toBe(true);
    expect(tasks.every((task) => task.status === "pending")).toBe(true);
    expect(tasks.every((task) => task.blockedBy.length === 0)).toBe(true);
  });

  it("clamps worker count to MAX_PARALLEL_TASKS", () => {
    const tasks = createDefaultTeamTasks("Large coordinated change", MAX_PARALLEL_TASKS + 5, "worker");

    expect(tasks).toHaveLength(MAX_PARALLEL_TASKS);
    expect(tasks.at(-1)?.id).toBe(`task-${MAX_PARALLEL_TASKS}`);
    expect(tasks.at(-1)?.owner).toBe(`worker-${MAX_PARALLEL_TASKS}`);
  });
});

describe("buildTeamWorkerPrompt", () => {
  it("codifies worker non-orchestration and reporting requirements", () => {
    const [task] = createDefaultTeamTasks("Implement native team mode", 1, "worker");
    const prompt = buildTeamWorkerPrompt(task, { goal: "Implement native team mode", workerCount: 1, agent: "worker" });

    expect(prompt).toContain("not the leader");
    expect(prompt).toContain("Do not spawn subagents");
    expect(prompt).toContain("team/ultrawork/autopilot/ralph");
    expect(prompt).toContain("changed files");
    expect(prompt).toContain("verification");
    expect(prompt).toContain("blockers");
  });
});

describe("validateTeamTasks", () => {
  it("rejects blockedBy reference to non-existent task", () => {
    const [task] = createDefaultTeamTasks("Goal", 1, "worker");
    const invalid = [{ ...task, blockedBy: ["nonexistent-task"] }];

    expect(() => validateTeamTasks(invalid)).toThrow(/non-existent/);
  });

  it("rejects circular dependencies", () => {
    const [t1, t2] = createDefaultTeamTasks("Goal", 2, "worker");
    const cyclic = [
      { ...t1, blockedBy: [t2.id] },
      { ...t2, blockedBy: [t1.id] },
    ];

    expect(() => validateTeamTasks(cyclic)).toThrow(/circular/i);
  });

  it("accepts valid blockedBy references", () => {
    const [t1, t2] = createDefaultTeamTasks("Goal", 2, "worker");
    const valid = [
      { ...t1, blockedBy: [] },
      { ...t2, blockedBy: [t1.id] },
    ];

    expect(() => validateTeamTasks(valid)).not.toThrow();
  });

  it("accepts empty blockedBy (backward compatible)", () => {
    const tasks = createDefaultTeamTasks("Goal", 3, "worker");

    expect(() => validateTeamTasks(tasks)).not.toThrow();
  });
});

describe("scheduleBatches", () => {
  it("returns single batch when no dependencies", () => {
    const tasks = createDefaultTeamTasks("Goal", 3, "worker");
    const batches = scheduleBatches(tasks);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it("schedules dependent tasks in separate batches", () => {
    const [t1, t2, t3] = createDefaultTeamTasks("Goal", 3, "worker");
    t3.blockedBy = [t1.id, t2.id];
    const batches = scheduleBatches([t1, t2, t3]);
    expect(batches).toHaveLength(2);
    expect(batches[0].map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());
    expect(batches[1].map((t) => t.id)).toEqual([t3.id]);
  });

  it("handles diamond dependency", () => {
    const [t1, t2, t3, t4] = createDefaultTeamTasks("Goal", 4, "worker");
    // Diamond: 1 → [2,3] → 4
    t2.blockedBy = [t1.id];
    t3.blockedBy = [t1.id];
    t4.blockedBy = [t2.id, t3.id];
    const batches = scheduleBatches([t1, t2, t3, t4]);
    expect(batches).toHaveLength(3);
    expect(batches[0].map((t) => t.id)).toEqual([t1.id]);
    expect(batches[1].map((t) => t.id).sort()).toEqual([t2.id, t3.id].sort());
    expect(batches[2].map((t) => t.id)).toEqual([t4.id]);
  });
});

describe("runTeam", () => {
  it("dispatches fake workers and returns successful synthesis with evidence", async () => {
    const calls: Array<{ taskId: string; prompt: string; extraEnv?: Record<string, string> }> = [];

    const summary = await runTeam(
      { goal: "Ship lightweight native team mode", workerCount: 2, agent: "worker", maxOutput: 1_000 },
      {
        runTask: async ({ task, prompt, extraEnv }) => {
          calls.push({ taskId: task.id, prompt, extraEnv });
          return fakeResult(task.agent, prompt, `${task.id} done`, {
            artifacts: { outputFile: `.pi/team/${task.id}.md` },
            worktree: { worktreePath: `/tmp/${task.id}`, worktreeDiffFile: `.pi/team/${task.id}.diff` },
          });
        },
      },
    );

    expect(calls.map((call) => call.taskId)).toEqual(["task-1", "task-2"]);
    expect(calls.every((call) => call.extraEnv?.PI_TEAM_WORKER === "1")).toBe(true);
    expect(summary.ok).toBe(true);
    expect(summary.backendRequested).toBe("auto");
    expect(summary.backendUsed).toBe("native");
    expect(summary.tasks[0].terminal).toMatchObject({
      backend: "native",
    });
    expect(summary.completedCount).toBe(2);
    expect(summary.failedCount).toBe(0);
    expect(summary.tasks.map((task) => task.status)).toEqual(["completed", "completed"]);
    expect(summary.finalSynthesis).toContain("task-1 done");
    expect(summary.finalSynthesis).toContain("task-2 done");
    expect(summary.verificationEvidence.checksRun.length).toBeGreaterThan(0);
    expect(summary.verificationEvidence.passed).toBe(true);
    expect(summary.verificationEvidence.failed).toBe(false);
    expect(summary.verificationEvidence.artifactRefs).toEqual([".pi/team/task-1.md", ".pi/team/task-2.md"]);
    expect(summary.verificationEvidence.worktreeRefs).toEqual(["/tmp/task-1", "/tmp/task-2"]);
  });

  it("uses tmux automatically when available and includes attach metadata in summaries", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    tmuxMock.createWorkerPanes.mockResolvedValue([
      {
        sessionName: "pi-team-run-1",
        windowName: "workers",
        paneId: "%1",
        attachCommand: "tmux attach -t pi-team-run-1",
        logFile: "/tmp/team-run-1/task-1.log",
        eventLogFile: "/tmp/team-run-1/task-1.events.jsonl",
      },
      {
        sessionName: "pi-team-run-1",
        windowName: "workers",
        paneId: "%2",
        attachCommand: "tmux attach -t pi-team-run-1",
        logFile: "/tmp/team-run-1/task-2.log",
        eventLogFile: "/tmp/team-run-1/task-2.events.jsonl",
      },
    ]);

    const summary = await runTeam(
      { goal: "Run tmux workers", workerCount: 2, agent: "worker", runId: "team-run-1" },
      {
        runTask: async ({ task, prompt }) => fakeResult(task.agent, prompt, `${task.id} done`, { terminal: task.terminal }),
      },
    );

    expect(summary.backendRequested).toBe("auto");
    expect(summary.backendUsed).toBe("tmux");
    expect(summary.tasks.every((task) => task.terminal?.backend === "tmux")).toBe(true);
    expect(summary.tasks[0].terminal).toMatchObject({
      sessionName: "pi-team-run-1",
      paneId: "%1",
      attachCommand: "tmux attach -t pi-team-run-1",
    });
    expect(summary.finalSynthesis).toContain("tmux attach -t");
    expect(summary.success).toBe(true);
  });

  it("propagates detected tmux binary metadata to panes, workers, and cleanup", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/opt/custom/tmux" });
    tmuxMock.createWorkerPanes.mockResolvedValue([
      {
        sessionName: "pi-custom-binary",
        windowName: "workers",
        paneId: "%1",
        attachCommand: "tmux attach -t pi-custom-binary",
        logFile: "/tmp/custom-binary/task-1.log",
        eventLogFile: "/tmp/custom-binary/task-1.events.jsonl",
      },
    ]);
    const terminals: any[] = [];

    const summary = await runTeam(
      { goal: "Use custom tmux", workerCount: 1, agent: "worker", runId: "custom-binary" },
      {
        runTask: async ({ task, prompt }) => {
          terminals.push(task.terminal);
          return fakeResult(task.agent, prompt, "custom tmux done", { terminal: task.terminal });
        },
      },
    );

    expect(summary.success).toBe(true);
    expect(tmuxMock.createWorkerPanes).toHaveBeenCalledWith(expect.objectContaining({ binary: "/opt/custom/tmux" }));
    expect(terminals[0]).toMatchObject({ backend: "tmux", tmuxBinary: "/opt/custom/tmux" });
    expect(tmuxMock.killTmuxSession).toHaveBeenCalledWith("pi-custom-binary", undefined, "/opt/custom/tmux");
  });

  it("converts tmux pane setup failures into persisted failed summaries", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/opt/custom/tmux" });
    tmuxMock.createWorkerPanes.mockRejectedValue(new Error("tmux setup exploded"));
    const records: any[] = [];

    const summary = await runTeam(
      { goal: "Fail setup cleanly", workerCount: 2, agent: "worker", runId: "setup-failure" },
      {
        now: (() => {
          let tick = 0;
          return () => `2026-04-27T00:10:0${tick++}.000Z`;
        })(),
        persistRun: (record) => {
          records.push(JSON.parse(JSON.stringify(record)));
        },
        runTask: async () => {
          throw new Error("workers must not run after tmux setup failure");
        },
      },
    );

    const finalRecord = records.at(-1);
    expect(summary.success).toBe(false);
    expect(summary.failedCount).toBe(2);
    expect(summary.tasks.map((task) => task.status)).toEqual(["failed", "failed"]);
    expect(summary.tasks.every((task) => task.errorMessage === "tmux setup exploded")).toBe(true);
    expect(finalRecord.status).toBe("failed");
    expect(finalRecord.summary.success).toBe(false);
    expect(finalRecord.events.filter((event: any) => event.type === "task_failed")).toHaveLength(2);
    expect(finalRecord.events.at(-1).type).toBe("run_failed");
  });

  it("cleans up partial detached tmux session when pane setup partially fails", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    tmuxMock.createWorkerPanes.mockRejectedValue(Object.assign(new Error("pane setup failed"), {
      partialPanes: [
        {
          sessionName: "pi-partial-detached",
          windowName: "workers",
          paneId: "%31",
          attachCommand: "tmux attach -t pi-partial-detached",
          logFile: "/tmp/partial-detached/task-1.log",
          eventLogFile: "/tmp/partial-detached/task-1.events.jsonl",
          placement: "detached-session",
        },
      ],
    }));
    const runTask = vi.fn(async () => fakeResult("worker", "prompt", "should not run"));

    const summary = await runTeam(
      { goal: "Clean partial detached setup", workerCount: 2, agent: "worker", runId: "partial-detached" },
      { runTask },
    );

    expect(summary.success).toBe(false);
    expect(summary.tasks.map((task) => task.status)).toEqual(["failed", "failed"]);
    expect(runTask).not.toHaveBeenCalled();
    expect(tmuxMock.killTmuxSession).toHaveBeenCalledWith("pi-partial-detached", undefined, "/usr/bin/tmux");
    expect(tmuxMock.killTmuxPane).not.toHaveBeenCalled();
  });

  it("cleans up partial current-window tmux panes when pane setup partially fails", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    tmuxMock.createWorkerPanes.mockRejectedValue(Object.assign(new Error("pane setup failed"), {
      partialPanes: [
        {
          sessionName: "dev-session",
          windowName: "main",
          paneId: "%41",
          attachCommand: "tmux attach -t dev-session",
          logFile: "/tmp/partial-current/task-1.log",
          eventLogFile: "/tmp/partial-current/task-1.events.jsonl",
          placement: "current-window",
        },
        {
          sessionName: "dev-session",
          windowName: "main",
          paneId: "%42",
          attachCommand: "tmux attach -t dev-session",
          logFile: "/tmp/partial-current/task-2.log",
          eventLogFile: "/tmp/partial-current/task-2.events.jsonl",
          placement: "current-window",
        },
      ],
    }));
    const runTask = vi.fn(async () => fakeResult("worker", "prompt", "should not run"));

    const summary = await runTeam(
      { goal: "Clean partial current-window setup", workerCount: 2, agent: "worker", runId: "partial-current" },
      { runTask },
    );

    expect(summary.success).toBe(false);
    expect(summary.tasks.map((task) => task.status)).toEqual(["failed", "failed"]);
    expect(runTask).not.toHaveBeenCalled();
    expect(tmuxMock.killTmuxPane).toHaveBeenCalledTimes(2);
    expect(tmuxMock.killTmuxPane).toHaveBeenNthCalledWith(1, "%41", undefined, "/usr/bin/tmux");
    expect(tmuxMock.killTmuxPane).toHaveBeenNthCalledWith(2, "%42", undefined, "/usr/bin/tmux");
    expect(tmuxMock.killTmuxSession).not.toHaveBeenCalled();
  });

  it("falls back to native when tmux is unavailable in auto mode", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: false });

    const summary = await runTeam(
      { goal: "Fallback workers", workerCount: 1, agent: "worker" },
      {
        runTask: async ({ task, prompt }) => fakeResult(task.agent, prompt, "fallback done", { terminal: task.terminal }),
      },
    );

    expect(summary.backendRequested).toBe("auto");
    expect(summary.backendUsed).toBe("native");
    expect(summary.tasks[0].terminal).toMatchObject({ backend: "native" });
    expect(summary.success).toBe(true);
    expect(summary.finalSynthesis).toContain("fallback done");
  });

  it("emits backend resolved + tmux ready callbacks once with attach metadata when tmux runs", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    tmuxMock.createWorkerPanes.mockResolvedValue([
      {
        sessionName: "pi-team-observability",
        windowName: "workers",
        paneId: "%1",
        attachCommand: "tmux attach -t pi-team-observability",
        logFile: "/tmp/team-observability/task-1.log",
        eventLogFile: "/tmp/team-observability/task-1.events.jsonl",
      },
      {
        sessionName: "pi-team-observability",
        windowName: "workers",
        paneId: "%2",
        attachCommand: "tmux attach -t pi-team-observability",
        logFile: "/tmp/team-observability/task-2.log",
        eventLogFile: "/tmp/team-observability/task-2.events.jsonl",
      },
    ]);
    const backendCalls: any[] = [];
    const tmuxCalls: any[] = [];

    const summary = await runTeam(
      { goal: "Observe tmux lifecycle", workerCount: 2, agent: "worker", runId: "team-observability" },
      {
        runTask: async ({ task, prompt }) => fakeResult(task.agent, prompt, `${task.id} done`, { terminal: task.terminal }),
        emitBackendResolved: (info) => backendCalls.push(info),
        emitTmuxReady: (info) => tmuxCalls.push(info),
      },
    );

    expect(summary.success).toBe(true);
    expect(backendCalls).toHaveLength(1);
    expect(backendCalls[0]).toEqual({ requested: "auto", used: "tmux", tmuxAvailable: true });
    expect(tmuxCalls).toHaveLength(1);
    expect(tmuxCalls[0]).toMatchObject({
      sessionName: "pi-team-observability",
      attachCommand: "tmux attach -t pi-team-observability",
      paneCount: 2,
      attachedToCurrentClient: false,
    });
    expect(typeof tmuxCalls[0].logDir).toBe("string");
    expect(tmuxCalls[0].logDir).toContain("team-observability");
  });

  it("cleans up worker panes instead of killing the session when tmux is already attached", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    tmuxMock.createWorkerPanes.mockResolvedValue([
      {
        sessionName: "dev-session",
        windowName: "main",
        paneId: "%11",
        attachCommand: "tmux attach -t dev-session",
        logFile: "/tmp/current-window/task-1.log",
        eventLogFile: "/tmp/current-window/task-1.events.jsonl",
        placement: "current-window",
      },
      {
        sessionName: "dev-session",
        windowName: "main",
        paneId: "%12",
        attachCommand: "tmux attach -t dev-session",
        logFile: "/tmp/current-window/task-2.log",
        eventLogFile: "/tmp/current-window/task-2.events.jsonl",
        placement: "current-window",
      },
    ]);
    const tmuxCalls: any[] = [];

    const summary = await runTeam(
      { goal: "Show workers in current tmux window", workerCount: 2, agent: "worker", runId: "current-window" },
      {
        runTask: async ({ task, prompt }) => fakeResult(task.agent, prompt, `${task.id} done`, { terminal: task.terminal }),
        emitTmuxReady: (info) => tmuxCalls.push(info),
      },
    );

    expect(summary.success).toBe(true);
    expect(tmuxCalls).toHaveLength(1);
    expect(tmuxCalls[0]).toMatchObject({
      sessionName: "dev-session",
      attachCommand: "tmux attach -t dev-session",
      paneCount: 2,
      attachedToCurrentClient: true,
    });
    expect(tmuxMock.killTmuxPane).toHaveBeenCalledTimes(2);
    expect(tmuxMock.killTmuxPane).toHaveBeenNthCalledWith(1, "%11", undefined, "/usr/bin/tmux");
    expect(tmuxMock.killTmuxPane).toHaveBeenNthCalledWith(2, "%12", undefined, "/usr/bin/tmux");
    expect(tmuxMock.killTmuxSession).not.toHaveBeenCalled();
  });

  it("cleans active detached tmux team resources when session shutdown cleanup runs", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    tmuxMock.createWorkerPanes.mockResolvedValue([
      {
        sessionName: "pi-team-shutdown-detached",
        windowName: "workers",
        paneId: "%31",
        attachCommand: "tmux attach -t pi-team-shutdown-detached",
        logFile: "/tmp/shutdown-detached/task-1.log",
        eventLogFile: "/tmp/shutdown-detached/task-1.events.jsonl",
      },
      {
        sessionName: "pi-team-shutdown-detached",
        windowName: "workers",
        paneId: "%32",
        attachCommand: "tmux attach -t pi-team-shutdown-detached",
        logFile: "/tmp/shutdown-detached/task-2.log",
        eventLogFile: "/tmp/shutdown-detached/task-2.events.jsonl",
      },
    ]);
    let started = 0;
    let resolveStarted!: () => void;
    const startedPromise = new Promise<void>((resolve) => { resolveStarted = resolve; });

    void runTeam(
      { goal: "Shutdown detached tmux workers", workerCount: 2, agent: "worker", runId: "shutdown-detached", heartbeatMs: 0 },
      {
        runTask: async () => {
          started += 1;
          if (started === 2) resolveStarted();
          return new Promise<SingleResult>(() => undefined);
        },
      },
    );

    await startedPromise;
    await cleanupActiveTeamTmuxResources();

    expect(tmuxMock.killTmuxSession).toHaveBeenCalledWith("pi-team-shutdown-detached", undefined, "/usr/bin/tmux");
    expect(tmuxMock.killTmuxPane).not.toHaveBeenCalled();
  }, 250);

  it("cleans active current-window tmux team panes when session shutdown cleanup runs", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    tmuxMock.createWorkerPanes.mockResolvedValue([
      {
        sessionName: "dev-session",
        windowName: "main",
        paneId: "%41",
        attachCommand: "tmux attach -t dev-session",
        logFile: "/tmp/shutdown-current/task-1.log",
        eventLogFile: "/tmp/shutdown-current/task-1.events.jsonl",
        placement: "current-window",
      },
      {
        sessionName: "dev-session",
        windowName: "main",
        paneId: "%42",
        attachCommand: "tmux attach -t dev-session",
        logFile: "/tmp/shutdown-current/task-2.log",
        eventLogFile: "/tmp/shutdown-current/task-2.events.jsonl",
        placement: "current-window",
      },
    ]);
    let started = 0;
    let resolveStarted!: () => void;
    const startedPromise = new Promise<void>((resolve) => { resolveStarted = resolve; });

    void runTeam(
      { goal: "Shutdown current tmux workers", workerCount: 2, agent: "worker", runId: "shutdown-current", heartbeatMs: 0 },
      {
        runTask: async () => {
          started += 1;
          if (started === 2) resolveStarted();
          return new Promise<SingleResult>(() => undefined);
        },
      },
    );

    await startedPromise;
    await cleanupActiveTeamTmuxResources();

    expect(tmuxMock.killTmuxPane).toHaveBeenCalledTimes(2);
    expect(tmuxMock.killTmuxPane).toHaveBeenNthCalledWith(1, "%41", undefined, "/usr/bin/tmux");
    expect(tmuxMock.killTmuxPane).toHaveBeenNthCalledWith(2, "%42", undefined, "/usr/bin/tmux");
    expect(tmuxMock.killTmuxSession).not.toHaveBeenCalled();
  }, 250);

  it("returns interrupted summary and kills detached tmux session when aborted", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    tmuxMock.createWorkerPanes.mockResolvedValue(Array.from({ length: 12 }, (_, index) => ({
      sessionName: "pi-team-aborted-detached",
      windowName: "workers",
      paneId: `%${index + 1}`,
      attachCommand: "tmux attach -t pi-team-aborted-detached",
      logFile: `/tmp/aborted-detached/task-${index + 1}.log`,
      eventLogFile: `/tmp/aborted-detached/task-${index + 1}.events.jsonl`,
    })));
    const controller = new AbortController();

    const summary = await runTeam(
      { goal: "Abort detached tmux workers", workerCount: 12, agent: "worker", runId: "aborted-detached", signal: controller.signal, heartbeatMs: 0 },
      {
        runTask: async () => {
          controller.abort(new Error("user aborted team run"));
          return new Promise<SingleResult>(() => undefined);
        },
      },
    );

    expect(summary.success).toBe(false);
    expect(summary.tasks.map((task) => task.status)).toEqual(Array.from({ length: 12 }, () => "interrupted"));
    expect(summary.tasks.every((task) => /abort/i.test(task.errorMessage || ""))).toBe(true);
    expect(tmuxMock.killTmuxSession).toHaveBeenCalledWith("pi-team-aborted-detached", undefined, "/usr/bin/tmux");
    expect(tmuxMock.killTmuxPane).not.toHaveBeenCalled();
  }, 250);

  it("returns interrupted summary and kills current-window tmux panes when aborted", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    tmuxMock.createWorkerPanes.mockResolvedValue([
      {
        sessionName: "dev-session",
        windowName: "main",
        paneId: "%21",
        attachCommand: "tmux attach -t dev-session",
        logFile: "/tmp/aborted-current/task-1.log",
        eventLogFile: "/tmp/aborted-current/task-1.events.jsonl",
        placement: "current-window",
      },
      {
        sessionName: "dev-session",
        windowName: "main",
        paneId: "%22",
        attachCommand: "tmux attach -t dev-session",
        logFile: "/tmp/aborted-current/task-2.log",
        eventLogFile: "/tmp/aborted-current/task-2.events.jsonl",
        placement: "current-window",
      },
    ]);
    const controller = new AbortController();

    const summary = await runTeam(
      { goal: "Abort current-window tmux workers", workerCount: 2, agent: "worker", runId: "aborted-current", signal: controller.signal, heartbeatMs: 0 },
      {
        runTask: async () => {
          controller.abort(new Error("user aborted team run"));
          return new Promise<SingleResult>(() => undefined);
        },
      },
    );

    expect(summary.success).toBe(false);
    expect(summary.tasks.map((task) => task.status)).toEqual(["interrupted", "interrupted"]);
    expect(summary.tasks.every((task) => /abort/i.test(task.errorMessage || ""))).toBe(true);
    expect(tmuxMock.killTmuxPane).toHaveBeenCalledTimes(2);
    expect(tmuxMock.killTmuxPane).toHaveBeenNthCalledWith(1, "%21", undefined, "/usr/bin/tmux");
    expect(tmuxMock.killTmuxPane).toHaveBeenNthCalledWith(2, "%22", undefined, "/usr/bin/tmux");
    expect(tmuxMock.killTmuxSession).not.toHaveBeenCalled();
  }, 250);
  it("retains a failed detached tmux session for operator inspection instead of killing it immediately", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    tmuxMock.createWorkerPanes.mockResolvedValueOnce([
      {
        sessionName: "pi-team-retain-fail",
        windowName: "workers",
        paneId: "%51",
        attachCommand: "tmux attach -t pi-team-retain-fail",
        logFile: "/tmp/retain-fail/task-1.log",
        eventLogFile: "/tmp/retain-fail/task-1.events.jsonl",
      },
    ]);

    const summary = await runTeam(
      { goal: "Fail a tmux worker task", workerCount: 1, agent: "worker", runId: "retain-fail" },
      {
        now: () => "2026-04-27T00:00:00.000Z",
        runTask: async ({ task, prompt }) =>
          fakeResult(task.agent, prompt, "boom", {
            terminal: task.terminal,
            exitCode: 1,
            stopReason: "error",
            errorMessage: "worker exploded",
          }),
      },
    );

    expect(summary.success).toBe(false);
    expect(tmuxMock.killTmuxSession).not.toHaveBeenCalled();
    expect(tmuxMock.killTmuxPane).not.toHaveBeenCalled();
  });

  it("reaps a stale retained failed-run tmux session on a later runTeam invocation (TTL sweep)", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    tmuxMock.createWorkerPanes.mockResolvedValueOnce([
      {
        sessionName: "pi-team-ttl-stale",
        windowName: "workers",
        paneId: "%52",
        attachCommand: "tmux attach -t pi-team-ttl-stale",
        logFile: "/tmp/ttl-stale/task-1.log",
        eventLogFile: "/tmp/ttl-stale/task-1.events.jsonl",
      },
    ]);

    const failingSummary = await runTeam(
      { goal: "Fail a tmux worker task", workerCount: 1, agent: "worker", runId: "ttl-stale" },
      {
        now: () => "2026-04-27T00:00:00.000Z",
        runTask: async ({ task, prompt }) =>
          fakeResult(task.agent, prompt, "boom", {
            terminal: task.terminal,
            exitCode: 1,
            stopReason: "error",
            errorMessage: "worker exploded",
          }),
      },
    );
    expect(failingSummary.success).toBe(false);
    expect(tmuxMock.killTmuxSession).not.toHaveBeenCalled();

    // A later runTeam invocation 31 minutes after the failure must reap the
    // now-stale retained tmux session as part of its opportunistic sweep --
    // this is what bounds resource growth across many `team` invocations in
    // one long-running session instead of leaking until process exit.
    tmuxMock.detectTmux.mockResolvedValueOnce({ available: false });
    const nextSummary = await runTeam(
      { goal: "Unrelated later run", workerCount: 1, agent: "worker", runId: "after-ttl-stale" },
      {
        now: () => "2026-04-27T00:31:00.000Z",
        runTask: async ({ task, prompt }) => fakeResult(task.agent, prompt, "native done", { terminal: task.terminal }),
      },
    );

    expect(nextSummary.success).toBe(true);
    expect(tmuxMock.killTmuxSession).toHaveBeenCalledWith("pi-team-ttl-stale", undefined, "/usr/bin/tmux");
    expect(tmuxMock.killTmuxPane).not.toHaveBeenCalled();
  });

  it("does not reap a retained failed-run tmux session before its TTL elapses", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    tmuxMock.createWorkerPanes.mockResolvedValueOnce([
      {
        sessionName: "pi-team-not-yet-stale",
        windowName: "workers",
        paneId: "%53",
        attachCommand: "tmux attach -t pi-team-not-yet-stale",
        logFile: "/tmp/not-yet-stale/task-1.log",
        eventLogFile: "/tmp/not-yet-stale/task-1.events.jsonl",
      },
    ]);

    const failingSummary = await runTeam(
      { goal: "Fail a tmux worker task", workerCount: 1, agent: "worker", runId: "not-yet-stale" },
      {
        now: () => "2026-04-27T00:00:00.000Z",
        runTask: async ({ task, prompt }) =>
          fakeResult(task.agent, prompt, "boom", {
            terminal: task.terminal,
            exitCode: 1,
            stopReason: "error",
            errorMessage: "worker exploded",
          }),
      },
    );
    expect(failingSummary.success).toBe(false);

    // Only 5 minutes later -- well under the 30-minute TTL -- the retained
    // session must still be left alive for inspection.
    tmuxMock.detectTmux.mockResolvedValueOnce({ available: false });
    const nextSummary = await runTeam(
      { goal: "Unrelated later run", workerCount: 1, agent: "worker", runId: "after-not-yet-stale" },
      {
        now: () => "2026-04-27T00:05:00.000Z",
        runTask: async ({ task, prompt }) => fakeResult(task.agent, prompt, "native done", { terminal: task.terminal }),
      },
    );

    expect(nextSummary.success).toBe(true);
    expect(tmuxMock.killTmuxSession).not.toHaveBeenCalled();
    expect(tmuxMock.killTmuxPane).not.toHaveBeenCalled();
  });

  it("caps retained failed-run tmux sessions, evicting the oldest once the hard limit is exceeded", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    const runFailingTmuxTeam = async (index: number) => {
      tmuxMock.createWorkerPanes.mockResolvedValueOnce([
        {
          sessionName: `pi-team-cap-${index}`,
          windowName: "workers",
          paneId: `%${60 + index}`,
          attachCommand: `tmux attach -t pi-team-cap-${index}`,
          logFile: `/tmp/cap-${index}/task-1.log`,
          eventLogFile: `/tmp/cap-${index}/task-1.events.jsonl`,
        },
      ]);
      return runTeam(
        { goal: `Fail tmux worker ${index}`, workerCount: 1, agent: "worker", runId: `cap-${index}` },
        {
          now: () => `2026-04-27T00:${String(index).padStart(2, "0")}:00.000Z`,
          runTask: async ({ task, prompt }) =>
            fakeResult(task.agent, prompt, "boom", {
              terminal: task.terminal,
              exitCode: 1,
              stopReason: "error",
              errorMessage: "worker exploded",
            }),
        },
      );
    };

    // 12 failing tmux runs in quick succession (well within the 30-minute
    // TTL). The sweep runs on ENTRY to each runTeam call, before that call's
    // own registration is added, so it takes a 12th call (seeing the 11
    // registrations retained by calls 1-11, one more than
    // MAX_RETAINED_FAILED_TEAM_TMUX_RESOURCES = 10) to observe an eviction.
    for (let index = 1; index <= 12; index += 1) {
      const summary = await runFailingTmuxTeam(index);
      expect(summary.success).toBe(false);
    }

    // The oldest retained session (cap-1) must have been evicted to enforce
    // the hard cap; the newest (cap-12) must still be alive/untouched.
    expect(tmuxMock.killTmuxSession).toHaveBeenCalledWith("pi-team-cap-1", undefined, "/usr/bin/tmux");
    expect(tmuxMock.killTmuxSession).not.toHaveBeenCalledWith("pi-team-cap-12", undefined, "/usr/bin/tmux");

  });



  it("aborts a hung worker via taskTimeoutMs instead of letting the run hang forever", async () => {
    vi.useFakeTimers();
    try {
      const capturedSignals: (AbortSignal | undefined)[] = [];
      const runPromise = runTeam(
        { goal: "Timeout test", workerCount: 1, agent: "worker", runId: "timeout-test", heartbeatMs: 0, taskTimeoutMs: 50 },
        {
          runTask: (input) => new Promise<SingleResult>((resolve) => {
            capturedSignals.push(input.signal);
            // Simulate a hung worker: only resolves once its signal aborts,
            // exactly as the real runAgent()/subagent.ts termination path does.
            input.signal?.addEventListener("abort", () => {
              resolve(fakeResult(input.agentName, input.prompt, "", {
                exitCode: 130,
                stopReason: "aborted",
                errorMessage: input.signal?.reason instanceof Error ? input.signal.reason.message : "aborted",
              }));
            });
          }),
        },
      );

      await vi.advanceTimersByTimeAsync(60);
      const summary = await runPromise;

      expect(capturedSignals).toHaveLength(1);
      expect(capturedSignals[0]?.aborted).toBe(true);
      expect(summary.success).toBe(false);
      expect(summary.tasks).toHaveLength(1);
      expect(summary.tasks[0].status).toBe("failed");
      expect(summary.tasks[0].errorMessage).toMatch(/worker exceeded taskTimeoutMs \(50ms\)/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not abort a worker that finishes within taskTimeoutMs", async () => {
    const capturedSignals: (AbortSignal | undefined)[] = [];
    const summary = await runTeam(
      { goal: "Fast worker", workerCount: 1, agent: "worker", runId: "timeout-not-triggered", heartbeatMs: 0, taskTimeoutMs: 10_000 },
      {
        runTask: async (input) => {
          capturedSignals.push(input.signal);
          return fakeResult(input.agentName, input.prompt, "done");
        },
      },
    );

    expect(capturedSignals).toHaveLength(1);
    expect(capturedSignals[0]?.aborted).toBe(false);
    expect(summary.success).toBe(true);
    expect(summary.tasks[0].status).toBe("completed");
  });

  it("emits backend resolved with native fallback and never fires tmux ready when tmux is missing", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: false });
    const backendCalls: any[] = [];
    const tmuxCalls: any[] = [];

    const summary = await runTeam(
      { goal: "Native fallback observability", workerCount: 1, agent: "worker" },
      {
        runTask: async ({ task, prompt }) => fakeResult(task.agent, prompt, "native fallback done", { terminal: task.terminal }),
        emitBackendResolved: (info) => backendCalls.push(info),
        emitTmuxReady: (info) => tmuxCalls.push(info),
      },
    );

    expect(summary.success).toBe(true);
    expect(summary.backendUsed).toBe("native");
    expect(backendCalls).toHaveLength(1);
    expect(backendCalls[0]).toEqual({ requested: "auto", used: "native", tmuxAvailable: false });
    expect(tmuxCalls).toHaveLength(0);
  });

  it("does not fire tmux ready on resume when all tasks are already terminal", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    const [task] = createDefaultTeamTasks("Resume with nothing to run", 1, "worker");
    task.status = "completed";
    task.startedAt = "2026-04-27T00:00:00.000Z";
    task.updatedAt = "2026-04-27T00:00:30.000Z";
    task.completedAt = "2026-04-27T00:00:30.000Z";
    const loadedRecord: any = {
      schemaVersion: 1,
      runId: "team-resume-done",
      goal: "Resume with nothing to run",
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:30.000Z",
      status: "running",
      options: { goal: "Resume with nothing to run", backend: "tmux" },
      tasks: [task],
      events: [],
      messages: [],
    };
    const backendCalls: any[] = [];
    const tmuxCalls: any[] = [];

    const summary = await runTeam(
      { goal: "Resume with nothing to run", backend: "tmux", resumeRunId: "team-resume-done" },
      {
        now: () => "2026-04-27T00:01:00.000Z",
        loadRun: async () => loadedRecord,
        runTask: async () => {
          throw new Error("no runnable tasks should remain");
        },
        emitBackendResolved: (info) => backendCalls.push(info),
        emitTmuxReady: (info) => tmuxCalls.push(info),
      },
    );

    expect(summary.backendUsed).toBe("tmux");
    expect(backendCalls).toHaveLength(1);
    expect(backendCalls[0]).toEqual({ requested: "tmux", used: "tmux", tmuxAvailable: true });
    expect(tmuxCalls).toHaveLength(0);
    expect(tmuxMock.createWorkerPanes).not.toHaveBeenCalled();
  });

  it("does not fire tmux ready when pane setup fails", async () => {
    tmuxMock.detectTmux.mockResolvedValue({ available: true, binary: "/usr/bin/tmux" });
    tmuxMock.createWorkerPanes.mockRejectedValue(new Error("pane setup boom"));
    const backendCalls: any[] = [];
    const tmuxCalls: any[] = [];

    const summary = await runTeam(
      { goal: "Pane setup failure", workerCount: 2, agent: "worker", runId: "pane-fail" },
      {
        runTask: async () => {
          throw new Error("workers must not run after pane setup failure");
        },
        emitBackendResolved: (info) => backendCalls.push(info),
        emitTmuxReady: (info) => tmuxCalls.push(info),
      },
    );

    expect(summary.success).toBe(false);
    expect(backendCalls).toHaveLength(1);
    expect(backendCalls[0]).toEqual({ requested: "auto", used: "tmux", tmuxAvailable: true });
    expect(tmuxCalls).toHaveLength(0);
  });

  it("persists lifecycle records plus inbox/outbox messages when persistence is enabled", async () => {
    const records: any[] = [];

    const summary = await runTeam(
      { goal: "Persist lifecycle", workerCount: 1, agent: "worker", runId: "team-persist-test", heartbeatMs: 0 },
      {
        now: (() => {
          let tick = 0;
          return () => `2026-04-27T00:00:0${tick++}.000Z`;
        })(),
        persistRun: (record) => {
          records.push(JSON.parse(JSON.stringify(record)));
        },
        runTask: async ({ task, prompt, worktree }) => {
          expect(worktree).toBe(false);
          return fakeResult(task.agent, prompt, "persisted worker done");
        },
      },
    );

    const finalRecord = records.at(-1);
    expect(summary.success).toBe(true);
    expect(records.length).toBeGreaterThan(2);
    expect(finalRecord.status).toBe("completed");
    expect(finalRecord.runId).toBe("team-persist-test");
    expect(finalRecord.events.map((event: any) => event.type)).toEqual(expect.arrayContaining([
      "run_created",
      "task_created",
      "task_started",
      "message_recorded",
      "task_completed",
      "run_completed",
    ]));
    expect(finalRecord.messages.map((message: any) => message.kind)).toEqual(["inbox", "outbox"]);
  });

  it("resumes stale in-progress records conservatively without reporting success", async () => {
    const [task] = createDefaultTeamTasks("Resume interrupted run", 1, "worker");
    task.status = "in_progress";
    task.startedAt = "2026-04-27T00:00:00.000Z";
    task.updatedAt = "2026-04-27T00:00:00.000Z";
    const loadedRecord: any = {
      schemaVersion: 1,
      runId: "team-resume-loaded",
      goal: "Resume interrupted run",
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
      status: "running",
      options: { goal: "Resume interrupted run" },
      tasks: [task],
      events: [],
      messages: [],
    };

    const summary = await runTeam(
      {
        goal: "Resume interrupted run",
        resumeRunId: "team-resume-loaded",
        staleTaskMs: 1_000,
        resumeMode: "mark-interrupted",
      },
      {
        now: () => "2026-04-27T00:01:00.000Z",
        loadRun: async () => loadedRecord,
        runTask: async () => {
          throw new Error("interrupted resume tasks must not run without retry-stale");
        },
      },
    );

    expect(summary.success).toBe(false);
    expect(summary.tasks[0].status).toBe("interrupted");
    expect(summary.verificationEvidence.failed).toBe(true);
  });

  it("keeps the public run summary JSON-serializable with stable task and evidence fields", async () => {
    const summary = await runTeam(
      { goal: "Document the team mode contract", workerCount: 1, agent: "worker" },
      {
        runTask: async ({ task, prompt }) => fakeResult(task.agent, prompt, "contract locked", {
          artifacts: {
            artifactDir: ".pi/team/run-1",
            outputFile: ".pi/team/run-1/task-1.md",
            progressFile: ".pi/team/run-1/task-1.progress.md",
            readFiles: ["README.md"],
          },
          worktree: { worktreePath: "/tmp/team-task-1" },
        }),
      },
    );

    const reparsed = JSON.parse(JSON.stringify(summary));

    expect(reparsed).toMatchObject({
      goal: "Document the team mode contract",
      taskCount: 1,
      completedCount: 1,
      failedCount: 0,
      blockedCount: 0,
      success: true,
      ok: true,
      tasks: [
        {
          id: "task-1",
          owner: "worker-1",
          agent: "worker",
          status: "completed",
          artifactRefs: [
            ".pi/team/run-1",
            ".pi/team/run-1/task-1.md",
            ".pi/team/run-1/task-1.progress.md",
            "README.md",
          ],
          worktreeRefs: ["/tmp/team-task-1"],
        },
      ],
      verificationEvidence: {
        checksRun: ["task-1: pi worker execution"],
        passed: true,
        failed: false,
        passedChecks: ["task-1: worker completed"],
        failedChecks: [],
      },
    });
  });

  it("marks the run failed when any worker fails", async () => {
    const summary = await runTeam(
      { goal: "Ship lightweight native team mode", workerCount: 2, agent: "worker" },
      {
        runTask: async ({ task, prompt }) => {
          if (task.id === "task-2") {
            return fakeResult(task.agent, prompt, "worker failed", {
              exitCode: 1,
              stopReason: "error",
              stderr: "boom",
              errorMessage: "boom",
            });
          }
          return fakeResult(task.agent, prompt, "worker succeeded");
        },
      },
    );

    expect(summary.ok).toBe(false);
    expect(summary.completedCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.tasks.map((task) => task.status)).toEqual(["completed", "failed"]);
    expect(summary.finalSynthesis).toContain("worker succeeded");
    expect(summary.finalSynthesis).toContain("boom");
    expect(summary.verificationEvidence.passed).toBe(false);
    expect(summary.verificationEvidence.failed).toBe(true);
  });

  it("formats team results with a result-first summary before worker details", () => {
    const [task1, task2] = createDefaultTeamTasks("Draw architecture", 2, "worker");
    task1.status = "completed";
    task1.resultSummary = [
      "# Worker 1 Final Report",
      "",
      "## Changed files",
      "- `TEAM_ARCH.md` — added a Mermaid flowchart.",
      "",
      "## Verification performed",
      "- `git diff --check` — PASS.",
      "",
      "## Blockers/risks",
      "- none",
    ].join("\n");
    task2.status = "completed";
    task2.resultSummary = [
      "# Worker 2 Final Report",
      "",
      "## Changed files",
      "- `docs/engineering-discipline/harness/team-mode-architecture.md` — added a Mermaid flowchart.",
      "",
      "## Verification",
      "- `python3` sanity check — PASS.",
      "",
      "## Blockers/risks",
      "- None.",
    ].join("\n");

    const summary = synthesizeTeamRun("Draw architecture", [task1, task2], [
      fakeResult("worker", "prompt", task1.resultSummary),
      fakeResult("worker", "prompt", task2.resultSummary),
    ]);

    const formatted = formatTeamRunSummary(summary);

    expect(formatted).toMatch(/^Team completed: 2\/2 tasks completed for goal: Draw architecture/);
    expect(formatted.indexOf("## Summary")).toBeLessThan(formatted.indexOf("## Worker Details"));
    expect(formatted.indexOf("## Outputs")).toBeLessThan(formatted.indexOf("## Worker Details"));
    expect(formatted).toContain("- Goal: Draw architecture");
    expect(formatted).toContain("- Backend: native");
    expect(formatted).toContain("- `TEAM_ARCH.md` — added a Mermaid flowchart.");
    expect(formatted).toContain("- `docs/engineering-discipline/harness/team-mode-architecture.md` — added a Mermaid flowchart.");
    expect(formatted).toContain("- PASS: 2/2 worker tasks completed.");
    expect(formatted).toContain("- `git diff --check` — PASS.");
    expect(formatted).toContain("- `python3` sanity check — PASS.");
    expect(formatted).toContain("## Risks / Blockers");
    expect(formatted).toContain("- None reported.");
    expect(formatted).toContain("## Worker Details");
    expect(formatted).toContain("# Worker 1 Final Report");
    expect(formatted).toContain("Structured verification evidence:");
  });

  it("formats structured verification evidence without dropping refs or failure details", () => {
    const [task] = createDefaultTeamTasks("Summarize partial run", 1, "worker");
    task.status = "failed";
    task.resultSummary = "worker reported incomplete verification";
    task.errorMessage = "verification failed";
    task.artifactRefs = [".pi/team/task-1.md"];
    task.worktreeRefs = ["/tmp/team-task-1"];

    const summary = synthesizeTeamRun("Summarize partial run", task ? [task] : [], [
      fakeResult("worker", "prompt", "worker reported incomplete verification", {
        exitCode: 1,
        errorMessage: "verification failed",
      }),
    ]);

    const formatted = formatTeamRunSummary(summary);

    expect(formatted).toContain("Team finished with failures");
    expect(formatted).toContain("checksRun: task-1: pi worker execution");
    expect(formatted).toContain("passed: false (none)");
    expect(formatted).toContain("failed: true (task-1: verification failed)");
    expect(formatted).toContain("artifactRefs: .pi/team/task-1.md");
    expect(formatted).toContain("worktreeRefs: /tmp/team-task-1");
    expect(formatted).toContain("Team mode supports task dependencies via blockedBy");
  });

  it("lets a user abort win over a longer taskTimeoutMs without double-aborting", async () => {
    const controller = new AbortController();
    const summary = await runTeam(
      {
        goal: "Abort still wins over a longer timeout",
        workerCount: 1,
        agent: "worker",
        taskTimeoutMs: 5_000,
        signal: controller.signal,
        heartbeatMs: 0,
      },
      {
        runTask: () =>
          new Promise<SingleResult>(() => {
            controller.abort(new Error("user aborted team run"));
          }),
      },
    );

    expect(summary.tasks[0].status).toBe("interrupted");
    expect(summary.tasks[0].errorMessage).toMatch(/user aborted team run/);
  });

});

describe("resolveTeamWorktreePolicy", () => {
  it("keeps the legacy boolean behavior while exposing explicit policy names", () => {
    expect(resolveTeamWorktreePolicy({ worktree: true })).toBe(true);
    expect(resolveTeamWorktreePolicy({ worktree: false })).toBe(false);
    expect(resolveTeamWorktreePolicy({ worktree: false, worktreePolicy: "on" })).toBe(true);
    expect(resolveTeamWorktreePolicy({ worktree: true, worktreePolicy: "off" })).toBe(false);
    expect(resolveTeamWorktreePolicy({ worktree: true, worktreePolicy: "auto" })).toBe(true);
    expect(resolveTeamWorktreePolicy({ worktree: false, worktreePolicy: "auto" })).toBe(false);
  });
});

describe("runTeam durable commands", () => {
  it("persists command lifecycle alongside audit inbox/outbox for initial dispatch", async () => {
    const records: any[] = [];

    const summary = await runTeam(
      { goal: "Command-backed dispatch", workerCount: 1, agent: "worker", runId: "team-command-backed", heartbeatMs: 0 },
      {
        now: (() => {
          let tick = 0;
          return () => `2026-04-28T00:00:0${tick++}.000Z`;
        })(),
        persistRun: (record) => { records.push(JSON.parse(JSON.stringify(record))); },
        runTask: async ({ task, prompt }) => fakeResult(task.agent, prompt, "command backed done", {
          artifacts: { outputFile: ".pi/team/final.md" },
        }),
      },
    );

    const finalRecord = records.at(-1);
    expect(summary.success).toBe(true);
    expect(finalRecord.commands).toHaveLength(1);
    expect(finalRecord.commands[0]).toMatchObject({
      id: "team-command-backed-command-1",
      taskId: "task-1",
      owner: "worker-1",
      status: "completed",
      attempt: 1,
      resultSummary: expect.stringContaining("command backed done"),
      artifactRefs: [".pi/team/final.md"],
    });
    expect(finalRecord.events.map((event: any) => event.type)).toEqual(expect.arrayContaining([
      "command_enqueued",
      "command_acknowledged",
      "command_started",
      "command_completed",
      "message_recorded",
    ]));
    expect(finalRecord.messages.map((message: any) => message.kind)).toEqual(["inbox", "outbox"]);
  });

  it("routes follow-up mode to an existing run without creating default tasks", async () => {
    const [task] = createDefaultTeamTasks("Existing run", 1, "worker");
    task.status = "completed";
    task.terminal = { backend: "native" };
    const loadedRecord: any = {
      schemaVersion: 1,
      runId: "team-follow-up",
      goal: "Existing run",
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z",
      status: "completed",
      options: { goal: "Existing run" },
      tasks: [task],
      commands: [],
      events: [],
      messages: [],
    };
    const records: any[] = [];
    const calls: any[] = [];

    const summary = await runTeam(
      { resumeRunId: "team-follow-up", commandTarget: "worker-1", commandMessage: "please verify follow-up", heartbeatMs: 0 },
      {
        now: (() => {
          let tick = 0;
          return () => `2026-04-28T00:01:0${tick++}.000Z`;
        })(),
        loadRun: async () => loadedRecord,
        persistRun: (record) => { records.push(JSON.parse(JSON.stringify(record))); },
        runTask: async ({ task, prompt }) => {
          calls.push({ taskId: task.id, prompt });
          return fakeResult(task.agent, prompt, "follow-up done");
        },
      },
    );

    const finalRecord = records.at(-1);
    expect(summary.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].taskId).toBe("task-1");
    expect(calls[0].prompt).toContain("Command id: team-follow-up-command-1");
    expect(calls[0].prompt).toContain("please verify follow-up");
    expect(finalRecord.tasks).toHaveLength(1);
    expect(finalRecord.commands[0]).toMatchObject({
      id: "team-follow-up-command-1",
      body: "please verify follow-up",
      status: "completed",
    });
  });

  it("rejects follow-up mode with missing target before command creation", async () => {
    const loadedRecord: any = {
      schemaVersion: 1,
      runId: "team-follow-up-missing",
      goal: "Existing run",
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z",
      status: "completed",
      options: { goal: "Existing run" },
      tasks: createDefaultTeamTasks("Existing run", 1, "worker"),
      commands: [],
      events: [],
      messages: [],
    };
    const records: any[] = [];

    const summary = await runTeam(
      { resumeRunId: "team-follow-up-missing", commandTarget: "worker-9", commandMessage: "lost" },
      {
        now: () => "2026-04-28T00:01:00.000Z",
        loadRun: async () => loadedRecord,
        persistRun: (record) => { records.push(JSON.parse(JSON.stringify(record))); },
        runTask: async () => {
          throw new Error("must not run missing target");
        },
      },
    );

    const finalRecord = records.at(-1);
    expect(summary.success).toBe(false);
    expect(summary.finalSynthesis).toContain("Follow-up command failed");
    expect(finalRecord.commands).toEqual([]);
    expect(finalRecord.events.at(-1).message).toContain("worker-9");
  });

  it("bounds a hung follow-up command with taskTimeoutMs instead of hanging the run forever", async () => {
    const [task] = createDefaultTeamTasks("Existing run", 1, "worker");
    task.status = "completed";
    task.terminal = { backend: "native" };
    const loadedRecord: any = {
      schemaVersion: 1,
      runId: "team-follow-up-timeout",
      goal: "Existing run",
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z",
      status: "completed",
      options: { goal: "Existing run" },
      tasks: [task],
      commands: [],
      events: [],
      messages: [],
    };
    const records: any[] = [];

    const summary = await runTeam(
      {
        resumeRunId: "team-follow-up-timeout",
        commandTarget: "worker-1",
        commandMessage: "please verify follow-up",
        taskTimeoutMs: 20,
      },
      {
        now: () => "2026-04-28T00:01:00.000Z",
        loadRun: async () => loadedRecord,
        persistRun: (record) => { records.push(JSON.parse(JSON.stringify(record))); },
        runTask: ({ agentName, prompt, signal }) =>
          new Promise((resolve) => {
            signal?.addEventListener("abort", () => {
              resolve(fakeResult(agentName, prompt, "", {
                exitCode: 130,
                stopReason: "aborted",
                errorMessage: signal.reason instanceof Error ? signal.reason.message : String(signal.reason),
              }));
            });
          }),
      },
    );

    const finalRecord = records.at(-1);
    expect(summary.success).toBe(false);
    expect(finalRecord.tasks[0].status).toBe("failed");
    expect(finalRecord.tasks[0].errorMessage).toMatch(/taskTimeoutMs/);
  });

});

describe("runTeam follow-up failure safety", () => {
  it("preserves a durable command and marks it blocked when follow-up wake-up fails", async () => {
    const [task] = createDefaultTeamTasks("Existing run", 1, "worker");
    task.status = "completed";
    task.terminal = { backend: "tmux", paneId: "%1", sessionName: "s", windowName: "w", logFile: "/tmp/task.log", attachCommand: "tmux attach -t s" };
    const loadedRecord: any = {
      schemaVersion: 1,
      runId: "team-follow-up-wakeup-fail",
      goal: "Existing run",
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z",
      status: "completed",
      options: { goal: "Existing run" },
      tasks: [task],
      commands: [],
      events: [],
      messages: [],
    };
    const records: any[] = [];

    const summary = await runTeam(
      { resumeRunId: "team-follow-up-wakeup-fail", commandTarget: "worker-1", commandMessage: "try wake", backend: "tmux" },
      {
        now: (() => {
          let tick = 0;
          return () => `2026-04-28T00:01:0${tick++}.000Z`;
        })(),
        loadRun: async () => loadedRecord,
        persistRun: (record) => { records.push(JSON.parse(JSON.stringify(record))); },
        runTask: async () => {
          throw new Error("send-keys failed");
        },
      },
    );

    const finalRecord = records.at(-1);
    expect(summary.success).toBe(false);
    expect(finalRecord.commands).toHaveLength(1);
    expect(finalRecord.commands[0]).toMatchObject({
      body: "try wake",
      status: "blocked",
      attempt: 1,
      errorMessage: expect.stringContaining("wake-up failed"),
    });
    expect(finalRecord.tasks[0]).toMatchObject({ status: "blocked", errorMessage: expect.stringContaining("send-keys failed") });
  });
});
