/**
 * Anthropic Messages wire adapter — ported from jeo-code
 * (`src/ai/providers/anthropic.ts`) and mapped onto pi's streamSimple /
 * AssistantMessageEventStream protocol.
 *
 * This is what makes a Claude Pro/Max OAuth subscription actually RESPOND: it
 * sends the Claude Code identity headers + billing/cloaking metadata + system
 * prelude that the OAuth `/v1/messages` endpoint requires, threads pi's thinking
 * level into Anthropic's adaptive/budget thinking transport, reconstructs native
 * tool_use / tool_result / thinking blocks for multi-turn continuity, and
 * surfaces an empty 200 response as an explicit error instead of a silent blank.
 *
 * The request builder and SSE parsers are pure and unit-tested; the streaming
 * wiring issues the live HTTP call.
 */

import { createHash, randomBytes, randomUUID } from "crypto";
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  ThinkingLevel,
  ToolCall,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const CLAUDE_CODE_VERSION = "2.1.63";
const CLAUDE_CODE_SYSTEM_INSTRUCTION = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
/** Newer Claude models (e.g. Opus 4.8) reject a custom `temperature`. */
const DEPRECATED_TEMPERATURE = "`temperature` is deprecated for this model.";

/** Betas for API-key requests: interleaved-thinking enables thinking+tools. */
const ANTHROPIC_API_KEY_BETA = ["interleaved-thinking-2025-05-14", "prompt-caching-scope-2026-01-05"];
/** Betas for OAuth (Claude Code) requests. */
const ANTHROPIC_OAUTH_BETA = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
];
const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";

/** A Claude OAuth access token (vs. an `sk-ant-api…` API key). */
export function isOAuthToken(apiKey: string): boolean {
  return apiKey.includes("sk-ant-oat");
}

/**
 * The genuine Anthropic Messages host. The Claude Code OAuth request shape
 * (Bearer auth + identity/billing headers + system prelude + cloaking metadata)
 * is only valid here. Anthropic-compatible hubs (e.g. Tencent TokenHub) speak the
 * same `/v1/messages` wire format but MUST receive the plain `x-api-key` Messages
 * shape — handing them the Claude Code OAuth cloaking is both wrong and rejected.
 * A missing baseUrl means the default Anthropic endpoint, so it is genuine.
 */
export function isGenuineAnthropicHost(baseUrl: string | undefined): boolean {
  if (!baseUrl) return true;
  try {
    return new URL(baseUrl).host === "api.anthropic.com";
  } catch {
    return false;
  }
}

/**
 * Decide whether to emit the Claude Code OAuth request shape. It requires BOTH a
 * Claude OAuth access token AND the genuine Anthropic host: a compatible hub
 * never receives OAuth cloaking even if its api key happens to contain
 * `sk-ant-oat`, and a Claude subscription token is never bearer-sent to a
 * third-party host. This is what scopes OAuth to Anthropic while Tencent and
 * Anthropic share the one `anthropic-messages` transport.
 */
export function shouldUseOAuthShape(token: string, baseUrl: string | undefined): boolean {
  return isOAuthToken(token) && isGenuineAnthropicHost(baseUrl);
}

export function stripAnthropicPrefix(model: string): string {
  return model.startsWith("anthropic/") ? model.slice("anthropic/".length) : model;
}

/** Parse a modern Claude id's family + version. Legacy/foreign ids → undefined. */
export function parseAnthropicVersion(
  model: string,
): { kind: "opus" | "sonnet" | "haiku"; major: number; minor: number } | undefined {
  const m = /claude-(opus|sonnet|haiku)-(\d+)-(\d+)/.exec(model);
  if (!m) return undefined;
  return { kind: m[1] as "opus" | "sonnet" | "haiku", major: Number(m[2]), minor: Number(m[3]) };
}

/** Adaptive thinking `display` is supported from Opus 4.7. Below it, the field is rejected. */
export function supportsAdaptiveThinkingDisplay(model: string): boolean {
  const v = parseAnthropicVersion(model);
  if (!v || v.kind !== "opus") return false;
  return v.major > 4 || (v.major === 4 && v.minor >= 7);
}

