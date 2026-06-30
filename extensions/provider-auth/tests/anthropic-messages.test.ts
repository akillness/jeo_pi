import { describe, it, expect } from "vitest";
import type { Message } from "@mariozechner/pi-ai";
import {
  ANTHROPIC_URL,
  anthropicAdaptiveEffort,
  anthropicThinkingBudget,
  anthropicThinkingMode,
  buildAnthropicMessages,
  buildAnthropicRequest,
  headersFor,
  isOAuthToken,
  isGenuineAnthropicHost,
  shouldUseOAuthShape,
  isEffortUnsupportedError,
  isReasoningArtifactError,
  isThirdPartyUsageError,
  parseAnthropicVersion,
  stripAnthropicPrefix,
  supportsAdaptiveThinkingDisplay,
} from "../anthropic/messages.js";

const OAUTH_TOKEN = "sk-ant-oat01-abc";
const API_KEY = "sk-ant-api03-abc";

function parseBody(model: string, extra: Partial<Parameters<typeof buildAnthropicRequest>[0]> = {}) {
  const { body } = buildAnthropicRequest({
    model,
    accessToken: OAUTH_TOKEN,
    oauth: true,
    messages: [{ role: "user", content: "hi", timestamp: 0 }],
    ...extra,
  });
  return JSON.parse(body);
}

describe("isOAuthToken", () => {
  it("recognises Claude OAuth access tokens, not API keys", () => {
    expect(isOAuthToken(OAUTH_TOKEN)).toBe(true);
    expect(isOAuthToken(API_KEY)).toBe(false);
  });
});

const TOKENHUB = "https://tokenhub-intl.tencentcloudmaas.com";
const ANTHROPIC_HOST = "https://api.anthropic.com";

describe("isGenuineAnthropicHost", () => {
  it("treats a missing baseUrl as the genuine Anthropic endpoint", () => {
    expect(isGenuineAnthropicHost(undefined)).toBe(true);
  });
  it("recognises the real Anthropic host", () => {
    expect(isGenuineAnthropicHost(ANTHROPIC_HOST)).toBe(true);
    expect(isGenuineAnthropicHost("https://api.anthropic.com/")).toBe(true);
  });
  it("rejects compatible hubs and look-alikes", () => {
    expect(isGenuineAnthropicHost(TOKENHUB)).toBe(false);
    expect(isGenuineAnthropicHost("https://api.anthropic.com.evil.test")).toBe(false);
    expect(isGenuineAnthropicHost("not a url")).toBe(false);
  });
});

describe("shouldUseOAuthShape", () => {
  it("uses OAuth cloaking only for a Claude token on the genuine Anthropic host", () => {
    expect(shouldUseOAuthShape(OAUTH_TOKEN, undefined)).toBe(true);
    expect(shouldUseOAuthShape(OAUTH_TOKEN, ANTHROPIC_HOST)).toBe(true);
  });
  it("never sends a Claude OAuth token's cloaking to a compatible hub", () => {
    // The core "Tencent has no OAuth" guarantee: even an oat-looking key on
    // TokenHub falls back to the plain x-api-key Messages shape.
    expect(shouldUseOAuthShape(OAUTH_TOKEN, TOKENHUB)).toBe(false);
  });
  it("uses the api-key shape for a non-OAuth key regardless of host", () => {
    expect(shouldUseOAuthShape(API_KEY, ANTHROPIC_HOST)).toBe(false);
    expect(shouldUseOAuthShape(API_KEY, TOKENHUB)).toBe(false);
  });
});

describe("stripAnthropicPrefix", () => {
  it("removes a leading anthropic/ provider prefix", () => {
    expect(stripAnthropicPrefix("anthropic/claude-opus-4-1")).toBe("claude-opus-4-1");
    expect(stripAnthropicPrefix("claude-opus-4-1")).toBe("claude-opus-4-1");
  });
});

describe("parseAnthropicVersion", () => {
  it("parses modern family + version, rejects legacy/foreign ids", () => {
    expect(parseAnthropicVersion("claude-opus-4-7")).toEqual({ kind: "opus", major: 4, minor: 7 });
    expect(parseAnthropicVersion("claude-sonnet-4-5-thinking")).toEqual({ kind: "sonnet", major: 4, minor: 5 });
    expect(parseAnthropicVersion("claude-3-5-sonnet")).toBeUndefined();
    expect(parseAnthropicVersion("gpt-5")).toBeUndefined();
  });
});

