/**
 * Provider presets and argument parsing for the `/provider` command.
 *
 * Borrowed in spirit from jeo-code's `jeo auth login <provider>` UX: a single
 * verb configures a named provider. Where jeo-code authenticates cloud
 * subscriptions, this surface targets the API-key / local-endpoint providers
 * pi serves through models.json (Ollama, LM Studio and any OpenAI-compatible
 * "other API"), plus a passthrough to pi's built-in `/login` for Claude.
 */

import type { CustomModel, CustomProvider, ProviderApi } from "./models-config.js";

export interface ProviderPreset {
  /** models.json provider key (also the id shown by /model). */
  name: string;
  /** Human label. */
  label: string;
  baseUrl: string;
  api: ProviderApi;
  /** Placeholder key — local servers ignore it but pi requires a value. */
  apiKey: string;
  /** Suggested default model ids when the user supplies none. */
  defaultModels: string[];
  /** OpenAI-compat flags appropriate for the endpoint. */
  compat?: CustomProvider["compat"];
}

/** Local, keyless OpenAI-compatible servers jeo-code excludes from cloud login. */
export const PRESETS: Record<string, ProviderPreset> = {
  ollama: {
    name: "ollama",
    label: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    api: "openai-completions",
    apiKey: "ollama",
    defaultModels: ["llama3.1:8b", "qwen2.5-coder:7b"],
    // Ollama's OpenAI shim rejects the `developer` role and reasoning_effort.
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  },
  lmstudio: {
    name: "lmstudio",
    label: "LM Studio (local)",
    baseUrl: "http://localhost:1234/v1",
    api: "openai-completions",
    apiKey: "lmstudio",
    defaultModels: [],
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);

/** Build a CustomProvider from a preset, overriding baseUrl/models when given. */
export function providerFromPreset(
  preset: ProviderPreset,
  overrides: { baseUrl?: string; models?: string[] } = {},
): CustomProvider {
  const modelIds = overrides.models && overrides.models.length > 0 ? overrides.models : preset.defaultModels;
  const models: CustomModel[] = modelIds.map((id) => ({ id }));
  return {
    name: preset.label,
    baseUrl: overrides.baseUrl?.trim() || preset.baseUrl,
    api: preset.api,
    apiKey: preset.apiKey,
    compat: preset.compat,
    models,
  };
}

const KNOWN_APIS: ProviderApi[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];

export interface CustomApiSpec {
  name: string;
  provider: CustomProvider;
}

/**
 * Parse `/provider api <name> <baseUrl> [--api X] [--key ENVVAR] [--header K=V]... [model...]`
 * into a registrable provider. Throws on missing required arguments so the
 * command handler can show a usage hint.
 */
export function parseCustomApiArgs(tokens: string[]): CustomApiSpec {
  const positional: string[] = [];
  let api: ProviderApi = "openai-completions";
  let apiKey = "";
  const headers: Record<string, string> = {};

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === "--api") {
      const value = tokens[++i];
      if (!value) throw new Error("--api requires a value");
      api = value as ProviderApi;
    } else if (tok === "--key") {
      const value = tokens[++i];
      if (!value) throw new Error("--key requires a value (env var name or literal key)");
      apiKey = value;
    } else if (tok === "--header") {
      const value = tokens[++i];
      if (!value || !value.includes("=")) throw new Error("--header requires K=V");
      const idx = value.indexOf("=");
      headers[value.slice(0, idx)] = value.slice(idx + 1);
    } else {
      positional.push(tok);
    }
  }

  const [name, baseUrl, ...modelIds] = positional;
  if (!name) throw new Error("provider name is required");
  if (!baseUrl) throw new Error("baseUrl is required");
  if (KNOWN_APIS.indexOf(api) === -1) {
    throw new Error(`unknown --api '${api}'. Known: ${KNOWN_APIS.join(", ")}`);
  }

  const provider: CustomProvider = {
    name,
    baseUrl,
    api,
    // Default to a placeholder so local/keyless endpoints work; real providers
    // pass --key NAME pointing at an env var pi resolves at request time.
    apiKey: apiKey || `${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    models: modelIds.map((id) => ({ id })),
  };
  return { name, provider };
}
