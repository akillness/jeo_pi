import path from "node:path";
import { createHarnessReplayEvent, type HarnessReplayEvent } from "./harness-events.js";
import {
  applyHarnessCommand,
  selectActiveMilestone,
  selectPlanForMilestone,
  type HarnessPlan,
  type HarnessPlanTaskStatus,
  type HarnessState,
} from "./harness-state.js";

function normalizePathForMatch(filePath: string): string {
  const normalized = path.posix.normalize(filePath.replace(/\\/g, "/"));
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function pathsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizePathForMatch(left);
  const normalizedRight = normalizePathForMatch(right);
  return normalizedLeft === normalizedRight
    || normalizedLeft.endsWith(`/${normalizedRight}`)
    || normalizedRight.endsWith(`/${normalizedLeft}`);
}

export function selectStructuredPlanForPaths(
  state: HarnessState,
  planPaths: string[],
): HarnessPlan | undefined {
  const exactMatch = state.plans.find((plan) => plan.planFile && planPaths.some((planPath) => pathsMatch(plan.planFile!, planPath)));
  if (exactMatch) return exactMatch;

  if (state.plans.length === 1) return state.plans[0];

  const activeMilestone = selectActiveMilestone(state);
  return activeMilestone ? selectPlanForMilestone(state, activeMilestone) : undefined;
}

export function applyStructuredPlanTaskStatusUpdates(
  state: HarnessState,
  input: {
    planId: string;
    taskIds: number[];
    status: HarnessPlanTaskStatus;
    now?: string;
    rootDir?: string;
  },
): { state: HarnessState; events: HarnessReplayEvent[] } {
  let currentState = state;
  const events: HarnessReplayEvent[] = [];
  const uniqueTaskIds = [...new Set(input.taskIds)];

  for (const taskId of uniqueTaskIds) {
    const at = input.now ?? new Date().toISOString();
    const replayEvent = createHarnessReplayEvent(currentState, {
      type: "set_plan_task_status",
      planId: input.planId,
      taskId,
      status: input.status,
      completedAt: input.status === "completed" || input.status === "failed" ? at : undefined,
      startedAt: input.status === "running" ? at : undefined,
    }, { now: at, rootDir: input.rootDir });
    currentState = applyHarnessCommand(currentState, replayEvent.command, { now: replayEvent.at }).state;
    events.push(replayEvent);
  }

  return { state: currentState, events };
}