export type AnthropicThinkingMode = "adaptive" | "budget-effort" | "budget";

/**
 * Thinking transport per model (jeo-code `inferThinkingControlMode` parity).
 *
 * The `budget-effort` transport (budget_tokens + `output_config.effort`) is
 * accepted ONLY by Opus 4.5. Sonnet 4.5 and Haiku 4.5 REJECT the effort field
 * ("This model does not support the effort parameter." → HTTP 400), so they fall
 * through to plain `budget` thinking. Verified live against `/v1/messages`.
 */
export function anthropicThinkingMode(model: string): AnthropicThinkingMode {
  const v = parseAnthropicVersion(model);
  if (!v) return "budget";
  if (v.major > 4 || (v.major === 4 && v.minor >= 6)) return "adaptive";
  if (v.kind === "opus" && v.major === 4 && v.minor === 5) return "budget-effort";
  return "budget";
}

/** Extended-thinking budget by reasoning level (kept under max_tokens). Only an
 *  UNSET level stays non-thinking — every explicit level enables thinking. */
export function anthropicThinkingBudget(effort: ThinkingLevel | undefined, maxTokens: number): number | undefined {
  let budget: number;
  switch (effort) {
    case "minimal": budget = 2000; break;
    case "low": budget = 4000; break;
    case "medium": budget = 10000; break;
    case "high": budget = 24000; break;
    case "xhigh": budget = 32000; break;
    default: return undefined;
  }
  return Math.min(budget, Math.max(1024, maxTokens - 1024));
}

/** Map pi's thinking level to Anthropic's adaptive/output_config effort literal. */
export function anthropicAdaptiveEffort(effort: ThinkingLevel): "low" | "medium" | "high" {
  switch (effort) {
    case "minimal":
    case "low": return "low";
    case "medium": return "medium";
    case "high":
    case "xhigh": return "high";
  }
}

/** The interleaved-thinking beta drives budget thinking; adaptive-display models drop it. */
function anthropicBetaHeader(betas: string[], model: string): string {
  const filtered = supportsAdaptiveThinkingDisplay(model)
    ? betas.filter((b) => b !== INTERLEAVED_THINKING_BETA)
    : betas;
  return filtered.join(",");
}

function createClaudeCloakingUserId(): string {
  return `user_${randomBytes(32).toString("hex")}_account_${randomUUID().toLowerCase()}_session_${randomUUID().toLowerCase()}`;
}

function createClaudeBillingHeader(payload: unknown): string {
  const payloadJson = JSON.stringify(payload) ?? "";
  const cch = createHash("sha256").update(payloadJson).digest("hex").slice(0, 5);
  const rnd = new Uint8Array(2);
  for (let i = 0; i < rnd.length; i++) rnd[i] = Math.floor(Math.random() * 256);
  const buildHash = Array.from(rnd, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 3);
  return `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.${buildHash}; cc_entrypoint=cli; cch=${cch};`;
}

interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

function anthropicSystemBlocks(
  systemPrompt: string | undefined,
  oauth: boolean,
  billingPayload: Record<string, unknown>,
): AnthropicSystemBlock[] | undefined {
  const blocks: AnthropicSystemBlock[] = [];
  if (oauth) {
    const billingSeed = systemPrompt ? { ...billingPayload, system: [systemPrompt] } : billingPayload;
    blocks.push(
      { type: "text", text: createClaudeBillingHeader(billingSeed) },
      { type: "text", text: CLAUDE_CODE_SYSTEM_INSTRUCTION },
    );
  }
  if (systemPrompt) blocks.push({ type: "text", text: systemPrompt });
  if (blocks.length === 0) return undefined;
  // Single cumulative cache breakpoint on the last system block.
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } };
  return blocks;
}

type AnthropicContentBlock = Record<string, unknown>;
type AnthropicMessage = { role: string; content: string | AnthropicContentBlock[] };

function assistantText(m: AssistantMessage): string {
  return m.content.filter((c): c is TextContent => c.type === "text").map((c) => c.text).join("");
}

