/**
 * Register the Anthropic (Claude Pro/Max) provider with pi, swapping pi's
 * built-in Claude OAuth + streaming for jeo-code's proven implementation.
 *
 * We register the provider name `anthropic` carrying:
 *   - an `oauth` block → jeo-code's `claude.ai/oauth/authorize` PKCE flow,
 *     overriding pi's built-in (`platform.claude.com`) OAuth provider in the
 *     global `/login` registry, and
 *   - a custom `streamSimple` keyed by the `anthropic-messages` api → the
 *     Claude Code request structure that makes an OAuth subscription actually
 *     respond (identity headers, billing/cloaking metadata, system prelude,
 *     adaptive/budget thinking, native tool blocks, empty-response surfacing).
 *
 * No `models` are declared, so pi's built-in Claude catalogue is preserved —
 * we only override the OAuth flow and the streaming transport.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { streamAnthropic } from "./messages.js";
import { getAnthropicApiKey, loginAnthropic, refreshAnthropicToken } from "./oauth.js";

export const ANTHROPIC_PROVIDER = "anthropic";
export const ANTHROPIC_API = "anthropic-messages";

/**
 * Wire the Claude provider into pi. Safe to call during extension load —
 * registerProvider is queued until the runner binds its context. Declaring the
 * `api` + `streamSimple` (with no models) overrides the global
 * `anthropic-messages` streaming transport for the built-in Claude catalogue,
 * while the `oauth` block replaces the built-in OAuth login flow.
 */
export function registerAnthropicProvider(pi: ExtensionAPI): void {
  pi.registerProvider(ANTHROPIC_PROVIDER, {
    api: ANTHROPIC_API,
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
