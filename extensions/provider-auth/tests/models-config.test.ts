import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, statSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  modelsJsonPath,
  readModelsConfig,
  mergeModels,
  upsertProvider,
  removeProvider,
  listProviders,
  writeModelsConfig,
  type ModelsConfig,
  type CustomProvider,
} from "../models-config.js";

function provider(over: Partial<CustomProvider> = {}): CustomProvider {
  return { baseUrl: "http://localhost:11434/v1", api: "openai-completions", apiKey: "k", models: [{ id: "m1" }], ...over };
}

describe("modelsJsonPath", () => {
  it("joins agentDir with models.json", () => {
    expect(modelsJsonPath("/tmp/agent")).toBe(join("/tmp/agent", "models.json"));
  });
});

describe("readModelsConfig", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pa-models-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns empty config when file is absent", () => {
    expect(readModelsConfig(join(dir, "models.json"))).toEqual({});
  });

  it("returns empty config when file is empty/whitespace", () => {
    const p = join(dir, "models.json");
    writeFileSync(p, "   \n");
    expect(readModelsConfig(p)).toEqual({});
  });

  it("parses a valid config object", () => {
    const p = join(dir, "models.json");
    writeFileSync(p, JSON.stringify({ providers: { ollama: provider() } }));
    expect(readModelsConfig(p).providers?.ollama?.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("throws on malformed JSON", () => {
    const p = join(dir, "models.json");
    writeFileSync(p, "{ not json ");
    expect(() => readModelsConfig(p)).toThrow(/not valid JSON/);
  });

  it("throws when top-level JSON is an array", () => {
    const p = join(dir, "models.json");
    writeFileSync(p, "[1,2,3]");
    expect(() => readModelsConfig(p)).toThrow(/must be a JSON object/);
  });

  it("throws when top-level JSON is null", () => {
    const p = join(dir, "models.json");
    writeFileSync(p, "null");
    expect(() => readModelsConfig(p)).toThrow(/must be a JSON object/);
  });
});

describe("mergeModels", () => {
  it("de-duplicates by id, preferring incoming", () => {
    const merged = mergeModels([{ id: "a", name: "old" }, { id: "b" }], [{ id: "a", name: "new" }, { id: "c" }]);
    expect(merged.map((m) => m.id).sort()).toEqual(["a", "b", "c"]);
    expect(merged.find((m) => m.id === "a")?.name).toBe("new");
  });

  it("handles undefined existing", () => {
    expect(mergeModels(undefined, [{ id: "x" }])).toEqual([{ id: "x" }]);
  });
});

describe("upsertProvider", () => {
  it("inserts a new provider without mutating the input", () => {
    const config: ModelsConfig = {};
    const next = upsertProvider(config, "ollama", provider());
    expect(next.providers?.ollama).toBeDefined();
    expect(config.providers).toBeUndefined();
  });

  it("merges models by id when re-upserting", () => {
    const a = upsertProvider({}, "ollama", provider({ models: [{ id: "m1" }] }));
    const b = upsertProvider(a, "ollama", provider({ models: [{ id: "m2" }] }));
    expect(b.providers?.ollama?.models.map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });

  it("preserves unrelated providers", () => {
    const a = upsertProvider({}, "ollama", provider());
    const b = upsertProvider(a, "lmstudio", provider({ baseUrl: "http://localhost:1234/v1" }));
    expect(listProviders(b).sort()).toEqual(["lmstudio", "ollama"]);
  });
});

describe("removeProvider", () => {
  it("removes an existing provider", () => {
    const a = upsertProvider({}, "ollama", provider());
    const b = removeProvider(a, "ollama");
    expect(b.providers?.ollama).toBeUndefined();
  });

  it("is a no-op for an absent provider and does not mutate", () => {
    const a = upsertProvider({}, "ollama", provider());
    const b = removeProvider(a, "missing");
    expect(b).toBe(a);
  });
});

describe("listProviders", () => {
  it("lists names, empty when none", () => {
    expect(listProviders({})).toEqual([]);
    expect(listProviders({ providers: { x: provider() } })).toEqual(["x"]);
  });
});

describe("writeModelsConfig", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pa-write-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes pretty JSON with trailing newline that round-trips", () => {
    const p = join(dir, "nested", "models.json");
    const config = upsertProvider({}, "ollama", provider());
    writeModelsConfig(p, config);
    const raw = readFileSync(p, "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(readModelsConfig(p)).toEqual(config);
  });

  it("writes the file with 0600 permissions", () => {
    const p = join(dir, "models.json");
    writeModelsConfig(p, {});
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });
});