function signedThinkingBlocks(m: AssistantMessage): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  for (const c of m.content) {
    if (c.type !== "thinking") continue;
    if (c.redacted && c.thinkingSignature) blocks.push({ type: "redacted_thinking", data: c.thinkingSignature });
    else if (c.thinkingSignature) blocks.push({ type: "thinking", thinking: c.thinking ?? "", signature: c.thinkingSignature });
  }
  return blocks;
}

function toolCalls(m: AssistantMessage): ToolCall[] {
  return m.content.filter((c): c is ToolCall => c.type === "toolCall");
}

function imageContentBlocks(content: Exclude<Message["content"], string> | undefined): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  for (const item of content ?? []) {
    if (item.type === "image") {
      blocks.push({ type: "image", source: { type: "base64", media_type: item.mimeType, data: item.data } });
    }
  }
  return blocks;
}

/**
 * Build Anthropic wire messages from pi's Context, reconstructing native
 * tool_use / tool_result blocks (so tool pairing is preserved) plus signed
 * thinking blocks for same-turn continuity when thinking is enabled this call.
 * `thinkingEnabled === false` (or a fail-safe artifact-stripping retry) drops
 * thinking blocks entirely.
 */
export function buildAnthropicMessages(messages: Message[], thinkingEnabled: boolean): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  // Track whether the most recent assistant turn emitted native tool_use blocks.
  // When thinking is enabled, Anthropic requires every tool_use assistant turn to
  // begin with its signed thinking block; a turn that lacks one (e.g. produced
  // while thinking was OFF, then replayed after the user enables thinking) would
  // send a bare tool_use and be rejected ("Expected `thinking`… found `tool_use`",
  // HTTP 400). For such turns we degrade to plain text (dropping the unreplayable
  // tool_use) — matching jeo-code's "no artifact ⇒ no native tool_use" invariant —
  // and the matching tool_result must degrade in lockstep, else Anthropic 400s on
  // an orphan tool_result with no preceding tool_use.
  let lastAssistantNativeTools = false;
  for (const m of messages) {
    if (m.role === "assistant") {
      const calls = toolCalls(m);
      const text = assistantText(m);
      const thinking = thinkingEnabled ? signedThinkingBlocks(m) : [];
      // Native tool_use is safe when thinking is off (no thinking-block contract) or
      // when we hold the turn's signed thinking blocks; otherwise degrade to plain text.
      const canNativizeTools = calls.length > 0 && (!thinkingEnabled || thinking.length > 0);
      if (calls.length > 0 && !canNativizeTools) {
        lastAssistantNativeTools = false;
        out.push({ role: "assistant", content: text || " " });
        continue;
      }
      lastAssistantNativeTools = calls.length > 0;
      if (calls.length === 0 && thinking.length === 0) {
        out.push({ role: "assistant", content: text || " " });
        continue;
      }
      const blocks: AnthropicContentBlock[] = [...thinking];
      if (text) blocks.push({ type: "text", text });
      for (const tc of calls) blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      out.push({ role: "assistant", content: blocks.length > 0 ? blocks : (text || " ") });
      continue;
    }
    if (m.role === "toolResult") {
      const resultText = m.content.filter((c): c is TextContent => c.type === "text").map((c) => c.text).join("");
      // If the originating assistant turn was degraded to plain text, its tool_use no
      // longer exists — fold the result into plain user text (merging consecutive
      // results) so there is no orphan tool_result and no consecutive user turns.
      if (!lastAssistantNativeTools) {
        const prev = out[out.length - 1];
        if (prev && prev.role === "user" && typeof prev.content === "string") {
          prev.content = prev.content ? `${prev.content}\n${resultText}` : resultText;
        } else {
          out.push({ role: "user", content: resultText || " " });
        }
        continue;
      }
      const block: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: resultText,
        is_error: m.isError,
      };
      const prev = out[out.length - 1];
      // Merge consecutive tool results into a single user turn (Anthropic groups them).
      if (prev && prev.role === "user" && Array.isArray(prev.content) && prev.content[0] && (prev.content[0] as AnthropicContentBlock).type === "tool_result") {
        (prev.content as AnthropicContentBlock[]).push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }
    // user
    lastAssistantNativeTools = false;
    if (typeof m.content === "string") {
      out.push({ role: "user", content: m.content });
    } else {
      const images = imageContentBlocks(m.content);
      const text = m.content.filter((c): c is TextContent => c.type === "text").map((c) => c.text).join("");
      const blocks: AnthropicContentBlock[] = [...images];
      if (text) blocks.push({ type: "text", text });
      out.push({ role: "user", content: blocks.length > 0 ? blocks : (text || " ") });
    }
  }
  return out;
}

