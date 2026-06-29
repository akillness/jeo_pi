/**
 * MANUAL live test — hits the real Antigravity Cloud Code Assist backend using
 * the OAuth credentials in ~/.pi/agent/auth.json. Skipped unless BOTH a real
 * antigravity credential exists AND PI_LIVE_ANTIGRAVITY=1 is set, so the normal
 * `npm test` run never touches the network. Run explicitly:
 *   PI_LIVE_ANTIGRAVITY=1 npx vitest run extensions/provider-auth/tests/live-antigravity.manual.test.ts
 */
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Context, Model } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import {
  buildCcaRequest,
  ccaFunctionCalls,
  ccaText,
  ccaThought,
  streamAntigravity,
} from "../antigravity/cca.js";
import { refreshAntigravityToken } from "../antigravity/oauth.js";
import { ANTIGRAVITY_PROVIDER, toAntigravityModel } from "../antigravity/register.js";

interface OAuthEntry {
  type?: string;
  access: string;
  refresh: string;
  expires: number;
  projectId?: string;
  email?: string;
}

function loadAntigravityCreds(): OAuthEntry | null {
  try {
    const raw = readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf-8");
    const all = JSON.parse(raw) as Record<string, OAuthEntry>;
    const ag = all.antigravity;
    if (ag && ag.access && ag.refresh) return ag;
  } catch {
    /* no creds */
  }
  return null;
}

/** Return a fresh access token + projectId, refreshing if near expiry. */
async function freshToken(creds: OAuthEntry): Promise<{ access: string; projectId?: string }> {
  if (creds.expires < Date.now() + 60_000) {
    const refreshed = await refreshAntigravityToken({
      access: creds.access,
      refresh: creds.refresh,
      expires: creds.expires,
    });
    return { access: refreshed.access, projectId: (refreshed.projectId as string | undefined) ?? creds.projectId };
  }
  return { access: creds.access, projectId: creds.projectId };
}

async function readSseToChunks(body: ReadableStream<Uint8Array>): Promise<any[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const chunks: any[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (payload && payload !== "[DONE]") {
          try {
            chunks.push(JSON.parse(payload));
          } catch {
            /* skip non-JSON keepalive */
          }
        }
      }
    }
  }
  return chunks;
}

const creds = loadAntigravityCreds();
const enabled = !!creds && process.env.PI_LIVE_ANTIGRAVITY === "1";

describe.skipIf(!enabled)("LIVE Antigravity CCA wire", () => {
  it("returns a parseable text response for a trivial prompt", async () => {
    const { access, projectId } = await freshToken(creds!);
    expect(projectId, "auth.json must carry a discovered projectId").toBeTruthy();

    const { url, headers, body } = buildCcaRequest({
      model: "antigravity/gemini-2.5-flash",
      project: projectId!,
      accessToken: access,
      systemPrompt: "You are a terse assistant.",
      messages: [{ role: "user", content: "Reply with exactly the word: PONG" }] as any,
    });

    const res = await fetch(url, { method: "POST", headers, body });
    const rawText = res.ok ? "" : await res.text();
    expect(res.ok, `HTTP ${res.status}: ${rawText}`).toBe(true);
    expect(res.body).toBeTruthy();

    const chunks = await readSseToChunks(res.body!);
    expect(chunks.length, "expected at least one SSE chunk").toBeGreaterThan(0);

    const text = chunks.map(ccaText).join("");
    const thought = chunks.map(ccaThought).join("");
    const calls = chunks.flatMap(ccaFunctionCalls);
    const usage = chunks.map((c) => c.response?.usageMetadata).filter(Boolean).pop();

    // eslint-disable-next-line no-console
    console.log("[LIVE wire] text=%o thoughtLen=%d calls=%d usage=%o", text, thought.length, calls.length, usage);

    expect(text.length, "model must emit some text").toBeGreaterThan(0);
    expect(text.toUpperCase()).toContain("PONG");
  }, 60_000);

  it("returns a function call for a tool-forced prompt", async () => {
    const { access, projectId } = await freshToken(creds!);
    const { url, headers, body } = buildCcaRequest({
      model: "antigravity/gemini-2.5-flash",
      project: projectId!,
      accessToken: access,
      systemPrompt: "Always use the provided tool.",
      messages: [{ role: "user", content: "What is the weather in Paris?" }] as any,
      tools: [
        {
          name: "get_weather",
          description: "Get current weather for a city",
          parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        },
      ] as any,
    });

    const res = await fetch(url, { method: "POST", headers, body });
    const rawText = res.ok ? "" : await res.text();
    expect(res.ok, `HTTP ${res.status}: ${rawText}`).toBe(true);
    const chunks = await readSseToChunks(res.body!);
    const calls = chunks.flatMap(ccaFunctionCalls);
    // eslint-disable-next-line no-console
    console.log("[LIVE wire] toolCalls=%o", calls);
    expect(calls.length, "model must request the tool").toBeGreaterThan(0);
    expect(calls[0].name).toBe("get_weather");
  }, 60_000);

  it("accepts a flash-3.5 tool schema containing const/anyOf (parametersJsonSchema path)", async () => {
    const { access, projectId } = await freshToken(creds!);
    // Regression guard: the legacy `parameters` field rejected `const` with
    // HTTP 400 ("Unknown name \"const\" ... Cannot find field"); native Gemini
    // must carry the full JSON Schema under `parametersJsonSchema`.
    const { url, headers, body } = buildCcaRequest({
      model: "antigravity/gemini-3.5-flash-low",
      project: projectId!,
      accessToken: access,
      systemPrompt: "Always use the provided tool.",
      messages: [{ role: "user", content: "Set the speed to fast for Paris." }] as any,
      tools: [
        {
          name: "set_speed",
          description: "Set the travel speed for a city",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string" },
              speed: { anyOf: [{ const: "fast" }, { const: "slow" }] },
            },
            required: ["city", "speed"],
          },
        },
      ] as any,
    });
    // The Gemini schema must ride on parametersJsonSchema, never the OpenAPI `parameters`.
    const sent = JSON.parse(body).request.tools[0].functionDeclarations[0];
    expect(sent.parametersJsonSchema).toBeTruthy();
    expect(sent.parameters).toBeUndefined();

    const res = await fetch(url, { method: "POST", headers, body });
    const rawText = res.ok ? "" : await res.text();
    // The fix proves itself here: a const-bearing schema no longer 400s.
    expect(res.ok, `HTTP ${res.status}: ${rawText}`).toBe(true);
    const chunks = await readSseToChunks(res.body!);
    const calls = chunks.flatMap(ccaFunctionCalls);
    // eslint-disable-next-line no-console
    console.log("[LIVE wire const-schema] toolCalls=%o", calls);
    expect(calls.length, "model must request the tool").toBeGreaterThan(0);
    expect(calls[0].name).toBe("set_speed");
  }, 60_000);

  it("streams reasoning thought parts when a thinking budget is requested", async () => {
    const { access, projectId } = await freshToken(creds!);
    const { url, headers, body } = buildCcaRequest({
      model: "antigravity/gemini-2.5-flash",
      project: projectId!,
      accessToken: access,
      reasoning: "medium",
      systemPrompt: "Think step by step before answering.",
      messages: [{ role: "user", content: "What is 17 times 23? Reason it out, then give the number." }] as any,
    });
    // Without includeThoughts in the request CCA never emits `thought` parts and
    // reasoning silently disappears — assert the wire shape carries it.
    expect(JSON.parse(body).request.generationConfig.thinkingConfig.includeThoughts).toBe(true);

    const res = await fetch(url, { method: "POST", headers, body });
    const rawText = res.ok ? "" : await res.text();
    expect(res.ok, `HTTP ${res.status}: ${rawText}`).toBe(true);
    const chunks = await readSseToChunks(res.body!);
    const text = chunks.map(ccaText).join("");
    const thought = chunks.map(ccaThought).join("");
    // eslint-disable-next-line no-console
    console.log("[LIVE wire reasoning] textLen=%d thoughtLen=%d", text.length, thought.length);
    expect(thought.length, "model must stream reasoning thought parts").toBeGreaterThan(0);
    expect(text).toContain("391");
  }, 60_000);
});

