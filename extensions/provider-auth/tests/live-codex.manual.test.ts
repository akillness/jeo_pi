/**
 * MANUAL live test — hits the real OpenAI Codex (ChatGPT OAuth) backend at
 * chatgpt.com/backend-api using the openai-codex credential in
 * ~/.pi/agent/auth.json. Skipped unless BOTH a real openai-codex credential
 * exists AND PI_LIVE_CODEX=1 is set, so the normal `npm test` run never touches
 * the network. Run explicitly:
 *   PI_LIVE_CODEX=1 npx vitest run extensions/provider-auth/tests/live-codex.manual.test.ts
 *
 * Unlike anthropic/antigravity, Codex is a pi BUILT-IN provider (not registered
 * by this extension) — pi's `/login` → "Sign in with ChatGPT" path streams via
 * `streamSimpleOpenAICodexResponses`. This harness drives that exact runtime
 * function with the stored OAuth access token (the provider extracts the
 * chatgpt-account-id from the JWT itself), proving the credential actually
 * produces model output and tool calls end to end.
 */
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Context, Model } from "@mariozechner/pi-ai";
import { streamSimpleOpenAICodexResponses } from "@mariozechner/pi-ai/openai-codex-responses";
import { refreshOpenAICodexToken } from "@mariozechner/pi-ai/oauth";
import { describe, expect, it } from "vitest";

const LIVE_MODEL = "gpt-5.5";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";

interface OAuthEntry {
  type?: string;
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

function loadCodexCreds(): OAuthEntry | null {
  try {
    const raw = readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf-8");
    const all = JSON.parse(raw) as Record<string, OAuthEntry>;
    const c = all["openai-codex"];
    if (c && c.access && c.refresh) return c;
  } catch {
    /* no creds */
  }
  return null;
}

/** Return a fresh OAuth access token, refreshing through pi's own flow if near expiry. */
async function freshToken(creds: OAuthEntry): Promise<string> {
  if (creds.expires < Date.now() + 60_000) {
    const refreshed = await refreshOpenAICodexToken(creds.refresh);
    if ("access" in refreshed && refreshed.access) return refreshed.access;
    throw new Error(`Codex token refresh failed: ${JSON.stringify(refreshed)}`);
  }
  return creds.access;
}

function model(): Model<"openai-codex-responses"> {
  return {
    id: LIVE_MODEL,
    name: "GPT-5.5",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: CODEX_BASE_URL,
    reasoning: true,
    thinkingLevelMap: { xhigh: "xhigh", minimal: "low" },
    input: ["text", "image"],
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
    contextWindow: 272_000,
    maxTokens: 128_000,
  } as unknown as Model<"openai-codex-responses">;
}

function textOf(msg: { content: any[] }): string {
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function toolCallsOf(msg: { content: any[] }): string[] {
  return msg.content.filter((b) => b.type === "toolCall").map((b) => b.name);
}

const creds = loadCodexCreds();
const enabled = !!creds && process.env.PI_LIVE_CODEX === "1";

/**
 * Drives the FULL pi streamSimple path — `streamSimpleOpenAICodexResponses(model,
 * context, options)` — exactly as pi's runtime invokes it after /login → Sign in
 * with ChatGPT. Exercises the OAuth bearer + chatgpt-account-id headers, the
 * SSE/WebSocket translation, and the AssistantMessageEventStream protocol.
 */
describe.skipIf(!enabled)("LIVE Codex streamSimpleOpenAICodexResponses (pi runtime path)", () => {
  it("yields text through the pi event stream (start→text→done)", async () => {
    const apiKey = await freshToken(creds!);
    const ctx: Context = {
      systemPrompt: "You are a terse assistant.",
      messages: [{ role: "user", content: "Reply with exactly the word: PONG", timestamp: Date.now() }] as any,
      tools: [],
    } as Context;

    const stream = streamSimpleOpenAICodexResponses(model(), ctx, { apiKey });
    const events: string[] = [];
    for await (const ev of stream) events.push(ev.type);
    const final = await stream.result();

    // eslint-disable-next-line no-console
    console.log("[LIVE codex] events=%o stop=%s text=%o", events, final.stopReason, textOf(final));
    expect(final.stopReason, final.errorMessage ?? "").not.toBe("error");
    expect(textOf(final).toUpperCase()).toContain("PONG");
  }, 90_000);

  it("emits a tool call for a tool-prompted request", async () => {
    const apiKey = await freshToken(creds!);
    const ctx: Context = {
      systemPrompt: "You must call the get_weather tool to answer any weather question. Do not answer in plain text.",
      messages: [{ role: "user", content: "What is the weather in Paris?", timestamp: Date.now() }] as any,
      tools: [
        {
          name: "get_weather",
          description: "Get current weather for a city",
          parameters: {
            type: "object",
            properties: { city: { type: "string", description: "City name" } },
            required: ["city"],
          },
        },
      ] as any,
    } as Context;

    const stream = streamSimpleOpenAICodexResponses(model(), ctx, { apiKey });
    for await (const _ev of stream) {
      /* drain */
    }
    const final = await stream.result();
    const tools = toolCallsOf(final);

    // eslint-disable-next-line no-console
    console.log("[LIVE codex] stop=%s toolCalls=%o", final.stopReason, tools);
    expect(final.stopReason, final.errorMessage ?? "").not.toBe("error");
    expect(tools, "model must request the get_weather tool").toContain("get_weather");
  }, 90_000);
});
