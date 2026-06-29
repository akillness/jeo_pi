/**
 * Correlation context for tracing work across orchestrator → worker → child process boundaries.
 *
 * Propagated via environment variables so child pi processes inherit the chain:
 *   PI_CORRELATION_ROOT   — top-level orchestrator run ID
 *   PI_CORRELATION_PARENT — immediate parent run ID
 *   PI_CORRELATION_DEPTH  — nesting depth (0-based)
 */

export interface CorrelationContext {
  rootRunId: string;
  parentRunId: string;
  workerInstanceId: string;
  depth: number;
}

export const CORRELATION_ROOT_ENV = "PI_CORRELATION_ROOT";
export const CORRELATION_PARENT_ENV = "PI_CORRELATION_PARENT";
export const CORRELATION_DEPTH_ENV = "PI_CORRELATION_DEPTH";

export function readCorrelationFromEnv(): CorrelationContext | null {
  const root = process.env[CORRELATION_ROOT_ENV];
  const parent = process.env[CORRELATION_PARENT_ENV];
  const depthRaw = process.env[CORRELATION_DEPTH_ENV];
  if (!root) return null;
  return {
    rootRunId: root,
    parentRunId: parent ?? root,
    workerInstanceId: "",
    depth: depthRaw ? parseInt(depthRaw, 10) : 0,
  };
}

export function buildChildCorrelationEnv(
  parentRunId: string,
  rootRunId: string | undefined,
  currentDepth: number
): Record<string, string> {
  return {
    [CORRELATION_ROOT_ENV]: rootRunId ?? parentRunId,
    [CORRELATION_PARENT_ENV]: parentRunId,
    [CORRELATION_DEPTH_ENV]: String(currentDepth + 1),
  };
}

export function correlationFields(ctx: CorrelationContext | null): Record<string, unknown> {
  if (!ctx) return {};
  return {
    correlationRootRunId: ctx.rootRunId,
    correlationParentRunId: ctx.parentRunId,
    correlationDepth: ctx.depth,
  };
}
