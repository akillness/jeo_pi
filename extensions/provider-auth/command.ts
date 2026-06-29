/**
 * `/provider` command — a unified provider authentication / setup surface for
 * jeo_pi, borrowing the single-verb UX of jeo-code's `jeo auth login <provider>`.
 *
 * Subcommands:
 *   /provider                      → list configured providers + auth guidance
 *   /provider ollama [url] [m...]  → configure a local Ollama endpoint
 *   /provider lmstudio [url] [m..] → configure a local LM Studio endpoint
 *   /provider api <name> <url> ... → configure any OpenAI-compatible "other API"
 *   /provider antigravity          → register Antigravity (then /login antigravity)
 *   /provider claude               → guidance for Claude (built-in /login)
 *   /provider remove <name>        → drop a custom provider from models.json
 */

import type { CustomModel, CustomProvider, ModelsConfig } from "./models-config.js";
import { listProviders, readModelsConfig, removeProvider, upsertProvider, writeModelsConfig } from "./models-config.js";
import { PRESETS, PRESET_NAMES, parseCustomApiArgs, providerFromPreset } from "./presets.js";

export type ProviderAction =
  | { kind: "status" }
  | { kind: "claude" }
  | { kind: "antigravity" }
  | { kind: "configure"; name: string; provider: CustomProvider }
  | { kind: "remove"; name: string }
  | { kind: "error"; message: string };

/** Parse a raw `/provider` argument string into an action. Pure + unit-tested. */
export function parseProviderCommand(argString: string): ProviderAction {
  const tokens = argString.trim().split(/\s+/).filter((t) => t.length > 0);
  const sub = (tokens[0] ?? "").toLowerCase();

  if (!sub || sub === "status" || sub === "list") return { kind: "status" };
  if (sub === "claude" || sub === "anthropic") return { kind: "claude" };
  if (sub === "antigravity") return { kind: "antigravity" };

  if (sub === "remove" || sub === "rm" || sub === "delete") {
    const name = tokens[1];
    if (!name) return { kind: "error", message: "Usage: /provider remove <name>" };
    return { kind: "remove", name };
  }

  if (sub === "ollama" || sub === "lmstudio") {
    const preset = PRESETS[sub];
    const rest = tokens.slice(1);
    // First non-model token that looks like a URL is treated as baseUrl.
    let baseUrl: string | undefined;
    let models = rest;
    if (rest[0] && /^https?:\/\//i.test(rest[0])) {
      baseUrl = rest[0];
      models = rest.slice(1);
    }
    return { kind: "configure", name: preset.name, provider: providerFromPreset(preset, { baseUrl, models }) };
  }

  if (sub === "api" || sub === "custom" || sub === "openai-compatible") {
    try {
      const { name, provider } = parseCustomApiArgs(tokens.slice(1));
      return { kind: "configure", name, provider };
    } catch (err) {
      return { kind: "error", message: `${(err as Error).message}\nUsage: /provider api <name> <baseUrl> [--api openai-completions] [--key ENV_VAR] [--header K=V] [model...]` };
    }
  }

  return {
    kind: "error",
    message: `Unknown provider target '${sub}'. Try: ${PRESET_NAMES.join(", ")}, api, antigravity, claude, status, remove.`,
  };
}

/** Default model fields used when registering a minimal model at runtime. */
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

/** Apply a configure/remove action to a models.json config object. Pure. */
export function applyToConfig(config: ModelsConfig, action: ProviderAction): ModelsConfig {
  if (action.kind === "configure") return upsertProvider(config, action.name, action.provider);
  if (action.kind === "remove") return removeProvider(config, action.name);
  return config;
}

/** Human-readable status summary of configured custom providers. */
export function statusReport(config: ModelsConfig): string {
  const custom = listProviders(config);
  const lines: string[] = [];
  lines.push("Provider authentication & setup (jeo_pi):");
  lines.push("  • claude       — built-in: run /login (Anthropic) or set ANTHROPIC_API_KEY");
  lines.push("  • antigravity  — run /provider antigravity, then /login antigravity");
  lines.push("  • ollama       — run /provider ollama [baseUrl] [model...]");
  lines.push("  • lmstudio     — run /provider lmstudio [baseUrl] [model...]");
  lines.push("  • other API    — run /provider api <name> <baseUrl> [--api ...] [--key ENV] [model...]");
  if (custom.length > 0) {
    lines.push("");
    lines.push("Configured custom providers (models.json):");
    for (const name of custom) {
      const p = config.providers?.[name];
      const models = p?.models?.map((m) => m.id).join(", ") || "(no models yet)";
      lines.push(`  - ${name} → ${p?.baseUrl} [${p?.api}] : ${models}`);
    }
  }
  return lines.join("\n");
}

export { readModelsConfig, writeModelsConfig };
