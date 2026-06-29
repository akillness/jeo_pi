/**
 * Custom-provider configuration read from `~/.pi/agent/models.json`.
 *
 * pi natively serves any provider that speaks a supported wire API
 * (OpenAI Completions / Responses, Anthropic Messages, Google Generative AI)
 * once it is described in `models.json`. This module reads that file so the
 * extension can register those providers at startup — surfacing them under
 * `/login → "Use an API key"` and `/model` without a bespoke command.
 *
 * All functions are pure with respect to an explicit file path so they are
 * unit-testable without touching the real `~/.pi` directory.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

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
 * silently ignoring a user's hand-written configuration.
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

/** List configured custom provider names. */
export function listProviders(config: ModelsConfig): string[] {
  return Object.keys(config.providers ?? {});
}