describe("anthropicThinkingMode", () => {
  it("selects adaptive for 4.6+, budget-effort only for Opus 4.5, budget otherwise", () => {
    expect(anthropicThinkingMode("claude-opus-4-7")).toBe("adaptive");
    expect(anthropicThinkingMode("claude-sonnet-4-6")).toBe("adaptive");
    // Opus 4.5 accepts output_config.effort alongside budget thinking.
    expect(anthropicThinkingMode("claude-opus-4-5-20251101")).toBe("budget-effort");
    // Sonnet/Haiku 4.5 REJECT the effort parameter → plain budget thinking.
    expect(anthropicThinkingMode("claude-sonnet-4-5")).toBe("budget");
    expect(anthropicThinkingMode("claude-haiku-4-5")).toBe("budget");
    expect(anthropicThinkingMode("claude-3-5-sonnet")).toBe("budget");
  });
});

describe("supportsAdaptiveThinkingDisplay", () => {
  it("is gated to Opus >= 4.7", () => {
    expect(supportsAdaptiveThinkingDisplay("claude-opus-4-7")).toBe(true);
    expect(supportsAdaptiveThinkingDisplay("claude-opus-4-8")).toBe(true);
    expect(supportsAdaptiveThinkingDisplay("claude-opus-4-6")).toBe(false);
    expect(supportsAdaptiveThinkingDisplay("claude-sonnet-4-7")).toBe(false);
  });
});

describe("anthropicThinkingBudget", () => {
  it("scales by level and stays under max_tokens; unset stays non-thinking", () => {
    expect(anthropicThinkingBudget("minimal", 64000)).toBe(2000);
    expect(anthropicThinkingBudget("high", 64000)).toBe(24000);
    expect(anthropicThinkingBudget(undefined, 64000)).toBeUndefined();
    // Clamped below maxTokens - 1024.
    expect(anthropicThinkingBudget("high", 4000)).toBe(2976);
  });
});

describe("anthropicAdaptiveEffort", () => {
  it("folds minimal→low and xhigh→high", () => {
    expect(anthropicAdaptiveEffort("minimal")).toBe("low");
    expect(anthropicAdaptiveEffort("low")).toBe("low");
    expect(anthropicAdaptiveEffort("medium")).toBe("medium");
    expect(anthropicAdaptiveEffort("xhigh")).toBe("high");
  });
});

