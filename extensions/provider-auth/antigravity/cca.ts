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
import type { AssistantMessage, AssistantMessageEventStream, Context, Model, TextContent, ThinkingContent, ToolCall } from "@mariozechner/pi-ai";
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

  const request: Record<string, unknown> = {
    contents: antigravityContents(input.messages),
    sessionId: sessionId(input.messages),
  };
  if (input.systemPrompt) request.systemInstruction = { role: "user", parts: [{ text: input.systemPrompt }] };
  if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig;
  if (input.tools && input.tools.length > 0) {
    request.tools = [
      {
        functionDeclarations: input.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
      },
    ];
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
      if (!accessToken) throw new Error("Antigravity requires an OAuth access token. Run /login antigravity.");
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
