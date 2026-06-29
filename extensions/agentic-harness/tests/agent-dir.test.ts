import { describe, expect, it } from "vitest";
import { resolvePiAgentDir, resolvePiSessionDir } from "../sandbox/agent-dir.js";

describe("resolvePiAgentDir", () => {
  it("uses ~/.pi/agent when env var is unset", () => {
    expect(resolvePiAgentDir(undefined, "/Users/tester")).toBe("/Users/tester/.pi/agent");
  });

  it("expands '~' to home", () => {
    expect(resolvePiAgentDir("~", "/Users/tester")).toBe("/Users/tester");
  });

  it("expands '~/...' to home subpath", () => {
    expect(resolvePiAgentDir("~/.custom-agent", "/Users/tester")).toBe("/Users/tester/.custom-agent");
  });

  it("uses explicit absolute path as-is", () => {
    expect(resolvePiAgentDir("/tmp/pi-agent", "/Users/tester")).toBe("/tmp/pi-agent");
  });
});

describe("resolvePiSessionDir", () => {
  it("is undefined when the session-dir env var is unset", () => {
    expect(resolvePiSessionDir(undefined, "/Users/tester")).toBeUndefined();
  });

  it("expands '~' to home", () => {
    expect(resolvePiSessionDir("~", "/Users/tester")).toBe("/Users/tester");
  });

  it("expands '~/...' to home subpath", () => {
    expect(resolvePiSessionDir("~/.pi-sessions", "/Users/tester")).toBe("/Users/tester/.pi-sessions");
  });

  it("uses explicit absolute path as-is", () => {
    expect(resolvePiSessionDir("/tmp/pi-sessions", "/Users/tester")).toBe("/tmp/pi-sessions");
  });
});
