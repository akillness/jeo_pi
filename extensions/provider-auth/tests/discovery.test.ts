import { describe, it, expect, vi } from "vitest";
import { discoverGoogleProjectId, ANTIGRAVITY_DISCOVERY_METADATA } from "../antigravity/discovery.js";

interface FakeResp {
  ok: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}

function resp(r: FakeResp): Response {
  const status = r.status ?? (r.ok ? 200 : 500);
  const obj = {
    ok: r.ok,
    status,
    json: async () => r.json,
    text: async () => r.text ?? JSON.stringify(r.json ?? {}),
    clone: () => obj,
  };
  return obj as unknown as Response;
}

/** Build a fetch mock that returns queued responses by call order, asserting URLs. */
function queuedFetch(responses: Array<FakeResp & { urlIncludes?: string }>) {
  let i = 0;
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    const r = responses[i++];
    if (!r) throw new Error(`unexpected fetch #${i}: ${url}`);
    if (r.urlIncludes) expect(url).toContain(r.urlIncludes);
    return resp(r);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("ANTIGRAVITY_DISCOVERY_METADATA", () => {
  it("carries the Antigravity desktop ide type", () => {
    expect(ANTIGRAVITY_DISCOVERY_METADATA.ideType).toBe("ANTIGRAVITY");
    expect(ANTIGRAVITY_DISCOVERY_METADATA.pluginType).toBe("GEMINI");
  });
});

describe("discoverGoogleProjectId", () => {
  it("returns an existing project from loadCodeAssist when a tier is active", async () => {
    const { fetchImpl, calls } = queuedFetch([
      { ok: true, json: { currentTier: { id: "standard-tier" }, cloudaicompanionProject: "proj-existing" }, urlIncludes: "loadCodeAssist" },
    ]);
    const id = await discoverGoogleProjectId("tok", { fetchImpl, env: {} });
    expect(id).toBe("proj-existing");
    expect(calls).toHaveLength(1);
  });

  it("reads a nested companion project object id", async () => {
    const { fetchImpl } = queuedFetch([
      { ok: true, json: { currentTier: { id: "legacy-tier" }, cloudaicompanionProject: { id: "nested-proj" } } },
    ]);
    expect(await discoverGoogleProjectId("tok", { fetchImpl, env: {} })).toBe("nested-proj");
  });

  it("falls back to the env project when a tier is active but no project is returned", async () => {
    const { fetchImpl } = queuedFetch([{ ok: true, json: { currentTier: { id: "standard-tier" } } }]);
    const id = await discoverGoogleProjectId("tok", { fetchImpl, env: { GOOGLE_CLOUD_PROJECT: "env-proj" } });
    expect(id).toBe("env-proj");
  });

  it("throws actionable guidance when a workspace account has no project", async () => {
    const { fetchImpl } = queuedFetch([{ ok: true, json: { currentTier: { id: "standard-tier" } } }]);
    await expect(discoverGoogleProjectId("tok", { fetchImpl, env: {} })).rejects.toThrow(/GOOGLE_CLOUD_PROJECT/);
  });

  it("onboards (free tier) and returns an immediately-provisioned project", async () => {
    const { fetchImpl, calls } = queuedFetch([
      { ok: true, json: { allowedTiers: [{ id: "free-tier", isDefault: true }] }, urlIncludes: "loadCodeAssist" },
      { ok: true, json: { done: true, response: { cloudaicompanionProject: "fresh-proj" } }, urlIncludes: "onboardUser" },
    ]);
    const id = await discoverGoogleProjectId("tok", { fetchImpl, env: {} });
    expect(id).toBe("fresh-proj");
    expect(calls).toHaveLength(2);
  });

  it("polls a long-running onboard operation until it completes", async () => {
    const sleep = vi.fn(async () => {});
    const { fetchImpl, calls } = queuedFetch([
      { ok: true, json: { allowedTiers: [{ id: "free-tier", isDefault: true }] } },
      { ok: true, json: { name: "operations/op-1", done: false } },
      { ok: true, json: { name: "operations/op-1", done: false } },
      { ok: true, json: { done: true, response: { cloudaicompanionProject: "polled-proj" } } },
    ]);
    const id = await discoverGoogleProjectId("tok", { fetchImpl, env: {}, sleep, maxPollAttempts: 5 });
    expect(id).toBe("polled-proj");
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(calls[2]).toContain("operations/op-1");
  });

  it("throws when loadCodeAssist fails without a VPC-SC signal", async () => {
    const { fetchImpl } = queuedFetch([{ ok: false, status: 403, text: "forbidden" }]);
    await expect(discoverGoogleProjectId("tok", { fetchImpl, env: {} })).rejects.toThrow(/loadCodeAssist failed/);
  });

  it("treats a VPC-SC security-policy error as an active standard tier", async () => {
    const { fetchImpl } = queuedFetch([
      { ok: false, status: 403, json: { error: { details: [{ reason: "SECURITY_POLICY_VIOLATED" }] } } },
    ]);
    const id = await discoverGoogleProjectId("tok", { fetchImpl, env: { GOOGLE_CLOUD_PROJECT: "vpc-proj" } });
    expect(id).toBe("vpc-proj");
  });

  it("throws when onboarding never yields a project id", async () => {
    const sleep = vi.fn(async () => {});
    const { fetchImpl } = queuedFetch([
      { ok: true, json: { allowedTiers: [{ id: "free-tier", isDefault: true }] } },
      { ok: true, json: { name: "operations/op-2", done: false } },
      { ok: true, json: { name: "operations/op-2", done: false } },
      { ok: true, json: { name: "operations/op-2", done: false } },
    ]);
    await expect(
      discoverGoogleProjectId("tok", { fetchImpl, env: {}, sleep, maxPollAttempts: 2 }),
    ).rejects.toThrow(/did not return a provisioned project/);
  });
});
