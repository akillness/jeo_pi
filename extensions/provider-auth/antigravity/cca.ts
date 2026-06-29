/**
 * Antigravity Cloud Code Assist (CCA) wire adapter — ported from jeo-code
 * (`src/ai/providers/antigravity.ts`) and mapped onto pi's streamSimple /
 * AssistantMessageEventStream protocol.
 *
 * Antigravity serves Gemini- and Claude-shaped models over the CCA proxy,
 * which is neither the public Gemini Generative AI shape nor native Anthropic
 * Messages — hence this dedicated request/response translation. The request
 * builder and chunk parsers are pure and unit-tested; the streaming wiring
 * issues the live HTTP call (verifiable only against a real Antigravity
 * account, so it is exercised here through the pure helpers).
 */

import { randomUUID } from "crypto";
import type { AssistantMessage, AssistantMessageEventStream, Context, Model, TextContent, ThinkingContent, ThinkingLevel, ToolCall } from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { ANTIGRAVITY_DISCOVERY_METADATA, discoverGoogleProjectId } from "./discovery.js";

export const ANTIGRAVITY_DAILY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_SANDBOX_ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com";
const ENDPOINTS = [ANTIGRAVITY_DAILY_ENDPOINT, ANTIGRAVITY_SANDBOX_ENDPOINT] as const;

export function getAntigravityUserAgent(): string {
  const version = process.env.PI_AI_ANTIGRAVITY_VERSION || "1.104.0";
  const os = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "x64" ? "amd64" : process.arch === "ia32" ? "386" : process.arch;
  return `antigravity/${version} ${os}/${arch}`;
}

/** Strip the `antigravity/` provider prefix to the bare CCA model id. */
export function antigravityModelId(model: string): string {
  return model.replace(/^antigravity\//, "");
}

/** JSON-Schema meta keywords the CCA OpenAPI-3.0 `parameters` validator rejects. */
const JSON_SCHEMA_META_KEYS = new Set([
  "$schema",
  "$id",
  "$anchor",
  "$dynamicAnchor",
  "$vocabulary",
  "$comment",
  "$defs",
  "definitions",
]);

/**
 * Strip/normalize JSON-Schema declarations the CCA OpenAPI `parameters` field
 * rejects. Claude-via-CCA still uses this legacy OpenAPI subset, so `const`
 * must become a single-value `enum`; otherwise real pi runs fail before the
 * model sees the prompt.
 */
export function sanitizeOpenApiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeOpenApiSchema);
  if (typeof schema !== "object" || schema === null) return schema;
  const input = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (JSON_SCHEMA_META_KEYS.has(k) || k === "const") continue;
    out[k] = sanitizeOpenApiSchema(v);
  }
  if ("const" in input && !("enum" in out)) out.enum = [input.const];

  // Anthropic's CCA bridge rejects some valid-but-complex JSON Schema unions in
  // tool input_schema. Collapse pure literal unions to a plain enum.
  const anyOf = out.anyOf;
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    const values: unknown[] = [];
    let type: unknown;
    let literalUnion = true;
    for (const branch of anyOf) {
      if (typeof branch !== "object" || branch === null) { literalUnion = false; break; }
      const b = branch as Record<string, unknown>;
      if (!Array.isArray(b.enum) || b.enum.length !== 1) { literalUnion = false; break; }
      if (type === undefined) type = b.type;
      else if (b.type !== undefined && b.type !== type) { literalUnion = false; break; }
      values.push(b.enum[0]);
    }
    if (literalUnion) {
      delete out.anyOf;
      if (type !== undefined) out.type = type;
      out.enum = values;
    }
  }
  return out;
}

