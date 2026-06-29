/**
 * Startup loader for models.json custom providers.
 *
 * The extension no longer exposes a `/provider` slash command. Instead every
 * provider is surfaced through pi's native `/login`:
 *   - Claude / Anthropic — built-in OAuth subscription (pi ships it).
 *   - Antigravity        — registered with an `oauth` block (see antigravity/register.ts)
 *                          so it appears under /login → "Use a subscription".
 *   - Other API / local  — any OpenAI-compatible endpoint described in
 *                          ~/.pi/agent/models.json is registered here at load
 *                          time, so it shows under /login → "Use an API key"
 *                          (or is directly selectable via /model).
 *
 * This module is pure with respect to an explicit agent dir so it is
 * unit-testable without touching the real ~/.pi directory.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CustomModel, CustomProvider } from "./models-config.js";
import { listProviders, modelsJsonPath, readModelsConfig } from "./models-config.js";

/** Default model fields used when registering a models.json model at runtime. */
export function toRuntimeModel(provider: CustomProvider, m: CustomModel): {
  id: string;
  name: string;
  api: CustomProvider["api"];
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  compat?: CustomProvider["compat"];
} {
  return {
    id: m.id,
    name: m.name ?? m.id,
    api: provider.api,
    reasoning: m.reasoning ?? false,
    input: m.input ?? ["text"],
    cost: m.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: m.contextWindow ?? 128_000,
    maxTokens: m.maxTokens ?? 8_192,
    compat: m.compat ?? provider.compat,
  };
}

export interface LoadResult {
  /** Provider names registered at runtime (had at least one model). */
  registered: string[];
  /** Provider names present in models.json but skipped (no models yet). */
  skipped: string[];
}

/**
 * Read ~/.pi/agent/models.json and register every configured custom provider so
 * it is usable through pi's native surfaces. A malformed models.json is reported
 * via the optional onError sink rather than throwing, so a single bad file never
 * blocks extension load (and thus never blocks /login for the OAuth providers).
 */
export function loadCustomProvidersFromConfig(
  pi: ExtensionAPI,
  agentDir: string,
  onError?: (message: string) => void,
): LoadResult {
  const result: LoadResult = { registered: [], skipped: [] };
  const path = modelsJsonPath(agentDir);

  let config;
  try {
    config = readModelsConfig(path);
  } catch (err) {
    onError?.((err as Error).message);
    return result;
  }

  for (const name of listProviders(config)) {
    const provider = config.providers?.[name];
    if (!provider) continue;
    if (!provider.models || provider.models.length === 0) {
      result.skipped.push(name);
      continue;
    }
    pi.registerProvider(name, {
      name: provider.name ?? name,
      baseUrl: provider.baseUrl,
      api: provider.api,
      apiKey: provider.apiKey,
      headers: provider.headers,
      models: provider.models.map((m) => toRuntimeModel(provider, m)),
    });
    result.registered.push(name);
  }

  return result;
}
