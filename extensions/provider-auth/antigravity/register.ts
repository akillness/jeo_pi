/**
 * Register the Antigravity provider with pi: the borrowed Google Cloud Code
 * Assist OAuth login (so Antigravity shows under /login → "Use a subscription")
 * plus a custom streamSimple
 * handler that serves the antigravity/* models over the CCA proxy.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { ANTIGRAVITY_DAILY_ENDPOINT, streamAntigravity } from "./cca.js";
import { getAntigravityApiKey, loginAntigravity, refreshAntigravityToken } from "./oauth.js";

export const ANTIGRAVITY_PROVIDER = "antigravity";

/**
 * Canonical Antigravity model ids served via Cloud Code Assist, mirrored from
 * jeo-code's static catalog (`src/ai/model-catalog.ts` → ANTIGRAVITY_MODELS).
 *
 * These are the wire ids the CCA `streamGenerateContent` endpoint accepts once
 * the `antigravity/` provider prefix is stripped (see `cca.ts:antigravityModelId`).
 * The previous jeo_pi list shipped a bare `gemini-3-pro` that the backend does
 * not serve (real ids are the `-high`/`-low` thinking-depth variants).
 */
export const ANTIGRAVITY_MODEL_IDS = [
  "claude-opus-4-5-thinking",
  "claude-opus-4-6-thinking",
  "claude-opus-4-7",
  "claude-opus-4-7-thinking",
  "claude-opus-4-8",
  "claude-opus-4-8-thinking",
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-thinking",
  "claude-sonnet-4-6",
  "claude-sonnet-4-6-thinking",
  "gemini-2.5-flash",
  "gemini-2.5-flash-thinking",
  "gemini-2.5-pro",
  "gemini-3-flash",
  "gemini-3-pro-high",
  "gemini-3-pro-low",
  "gemini-3.1-pro-high",
  "gemini-3.1-pro-low",
  "gpt-oss-120b-medium",
  "gpt-5.5",
] as const;

export interface AntigravityModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

/**
 * Derive the pi ProviderModelConfig fields for an Antigravity model id, applying
 * the same capability rules jeo-code's catalog uses:
 *   - context window: Claude 200K · GPT-5 400K · everything else (Gemini/gpt-oss) 1M
 *   - max output:     Claude 64K  · GPT-5 128K · everything else 65,536
 *   - reasoning:      every Antigravity model exposes at least standard thinking
 *   - images:         all except the text-only gpt-oss family
 */
export function toAntigravityModel(id: string): AntigravityModel {
  const isClaude = id.includes("claude");
  const isGpt5 = id.startsWith("gpt-5");
  const isGptOss = id.includes("gpt-oss");
  const images = !isGptOss;
  return {
    id: `${ANTIGRAVITY_PROVIDER}/${id}`,
    name: `${id} (Antigravity)`,
    reasoning: true,
    input: images ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: isClaude ? 200_000 : isGpt5 ? 400_000 : 1_000_000,
    maxTokens: isClaude ? 64_000 : isGpt5 ? 128_000 : 65_536,
  };
}

/** Antigravity model catalogue served via Cloud Code Assist (jeo-code parity). */
export const ANTIGRAVITY_MODELS: AntigravityModel[] = ANTIGRAVITY_MODEL_IDS.map(toAntigravityModel);

/**
 * Wire Antigravity into pi. Safe to call during extension load — registerProvider
 * is queued until the runner binds its context.
 */
export function registerAntigravityProvider(pi: ExtensionAPI): void {
  pi.registerProvider(ANTIGRAVITY_PROVIDER, {
    name: "Google Antigravity (Cloud Code Assist)",
    baseUrl: ANTIGRAVITY_DAILY_ENDPOINT,
    api: "google-generative-ai",
    // OAuth provides the bearer token; this placeholder satisfies the "apiKey
    // required when defining models" rule and is overridden at request time.
    apiKey: "antigravity-oauth",
    models: ANTIGRAVITY_MODELS,
    streamSimple: (model: Model<any>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream =>
      streamAntigravity(model as Model<"google-generative-ai">, context, {
        apiKey: options?.apiKey,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        reasoning: options?.reasoning,
        signal: options?.signal,
      }),
    oauth: {
      name: "Google Antigravity (Cloud Code Assist agent)",
      login: loginAntigravity,
      refreshToken: refreshAntigravityToken,
      getApiKey: getAntigravityApiKey,
    },
  });
}