/**
 * Drives the FULL pi streamSimple path — `streamAntigravity(model, context,
 * options)` — exactly as pi's runtime invokes it after /login. Exercises
 * project-id resolution, the dual-endpoint fetch, SSE parsing, and the
 * AssistantMessageEventStream event protocol end to end.
 */
describe.skipIf(!enabled)("LIVE Antigravity streamAntigravity (pi runtime path)", () => {
  function model(): Model<"google-generative-ai"> {
    const m = toAntigravityModel("gemini-2.5-flash");
    return {
      id: m.id,
      name: m.name,
      api: "google-generative-ai",
      provider: ANTIGRAVITY_PROVIDER,
      baseUrl: "https://daily-cloudcode-pa.googleapis.com",
      reasoning: m.reasoning,
      input: m.input,
      cost: m.cost,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    } as unknown as Model<"google-generative-ai">;
  }

  it("with an explicit projectId (the post-modifyModels path) yields text", async () => {
    const { access, projectId } = await freshToken(creds!);
    const ctx: Context = {
      systemPrompt: "You are a terse assistant.",
      messages: [{ role: "user", content: "Reply with exactly the word: PONG" }] as any,
      tools: [],
    } as Context;

    const stream = streamAntigravity(model(), ctx, { apiKey: access, projectId });
    const events: string[] = [];
    for await (const ev of stream) events.push(ev.type);
    const final = await stream.result();

    // eslint-disable-next-line no-console
    console.log("[LIVE stream+projectId] events=%o stop=%s text=%o", events, final.stopReason, textOf(final));
    expect(final.stopReason).not.toBe("error");
    expect(textOf(final).toUpperCase()).toContain("PONG");
  }, 60_000);

  it("with no projectId resolves via live discovery and still yields text", async () => {
    const { access } = await freshToken(creds!);
    const ctx: Context = {
      systemPrompt: "You are a terse assistant.",
      messages: [{ role: "user", content: "Reply with exactly the word: PONG" }] as any,
      tools: [],
    } as Context;

    // Only the bearer token — forces resolveProjectId's discovery fallback,
    // the realistic path when modifyModels has not stamped a projectId.
    const stream = streamAntigravity(model(), ctx, { apiKey: access });
    const final = await stream.result();

    // eslint-disable-next-line no-console
    console.log("[LIVE stream+discovery] stop=%s err=%o text=%o", final.stopReason, final.errorMessage, textOf(final));
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
