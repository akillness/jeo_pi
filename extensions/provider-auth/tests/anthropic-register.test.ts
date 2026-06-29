import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { getOAuthProviders, registerOAuthProvider, resetOAuthProviders } from "@mariozechner/pi-ai/oauth";
import type { Context, Model } from "@mariozechner/pi-ai";
import { ANTHROPIC_API, ANTHROPIC_PROVIDER, registerAnthropicProvider } from "../anthropic/register.js";

/** Capture the provider config the extension hands to pi.registerProvider. */
function captureConfig(): any {
  let captured: any;
  const pi = {
    registerProvider: (name: string, config: any) => {
      if (name === ANTHROPIC_PROVIDER) captured = config;
    },
    unregisterProvider: () => {},
    registerCommand: () => {},
  } as any;
  registerAnthropicProvider(pi);
  return captured;
}

/** Mirror pi's model-registry OAuth-registration step. */
function applyOAuthLikeModelRegistry(providerName: string, config: any): void {
  if (config.oauth) registerOAuthProvider({ ...config.oauth, id: providerName });
}

describe("registerAnthropicProvider config", () => {
  it("registers the anthropic-messages api with a streamSimple transport", () => {
    const config = captureConfig();
    expect(config.api).toBe(ANTHROPIC_API);
    expect(typeof config.streamSimple).toBe("function");
  });

  it("carries the full OAuth login contract /login drives", () => {
    const config = captureConfig();
    expect(config.oauth).toBeTruthy();
    expect(config.oauth.name).toMatch(/Claude Pro\/Max/);
    expect(typeof config.oauth.login).toBe("function");
    expect(typeof config.oauth.refreshToken).toBe("function");
    expect(typeof config.oauth.getApiKey).toBe("function");
  });

  it("declares an up-to-date Claude catalogue pinned to the OAuth transport", () => {
    const config = captureConfig();
    expect(config.baseUrl).toBe("https://api.anthropic.com");
    expect(Array.isArray(config.models)).toBe(true);
    const ids = config.models.map((m: any) => m.id);
    // Current direct-API ids (jeo-code parity) — the picker is no longer stale.
    expect(ids).toContain("claude-opus-4-8");
    expect(ids).toContain("claude-opus-4-6");
    expect(ids).toContain("claude-sonnet-4-5-20250929");
    expect(ids).toContain("claude-haiku-4-5-20251001");
    // Every Claude model routes through OUR anthropic-messages transport — the
    // Claude Code identity shape that avoids the 400 third-party rejection.
    for (const m of config.models) {
      expect(m.api).toBe(ANTHROPIC_API);
      expect(m.contextWindow).toBe(200_000);
      expect(m.input).toEqual(["text", "image"]);
    }
    // opus 4.x advertise extended thinking; legacy 3.5 sonnet does not.
    const opus48 = config.models.find((m: any) => m.id === "claude-opus-4-8");
    expect(opus48.reasoning).toBe(true);
    const legacy = config.models.find((m: any) => m.id === "claude-3-5-sonnet-20241022");
    expect(legacy.reasoning).toBe(false);
  });
});

describe("/login subscription registry (OAuth) — Claude override", () => {
  beforeEach(() => resetOAuthProviders());

  it("replaces the built-in anthropic OAuth provider with the jeo-code flow", () => {
    const before = getOAuthProviders().find((p) => p.id === "anthropic");
    expect(before).toBeTruthy();

    const config = captureConfig();
    applyOAuthLikeModelRegistry(ANTHROPIC_PROVIDER, config);

    const after = getOAuthProviders().find((p) => p.id === "anthropic");
    expect(after).toBeTruthy();
    expect(after!.name).toMatch(/Claude Pro\/Max/);
    expect(typeof (after as any).login).toBe("function");
  });
});

describe("streamSimple forwards options into the Anthropic stream", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function sseResponse(events: string[]): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const e of events) controller.enqueue(enc.encode(`data: ${e}\n\n`));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  async function drain(stream: AsyncIterable<any>): Promise<any[]> {
    const out: any[] = [];
    for await (const e of stream) out.push(e);
    return out;
  }

  const model = {
    id: "claude-sonnet-4-5",
    api: "anthropic-messages",
    provider: "anthropic",
  } as unknown as Model<"anthropic-messages">;
  const context: Context = { systemPrompt: "sys", messages: [{ role: "user", content: "hi", timestamp: 0 }] };

  it("streams thinking + text deltas and finishes with done", async () => {
    let sentBody: any;
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      sentBody = JSON.parse(init.body);
      return sseResponse([
        JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }),
        JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } }),
        JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }),
        JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "text" } }),
        JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello" } }),
        JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } }),
      ]);
    }) as any;

    const config = captureConfig();
    const events = await drain(
      config.streamSimple(model, context, { apiKey: "sk-ant-oat01-x", reasoning: "low", maxTokens: 8000 }),
    );
    const types = events.map((e) => e.type);
    expect(types).toContain("thinking_delta");
    expect(types).toContain("text_delta");
    expect(types[types.length - 1]).toBe("done");
    const done = events[events.length - 1];
    expect(done.reason).toBe("stop");
    expect(done.message.content.find((c: any) => c.type === "text").text).toBe("Hello");
    const think = done.message.content.find((c: any) => c.type === "thinking");
    expect(think.thinking).toBe("hmm");
    expect(think.thinkingSignature).toBe("sig");
    // Options were threaded into the request (OAuth token → thinking enabled).
    expect(sentBody.thinking).toBeTruthy();
  });

  it("surfaces an empty 200 stream as an explicit error event", async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([JSON.stringify({ type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 0 } })]),
    ) as any;
    const config = captureConfig();
    const events = await drain(config.streamSimple(model, context, { apiKey: "sk-ant-oat01-x" }));
    const last = events[events.length - 1];
    expect(last.type).toBe("error");
    expect(last.error.errorMessage).toMatch(/no content/);
    expect(last.error.errorMessage).toMatch(/max_tokens/);
  });

  it("errors when no credential is supplied", async () => {
    const config = captureConfig();
    const events = await drain(config.streamSimple(model, context, {}));
    const last = events[events.length - 1];
    expect(last.type).toBe("error");
    expect(last.error.errorMessage).toMatch(/Claude requires a credential/);
  });
});