export interface AnthropicRequestInput {
  model: string;
  accessToken: string;
  oauth: boolean;
  systemPrompt?: string;
  messages: Message[];
  tools?: Context["tools"];
  temperature?: number;
  maxTokens?: number;
  reasoning?: ThinkingLevel;
  stream?: boolean;
  baseUrl?: string;
  /** Fail-safe retry: drop replayed thinking artifacts AND disable thinking, so the
   *  request degrades to plain, thinking-free history (no bare tool_use 400). */
  stripArtifacts?: boolean;
  /** Fail-safe retry: force plain budget thinking (no adaptive / output_config effort). */
  forceBudgetThinking?: boolean;
  /** Fail-safe retry: drop a `temperature` the model deprecated (HTTP 400). */
  dropTemperature?: boolean;
}

/** Build the Anthropic `/v1/messages` request. Pure. */
export function buildAnthropicRequest(input: AnthropicRequestInput): {
  url: string;
  headers: Record<string, string>;
  body: string;
} {
  const model = stripAnthropicPrefix(input.model);
  const stream = input.stream ?? true;
  const maxTokens = input.maxTokens ?? 4000;
  // Fail-safe artifact-strip retry: force the whole request non-thinking. Dropping
  // only the history thinking blocks while leaving `payload.thinking` enabled would
  // leave bare tool_use turns (no leading thinking block), which Anthropic rejects
  // with the SAME 400 — so the strip retry must degrade to a plain, thinking-free
  // request (history thinking off + no payload.thinking) to actually recover.
  const effort = input.stripArtifacts ? undefined : input.reasoning;
  const thinkingEnabled = effort !== undefined;
  const thinkingMode = thinkingEnabled
    ? input.forceBudgetThinking
      ? "budget"
      : anthropicThinkingMode(model)
    : "budget";
  const thinkingBudget =
    thinkingEnabled && thinkingMode !== "adaptive" ? anthropicThinkingBudget(effort, maxTokens) : undefined;
  const anthropicMessages = buildAnthropicMessages(input.messages, thinkingEnabled && !input.stripArtifacts);

  // Conversation prompt caching: one breakpoint on the last message.
  const last = anthropicMessages[anthropicMessages.length - 1];
  if (last) {
    if (typeof last.content === "string") {
      if (last.content) last.content = [{ type: "text", text: last.content, cache_control: { type: "ephemeral" } }];
    } else if (last.content.length > 0) {
      const tail = last.content[last.content.length - 1]!;
      last.content[last.content.length - 1] = { ...tail, cache_control: { type: "ephemeral" } };
    }
  }

  const payload: Record<string, unknown> = {
    model,
    messages: anthropicMessages,
    max_tokens: thinkingBudget !== undefined ? Math.max(maxTokens, thinkingBudget + 1024) : maxTokens,
  };
  if (input.oauth) payload.metadata = { user_id: createClaudeCloakingUserId() };
  if (effort !== undefined) {
    if (thinkingMode === "adaptive") {
      payload.thinking = supportsAdaptiveThinkingDisplay(model)
        ? { type: "adaptive", display: "summarized" }
        : { type: "adaptive" };
      payload.output_config = { effort: anthropicAdaptiveEffort(effort) };
    } else {
      payload.thinking = { type: "enabled", budget_tokens: thinkingBudget, display: "summarized" };
      if (thinkingMode === "budget-effort") payload.output_config = { effort: anthropicAdaptiveEffort(effort) };
    }
  } else if (input.temperature !== undefined && !input.dropTemperature) {
    payload.temperature = input.temperature;
  }
  if (input.tools && input.tools.length > 0) {
    payload.tools = input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    payload.tool_choice = { type: "auto" };
  }
  if (stream) payload.stream = true;
  const system = anthropicSystemBlocks(input.systemPrompt, input.oauth, payload);
  if (system) payload.system = system;

  return {
    url: input.baseUrl ? `${input.baseUrl.replace(/\/$/, "")}/v1/messages` : ANTHROPIC_URL,
    headers: headersFor(input.oauth, input.accessToken, stream, model),
    body: JSON.stringify(payload),
  };
}

