/**
 * Register the Anthropic (Claude Pro/Max) provider with pi, swapping pi's
 * built-in Claude OAuth + streaming for jeo-code's proven implementation.
 *
 * We register the provider name `anthropic` carrying:
 *   - an up-to-date Claude `models` catalogue (jeo-code parity), which REPLACES
 *     pi's stale built-in Claude list and pins every Claude id to our
 *     `anthropic-messages` streamSimple transport — fixing both the outdated
 *     model picker and the HTTP 400 "third-party OAuth" rejection that occurs
 *     when a Claude id is streamed without the Claude Code identity shape,
 *   - an `oauth` block → jeo-code's `claude.ai/oauth/authorize` PKCE flow,
 *     overriding pi's built-in (`platform.claude.com`) OAuth provider in the
 *     global `/login` registry, and
 *   - a custom `streamSimple` keyed by the `anthropic-messages` api → the
 *     Claude Code request structure that makes an OAuth subscription actually
 *     respond (identity headers, billing/cloaking metadata, system prelude,
 *     adaptive/budget thinking, native tool blocks, empty-response surfacing).
 */

import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
import type { Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { streamAnthropic } from "./messages.js";
import { getAnthropicApiKey, loginAnthropic, refreshAnthropicToken } from "./oauth.js";

export const ANTHROPIC_PROVIDER = "anthropic";
export const ANTHROPIC_API = "anthropic-messages";

/**
 * Anthropic `/v1/messages` base. pi appends nothing — our streamAnthropic reads
 * `model.baseUrl` and builds `${base}/v1/messages` (see messages.ts), so this is
 * the host root, not the full endpoint.
 */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

interface AnthropicCatalogEntry {
  /** Exact wire id Anthropic's `/v1/messages` accepts (also the pi model id). */
  id: string;
  /** Human-facing label in the model picker. */
  name: string;
  /** Extended-thinking capable (drives the reasoning-level UI). */
  reasoning: boolean;
  /** Max output tokens. */
  maxTokens: number;
}

/**
 * Curated Claude catalogue — capability metadata mirrored from jeo-code's
 * verified direct-API entries (`src/ai/model-catalog.ts`). These are the exact
 * wire ids the live Anthropic Messages endpoint serves; opus 4.6+ stream via the
 * adaptive thinking transport, 4.5 via budget-effort, older via budget (handled
 * by messages.ts per id). All carry a 200K context window and accept images.
 * Cost is 0 — the Claude Pro/Max OAuth subscription is not per-token billed; the
 * `sk-ant-…` API-key path is usage-billed by Anthropic directly.
 */
const ANTHROPIC_CATALOG: readonly AnthropicCatalogEntry[] = [
  { id: "claude-opus-4-8", name: "Claude Opus 4.8", reasoning: true, maxTokens: 64_000 },
  { id: "claude-opus-4-7", name: "Claude Opus 4.7", reasoning: true, maxTokens: 64_000 },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6", reasoning: true, maxTokens: 64_000 },
  { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5", reasoning: true, maxTokens: 64_000 },
  { id: "claude-opus-4-1-20250805", name: "Claude Opus 4.1", reasoning: true, maxTokens: 32_000 },
  { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", reasoning: true, maxTokens: 64_000 },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", reasoning: true, maxTokens: 64_000 },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", reasoning: false, maxTokens: 8_192 },
] as const;

/** Build the pi ProviderModelConfig list from the curated Claude catalogue. */
export const ANTHROPIC_MODELS: ProviderModelConfig[] = ANTHROPIC_CATALOG.map((m) => ({
  id: m.id,
  name: m.name,
  api: ANTHROPIC_API,
  reasoning: m.reasoning,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: m.maxTokens,
}));

/**
 * Wire the Claude provider into pi. Safe to call during extension load —
 * registerProvider is queued until the runner binds its context. Declaring the
 * `api` + `streamSimple` overrides the global `anthropic-messages` streaming
 * transport; the `models` catalogue replaces pi's stale built-in Claude list
 * (full replacement, jeo-code parity); the `oauth` block replaces the built-in
 * OAuth login flow.
 */
export function registerAnthropicProvider(pi: ExtensionAPI): void {
  pi.registerProvider(ANTHROPIC_PROVIDER, {
    name: "Anthropic (Claude)",
    baseUrl: ANTHROPIC_BASE_URL,
    api: ANTHROPIC_API,
    models: ANTHROPIC_MODELS,
    streamSimple: (model: Model<any>, context: Context, options?: SimpleStreamOptions) =>
      streamAnthropic(model as Model<"anthropic-messages">, context, {
        apiKey: options?.apiKey,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        reasoning: options?.reasoning,
        signal: options?.signal,
      }),
    oauth: {
      name: "Claude Pro/Max (OAuth)",
      login: loginAnthropic,
      refreshToken: refreshAnthropicToken,
      getApiKey: getAnthropicApiKey,
    },
  });
}
