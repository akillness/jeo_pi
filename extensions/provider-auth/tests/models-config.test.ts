import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  modelsJsonPath,
  readModelsConfig,
  listProviders,
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

describe("listProviders", () => {
  it("lists names, empty when none", () => {
    expect(listProviders({})).toEqual([]);
    expect(listProviders({ providers: { x: provider() } })).toEqual(["x"]);
  });
});
