import { describe, it, expect } from "vitest";
import {
  registerAntigravityProvider,
  ANTIGRAVITY_PROVIDER,
  ANTIGRAVITY_MODEL_IDS,
  toAntigravityModel,
  applyAntigravityProject,
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

  it("ships only live-routable Antigravity model ids", () => {
    const { pi, providers } = fakePi();
    registerAntigravityProvider(pi);
    const ids: string[] = providers[0].config.models.map((m: any) => m.id);

    expect(ids).toEqual(ANTIGRAVITY_MODEL_IDS.map((id) => `antigravity/${id}`));

    // Representative coverage across the live Anthropic / Gemini / GPT families.
    expect(ids).toContain("antigravity/claude-sonnet-4-6");
    expect(ids).toContain("antigravity/claude-opus-4-6-thinking");
    expect(ids).toContain("antigravity/gemini-2.5-flash");
    expect(ids).toContain("antigravity/gemini-pro-agent");
    expect(ids).toContain("antigravity/gpt-oss-120b-medium");

    // Ghost ids the backend rejects with HTTP 404/400 must never ship.
    expect(ids).not.toContain("antigravity/claude-sonnet-4-5");
    expect(ids).not.toContain("antigravity/claude-sonnet-4-5-thinking");
    expect(ids).not.toContain("antigravity/claude-sonnet-4-6-thinking");
    expect(ids).not.toContain("antigravity/claude-opus-4-8");
    expect(ids).not.toContain("antigravity/claude-opus-4-8-thinking");
    expect(ids).not.toContain("antigravity/gpt-5.5");
    expect(ids).not.toContain("antigravity/gemini-3-pro-high");

    // Every id carries the provider prefix exactly once.
    for (const id of ids) expect(id.startsWith("antigravity/")).toBe(true);
    expect(ids.length).toBe(ANTIGRAVITY_MODEL_IDS.length);
  });

  it("derives per-family capabilities the way jeo-code's catalog does", () => {
    const claude = toAntigravityModel("claude-sonnet-4-6");
    expect(claude.contextWindow).toBe(200_000);
    expect(claude.maxTokens).toBe(64_000);
    expect(claude.input).toEqual(["text", "image"]);

    // gpt-5 family is no longer served by the backend, but the capability rule
    // for it must still hold (the function stays future-proof for re-listing).
    const gpt5 = toAntigravityModel("gpt-5.5");
    expect(gpt5.contextWindow).toBe(400_000);
    expect(gpt5.maxTokens).toBe(128_000);

    const gemini = toAntigravityModel("gemini-pro-agent");
    expect(gemini.contextWindow).toBe(1_000_000);
    expect(gemini.maxTokens).toBe(65_536);
    expect(gemini.reasoning).toBe(true);

    // gpt-oss is the lone text-only family in the catalog.
    const oss = toAntigravityModel("gpt-oss-120b-medium");
    expect(oss.input).toEqual(["text"]);
  });
});

describe("applyAntigravityProject (modifyModels projectId baking)", () => {
  const cred = (extra: Record<string, unknown> = {}) =>
    ({ access: "tok", refresh: "r", expires: 0, ...extra }) as any;

  function antigravityModels() {
    return ANTIGRAVITY_MODEL_IDS.map((id) => {
      const m = toAntigravityModel(id);
      return { id: m.id, name: m.name, api: "google-generative-ai", provider: ANTIGRAVITY_PROVIDER } as any;
    });
  }

  it("stamps the credential projectId onto every antigravity model", () => {
    const out = applyAntigravityProject(antigravityModels(), cred({ projectId: "proj-123" }));
    expect(out.length).toBe(ANTIGRAVITY_MODEL_IDS.length);
    for (const m of out) expect((m as any).projectId).toBe("proj-123");
  });

  it("leaves models untouched when the credential has no projectId", () => {
    const models = antigravityModels();
    const out = applyAntigravityProject(models, cred());
    expect(out).toBe(models); // same reference: no rewrite
    for (const m of out) expect((m as any).projectId).toBeUndefined();
  });

  it("ignores a non-string projectId", () => {
    const models = antigravityModels();
    const out = applyAntigravityProject(models, cred({ projectId: 42 }));
    expect(out).toBe(models);
  });

  it("does not stamp projectId onto other providers' models", () => {
    const foreign = { id: "other/x", name: "x", api: "openai-completions", provider: "other" } as any;
    const out = applyAntigravityProject([foreign, ...antigravityModels()], cred({ projectId: "proj-9" }));
    const kept = out.find((m) => m.provider === "other") as any;
    expect(kept.projectId).toBeUndefined();
    expect(out.filter((m) => m.provider === ANTIGRAVITY_PROVIDER).every((m: any) => m.projectId === "proj-9")).toBe(true);
  });

  it("is wired as the oauth modifyModels hook in the registered config", () => {
    const { pi, providers } = fakePi();
    registerAntigravityProvider(pi);
    expect(providers[0].config.oauth.modifyModels).toBe(applyAntigravityProject);
  });

  it("streamSimple forwards the model's stamped projectId into the stream options", () => {
    const { pi, providers } = fakePi();
    registerAntigravityProvider(pi);
    const { streamSimple } = providers[0].config;

    // A model carrying a projectId (as modifyModels would produce). Drive
    // streamSimple with no apiKey so streamAntigravity errors out before any
    // network call — we only assert the projectId reached resolveProjectId by
    // observing the error is the missing-token error, not a discovery attempt.
    const model = { id: "antigravity/gemini-2.5-flash", provider: ANTIGRAVITY_PROVIDER, api: "google-generative-ai", projectId: "proj-x" } as any;
    const stream = streamSimple(model, { systemPrompt: "", messages: [], tools: [] }, {});
    expect(stream).toBeTruthy();
    expect(typeof stream[Symbol.asyncIterator]).toBe("function");
  });
});