/**
 * Build CCA `functionDeclarations` for a turn's tools.
 *
 * Native Gemini / gpt-oss models take the FULL JSON Schema via
 * `parametersJsonSchema`, so keywords like `const`/`anyOf` survive. The legacy
 * `parameters` field is an OpenAPI-3.0 subset that rejects `const` with HTTP 400
 * (`Invalid JSON payload received. Unknown name "const" ... Cannot find field`),
 * so it must NOT carry a Gemini tool schema. Claude-via-CCA keeps `parameters`
 * because the backend translates it into Anthropic's `input_schema` — this
 * mirrors pi-ai's `convertTools(tools, useParameters)` split.
 */
export function antigravityFunctionDeclarations(
  tools: NonNullable<Context["tools"]>,
  isClaude: boolean,
): Array<Record<string, unknown>> {
  return tools.map((t) => {
    const parameters = isClaude ? sanitizeOpenApiSchema(t.parameters) : t.parameters;
    if (process.env.PI_ANTIGRAVITY_DEBUG === "1") {
      // eslint-disable-next-line no-console
      console.error(`[ANTIGRAVITY_DEBUG] tool=${t.name} claude=${isClaude} schema=${JSON.stringify(parameters)}`);
    }
    return {
      name: t.name,
      description: t.description,
      ...(isClaude ? { parameters } : { parametersJsonSchema: parameters }),
    };
  });
}

/**
 * Anthropic-style thinking budget for Claude served via CCA (jeo-code parity,
 * `antigravityClaudeThinkingBudget`). gemini's budget fn returns undefined for
 * claude ids, which would leave Antigravity Claude with NO thinking requested.
 * minimal/low/medium/high(/xhigh) ALL think; only an UNSET effort stays
 * non-thinking.
 */
export function antigravityClaudeThinkingBudget(effort?: ThinkingLevel): number | undefined {
  switch (effort) {
    case "minimal": return 2000;
    case "low": return 4000;
    case "medium": return 10000;
    case "high": return 24000;
    case "xhigh": return 32000;
    default: return undefined;
  }
}

/**
 * Gemini thinking budget (jeo-code `geminiThinkingBudget` parity). Reasoning is
 * available for Gemini >= 2.5 or major >= 3 (plus the rolling *-latest aliases).
 * An in-name depth marker (`-high`/`-low`/`-thinking`) IS the user's opt-in and
 * overrides the off-by-default floor; unmarked flash ids stay off by default.
 */
export function geminiThinkingBudget(model: string, effort?: ThinkingLevel, maxTokens?: number): number | undefined {
  const m = model.toLowerCase();
  const ver = m.match(/gemini-(\d+)(?:\.(\d+))?/);
  const major = ver ? Number(ver[1]) : 0;
  const minor = ver ? Number(ver[2] ?? 0) : 0;
  const thinkingCapable = major >= 3 || (major === 2 && minor >= 5) || /flash-latest|pro-latest/.test(m);
  if (!thinkingCapable) return undefined;
  const floor = m.includes("pro") ? 128 : 0; // pro-class cannot fully disable thinking
  const named: ThinkingLevel | undefined =
    m.includes("-high") ? "high"
    : m.includes("-low") ? "low"
    : m.includes("thinking") ? "medium"
    : undefined;
  const effectiveEffort = effort ?? named;
  let budget: number;
  switch (effectiveEffort) {
    case "minimal": budget = Math.max(floor, 2000); break;
    case "low": budget = 4000; break;
    case "medium": budget = 10000; break;
    case "high": case "xhigh": budget = 24000; break;
    default: budget = floor;
  }
  if (typeof maxTokens === "number") budget = Math.min(budget, Math.max(floor, maxTokens - 1024));
  return budget;
}

/**
 * The thinking budget actually requested for an Antigravity turn — Claude-via-CCA
 * uses an Anthropic-style budget, native Gemini scales via geminiThinkingBudget
 * (which also honours in-name depth markers like `-high`/`-low`). Centralised so
 * the request builder stays in agreement with itself.
 */
