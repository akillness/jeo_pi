// extensions/tool-flow/runner.ts
//
// Durable-structure + knowledge-capture wiring for jeo-pi, the pi-agent parity of
// jeo-code's `~/.jeo/config.json` hooks (post-implementation: graphify, post-turn:
// llm-wiki ingest). pi has no shell-hook config, so this logic runs inside a bundled
// extension that subscribes to `tool_execution_end` + `turn_end`.
//
// All side effects are fire-and-forget and self-guarded: a missing tool or vault is a
// silent no-op and never blocks a turn.

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

/** Tools whose successful completion means the workspace changed (graphify should refresh). */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);

/** Minimal spawn surface so tests can record invocations without launching processes. */
export type SpawnLike = (
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
) => void;

export interface ToolFlowDeps {
  /** Launch a detached, output-discarded child process. */
  spawn: SpawnLike;
  /** Process environment (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** Path existence check (injectable for tests). */
  fileExists?: (path: string) => boolean;
  /** Home directory (injectable for tests). */
  homeDir?: string;
}

/** Resolve the llm-wiki vault: $LLM_WIKI_VAULT or ~/vaults/llm-wiki (matches setup Step 3e/3i). */
export function resolveVault(env: NodeJS.ProcessEnv, homeDir: string): string {
  const override = env.LLM_WIKI_VAULT?.trim();
  return override && override.length > 0 ? override : join(homeDir, "vaults", "llm-wiki");
}

/** Path to the llm-wiki ingest script inside a vault. */
export function ingestScriptPath(vault: string): string {
  return join(vault, "scripts", "ingest-prompt.py");
}

/**
 * Tracks whether the current turn produced workspace edits and drives the two
 * durable side effects (graphify refresh, llm-wiki ingest) at turn boundaries.
 */
export class ToolFlowRunner {
  private dirty = false;
  private readonly spawn: SpawnLike;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fileExists: (path: string) => boolean;
  private readonly homeDir: string;

  constructor(deps: ToolFlowDeps) {
    this.spawn = deps.spawn;
    this.env = deps.env ?? process.env;
    this.fileExists = deps.fileExists ?? existsSync;
    this.homeDir = deps.homeDir ?? homedir();
  }

  /** Whether a mutating tool has completed since the last graphify refresh. */
  get isDirty(): boolean {
    return this.dirty;
  }

  /** Record a finished tool execution; flips the dirty flag for successful edits/writes. */
  markToolEnd(toolName: string, isError: boolean): void {
    if (!isError && MUTATING_TOOLS.has(toolName)) {
      this.dirty = true;
    }
  }

  /**
   * Refresh the durable graph when the workspace changed. Equivalent to jeo's
   * `post-implementation` hook (`graphify update .`). No-ops when nothing changed.
   * Returns true when a refresh was launched.
   */
  runGraphify(cwd: string): boolean {
    if (!this.dirty) {
      return false;
    }
    this.dirty = false;
    this.spawn("graphify", ["update", "."], { cwd, env: this.env });
    return true;
  }

  /**
   * Capture the turn into the llm-wiki vault. Equivalent to jeo's `post-turn` hook.
   * No-ops when the vault's ingest script is absent. Returns true when launched.
   */
  runIngest(cwd: string): boolean {
    const vault = resolveVault(this.env, this.homeDir);
    const script = ingestScriptPath(vault);
    if (!this.fileExists(script)) {
      return false;
    }
    this.spawn("python3", [script], {
      cwd,
      env: { ...this.env, LLM_WIKI_VAULT: vault },
    });
    return true;
  }

  /**
   * Turn-boundary driver: refresh graphify if dirty, then ingest the turn.
   * Returns which side effects were launched (for diagnostics/tests).
   */
  onTurnEnd(cwd: string): { graphify: boolean; ingest: boolean } {
    const graphify = this.runGraphify(cwd);
    const ingest = this.runIngest(cwd);
    return { graphify, ingest };
  }
}
