import { describe, it, expect } from "vitest";
import {
  registerTencentProvider,
  toTencentModel,
  TENCENT_PROVIDER,
  TENCENT_BASE_URL,
  TENCENT_API_KEY_ENV,
  TENCENT_DEFAULT_MODEL,
  TENCENT_MODEL_IDS,
  TENCENT_MODELS,
} from "../tencent/register.js";

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

describe("registerTencentProvider", () => {
  it("registers the tencent hub against the TokenHub Anthropic endpoint", () => {
    const { pi, providers } = fakePi();
    registerTencentProvider(pi);

    expect(providers).toHaveLength(1);
    const { name, config } = providers[0];
    expect(name).toBe(TENCENT_PROVIDER);
    expect(name).toBe("tencent");
    expect(config.baseUrl).toBe(TENCENT_BASE_URL);
    expect(config.baseUrl).toBe("https://tokenhub-intl.tencentcloudmaas.com");
    // TokenHub speaks the Anthropic Messages wire format.
    expect(config.api).toBe("anthropic-messages");
  });

  it("passes the TENCENT_API_KEY env-var name as the provider apiKey", () => {
    const { pi, providers } = fakePi();
    registerTencentProvider(pi);
    // pi resolves an env-var name to its value at request time, so the literal
    // env-var name (not a baked key) is what we register.
    expect(providers[0].config.apiKey).toBe(TENCENT_API_KEY_ENV);
    expect(providers[0].config.apiKey).toBe("TENCENT_API_KEY");
  });

  it("is an API-key hub, not an OAuth subscription provider", () => {
    const { pi, providers } = fakePi();
    registerTencentProvider(pi);
    expect(providers[0].config.oauth).toBeUndefined();
  });

  it("registers every hosted model with pi's required ProviderModelConfig fields", () => {
    const { pi, providers } = fakePi();
    registerTencentProvider(pi);
    const models = providers[0].config.models;

    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBe(TENCENT_MODEL_IDS.length);
    for (const m of models) {
      expect(typeof m.id).toBe("string");
      expect(m.id.startsWith("tencent/")).toBe(true);
      expect(typeof m.name).toBe("string");
      expect(typeof m.reasoning).toBe("boolean");
      expect(Array.isArray(m.input)).toBe(true);
      expect(m.contextWindow).toBeGreaterThan(0);
      expect(m.maxTokens).toBeGreaterThan(0);
      expect(m.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    }
  });

  it("covers the DeepSeek / MiniMax / GLM / Kimi / Hunyuan families the hub hosts", () => {
    const ids = TENCENT_MODEL_IDS.map((e) => e.id);
    expect(ids).toContain("deepseek-v4-pro");
    expect(ids).toContain("minimax-m3");
    expect(ids).toContain("glm-5.2");
    expect(ids).toContain("glm-5v-turbo");
    expect(ids).toContain("kimi-k2.6");
    expect(ids).toContain("hy-mt2-plus");
    // The catalogued default must be one of the hosted ids.
    expect(ids).toContain(TENCENT_DEFAULT_MODEL);
  });
});

describe("toTencentModel", () => {
  it("namespaces the id and marks text-only models with thinking enabled", () => {
    const m = toTencentModel({ id: "deepseek-v4-pro" });
    expect(m.id).toBe("tencent/deepseek-v4-pro");
    expect(m.name).toBe("deepseek-v4-pro (Tencent)");
    expect(m.reasoning).toBe(true);
    expect(m.input).toEqual(["text"]);
    expect(m.contextWindow).toBe(128_000);
    expect(m.maxTokens).toBe(8_192);
  });

  it("flags the GLM vision line as accepting image input", () => {
    const vision = toTencentModel({ id: "glm-5v-turbo", vision: true });
    expect(vision.input).toEqual(["text", "image"]);

    const text = toTencentModel({ id: "glm-5-turbo" });
    expect(text.input).toEqual(["text"]);
  });

  it("only the glm-5v vision member declares image input across the full hub", () => {
    const visionModels = TENCENT_MODELS.filter((m) => m.input.includes("image"));
    expect(visionModels.map((m) => m.id)).toEqual(["tencent/glm-5v-turbo"]);
  });
});