export function antigravityThinkingBudget(model: string, effort?: ThinkingLevel, maxTokens?: number): number | undefined {
  const id = antigravityModelId(model);
  return id.toLowerCase().includes("claude")
    ? antigravityClaudeThinkingBudget(effort)
    : geminiThinkingBudget(id, effort, maxTokens);
}

type CcaPart = { text: string } | { inlineData: { mimeType: string; data: string } };
interface CcaContent {
  role: "user" | "model";
  parts: CcaPart[];
}

function textFromContent(content: AssistantMessage["content"] | string): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (part.type === "text") return part.text;
      return "";
    })
    .join("");
}

/** Map pi messages → CCA `contents`, collapsing consecutive same-role turns. */
export function antigravityContents(messages: Context["messages"]): CcaContent[] {
  const contents: CcaContent[] = [];
  for (const m of messages) {
    if (m.role === "toolResult") {
      // CCA has no native tool-result channel here; fold results back in as user text.
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      pushPart(contents, "user", [{ text }]);
      continue;
    }
    const role: "user" | "model" = m.role === "assistant" ? "model" : "user";
    const parts: CcaPart[] = [];
    if (m.role === "user" && Array.isArray(m.content)) {
      for (const item of m.content) {
        if (item.type === "image") parts.push({ inlineData: { mimeType: item.mimeType, data: item.data } });
      }
    }
    const text = textFromContent(m.content as AssistantMessage["content"] | string);
    parts.push({ text });
    pushPart(contents, role, parts);
  }
  return contents;
}

function pushPart(contents: CcaContent[], role: "user" | "model", parts: CcaPart[]): void {
  const prev = contents[contents.length - 1];
  if (prev && prev.role === role) prev.parts.push(...parts);
  else contents.push({ role, parts });
}

function sessionId(messages: Context["messages"]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const first = firstUser ? textFromContent(firstUser.content as AssistantMessage["content"] | string) : `${Date.now()}`;
  let hash = 0n;
  for (const ch of new TextEncoder().encode(first || `${Date.now()}`)) hash = (hash * 131n + BigInt(ch)) & ((1n << 63n) - 1n);
  return `-${hash.toString()}`;
}

export interface CcaRequestInput {
  model: string;
  project: string;
  accessToken: string;
  systemPrompt?: string;
  messages: Context["messages"];
  tools?: Context["tools"];
  temperature?: number;
  maxTokens?: number;
  /** pi thinking level for this turn — drives the CCA thinkingConfig. */
  reasoning?: ThinkingLevel;
  endpoint?: string;
}

/** Build the CCA streamGenerateContent request. Pure. */
export function buildCcaRequest(input: CcaRequestInput): { url: string; headers: Record<string, string>; body: string } {
  const endpoint = input.endpoint ?? ANTIGRAVITY_DAILY_ENDPOINT;
  const model = antigravityModelId(input.model);
  const isClaude = model.toLowerCase().includes("claude");

  const generationConfig: Record<string, unknown> = {};
  if (input.temperature !== undefined) generationConfig.temperature = input.temperature;
  // Upstream Antigravity strips maxOutputTokens for non-Claude models.
  if (isClaude) generationConfig.maxOutputTokens = input.maxTokens ?? 4000;

  // Apply the thinking level. CCA emits `thought` parts ONLY when thinkingConfig
  // has includeThoughts set — without it Antigravity never streams reasoning.
  // Gemini scales via geminiThinkingBudget; Claude-via-CCA needs an Anthropic-style
  // budget PLUS the interleaved-thinking beta header below — without both,
  // Antigravity Claude (e.g. opus) never streams reasoning while native sonnet does.
  const thinkingBudget = antigravityThinkingBudget(input.model, input.reasoning, input.maxTokens);
  const claudeThinkingOn = isClaude && thinkingBudget !== undefined;
  if (thinkingBudget !== undefined) {
    generationConfig.thinkingConfig = { includeThoughts: true, thinkingBudget };
    // Claude (via CCA) enforces max_tokens > thinking.budget_tokens — bump the
    // output cap above the budget or CCA returns HTTP 400.
    if (claudeThinkingOn) generationConfig.maxOutputTokens = Math.max(input.maxTokens ?? 4000, thinkingBudget + 1024);
  }

  const request: Record<string, unknown> = {
    contents: antigravityContents(input.messages),
    sessionId: sessionId(input.messages),
  };
  if (input.systemPrompt) request.systemInstruction = { role: "user", parts: [{ text: input.systemPrompt }] };
  if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig;
  if (input.tools && input.tools.length > 0) {
    request.tools = [{ functionDeclarations: antigravityFunctionDeclarations(input.tools, isClaude) }];
    request.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }

  const body = JSON.stringify({
    project: input.project,
    model,
    request,
    requestType: "agent",
    userAgent: "antigravity",
    requestId: `agent-${randomUUID()}`,
  });
  return {
    url: `${endpoint}/v1internal:streamGenerateContent?alt=sse`,
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
      accept: "text/event-stream",
      "User-Agent": getAntigravityUserAgent(),
      // Claude reasoning over CCA requires the Anthropic interleaved-thinking beta.
      ...(claudeThinkingOn ? { "anthropic-beta": "interleaved-thinking-2025-05-14" } : {}),
    },
    body,
  };
}

