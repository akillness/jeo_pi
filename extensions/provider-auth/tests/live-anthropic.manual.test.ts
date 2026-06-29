/**
 * MANUAL live test — hits the real Anthropic /v1/messages backend using the
 * Claude Pro/Max OAuth credentials in ~/.pi/agent/auth.json. Skipped unless BOTH
 * a real anthropic credential exists AND PI_LIVE_ANTHROPIC=1 is set, so the
 * normal `npm test` run never touches the network. Run explicitly:
 *   PI_LIVE_ANTHROPIC=1 npx vitest run extensions/provider-auth/tests/live-anthropic.manual.test.ts
 *
 * Mirrors live-antigravity.manual.test.ts: exercises the pure request builder
 * wire shape, a tool-forced prompt, and the full pi streamAnthropic runtime path
 * that pi invokes after /login → "Use a subscription" → Claude Pro/Max.
 */
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Context, Model } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { buildAnthropicRequest, isOAuthToken, streamAnthropic } from "../anthropic/messages.js";
import { refreshAnthropicToken } from "../anthropic/oauth.js";
import { ANTHROPIC_API, ANTHROPIC_PROVIDER } from "../anthropic/register.js";

const LIVE_MODEL = "claude-sonnet-4-5-20250929";

interface OAuthEntry {
  type?: string;
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  email?: string;
}

function loadAnthropicCreds(): OAuthEntry | null {
  try {
    const raw = readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf-8");
    const all = JSON.parse(raw) as Record<string, OAuthEntry>;
    const a = all.anthropic;
    if (a && a.access && a.refresh) return a;
  } catch {
    /* no creds */
  }
  return null;
}

/** Return a fresh OAuth access token, refreshing if near expiry. */
async function freshToken(creds: OAuthEntry): Promise<string> {
  if (creds.expires < Date.now() + 60_000) {
    const refreshed = await refreshAnthropicToken({
      access: creds.access,
      refresh: creds.refresh,
      expires: creds.expires,
      accountId: creds.accountId,
      email: creds.email,
    });
    return refreshed.access;
  }
  return creds.access;
}

async function readSseText(body: ReadableStream<Uint8Array>): Promise<{ text: string; toolNames: string[] }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const toolNames: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") text += evt.delta.text;
        if (evt.type === "content_block_start" && evt.content_block?.type === "tool_use") {
          toolNames.push(evt.content_block.name ?? "");
        }
      } catch {
        /* skip non-JSON keepalive */
      }
    }
  }
  return { text, toolNames };
}

const creds = loadAnthropicCreds();
const enabled = !!creds && process.env.PI_LIVE_ANTHROPIC === "1";

describe.skipIf(!enabled)("LIVE Anthropic /v1/messages wire", () => {
  it("returns a parseable text response for a trivial prompt", async () => {
    const access = await freshToken(creds!);
    expect(isOAuthToken(access), "auth.json must carry an OAuth (Pro/Max) token").toBe(true);

    const { url, headers, body } = buildAnthropicRequest({
      model: LIVE_MODEL,
      accessToken: access,
      oauth: true,
      systemPrompt: "You are a terse assistant.",
      messages: [{ role: "user", content: "Reply with exactly the word: PONG", timestamp: Date.now() }] as any,
      maxTokens: 64,
      stream: true,
    });

    const res = await fetch(url, { method: "POST", headers, body });
    const rawText = res.ok ? "" : await res.text();
    expect(res.ok, `HTTP ${res.status}: ${rawText}`).toBe(true);
    expect(res.body).toBeTruthy();

    const { text } = await readSseText(res.body!);
    // eslint-disable-next-line no-console
    console.log("[LIVE wire] text=%o", text);
    expect(text.length, "model must emit some text").toBeGreaterThan(0);
    expect(text.toUpperCase()).toContain("PONG");
  }, 60_000);

  it("returns a tool_use block for a tool-forced prompt", async () => {
    const access = await freshToken(creds!);
    const { url, headers, body } = buildAnthropicRequest({
      model: LIVE_MODEL,
      accessToken: access,
      oauth: true,
      systemPrompt: "Always use the provided tool to answer.",
      messages: [{ role: "user", content: "What is the weather in Paris?", timestamp: Date.now() }] as any,
      tools: [
        {
          name: "get_weather",
          description: "Get current weather for a city",
          parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        },
      ] as any,
      maxTokens: 256,
      stream: true,
    });

    const res = await fetch(url, { method: "POST", headers, body });
    const rawText = res.ok ? "" : await res.text();
    expect(res.ok, `HTTP ${res.status}: ${rawText}`).toBe(true);
    const { toolNames } = await readSseText(res.body!);
    // eslint-disable-next-line no-console
    console.log("[LIVE wire] toolNames=%o", toolNames);
    expect(toolNames, "model must request the tool").toContain("get_weather");
  }, 60_000);
});

/**
 * Drives the FULL pi streamSimple path — `streamAnthropic(model, context,
 * options)` — exactly as pi's runtime invokes it after /login → Claude Pro/Max.
 * Exercises OAuth bearer headers, the SSE translation, and the
 * AssistantMessageEventStream event protocol end to end.
 */
describe.skipIf(!enabled)("LIVE Anthropic streamAnthropic (pi runtime path)", () => {
  function model(): Model<"anthropic-messages"> {
    return {
      id: LIVE_MODEL,
      name: "Claude Sonnet 4.5",
      api: ANTHROPIC_API,
      provider: ANTHROPIC_PROVIDER,
      baseUrl: "https://api.anthropic.com",
      reasoning: true,
      input: ["text"],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      contextWindow: 200_000,
      maxTokens: 8192,
    } as unknown as Model<"anthropic-messages">;
  }

  it("yields text through the pi event stream (start→text→done)", async () => {
    const access = await freshToken(creds!);
    const ctx: Context = {
      systemPrompt: "You are a terse assistant.",
      messages: [{ role: "user", content: "Reply with exactly the word: PONG", timestamp: Date.now() }] as any,
      tools: [],
    } as Context;

    const stream = streamAnthropic(model(), ctx, { apiKey: access, maxTokens: 64 });
    const events: string[] = [];
    for await (const ev of stream) events.push(ev.type);
    const final = await stream.result();

    // eslint-disable-next-line no-console
    console.log("[LIVE stream] events=%o stop=%s text=%o", events, final.stopReason, textOf(final));
    expect(final.stopReason, final.errorMessage ?? "").not.toBe("error");
    expect(textOf(final).toUpperCase()).toContain("PONG");
  }, 60_000);
});

function textOf(msg: { content: any[] }): string {
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}
