/**
 * Custom-provider configuration for `~/.pi/agent/models.json`.
 *
 * pi natively serves any provider that speaks a supported wire API
 * (OpenAI Completions / Responses, Anthropic Messages, Google Generative AI)
 * once it is described in `models.json`. This module reads, merges and writes
 * that file so the `/provider` command can configure Ollama, LM Studio, vLLM
 * and any other OpenAI-compatible endpoint without hand-editing JSON.
 *
 * All functions are pure with respect to an explicit file path so they are
 * unit-testable without touching the real `~/.pi` directory.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export type ProviderApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai"
  | (string & {});

export interface ModelCompat {
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  [key: string]: unknown;
}

export interface CustomModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  compat?: ModelCompat;
}

export interface CustomProvider {
  name?: string;
  baseUrl: string;
  api: ProviderApi;
  /** Required by pi even when the endpoint ignores it (e.g. Ollama). */
  apiKey: string;
  headers?: Record<string, string>;
  compat?: ModelCompat;
  models: CustomModel[];
}

export interface ModelsConfig {
  providers?: Record<string, CustomProvider>;
  [key: string]: unknown;
}

/** Absolute path to the agent-level models.json given the pi agent dir. */
export function modelsJsonPath(agentDir: string): string {
  return join(agentDir, "models.json");
}

/**
 * Read and parse models.json. Returns an empty config when the file is absent.
 * A malformed file throws so the caller can surface the problem rather than
 * silently clobbering a user's hand-written configuration.
 */
export function readModelsConfig(path: string): ModelsConfig {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8").trim();
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`models.json at ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`models.json at ${path} must be a JSON object`);
  }
  return parsed as ModelsConfig;
}

/** Merge a new model list into an existing one, de-duplicating by model id. */
export function mergeModels(existing: CustomModel[] | undefined, incoming: CustomModel[]): CustomModel[] {
  const byId = new Map<string, CustomModel>();
  for (const m of existing ?? []) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()];
}

/**
 * Insert or update a custom provider, returning a NEW config object (the input
 * is not mutated). Models are merged by id so re-running `/provider` to add a
 * model never drops previously configured ones.
 */
export function upsertProvider(config: ModelsConfig, name: string, provider: CustomProvider): ModelsConfig {
  const providers = { ...(config.providers ?? {}) };
  const prior = providers[name];
  providers[name] = {
    ...provider,
    models: mergeModels(prior?.models, provider.models),
  };
  return { ...config, providers };
}

/** Remove a custom provider. Returns a new config; no-op when absent. */
export function removeProvider(config: ModelsConfig, name: string): ModelsConfig {
  if (!config.providers || !(name in config.providers)) return config;
  const providers = { ...config.providers };
  delete providers[name];
  return { ...config, providers };
}

/** List configured custom provider names. */
export function listProviders(config: ModelsConfig): string[] {
  return Object.keys(config.providers ?? {});
}

/** Serialize and atomically-enough write models.json with 0600 perms (creating the dir). */
export function writeModelsConfig(path: string, config: ModelsConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
}
