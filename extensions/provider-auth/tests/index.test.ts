import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { existsSync, rmSync } from "fs";

// A throwaway agent dir so the handler's models.json read/writes never touch
// the real ~/.pi. getAgentDir is the only symbol index.ts needs at runtime
// from the pi runtime; everything else it imports is type-only. The dir is
// created lazily by writeModelsConfig (mkdir recursive), so we only need a
// unique path string here.
const h = vi.hoisted(() => ({
  agentDir: `${require("os").tmpdir()}/pi-provider-auth-${process.pid}-${Date.now()}`,
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  getAgentDir: () => h.agentDir,
}));

import providerAuthExtension from "../index.js";
import { modelsJsonPath } from "../models-config.js";

type Notice = { message: string; level: string };

function harness() {
  const notices: Notice[] = [];
  const registered: { name: string; config: any }[] = [];
  const unregistered: string[] = [];
  const commands = new Map<string, any>();

  const pi = {
    registerProvider: (name: string, config: any) => registered.push({ name, config }),
    unregisterProvider: (name: string) => unregistered.push(name),
    registerCommand: (name: string, opts: any) => commands.set(name, opts),
  } as any;

  const ctx = {
    ui: { notify: (message: string, level: string) => notices.push({ message, level }) },
  } as any;

  providerAuthExtension(pi);

  const run = (args: string) => commands.get("provider").handler(args, ctx);
  return { pi, ctx, notices, registered, unregistered, commands, run };
}

describe("providerAuthExtension wiring", () => {
  beforeEach(() => {
    // Start each test from a clean models.json.
    const p = modelsJsonPath(h.agentDir);
    if (existsSync(p)) rmSync(p);
  });

  afterAll(() => {
    rmSync(h.agentDir, { recursive: true, force: true });
  });

  it("registers antigravity on load and the /provider command", () => {
    const { registered, commands } = harness();
    expect(registered.some((r) => r.name === "antigravity")).toBe(true);
    expect(commands.has("provider")).toBe(true);
    expect(typeof commands.get("provider").handler).toBe("function");
    expect(typeof commands.get("provider").description).toBe("string");
  });

  it("status action reports an info notice without writing models.json", async () => {
    const { run, notices } = harness();
    await run("status");
    const last = notices.at(-1)!;
    expect(last.level).toBe("info");
    expect(last.message).toContain("Provider authentication");
    expect(existsSync(modelsJsonPath(h.agentDir))).toBe(false);
  });

  it("claude action gives built-in /login guidance", async () => {
    const { run, notices } = harness();
    await run("claude");
    expect(notices.at(-1)!.level).toBe("info");
    expect(notices.at(-1)!.message).toMatch(/\/login/);
  });

  it("antigravity action re-registers the provider and notifies", async () => {
    const { run, notices, registered } = harness();
    const before = registered.filter((r) => r.name === "antigravity").length;
    await run("antigravity");
    const after = registered.filter((r) => r.name === "antigravity").length;
    expect(after).toBe(before + 1);
    expect(notices.at(-1)!.message).toMatch(/Antigravity/);
  });

  it("unknown target surfaces an error notice", async () => {
    const { run, notices } = harness();
    await run("does-not-exist");
    expect(notices.at(-1)!.level).toBe("error");
  });

  it("configuring ollama writes models.json and registers at runtime", async () => {
    const { run, notices, registered } = harness();
    await run("ollama http://localhost:11434 llama3.1");

    expect(existsSync(modelsJsonPath(h.agentDir))).toBe(true);
    const reg = registered.filter((r) => r.name === "ollama");
    expect(reg).toHaveLength(1);
    expect(reg[0].config.baseUrl).toBe("http://localhost:11434");
    expect(reg[0].config.models.map((m: any) => m.id)).toContain("llama3.1");
    expect(notices.at(-1)!.level).toBe("info");
    expect(notices.at(-1)!.message).toContain("Select with /model");
  });

  it("configuring without models persists but does not register a runtime provider", async () => {
    // lmstudio's preset has no default models, so a bare configure persists the
    // provider stub to models.json without registering a usable runtime model.
    const { run, notices, registered } = harness();
    await run("lmstudio http://localhost:1234");
    expect(existsSync(modelsJsonPath(h.agentDir))).toBe(true);
    expect(registered.some((r) => r.name === "lmstudio")).toBe(false);
    expect(notices.at(-1)!.message).toContain("Add models");
  });

  it("removing a configured provider unregisters it and rewrites models.json", async () => {
    const { run, unregistered } = harness();
    await run("ollama http://localhost:11434 llama3.1");
    await run("remove ollama");
    expect(unregistered).toContain("ollama");
  });

  it("removing a non-existent provider warns and skips unregister", async () => {
    const { run, notices, unregistered } = harness();
    await run("remove ghost");
    expect(notices.at(-1)!.level).toBe("warning");
    expect(unregistered).not.toContain("ghost");
  });
});
