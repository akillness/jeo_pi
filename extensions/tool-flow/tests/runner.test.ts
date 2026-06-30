// extensions/tool-flow/tests/runner.test.ts
import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import {
  ToolFlowRunner,
  MUTATING_TOOLS,
  resolveVault,
  ingestScriptPath,
  type SpawnLike,
} from "../runner.js";

interface SpawnCall {
  command: string;
  args: string[];
  options: { cwd?: string; env?: NodeJS.ProcessEnv };
}

function recordingSpawn(): { spawn: SpawnLike; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawn: SpawnLike = (command, args, options) => {
    calls.push({ command, args, options });
  };
  return { spawn, calls };
}

describe("resolveVault", () => {
  it("prefers LLM_WIKI_VAULT when set", () => {
    expect(resolveVault({ LLM_WIKI_VAULT: "/custom/vault" }, "/home/u")).toBe("/custom/vault");
  });

  it("trims whitespace-only override and falls back to default", () => {
    expect(resolveVault({ LLM_WIKI_VAULT: "   " }, "/home/u")).toBe(join("/home/u", "vaults", "llm-wiki"));
  });

  it("defaults to ~/vaults/llm-wiki when unset", () => {
    expect(resolveVault({}, "/home/u")).toBe(join("/home/u", "vaults", "llm-wiki"));
  });
});

describe("ingestScriptPath", () => {
  it("points at scripts/ingest-prompt.py inside the vault", () => {
    expect(ingestScriptPath("/v")).toBe(join("/v", "scripts", "ingest-prompt.py"));
  });
});

describe("ToolFlowRunner dirty tracking", () => {
  it("flips dirty only for successful mutating tools", () => {
    const { spawn } = recordingSpawn();
    const runner = new ToolFlowRunner({ spawn, fileExists: () => false });

    for (const tool of MUTATING_TOOLS) {
      const r = new ToolFlowRunner({ spawn, fileExists: () => false });
      r.markToolEnd(tool, false);
      expect(r.isDirty).toBe(true);
    }

    runner.markToolEnd("read", false);
    expect(runner.isDirty).toBe(false);

    runner.markToolEnd("edit", true); // errored edit must not mark dirty
    expect(runner.isDirty).toBe(false);
  });
});

describe("ToolFlowRunner.runGraphify", () => {
  it("no-ops and launches nothing when clean", () => {
    const { spawn, calls } = recordingSpawn();
    const runner = new ToolFlowRunner({ spawn, fileExists: () => false });
    expect(runner.runGraphify("/work")).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("launches `graphify update .` in cwd when dirty, then clears dirty", () => {
    const { spawn, calls } = recordingSpawn();
    const runner = new ToolFlowRunner({ spawn, fileExists: () => false });
    runner.markToolEnd("write", false);
    expect(runner.runGraphify("/work")).toBe(true);
    expect(calls).toEqual([{ command: "graphify", args: ["update", "."], options: { cwd: "/work", env: expect.anything() } }]);
    expect(runner.isDirty).toBe(false);
    // second call with no new edits is a no-op
    expect(runner.runGraphify("/work")).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe("ToolFlowRunner.runIngest", () => {
  it("no-ops when the vault ingest script is absent", () => {
    const { spawn, calls } = recordingSpawn();
    const runner = new ToolFlowRunner({ spawn, env: {}, homeDir: "/home/u", fileExists: () => false });
    expect(runner.runIngest("/work")).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("launches python3 with LLM_WIKI_VAULT injected when the script exists", () => {
    const { spawn, calls } = recordingSpawn();
    const vault = "/home/u/vaults/llm-wiki";
    const script = join(vault, "scripts", "ingest-prompt.py");
    const runner = new ToolFlowRunner({
      spawn,
      env: { PATH: "/usr/bin" },
      homeDir: "/home/u",
      fileExists: (p) => p === script,
    });
    expect(runner.runIngest("/work")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("python3");
    expect(calls[0].args).toEqual([script]);
    expect(calls[0].options.cwd).toBe("/work");
    expect(calls[0].options.env).toMatchObject({ PATH: "/usr/bin", LLM_WIKI_VAULT: vault });
  });
});

describe("ToolFlowRunner.onTurnEnd", () => {
  it("runs both graphify (when dirty) and ingest (when script present)", () => {
    const { spawn, calls } = recordingSpawn();
    const vault = "/home/u/vaults/llm-wiki";
    const script = join(vault, "scripts", "ingest-prompt.py");
    const runner = new ToolFlowRunner({
      spawn,
      env: {},
      homeDir: "/home/u",
      fileExists: (p) => p === script,
    });
    runner.markToolEnd("edit", false);
    const result = runner.onTurnEnd("/work");
    expect(result).toEqual({ graphify: true, ingest: true });
    expect(calls.map((c) => c.command)).toEqual(["graphify", "python3"]);
  });

  it("only ingests when there were no edits this turn", () => {
    const { spawn, calls } = recordingSpawn();
    const vault = "/home/u/vaults/llm-wiki";
    const script = join(vault, "scripts", "ingest-prompt.py");
    const runner = new ToolFlowRunner({
      spawn,
      env: {},
      homeDir: "/home/u",
      fileExists: (p) => p === script,
    });
    const result = runner.onTurnEnd("/work");
    expect(result).toEqual({ graphify: false, ingest: true });
    expect(calls.map((c) => c.command)).toEqual(["python3"]);
  });
});
