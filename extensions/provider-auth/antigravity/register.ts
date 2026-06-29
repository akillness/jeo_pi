/**
 * Register the Antigravity provider with pi: the borrowed Google Cloud Code
 * Assist OAuth login (so Antigravity shows under /login → "Use a subscription")
 * plus a custom streamSimple
 * handler that serves the antigravity/* models over the CCA proxy.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AssistantMessageEventStream, Context, Model } from "@mariozechner/pi-ai";
import { ANTIGRAVITY_DAILY_ENDPOINT, streamAntigravity } from "./cca.js";
import { getAntigravityApiKey, loginAntigravity, refreshAntigravityToken } from "./oauth.js";

export const ANTIGRAVITY_PROVIDER = "antigravity";

/** Antigravity model catalogue served via Cloud Code Assist (jeo-code parity subset). */
const ANTIGRAVITY_MODELS = [
  {
    id: "antigravity/gemini-3-pro",
    name: "Gemini 3 Pro (Antigravity)",
    reasoning: true,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 65_536,
  },
  {
    id: "antigravity/claude-sonnet-4-5",
    name: "Claude Sonnet 4.5 (Antigravity)",
    reasoning: true,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 64_000,
  },
];

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
    streamSimple: (model: Model<any>, context: Context, options?: { apiKey?: string; temperature?: number; maxTokens?: number; signal?: AbortSignal }): AssistantMessageEventStream =>
      streamAntigravity(model as Model<"google-generative-ai">, context, options),
    oauth: {
      name: "Google Antigravity (Cloud Code Assist agent)",
      login: loginAntigravity,
      refreshToken: refreshAntigravityToken,
      getApiKey: getAntigravityApiKey,
    },
  });
}