interface CcaChunk {
  response?: {
    candidates?: {
      content?: { parts?: { text?: string; thought?: boolean; functionCall?: { name?: string; args?: Record<string, unknown> } }[] };
      finishReason?: string;
    }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
}

export function ccaText(chunk: CcaChunk): string {
  return chunk.response?.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? "";
}

export function ccaThought(chunk: CcaChunk): string {
  return chunk.response?.candidates?.[0]?.content?.parts?.filter((p) => p.thought).map((p) => p.text ?? "").join("") ?? "";
}

export function ccaFunctionCalls(chunk: CcaChunk): { name: string; args: Record<string, unknown> }[] {
  const parts = chunk.response?.candidates?.[0]?.content?.parts ?? [];
  const out: { name: string; args: Record<string, unknown> }[] = [];
  for (const p of parts) {
    if (p.functionCall && typeof p.functionCall.name === "string") {
      out.push({ name: p.functionCall.name, args: (p.functionCall.args ?? {}) as Record<string, unknown> });
    }
  }
  return out;
}

/** Parse an SSE byte stream into `data:` payload strings. */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
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
          if (payload && payload !== "[DONE]") yield payload;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

const discoveredProjects = new Map<string, string>();

async function resolveProjectId(accessToken: string, projectId: string | undefined, signal?: AbortSignal): Promise<string> {
  const direct = projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
  if (direct) return direct;
  const cached = discoveredProjects.get(accessToken);
  if (cached) return cached;
  const discovered = await discoverGoogleProjectId(accessToken, {
    metadata: { ...ANTIGRAVITY_DISCOVERY_METADATA },
    extraHeaders: { "User-Agent": getAntigravityUserAgent() },
    signal,
  });
  discoveredProjects.set(accessToken, discovered);
  return discovered;
}

/** Test seam: clear the in-process project-id cache. */
export function _resetAntigravityProjectCache(): void {
  discoveredProjects.clear();
}

export interface AntigravityStreamOptions {
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  /** pi thinking level for this turn — drives the CCA thinkingConfig. */
  reasoning?: ThinkingLevel;
  signal?: AbortSignal;
  /** Credential-derived project id (set by modifyModels at login time). */
  projectId?: string;
}

/**
 * pi streamSimple handler for Antigravity models. Emits start → text/thinking/
 * toolcall events → done, translating the CCA SSE stream.
 */
export function streamAntigravity(model: Model<"google-generative-ai">, context: Context, options?: AntigravityStreamOptions): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const output: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  (async () => {
    try {
      const accessToken = options?.apiKey;
      if (!accessToken) throw new Error("Antigravity requires an OAuth access token. Run /login → \"Use a subscription\" → Google Antigravity.");
      const project = await resolveProjectId(accessToken, options?.projectId, options?.signal);

      let response: Response | undefined;
      let lastError: Response | undefined;
      for (const endpoint of ENDPOINTS) {
        const { url, headers, body } = buildCcaRequest({
          model: model.id,
          project,
          accessToken,
          systemPrompt: context.systemPrompt,
          messages: context.messages,
          tools: context.tools,
          temperature: options?.temperature,
          maxTokens: options?.maxTokens,
          reasoning: options?.reasoning,
          endpoint,
        });
        const res = await fetch(url, { method: "POST", headers, body, signal: options?.signal });
        if (res.ok) {
          response = res;
          break;
        }
        lastError = res;
        if (res.status !== 404 && res.status !== 503) break;
      }
      if (!response) {
        throw new Error(`Antigravity Cloud Code Assist request failed (HTTP ${lastError?.status ?? "?"}): ${lastError ? await lastError.text() : "no response"}`);
      }

      stream.push({ type: "start", partial: output });

      const blocks = output.content;
      const indexOf = (b: TextContent | ThinkingContent | ToolCall) => blocks.indexOf(b);
      let textBlock: TextContent | null = null;
      let thinkingBlock: ThinkingContent | null = null;

      if (response.body) {
        for await (const data of readSse(response.body)) {
          let chunk: CcaChunk;
          try {
            chunk = JSON.parse(data) as CcaChunk;
          } catch {
            continue;
          }

          const thought = ccaThought(chunk);
          if (thought) {
            if (!thinkingBlock) {
              thinkingBlock = { type: "thinking", thinking: "" };
              blocks.push(thinkingBlock);
              stream.push({ type: "thinking_start", contentIndex: indexOf(thinkingBlock), partial: output });
            }
            thinkingBlock.thinking += thought;
            stream.push({ type: "thinking_delta", contentIndex: indexOf(thinkingBlock), delta: thought, partial: output });
          }

          const text = ccaText(chunk);
          if (text) {
            if (!textBlock) {
              textBlock = { type: "text", text: "" };
              blocks.push(textBlock);
              stream.push({ type: "text_start", contentIndex: indexOf(textBlock), partial: output });
            }
            textBlock.text += text;
            stream.push({ type: "text_delta", contentIndex: indexOf(textBlock), delta: text, partial: output });
          }

          for (const fc of ccaFunctionCalls(chunk)) {
            const toolCall: ToolCall = { type: "toolCall", id: `cca-${randomUUID()}`, name: fc.name, arguments: fc.args };
            blocks.push(toolCall);
            stream.push({ type: "toolcall_start", contentIndex: indexOf(toolCall), partial: output });
            stream.push({ type: "toolcall_end", contentIndex: indexOf(toolCall), toolCall, partial: output });
            output.stopReason = "toolUse";
          }

          const usage = chunk.response?.usageMetadata;
          if (usage) {
            output.usage.input = usage.promptTokenCount ?? output.usage.input;
            output.usage.output = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
            output.usage.totalTokens = output.usage.input + output.usage.output;
          }
        }
      }

      if (thinkingBlock) stream.push({ type: "thinking_end", contentIndex: indexOf(thinkingBlock), content: thinkingBlock.thinking, partial: output });
      if (textBlock) stream.push({ type: "text_end", contentIndex: indexOf(textBlock), content: textBlock.text, partial: output });

      if (options?.signal?.aborted) throw new Error("Request was aborted");
      // An OAuth-authenticated CCA turn that streamed no text, reasoning, or tool
      // call is a failed response — surface it instead of a silent empty answer.
      if (blocks.length === 0) throw new Error("Antigravity Cloud Code Assist returned an empty response.");
      const reason: "stop" | "toolUse" = output.stopReason === "toolUse" ? "toolUse" : "stop";
      stream.push({ type: "done", reason, message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}
