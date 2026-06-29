import { describe, it, expect } from "vitest";
import { PRESETS, PRESET_NAMES, providerFromPreset, parseCustomApiArgs } from "../presets.js";

describe("PRESETS", () => {
  it("exposes ollama and lmstudio as local keyless openai-completions endpoints", () => {
    expect(PRESET_NAMES.sort()).toEqual(["lmstudio", "ollama"]);
    for (const name of PRESET_NAMES) {
      const p = PRESETS[name];
      expect(p.api).toBe("openai-completions");
      expect(p.baseUrl).toMatch(/^http:\/\/localhost:/);
      // Local OpenAI shims reject the developer role and reasoning_effort.
      expect(p.compat?.supportsDeveloperRole).toBe(false);
      expect(p.compat?.supportsReasoningEffort).toBe(false);
    }
  });
});

describe("providerFromPreset", () => {
  it("uses default models and baseUrl when no overrides given", () => {
    const p = providerFromPreset(PRESETS.ollama);
    expect(p.baseUrl).toBe(PRESETS.ollama.baseUrl);
    expect(p.models.map((m) => m.id)).toEqual(PRESETS.ollama.defaultModels);
    expect(p.compat?.supportsDeveloperRole).toBe(false);
  });

  it("overrides baseUrl (trimmed) and model ids", () => {
    const p = providerFromPreset(PRESETS.ollama, { baseUrl: "  http://host:9/v1  ", models: ["x", "y"] });
    expect(p.baseUrl).toBe("http://host:9/v1");
    expect(p.models.map((m) => m.id)).toEqual(["x", "y"]);
  });

  it("falls back to preset baseUrl when override is blank", () => {
    const p = providerFromPreset(PRESETS.ollama, { baseUrl: "   " });
    expect(p.baseUrl).toBe(PRESETS.ollama.baseUrl);
  });

  it("keeps empty default models when preset has none and none supplied", () => {
    const p = providerFromPreset(PRESETS.lmstudio);
    expect(p.models).toEqual([]);
  });
});

describe("parseCustomApiArgs", () => {
  it("parses name, baseUrl and model ids with default api", () => {
    const { name, provider } = parseCustomApiArgs(["myapi", "https://api.example.com/v1", "modelA", "modelB"]);
    expect(name).toBe("myapi");
    expect(provider.baseUrl).toBe("https://api.example.com/v1");
    expect(provider.api).toBe("openai-completions");
    expect(provider.models.map((m) => m.id)).toEqual(["modelA", "modelB"]);
  });

  it("derives a default env-var apiKey from the name", () => {
    const { provider } = parseCustomApiArgs(["my-api", "https://x/v1"]);
    expect(provider.apiKey).toBe("MY_API_API_KEY");
  });

  it("honours --api, --key and --header flags in any position", () => {
    const { provider } = parseCustomApiArgs([
      "p",
      "--api",
      "anthropic-messages",
      "https://x/v1",
      "--key",
      "MY_KEY",
      "--header",
      "X-Org=acme",
      "model1",
    ]);
    expect(provider.api).toBe("anthropic-messages");
    expect(provider.apiKey).toBe("MY_KEY");
    expect(provider.headers).toEqual({ "X-Org": "acme" });
    expect(provider.models.map((m) => m.id)).toEqual(["model1"]);
  });

  it("preserves '=' in header values", () => {
    const { provider } = parseCustomApiArgs(["p", "https://x/v1", "--header", "Auth=a=b=c"]);
    expect(provider.headers).toEqual({ Auth: "a=b=c" });
  });

  it("throws when name is missing", () => {
    expect(() => parseCustomApiArgs([])).toThrow(/name is required/);
  });

  it("throws when baseUrl is missing", () => {
    expect(() => parseCustomApiArgs(["onlyname"])).toThrow(/baseUrl is required/);
  });

  it("throws on an unknown --api", () => {
    expect(() => parseCustomApiArgs(["p", "https://x", "--api", "bogus"])).toThrow(/unknown --api/);
  });

  it("throws when a flag is missing its value", () => {
    expect(() => parseCustomApiArgs(["p", "https://x", "--key"])).toThrow(/--key requires/);
    expect(() => parseCustomApiArgs(["p", "https://x", "--api"])).toThrow(/--api requires/);
    expect(() => parseCustomApiArgs(["p", "https://x", "--header", "noequals"])).toThrow(/--header requires/);
  });
});
