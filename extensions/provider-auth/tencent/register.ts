/**
 * Register Tencent Cloud MaaS as a hosted model hub with pi.
 *
 * Tencent's international TokenHub (`tokenhub-intl.tencentcloudmaas.com`) is a
 * *hub*: a single API-key endpoint that serves many third-party model families
 * (DeepSeek, MiniMax, Zhipu GLM, Moonshot Kimi, Tencent Hunyuan) over the
 * Anthropic Messages wire format. We surface it as one pi provider named
 * `tencent` whose model list mirrors jeo-code's verified catalogue, so every
 * hosted model is selectable via `/model` and authenticated through
 * `/login → "Use an API key"` (the `TENCENT_API_KEY` env var).
 *
 * Wire details borrowed from jeo-code (`src/ai/providers/openai-compatible-catalog.ts`):
 *   - protocol:  Anthropic Messages (`api: "anthropic-messages"`); pi's Anthropic
 *                client posts to `${baseUrl}/v1/messages` with an `x-api-key`
 *                header — exactly what TokenHub expects.
 *   - base URL:  https://tokenhub-intl.tencentcloudmaas.com
 *   - api key:   "$TENCENT_API_KEY" (interpolated from the environment at request time).
 *
 * This module is pure with respect to its inputs so it is unit-testable without
 * touching the network or the real ~/.pi directory.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export const TENCENT_PROVIDER = "tencent";

/** International TokenHub base URL; pi appends `/v1/messages` (Anthropic wire). */
export const TENCENT_BASE_URL = "https://tokenhub-intl.tencentcloudmaas.com";

/**
 * Env var name carrying the TokenHub API key. The real key never has to be
 * baked into the registration: pi interpolates the `$`-prefixed reference below
 * from `process.env` at request time.
 */
export const TENCENT_API_KEY_ENV = "TENCENT_API_KEY";

/**
 * The `apiKey` value handed to pi. The current pi runtime
 * (`@earendil-works/pi-coding-agent`) resolves config values as templates: only
 * `$NAME` / `${NAME}` tokens are interpolated from the environment, while a bare
 * string is treated as a literal key. So the reference MUST carry the `$` —
 * passing the plain env-var name would be sent verbatim as the key and rejected
 * with `invalid api key` (verified live against TokenHub, 2026-06).
 */
export const TENCENT_API_KEY_REF = `$${TENCENT_API_KEY_ENV}`;

/** Canonical default model offered when the hub is selected with no explicit pick. */
export const TENCENT_DEFAULT_MODEL = "deepseek-v4-pro";

/**
 * Hosted model ids verified live against TokenHub by jeo-code (2026-06). Each id
 * is recognised by the `/v1/messages` route (returned either a completion or
 * FREE_QUOTA_EXHAUSTED). The host exposes no `/v1/models` route, so this list is
 * the offline source of truth for the hub's model picker.
 *
 * `vision: true` marks the multimodal members (GLM's `glm-5v` line); everything
 * else is text-only. Every model exposes extended thinking.
 */
export const TENCENT_MODEL_IDS: readonly { id: string; vision?: boolean }[] = [
  // DeepSeek
  { id: "deepseek-v4-pro" },
  { id: "deepseek-v4-pro-202606" },
  { id: "deepseek-v4-flash" },
  { id: "deepseek-v4-flash-202605" },
  { id: "deepseek-v3.2" },
  // MiniMax
  { id: "minimax-m3" },
  { id: "minimax-m2.7" },
  { id: "minimax-m2.5" },
  // Zhipu GLM
  { id: "glm-5.2" },
  { id: "glm-5.1" },
  { id: "glm-5" },
  { id: "glm-5-turbo" },
  { id: "glm-5v-turbo", vision: true },
  // Moonshot Kimi
  { id: "kimi-k2.6" },
  { id: "kimi-k2.5" },
  // Tencent Hunyuan MT
  { id: "hy-mt2-plus" },
] as const;

export interface TencentModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

/**
 * Derive the pi ProviderModelConfig fields for a TokenHub model id, applying the
 * same capability rules jeo-code's catalogue uses (128K context · 8K output ·
 * thinking on every model · images only on the `glm-5v` vision line).
 *
 * The `id` is the BARE TokenHub model id (e.g. `minimax-m3`), not namespaced.
 * The stock `anthropic-messages` transport sends `model.id` verbatim as the
 * request `model`, and TokenHub only recognises bare ids — a `tencent/`-prefixed
 * id is rejected with `model '…' not found` (verified live, 2026-06). pi still
 * scopes the model to this provider via the registration name, so it is selected
 * as `tencent/<id>` on the CLI while the wire receives `<id>`.
 */
export function toTencentModel(entry: { id: string; vision?: boolean }): TencentModel {
  const vision = entry.vision === true;
  return {
    id: entry.id,
    name: `${entry.id} (Tencent)`,
    reasoning: true,
    input: vision ? ["text", "image"] : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

/** Full pi model list for the Tencent hub. */
export const TENCENT_MODELS: TencentModel[] = TENCENT_MODEL_IDS.map(toTencentModel);

/**
 * Wire the Tencent hub into pi. Safe to call during extension load —
 * registerProvider is queued until the runner binds its context. The provider
 * is always registered (so its hosted models are discoverable via `/model`);
 * requests succeed once `TENCENT_API_KEY` is present in the environment.
 */
export function registerTencentProvider(pi: ExtensionAPI): void {
  pi.registerProvider(TENCENT_PROVIDER, {
    name: "Tencent Cloud MaaS (TokenHub)",
    baseUrl: TENCENT_BASE_URL,
    api: "anthropic-messages",
    // pi interpolates "$TENCENT_API_KEY" from the environment at request time;
    // absent the key, requests fail with an honest auth error (not a startup
    // block). A bare env-var name would be sent literally, so use the $ ref.
    apiKey: TENCENT_API_KEY_REF,
    models: TENCENT_MODELS,
  });
}
