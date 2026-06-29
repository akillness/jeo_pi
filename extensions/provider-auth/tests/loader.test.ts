import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadCustomProvidersFromConfig, toRuntimeModel } from "../loader.js";
import type { CustomProvider } from "../models-config.js";

function provider(over: Partial<CustomProvider> = {}): CustomProvider {
  return { baseUrl: "http://localhost:11434/v1", api: "openai-completions", apiKey: "k", models: [{ id: "m1" }], ...over };
}

function fakePi() {
  const registered: { name: string; config: any }[] = [];
  const pi = { registerProvider: (name: string, config: any) => registered.push({ name, config }) } as any;
  return { pi, registered };
}

describe("toRuntimeModel", () => {
  it("fills defaults for an id-only model", () => {
    const m = toRuntimeModel(provider(), { id: "x" });
    expect(m).toMatchObject({
      id: "x",
      name: "x",
      api: "openai-completions",
      reasoning: false,
      input: ["text"],
      contextWindow: 128_000,
      maxTokens: 8_192,
    });
    expect(m.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("preserves explicit model fields and inherits provider compat", () => {
    const p = provider({ compat: { supportsDeveloperRole: false } });
    const m = toRuntimeModel(p, { id: "y", name: "Y", reasoning: true, input: ["text", "image"], contextWindow: 1, maxTokens: 2 });
    expect(m.name).toBe("Y");
    expect(m.reasoning).toBe(true);
    expect(m.input).toEqual(["text", "image"]);
    expect(m.contextWindow).toBe(1);
    expect(m.maxTokens).toBe(2);
    expect(m.compat).toEqual({ supportsDeveloperRole: false });
  });
});

describe("loadCustomProvidersFromConfig", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pa-loader-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("registers providers that have models and returns their names", () => {
    writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { ollama: provider() } }));
    const { pi, registered } = fakePi();
    const res = loadCustomProvidersFromConfig(pi, dir);
    expect(res.registered).toEqual(["ollama"]);
    expect(res.skipped).toEqual([]);
    expect(registered).toHaveLength(1);
    expect(registered[0].config.models.map((m: any) => m.id)).toEqual(["m1"]);
  });

  it("skips (does not register) providers with no models", () => {
    writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { lmstudio: provider({ models: [] }) } }));
    const { pi, registered } = fakePi();
    const res = loadCustomProvidersFromConfig(pi, dir);
    expect(res.registered).toEqual([]);
    expect(res.skipped).toEqual(["lmstudio"]);
    expect(registered).toHaveLength(0);
  });

  it("returns empty result when models.json is absent", () => {
    const { pi, registered } = fakePi();
    const res = loadCustomProvidersFromConfig(pi, dir);
    expect(res).toEqual({ registered: [], skipped: [] });
    expect(registered).toHaveLength(0);
  });

  it("reports malformed models.json via onError instead of throwing", () => {
    writeFileSync(join(dir, "models.json"), "{ not json ");
    const { pi, registered } = fakePi();
    const errs: string[] = [];
    const res = loadCustomProvidersFromConfig(pi, dir, (m) => errs.push(m));
    expect(res).toEqual({ registered: [], skipped: [] });
    expect(registered).toHaveLength(0);
    expect(errs.some((e) => /not valid JSON/.test(e))).toBe(true);
  });

  it("registers multiple providers and passes through headers", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify({
        providers: {
          a: provider({ models: [{ id: "a1" }] }),
          b: provider({ headers: { "X-Test": "1" }, models: [{ id: "b1" }] }),
        },
      }),
    );
    const { pi, registered } = fakePi();
    const res = loadCustomProvidersFromConfig(pi, dir);
    expect(res.registered.sort()).toEqual(["a", "b"]);
    const b = registered.find((r) => r.name === "b")!;
    expect(b.config.headers).toEqual({ "X-Test": "1" });
  });
});
