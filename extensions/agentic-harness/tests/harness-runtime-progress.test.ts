import { describe, expect, it } from "vitest";
import { applyHarnessCommand, createHarnessState } from "../harness-state.js";
import {
  applyStructuredPlanTaskStatusUpdates,
  selectStructuredPlanForPaths,
} from "../harness-runtime-progress.js";

function stateWithPlans() {
  let state = createHarnessState({ runId: "run-1", title: "Runtime Progress" });
  state = applyHarnessCommand(state, {
    type: "attach_plan",
    plan: { id: "plan-1", milestoneId: "M1", title: "Plan 1", goal: "First", planFile: "docs/plans/one.md" },
  }).state;
  state = applyHarnessCommand(state, {
    type: "define_plan_tasks",
    planId: "plan-1",
    tasks: [
      { id: 1, name: "Task 1" },
      { id: 2, name: "Task 2" },
    ],
  }).state;
  state = applyHarnessCommand(state, {
    type: "attach_plan",
    plan: { id: "plan-2", milestoneId: "M2", title: "Plan 2", goal: "Second", planFile: "docs/plans/two.md" },
  }).state;
  state = applyHarnessCommand(state, {
    type: "define_plan_tasks",
    planId: "plan-2",
    tasks: [
      { id: 1, name: "Other Task 1" },
      { id: 2, name: "Other Task 2" },
    ],
  }).state;
  return state;
}

describe("runtime structured plan progress helpers", () => {
  it("applies multiple task status updates cumulatively", () => {
    const state = stateWithPlans();

    const result = applyStructuredPlanTaskStatusUpdates(state, {
      planId: "plan-1",
      taskIds: [1, 2],
      status: "completed",
      now: "2026-05-06T00:00:00.000Z",
    });

    const plan = result.state.plans.find((candidate) => candidate.id === "plan-1")!;
    expect(plan.tasks.map((task) => task.status)).toEqual(["completed", "completed"]);
    expect(result.events).toHaveLength(2);
    expect(result.events.map((event) => event.seq)).toEqual([state.eventSeq + 1, state.eventSeq + 2]);
  });

  it("deduplicates task ids", () => {
    const state = stateWithPlans();

    const result = applyStructuredPlanTaskStatusUpdates(state, {
      planId: "plan-1",
      taskIds: [1, 1, 2],
      status: "failed",
      now: "2026-05-06T00:00:00.000Z",
    });

    const plan = result.state.plans.find((candidate) => candidate.id === "plan-1")!;
    expect(plan.tasks.map((task) => task.status)).toEqual(["failed", "failed"]);
    expect(result.events).toHaveLength(2);
  });

  it("marks running tasks with startedAt instead of completedAt", () => {
    const state = stateWithPlans();

    const result = applyStructuredPlanTaskStatusUpdates(state, {
      planId: "plan-1",
      taskIds: [1],
      status: "running",
      now: "2026-05-06T00:00:00.000Z",
    });

    const task = result.state.plans.find((candidate) => candidate.id === "plan-1")!.tasks[0];
    expect(task.status).toBe("running");
    expect(task.startedAt).toBe("2026-05-06T00:00:00.000Z");
    expect(task.completedAt).toBeUndefined();
  });

  it("selects the structured plan matching subagent plan paths", () => {
    const state = stateWithPlans();

    const selected = selectStructuredPlanForPaths(state, ["docs/plans/two.md"]);

    expect(selected?.id).toBe("plan-2");
  });

  it("matches subagent plan paths across ./ and absolute path spellings", () => {
    const state = stateWithPlans();

    const selected = selectStructuredPlanForPaths(state, ["/workspace/./docs/plans/two.md"]);

    expect(selected?.id).toBe("plan-2");
  });

  it("does not fall back to the first plan when multiple plans are ambiguous", () => {
    const state = stateWithPlans();

    const selected = selectStructuredPlanForPaths(state, ["docs/plans/missing.md"]);

    expect(selected).toBeUndefined();
  });

  it("allows single-plan fallback when no path matches", () => {
    let state = createHarnessState({ runId: "run-1", title: "Runtime Progress" });
    state = applyHarnessCommand(state, {
      type: "attach_plan",
      plan: { id: "plan-1", milestoneId: "M1", title: "Plan 1", goal: "First", planFile: "docs/plans/one.md" },
    }).state;

    const selected = selectStructuredPlanForPaths(state, ["docs/plans/missing.md"]);

    expect(selected?.id).toBe("plan-1");
  });
});
