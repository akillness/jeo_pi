import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readCorrelationFromEnv,
  buildChildCorrelationEnv,
  correlationFields,
  CORRELATION_ROOT_ENV,
  CORRELATION_PARENT_ENV,
  CORRELATION_DEPTH_ENV,
} from "../correlation.js";

describe("correlation", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe("readCorrelationFromEnv", () => {
    it("returns null when no correlation env is set", () => {
      delete process.env[CORRELATION_ROOT_ENV];
      expect(readCorrelationFromEnv()).toBeNull();
    });

    it("reads correlation from env vars", () => {
      process.env[CORRELATION_ROOT_ENV] = "root-abc";
      process.env[CORRELATION_PARENT_ENV] = "parent-xyz";
      process.env[CORRELATION_DEPTH_ENV] = "2";
      const ctx = readCorrelationFromEnv()!;
      expect(ctx.rootRunId).toBe("root-abc");
      expect(ctx.parentRunId).toBe("parent-xyz");
      expect(ctx.depth).toBe(2);
    });

    it("defaults parent to root when parent is missing", () => {
      process.env[CORRELATION_ROOT_ENV] = "root-abc";
      delete process.env[CORRELATION_PARENT_ENV];
      const ctx = readCorrelationFromEnv()!;
      expect(ctx.parentRunId).toBe("root-abc");
    });

    it("defaults depth to 0 when missing", () => {
      process.env[CORRELATION_ROOT_ENV] = "root-abc";
      delete process.env[CORRELATION_DEPTH_ENV];
      const ctx = readCorrelationFromEnv()!;
      expect(ctx.depth).toBe(0);
    });
  });

  describe("buildChildCorrelationEnv", () => {
    it("builds child env with incremented depth", () => {
      const env = buildChildCorrelationEnv("worker-1", "root-abc", 0);
      expect(env[CORRELATION_ROOT_ENV]).toBe("root-abc");
      expect(env[CORRELATION_PARENT_ENV]).toBe("worker-1");
      expect(env[CORRELATION_DEPTH_ENV]).toBe("1");
    });

    it("uses parentRunId as root when root is undefined", () => {
      const env = buildChildCorrelationEnv("worker-1", undefined, 1);
      expect(env[CORRELATION_ROOT_ENV]).toBe("worker-1");
    });
  });

  describe("correlationFields", () => {
    it("returns empty object when context is null", () => {
      expect(correlationFields(null)).toEqual({});
    });

    it("returns structured correlation fields", () => {
      const fields = correlationFields({
        rootRunId: "root",
        parentRunId: "parent",
        workerInstanceId: "w1",
        depth: 2,
      });
      expect(fields).toEqual({
        correlationRootRunId: "root",
        correlationParentRunId: "parent",
        correlationDepth: 2,
      });
    });
  });
});