function mapStainlessOs(platform: string): string {
  switch (platform.toLowerCase()) {
    case "darwin": return "MacOS";
    case "win32":
    case "windows": return "Windows";
    case "linux": return "Linux";
    case "freebsd": return "FreeBSD";
    default: return `Other::${platform.toLowerCase()}`;
  }
}

function mapStainlessArch(arch: string): string {
  switch (arch.toLowerCase()) {
    case "amd64":
    case "x64": return "x64";
    case "arm64":
    case "aarch64": return "arm64";
    case "386":
    case "x86":
    case "ia32": return "x86";
    default: return `other::${arch.toLowerCase()}`;
  }
}

export function headersFor(oauth: boolean, token: string, stream: boolean, model: string): Record<string, string> {
  if (oauth) {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "anthropic-version": "2023-06-01",
      accept: stream ? "text/event-stream" : "application/json",
      "anthropic-beta": anthropicBetaHeader(ANTHROPIC_OAUTH_BETA, model),
      "anthropic-dangerous-direct-browser-access": "true",
      "user-agent": `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
      "x-app": "cli",
      "x-stainless-arch": mapStainlessArch(process.arch),
      "x-stainless-lang": "js",
      "x-stainless-os": mapStainlessOs(process.platform),
      "x-stainless-package-version": "0.74.0",
      "x-stainless-retry-count": "0",
      "x-stainless-runtime": "node",
      "x-stainless-runtime-version": process.version,
      "x-stainless-timeout": "600",
    };
  }
  return {
    accept: stream ? "text/event-stream" : "application/json",
    "content-type": "application/json",
    "x-api-key": token,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": anthropicBetaHeader(ANTHROPIC_API_KEY_BETA, model),
  };
}

/** A 400 rejecting a custom `temperature` the model deprecated (e.g. Opus 4.8). */
export function isDeprecatedTemperatureError(status: number, detail: string): boolean {
  return status === 400 && detail.includes(DEPRECATED_TEMPERATURE);
}

/** A 400 naming thinking/signature/redacted means a replayed artifact was rejected. */
export function isReasoningArtifactError(status: number, detail: string): boolean {
  return status === 400 && /thinking|signature|redacted_thinking/i.test(detail);
}

/**
 * A 400 rejecting the effort / adaptive thinking transport — the model accepts
 * extended thinking but not the `output_config.effort` field or `type:"adaptive"`
 * (e.g. Sonnet 4.5 / Haiku 4.5: "This model does not support the effort
 * parameter."). The fail-safe retries once with plain budget thinking.
 */
export function isEffortUnsupportedError(status: number, detail: string): boolean {
  return status === 400 && /does not support the effort parameter|adaptive thinking is not supported/i.test(detail);
}

/**
 * A 400 where Anthropic classifies the OAuth call as THIRD-PARTY-APP usage and
 * declines to bill it against the Claude Pro/Max plan ("Third-party apps now
 * draw from your extra usage, not your plan limits."). This fires when the
 * subscription's separate extra-usage balance is empty — it is an account/billing
 * state, NOT a malformed request, so retrying the wire shape cannot fix it.
 */
export function isThirdPartyUsageError(status: number, detail: string): boolean {
  return status === 400 && /third-party apps|extra usage|draw from your/i.test(detail);
}

function emptyCompletionError(stopReason: string | undefined): Error {
  const hint =
    stopReason === "max_tokens"
      ? " — output budget exhausted before any text; raise maxTokens or lower the thinking level"
      : "";
  return new Error(`Anthropic returned no content${stopReason ? ` (stop_reason=${stopReason})` : ""}${hint}.`);
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

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
function totalInputTokens(u: AnthropicUsage): number {
  return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
}

export interface AnthropicStreamOptions {
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  reasoning?: ThinkingLevel;
  signal?: AbortSignal;
}

async function postAnthropic(input: AnthropicRequestInput, signal?: AbortSignal): Promise<Response> {
  const send = (overrides: Partial<AnthropicRequestInput>) => {
    const { url, headers, body } = buildAnthropicRequest({ ...input, ...overrides });
    return fetch(url, { method: "POST", headers, body, signal });
  };
  let response = await send({});
  if (response.ok) return response;
  const detail = await response.text().catch(() => "");
  // Fail-safe: the model deprecated `temperature` → retry once without it.
  if (isDeprecatedTemperatureError(response.status, detail)) {
    response = await send({ dropTemperature: true });
    if (response.ok) return response;
    throw new Error(`Anthropic request failed (HTTP ${response.status}): ${await response.text().catch(() => "")}`);
  }
  // Fail-safe: the model rejects the effort/adaptive thinking transport → retry once
  // with plain budget thinking (drops output_config.effort and type:"adaptive").
  if (isEffortUnsupportedError(response.status, detail)) {
    response = await send({ forceBudgetThinking: true });
    if (response.ok) return response;
    throw new Error(`Anthropic request failed (HTTP ${response.status}): ${await response.text().catch(() => "")}`);
  }
  // Fail-safe: a rejected replay artifact → retry once with artifacts stripped.
  if (isReasoningArtifactError(response.status, detail)) {
    response = await send({ stripArtifacts: true });
    if (response.ok) return response;
    throw new Error(`Anthropic request failed (HTTP ${response.status}): ${await response.text().catch(() => "")}`);
  }
  // Account/billing state, not a wire problem: Anthropic is treating this Claude
  // Code OAuth call as third-party-app usage and the plan's extra-usage balance is
  // empty. Surface an actionable message instead of the raw API string.
  if (isThirdPartyUsageError(response.status, detail)) {
    throw new Error(
      "Claude declined this request: your Pro/Max plan is billing third-party-app usage to a separate extra-usage balance that is empty. " +
        "Add extra usage at https://claude.ai/settings/usage, or run /login → \"Use an API key\" with an sk-ant-api… key (usage-billed) to bypass the subscription limit. " +
        `(Anthropic HTTP ${response.status})`,
    );
  }
  throw new Error(`Anthropic request failed (HTTP ${response.status}): ${detail}`);
}

/**
 * pi streamSimple handler for Anthropic (Claude) models. Emits start →
 * thinking/text/toolcall events → done, translating the Anthropic SSE stream.
 * Handles both OAuth (Claude Pro/Max) and `sk-ant-…` API-key credentials.
 */
export function streamAnthropic(
  model: Model<"anthropic-messages">,
  context: Context,
  options?: AnthropicStreamOptions,
): AssistantMessageEventStream {
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
      const token = options?.apiKey;
      if (!token) {
        throw new Error('Claude requires a credential. Run /login → "Use a subscription" → Claude Pro/Max, or set an Anthropic API key.');
      }
      const response = await postAnthropic(
        {
          model: model.id,
          accessToken: token,
          // OAuth cloaking only for a Claude token on the genuine Anthropic host;
          // a compatible hub (Tencent TokenHub) always gets the plain x-api-key shape.
          oauth: shouldUseOAuthShape(token, model.baseUrl),
          systemPrompt: context.systemPrompt,
          messages: context.messages,
          tools: context.tools,
          temperature: options?.temperature,
          maxTokens: options?.maxTokens,
          reasoning: options?.reasoning,
          stream: true,
          baseUrl: model.baseUrl,
        },
        options?.signal,
      );

      stream.push({ type: "start", partial: output });
      const blocks = output.content;
      const indexOf = (b: TextContent | ThinkingContent | ToolCall) => blocks.indexOf(b);
      let textBlock: TextContent | null = null;
      let thinkingBlock: ThinkingContent | null = null;
      let cachedInput: number | undefined;
      let stopReason: string | undefined;
      const toolAcc = new Map<number, { name: string; args: string }>();

      if (response.body) {
        for await (const data of readSse(response.body)) {
          let evt: {
            type?: string;
            index?: number;
            content_block?: { type?: string; name?: string; data?: string };
            delta?: { type?: string; text?: string; partial_json?: string; thinking?: string; signature?: string; stop_reason?: string };
            message?: { usage?: AnthropicUsage; stop_reason?: string };
            usage?: { output_tokens?: number };
          };
          try {
            evt = JSON.parse(data);
          } catch {
            continue;
          }

          if (evt.type === "content_block_start" && evt.content_block?.type === "tool_use" && typeof evt.index === "number") {
            toolAcc.set(evt.index, { name: evt.content_block.name ?? "", args: "" });
          } else if (evt.type === "content_block_start" && evt.content_block?.type === "thinking") {
            if (!thinkingBlock) {
              thinkingBlock = { type: "thinking", thinking: "" };
              blocks.push(thinkingBlock);
              stream.push({ type: "thinking_start", contentIndex: indexOf(thinkingBlock), partial: output });
            }
          } else if (evt.type === "content_block_start" && evt.content_block?.type === "redacted_thinking" && evt.content_block.data) {
            const redacted: ThinkingContent = { type: "thinking", thinking: "", redacted: true, thinkingSignature: evt.content_block.data };
            blocks.push(redacted);
          } else if (evt.type === "content_block_delta" && evt.delta?.type === "input_json_delta" && typeof evt.index === "number") {
            const b = toolAcc.get(evt.index);
            if (b) b.args += evt.delta.partial_json ?? "";
          } else if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
            if (!textBlock) {
              textBlock = { type: "text", text: "" };
              blocks.push(textBlock);
              stream.push({ type: "text_start", contentIndex: indexOf(textBlock), partial: output });
            }
            textBlock.text += evt.delta.text;
            stream.push({ type: "text_delta", contentIndex: indexOf(textBlock), delta: evt.delta.text, partial: output });
          } else if (evt.type === "content_block_delta" && evt.delta?.type === "thinking_delta" && evt.delta.thinking) {
            if (!thinkingBlock) {
              thinkingBlock = { type: "thinking", thinking: "" };
              blocks.push(thinkingBlock);
              stream.push({ type: "thinking_start", contentIndex: indexOf(thinkingBlock), partial: output });
            }
            thinkingBlock.thinking += evt.delta.thinking;
            stream.push({ type: "thinking_delta", contentIndex: indexOf(thinkingBlock), delta: evt.delta.thinking, partial: output });
          } else if (evt.type === "content_block_delta" && evt.delta?.type === "signature_delta" && evt.delta.signature) {
            if (thinkingBlock) thinkingBlock.thinkingSignature = (thinkingBlock.thinkingSignature ?? "") + evt.delta.signature;
          } else if (evt.type === "message_start" && evt.message?.usage) {
            cachedInput = totalInputTokens(evt.message.usage);
          } else if (evt.type === "message_delta") {
            if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
            if (evt.usage) {
              output.usage.input = cachedInput ?? output.usage.input;
              output.usage.output = evt.usage.output_tokens ?? output.usage.output;
              output.usage.totalTokens = output.usage.input + output.usage.output;
            }
          }
        }
      }

      if (thinkingBlock) {
        stream.push({ type: "thinking_end", contentIndex: indexOf(thinkingBlock), content: thinkingBlock.thinking, partial: output });
      }
      if (textBlock) {
        stream.push({ type: "text_end", contentIndex: indexOf(textBlock), content: textBlock.text, partial: output });
      }
      // Finalize accumulated tool calls (input_json_delta fragments → parsed args).
      for (const [, acc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
        let args: Record<string, unknown> = {};
        try {
          args = acc.args ? (JSON.parse(acc.args) as Record<string, unknown>) : {};
        } catch {
          args = {};
        }
        const toolCall: ToolCall = { type: "toolCall", id: `anthropic-${randomUUID()}`, name: acc.name, arguments: args };
        blocks.push(toolCall);
        stream.push({ type: "toolcall_start", contentIndex: indexOf(toolCall), partial: output });
        stream.push({ type: "toolcall_end", contentIndex: indexOf(toolCall), toolCall, partial: output });
        output.stopReason = "toolUse";
      }

      if (options?.signal?.aborted) throw new Error("Request was aborted");
      // A 200 that streamed nothing usable is a failed response — surface the cause.
      if (blocks.length === 0) throw emptyCompletionError(stopReason);
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