describe("headersFor", () => {
  it("sends Claude Code OAuth identity headers + full beta set for a bearer token", () => {
    const h = headersFor(true, OAUTH_TOKEN, true, "claude-sonnet-4-5");
    expect(h.authorization).toBe(`Bearer ${OAUTH_TOKEN}`);
    expect(h["x-app"]).toBe("cli");
    expect(h["user-agent"]).toMatch(/^claude-cli\//);
    expect(h.accept).toBe("text/event-stream");
    const beta = h["anthropic-beta"];
    expect(beta).toContain("claude-code-20250219");
    expect(beta).toContain("oauth-2025-04-20");
    expect(beta).toContain("interleaved-thinking-2025-05-14");
  });

  it("drops the interleaved-thinking beta for adaptive-display models", () => {
    const h = headersFor(true, OAUTH_TOKEN, true, "claude-opus-4-7");
    expect(h["anthropic-beta"]).not.toContain("interleaved-thinking-2025-05-14");
    expect(h["anthropic-beta"]).toContain("oauth-2025-04-20");
  });

  it("uses x-api-key (no oauth headers) for an API-key request", () => {
    const h = headersFor(false, API_KEY, false, "claude-sonnet-4-5");
    expect(h["x-api-key"]).toBe(API_KEY);
    expect(h.authorization).toBeUndefined();
    expect(h.accept).toBe("application/json");
    expect(h["anthropic-beta"]).toContain("interleaved-thinking-2025-05-14");
  });
});

describe("buildAnthropicMessages", () => {
  it("keeps plain user/assistant turns as string content", () => {
    const msgs: Message[] = [
      { role: "user", content: "hello", timestamp: 0 },
      {
        role: "assistant",
        content: [{ type: "text", text: "hi there" }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: 0,
      },
    ];
    expect(buildAnthropicMessages(msgs, false)).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ]);
  });

  it("reconstructs native tool_use + merges consecutive tool_results into one user turn", () => {
    const msgs: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "calling" },
          { type: "toolCall", id: "t1", name: "read", arguments: { path: "a" } },
          { type: "toolCall", id: "t2", name: "read", arguments: { path: "b" } },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "toolUse",
        timestamp: 0,
      },
      { role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "A" }], isError: false, timestamp: 0 },
      { role: "toolResult", toolCallId: "t2", toolName: "read", content: [{ type: "text", text: "B" }], isError: false, timestamp: 0 },
    ];
    const out = buildAnthropicMessages(msgs, true);
    expect(out).toHaveLength(2);
    const assistant = out[0].content as any[];
    expect(assistant.filter((b) => b.type === "tool_use").map((b) => b.id)).toEqual(["t1", "t2"]);
    const user = out[1].content as any[];
    expect(user).toHaveLength(2);
    expect(user[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1", content: "A", is_error: false });
    expect(user[1]).toMatchObject({ type: "tool_result", tool_use_id: "t2", content: "B" });
  });

  it("replays signed thinking blocks only when thinking is enabled", () => {
    const assistant: Message = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "ponder", thinkingSignature: "sig-1" },
        { type: "text", text: "answer" },
        { type: "toolCall", id: "t1", name: "x", arguments: {} },
      ],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "toolUse",
      timestamp: 0,
    };
    const withThinking = buildAnthropicMessages([assistant], true)[0].content as any[];
    expect(withThinking[0]).toEqual({ type: "thinking", thinking: "ponder", signature: "sig-1" });
    const stripped = buildAnthropicMessages([assistant], false)[0].content as any[];
    expect(stripped.some((b) => b.type === "thinking")).toBe(false);
    expect(stripped.some((b) => b.type === "tool_use")).toBe(true);
  });

  it("encodes user image attachments as base64 image blocks", () => {
    const msgs: Message[] = [
      { role: "user", content: [{ type: "image", data: "BASE64", mimeType: "image/png" }, { type: "text", text: "what is this" }], timestamp: 0 },
    ];
    const content = buildAnthropicMessages(msgs, false)[0].content as any[];
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: "BASE64" } });
    expect(content[1]).toEqual({ type: "text", text: "what is this" });
  });
});

