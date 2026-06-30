import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";

// A throwaway agent dir so the loader's models.json reads never touch the real
// ~/.pi. getAgentDir is the only symbol index.ts needs at runtime from the pi
// runtime; everything else it imports is type-only.
const h = vi.hoisted(() => ({
  agentDir: `${require("os").tmpdir()}/pi-provider-auth-${process.pid}-${Date.now()}`,
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  getAgentDir: () => h.agentDir,
}));

import providerAuthExtension from "../index.js";
import { modelsJsonPath } from "../models-config.js";

function harness() {
  const registered: { name: string; config: any }[] = [];
  const unregistered: string[] = [];
  const commands = new Map<string, any>();

  const pi = {
    registerProvider: (name: string, config: any) => registered.push({ name, config }),
    unregisterProvider: (name: string) => unregistered.push(name),
    registerCommand: (name: string, opts: any) => commands.set(name, opts),
  } as any;

  providerAuthExtension(pi);
  return { pi, registered, unregistered, commands };
}

describe("providerAuthExtension wiring", () => {
  beforeEach(() => {
    const p = modelsJsonPath(h.agentDir);
    if (existsSync(p)) rmSync(p);
  });

  afterAll(() => {
    rmSync(h.agentDir, { recursive: true, force: true });
  });

  it("registers antigravity on load so it appears under /login subscription", () => {
    const { registered } = harness();
    expect(registered.some((r) => r.name === "antigravity")).toBe(true);
    const ag = registered.find((r) => r.name === "antigravity")!;
    // The oauth block is what makes it show under /login → "Use a subscription".
    expect(ag.config.oauth).toBeTruthy();
    expect(typeof ag.config.oauth.login).toBe("function");
  });

  it("registers the Claude (anthropic) override on load with oauth + streamSimple", () => {
    const { registered } = harness();
    const claude = registered.find((r) => r.name === "anthropic");
    expect(claude).toBeTruthy();
    // OAuth block → /login subscription; streamSimple → the response transport.
    expect(claude!.config.oauth).toBeTruthy();
    expect(typeof claude!.config.oauth.login).toBe("function");
    expect(claude!.config.api).toBe("anthropic-messages");
    expect(typeof claude!.config.streamSimple).toBe("function");
    // An up-to-date Claude catalogue is declared (full replacement of pi's stale built-in list).
    expect(Array.isArray(claude!.config.models)).toBe(true);
    expect(claude!.config.models.map((m: any) => m.id)).toContain("claude-opus-4-8");
  });

  it("registers the Tencent hub on load so its hosted models surface under /model", () => {
    const { registered } = harness();
    const tencent = registered.find((r) => r.name === "tencent");
    expect(tencent).toBeTruthy();
    expect(tencent!.config.baseUrl).toBe("https://tokenhub-intl.tencentcloudmaas.com");
    expect(tencent!.config.api).toBe("anthropic-messages");
    // API-key hub (env-var reference), not an OAuth subscription provider.
    expect(tencent!.config.oauth).toBeUndefined();
    expect(tencent!.config.apiKey).toBe("$TENCENT_API_KEY");
    const ids = tencent!.config.models.map((m: any) => m.id);
    expect(ids).toContain("deepseek-v4-pro");
    expect(ids).toContain("kimi-k2.6");
  });


  it("does NOT register a /provider command (login is the only surface)", () => {
    const { commands } = harness();
    expect(commands.has("provider")).toBe(false);
    expect(commands.size).toBe(0);
  });

  it("loads custom providers from models.json at startup", () => {
    const p = modelsJsonPath(h.agentDir);
    mkdirSync(h.agentDir, { recursive: true });
    writeFileSync(
      p,
      JSON.stringify({
        providers: {
          ollama: {
            name: "Ollama (local)",
            baseUrl: "http://localhost:11434/v1",
            api: "openai-completions",
            apiKey: "ollama",
            models: [{ id: "llama3.1" }],
          },
        },
      }),
    );
    const { registered } = harness();
    const reg = registered.filter((r) => r.name === "ollama");
    expect(reg).toHaveLength(1);
    expect(reg[0].config.baseUrl).toBe("http://localhost:11434/v1");
    expect(reg[0].config.models.map((m: any) => m.id)).toContain("llama3.1");
  });

  it("does not crash or register a provider when models.json is malformed", () => {
    const p = modelsJsonPath(h.agentDir);
    mkdirSync(h.agentDir, { recursive: true });
    writeFileSync(p, "{ not json ");
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m?: any) => {
      errs.push(String(m));
    });
    const { registered } = harness();
    spy.mockRestore();
    // Antigravity still registered (load not blocked); no models.json provider added.
    expect(registered.some((r) => r.name === "antigravity")).toBe(true);
    expect(registered.some((r) => r.name === "ollama")).toBe(false);
    expect(errs.some((e) => /not valid JSON/.test(e))).toBe(true);
  });
});
