import { describe, it, expect } from "vitest";
import {
  registerAntigravityProvider,
  ANTIGRAVITY_PROVIDER,
  ANTIGRAVITY_MODEL_IDS,
  toAntigravityModel,
} from "../antigravity/register.js";
import { ANTIGRAVITY_DAILY_ENDPOINT } from "../antigravity/cca.js";

interface CapturedProvider {
  name: string;
  config: any;
}

function fakePi() {
  const providers: CapturedProvider[] = [];
  const pi = {
    registerProvider: (name: string, config: any) => providers.push({ name, config }),
    unregisterProvider: () => {},
    registerCommand: () => {},
  } as any;
  return { pi, providers };
}

describe("registerAntigravityProvider", () => {
  it("registers the antigravity provider with the CCA endpoint and google api", () => {
    const { pi, providers } = fakePi();
    registerAntigravityProvider(pi);

    expect(providers).toHaveLength(1);
    const { name, config } = providers[0];
    expect(name).toBe(ANTIGRAVITY_PROVIDER);
    expect(name).toBe("antigravity");
    expect(config.baseUrl).toBe(ANTIGRAVITY_DAILY_ENDPOINT);
    expect(config.api).toBe("google-generative-ai");
    // A non-empty placeholder apiKey is required so model defs validate even
    // before OAuth supplies the real bearer token.
    expect(typeof config.apiKey).toBe("string");
    expect(config.apiKey.length).toBeGreaterThan(0);
  });

  it("exposes the full oauth login contract (login/refresh/getApiKey)", () => {
    const { pi, providers } = fakePi();
    registerAntigravityProvider(pi);
    const { oauth } = providers[0].config;

    expect(oauth).toBeTruthy();
    expect(typeof oauth.name).toBe("string");
    expect(typeof oauth.login).toBe("function");
    expect(typeof oauth.refreshToken).toBe("function");
    expect(typeof oauth.getApiKey).toBe("function");
  });

  it("provides a streamSimple handler for the CCA proxy", () => {
    const { pi, providers } = fakePi();
    registerAntigravityProvider(pi);
    expect(typeof providers[0].config.streamSimple).toBe("function");
  });

  it("registers models that satisfy pi's required ProviderModelConfig fields", () => {
    const { pi, providers } = fakePi();
    registerAntigravityProvider(pi);
    const models = providers[0].config.models;

    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(typeof m.id).toBe("string");
      expect(m.id.startsWith("antigravity/")).toBe(true);
      expect(typeof m.name).toBe("string");
      expect(typeof m.reasoning).toBe("boolean");
      expect(Array.isArray(m.input)).toBe(true);
      expect(m.input.length).toBeGreaterThan(0);
      expect(m.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      expect(m.contextWindow).toBeGreaterThan(0);
      expect(m.maxTokens).toBeGreaterThan(0);
    }
  });

  it("model ids are unique", () => {
    const { pi, providers } = fakePi();
    registerAntigravityProvider(pi);
    const ids = providers[0].config.models.map((m: any) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("mirrors jeo-code's antigravity catalog ids (no bogus bare gemini-3-pro)", () => {
    const { pi, providers } = fakePi();
    registerAntigravityProvider(pi);
    const ids: string[] = providers[0].config.models.map((m: any) => m.id);

    // Real CCA thinking-depth variants, not the bare id the backend rejects.
    expect(ids).toContain("antigravity/gemini-3-pro-high");
    expect(ids).toContain("antigravity/gemini-3-pro-low");
    expect(ids).not.toContain("antigravity/gemini-3-pro");
    // Representative coverage across the Claude / Gemini / GPT families.
    expect(ids).toContain("antigravity/claude-sonnet-4-5");
    expect(ids).toContain("antigravity/claude-opus-4-8-thinking");
    expect(ids).toContain("antigravity/gpt-5.5");
    expect(ids).toContain("antigravity/gpt-oss-120b-medium");
    // Every id carries the provider prefix exactly once.
    for (const id of ids) expect(id.startsWith("antigravity/")).toBe(true);
    expect(ids.length).toBe(ANTIGRAVITY_MODEL_IDS.length);
  });

  it("derives per-family capabilities the way jeo-code's catalog does", () => {
    const claude = toAntigravityModel("claude-sonnet-4-5");
    expect(claude.contextWindow).toBe(200_000);
    expect(claude.maxTokens).toBe(64_000);
    expect(claude.input).toEqual(["text", "image"]);

    const gpt5 = toAntigravityModel("gpt-5.5");
    expect(gpt5.contextWindow).toBe(400_000);
    expect(gpt5.maxTokens).toBe(128_000);

    const gemini = toAntigravityModel("gemini-3-pro-high");
    expect(gemini.contextWindow).toBe(1_000_000);
    expect(gemini.maxTokens).toBe(65_536);
    expect(gemini.reasoning).toBe(true);

    // gpt-oss is the lone text-only family in the catalog.
    const oss = toAntigravityModel("gpt-oss-120b-medium");
    expect(oss.input).toEqual(["text"]);
  });
});