describe("buildAnthropicRequest", () => {
  it("posts to the Anthropic Messages endpoint by default", () => {
    const { url } = buildAnthropicRequest({
      model: "claude-sonnet-4-5",
      accessToken: OAUTH_TOKEN,
      oauth: true,
      messages: [{ role: "user", content: "hi", timestamp: 0 }],
    });
    expect(url).toBe(ANTHROPIC_URL);
  });

  it("honours an explicit baseUrl override", () => {
    const { url } = buildAnthropicRequest({
      model: "claude-sonnet-4-5",
      accessToken: API_KEY,
      oauth: false,
      messages: [{ role: "user", content: "hi", timestamp: 0 }],
      baseUrl: "https://proxy.example.com/",
    });
    expect(url).toBe("https://proxy.example.com/v1/messages");
  });

  it("prepends the Claude Code billing + system prelude for OAuth requests", () => {
    const body = parseBody("claude-sonnet-4-5", { systemPrompt: "Be terse." });
    const system = body.system as { text: string }[];
    expect(system[0].text).toMatch(/^x-anthropic-billing-header:/);
    expect(system[1].text).toBe("You are a Claude agent, built on Anthropic's Claude Agent SDK.");
    expect(system[2].text).toBe("Be terse.");
    // A cloaking user id is attached on the OAuth path.
    expect(body.metadata.user_id).toMatch(/^user_/);
  });

  it("omits the OAuth prelude + cloaking for API-key requests", () => {
    const { body } = buildAnthropicRequest({
      model: "claude-sonnet-4-5",
      accessToken: API_KEY,
      oauth: false,
      systemPrompt: "Be terse.",
      messages: [{ role: "user", content: "hi", timestamp: 0 }],
    });
    const parsed = JSON.parse(body);
    expect((parsed.system as { text: string }[]).map((b) => b.text)).toEqual(["Be terse."]);
    expect(parsed.metadata).toBeUndefined();
  });

  it("uses plain budget thinking for Sonnet 4.5 (no effort field — the API rejects it)", () => {
    const body = parseBody("claude-sonnet-4-5", { reasoning: "high", maxTokens: 8000 });
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 6976, display: "summarized" });
    expect(body.output_config).toBeUndefined();
    expect(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens);
  });

  it("uses budget-effort thinking for Opus 4.5 (it accepts the effort field)", () => {
    const body = parseBody("claude-opus-4-5-20251101", { reasoning: "high", maxTokens: 8000 });
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 6976, display: "summarized" });
    expect(body.output_config).toEqual({ effort: "high" });
  });

  it("forceBudgetThinking drops adaptive + output_config for the effort-rejection retry", () => {
    const adaptive = parseBody("claude-opus-4-7", { reasoning: "medium" });
    expect(adaptive.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(adaptive.output_config).toEqual({ effort: "medium" });
    const forced = parseBody("claude-opus-4-7", { reasoning: "medium", forceBudgetThinking: true });
    expect(forced.thinking.type).toBe("enabled");
    expect(forced.thinking.budget_tokens).toBeGreaterThan(0);
    expect(forced.output_config).toBeUndefined();
  });


  it("uses adaptive thinking with summarized display for Opus 4.7 (no budget_tokens)", () => {
    const body = parseBody("claude-opus-4-7", { reasoning: "medium" });
    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body.output_config).toEqual({ effort: "medium" });
  });

  it("sets temperature only on the non-thinking path", () => {
    const off = parseBody("claude-sonnet-4-5", { temperature: 0.5 });
    expect(off.temperature).toBe(0.5);
    const thinking = parseBody("claude-sonnet-4-5", { temperature: 0.5, reasoning: "low" });
    expect(thinking.temperature).toBeUndefined();
  });

  it("declares tools as native functions with tool_choice auto", () => {
    const body = parseBody("claude-sonnet-4-5", {
      tools: [{ name: "read", description: "Read a file", parameters: { type: "object" } as any }],
    });
    expect(body.tools).toEqual([{ name: "read", description: "Read a file", input_schema: { type: "object" } }]);
    expect(body.tool_choice).toEqual({ type: "auto" });
  });
});

describe("isReasoningArtifactError", () => {
  it("flags a 400 that names a rejected thinking/signature artifact", () => {
    expect(isReasoningArtifactError(400, "invalid signature for thinking block")).toBe(true);
    expect(isReasoningArtifactError(400, "redacted_thinking mismatch")).toBe(true);
    expect(isReasoningArtifactError(400, "some other error")).toBe(false);
    expect(isReasoningArtifactError(401, "thinking")).toBe(false);
  });
});

describe("isEffortUnsupportedError", () => {
  it("flags a 400 that rejects the effort / adaptive thinking transport", () => {
    expect(isEffortUnsupportedError(400, "This model does not support the effort parameter.")).toBe(true);
    expect(isEffortUnsupportedError(400, "adaptive thinking is not supported on this model")).toBe(true);
    expect(isEffortUnsupportedError(400, "invalid signature for thinking block")).toBe(false);
    expect(isEffortUnsupportedError(429, "This model does not support the effort parameter.")).toBe(false);
  });
});

describe("isThirdPartyUsageError", () => {
  it("flags a 400 that bills OAuth usage to a third-party extra-usage balance", () => {
    expect(
      isThirdPartyUsageError(
        400,
        "Third-party apps now draw from your extra usage, not your plan limits. Add more at claude.ai/settings/usage and keep going.",
      ),
    ).toBe(true);
    expect(isThirdPartyUsageError(400, "This model does not support the effort parameter.")).toBe(false);
    expect(isThirdPartyUsageError(400, "invalid signature for thinking block")).toBe(false);
    expect(
      isThirdPartyUsageError(429, "Third-party apps now draw from your extra usage, not your plan limits."),
    ).toBe(false);
  });
});

