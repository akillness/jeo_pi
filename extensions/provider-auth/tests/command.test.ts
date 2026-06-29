import { describe, it, expect } from "vitest";
import {
  parseProviderCommand,
  applyToConfig,
  statusReport,
  toRuntimeModel,
} from "../command.js";
import type { CustomProvider, ModelsConfig } from "../models-config.js";

describe("parseProviderCommand", () => {
  it("treats empty / status / list as a status action", () => {
    for (const s of ["", "   ", "status", "list", "LIST"]) {
      expect(parseProviderCommand(s).kind).toBe("status");
    }
  });

  it("maps claude and anthropic to the claude action", () => {
    expect(parseProviderCommand("claude").kind).toBe("claude");
    expect(parseProviderCommand("anthropic").kind).toBe("claude");
  });

  it("maps antigravity", () => {
    expect(parseProviderCommand("antigravity").kind).toBe("antigravity");
  });

  it("parses remove/rm/delete with a name", () => {
    const a = parseProviderCommand("remove foo");
    expect(a).toEqual({ kind: "remove", name: "foo" });
    expect(parseProviderCommand("rm bar").kind).toBe("remove");
    expect(parseProviderCommand("delete baz").kind).toBe("remove");
  });

  it("errors when remove has no name", () => {
    const a = parseProviderCommand("remove");
    expect(a.kind).toBe("error");
  });

  it("configures ollama with default models when none supplied", () => {
    const a = parseProviderCommand("ollama");
    expect(a.kind).toBe("configure");
    if (a.kind === "configure") {
      expect(a.name).toBe("ollama");
      expect(a.provider.models.length).toBeGreaterThan(0);
    }
  });

  it("treats a leading http token after ollama as the baseUrl", () => {
    const a = parseProviderCommand("ollama http://box:11434/v1 llama3");
    expect(a.kind).toBe("configure");
    if (a.kind === "configure") {
      expect(a.provider.baseUrl).toBe("http://box:11434/v1");
      expect(a.provider.models.map((m) => m.id)).toEqual(["llama3"]);
    }
  });

  it("treats non-url tokens after lmstudio as model ids", () => {
    const a = parseProviderCommand("lmstudio my-model");
    if (a.kind === "configure") {
      expect(a.provider.baseUrl).toBe("http://localhost:1234/v1");
      expect(a.provider.models.map((m) => m.id)).toEqual(["my-model"]);
    }
  });

  it("parses 'api' custom providers via parseCustomApiArgs", () => {
    const a = parseProviderCommand("api myapi https://x/v1 m1");
    expect(a.kind).toBe("configure");
    if (a.kind === "configure") expect(a.name).toBe("myapi");
  });

  it("returns an error with usage hint for malformed api args", () => {
    const a = parseProviderCommand("api onlyname");
    expect(a.kind).toBe("error");
    if (a.kind === "error") expect(a.message).toMatch(/Usage: \/provider api/);
  });

  it("returns an error for an unknown target", () => {
    const a = parseProviderCommand("bogus");
    expect(a.kind).toBe("error");
  });
});

describe("applyToConfig", () => {
  const prov: CustomProvider = { baseUrl: "http://x/v1", api: "openai-completions", apiKey: "k", models: [{ id: "m" }] };

  it("upserts on configure", () => {
    const next = applyToConfig({}, { kind: "configure", name: "p", provider: prov });
    expect(next.providers?.p).toBeDefined();
  });

  it("removes on remove", () => {
    const a = applyToConfig({}, { kind: "configure", name: "p", provider: prov });
    const b = applyToConfig(a, { kind: "remove", name: "p" });
    expect(b.providers?.p).toBeUndefined();
  });

  it("returns config unchanged for non-mutating actions", () => {
    const config: ModelsConfig = { providers: {} };
    expect(applyToConfig(config, { kind: "status" })).toBe(config);
  });
});

describe("statusReport", () => {
  it("lists built-in auth guidance and configured custom providers", () => {
    const config: ModelsConfig = {
      providers: { ollama: { baseUrl: "http://x/v1", api: "openai-completions", apiKey: "k", models: [{ id: "m1" }] } },
    };
    const report = statusReport(config);
    expect(report).toMatch(/claude/);
    expect(report).toMatch(/antigravity/);
    expect(report).toMatch(/ollama → http:\/\/x\/v1/);
    expect(report).toMatch(/m1/);
  });

  it("notes (no models yet) for a provider with no models", () => {
    const config: ModelsConfig = {
      providers: { lmstudio: { baseUrl: "http://x/v1", api: "openai-completions", apiKey: "k", models: [] } },
    };
    expect(statusReport(config)).toMatch(/\(no models yet\)/);
  });
});

describe("toRuntimeModel", () => {
  const prov: CustomProvider = {
    baseUrl: "http://x/v1",
    api: "openai-completions",
    apiKey: "k",
    compat: { supportsDeveloperRole: false },
    models: [],
  };

  it("fills defaults for a minimal model and inherits provider compat", () => {
    const m = toRuntimeModel(prov, { id: "m1" });
    expect(m).toMatchObject({
      id: "m1",
      name: "m1",
      api: "openai-completions",
      reasoning: false,
      input: ["text"],
      contextWindow: 128_000,
      maxTokens: 8_192,
    });
    expect(m.compat).toEqual({ supportsDeveloperRole: false });
    expect(m.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("preserves explicit model fields and per-model compat", () => {
    const m = toRuntimeModel(prov, {
      id: "m2",
      name: "Big",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1000,
      maxTokens: 50,
      compat: { supportsReasoningEffort: true },
    });
    expect(m.name).toBe("Big");
    expect(m.reasoning).toBe(true);
    expect(m.input).toEqual(["text", "image"]);
    expect(m.contextWindow).toBe(1000);
    expect(m.maxTokens).toBe(50);
    expect(m.compat).toEqual({ supportsReasoningEffort: true });
  });
});
