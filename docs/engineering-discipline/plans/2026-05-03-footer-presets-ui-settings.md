# Footer Presets and UI Settings Resolver Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Add `default`, `compact`, and `minimal` footer presets through a small typed settings resolver.

**Architecture:** Add a new `ui-settings.ts` module that resolves a `footerPreset` from environment and Pi settings files, with safe fallback to `default`. Update `RoachFooter` to consume a final optional options object and render preset layouts from a data-driven preset definition rather than scattered conditionals. Wire the resolved settings in `index.ts` when constructing `RoachFooter`.

**Tech Stack:** TypeScript, Vitest, Node `fs`/`path`/`os`, Pi extension footer API, `@mariozechner/pi-tui` width utilities.

**Work Scope:**
- **In scope:** `AgenticUiSettings`, `FooterPresetName`, settings resolution from env/global/project settings, footer preset layouts, focused settings/preset tests, index wiring.
- **Out of scope:** Runtime command persistence, welcome UI, editor stash, editor composition, extra presets beyond `default`/`compact`/`minimal`, and new runtime dependencies.

**Completed M1 Context:**
- `RoachFooter.render(width)` normal footer lines are width-safe.
- Extension statuses flow from `footerData.getExtensionStatuses()` into the normal footer in stable key order.
- Blank status values are ignored.
- Existing plan/milestone panels are preserved above the normal footer.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build`
- **What it validates:** Vitest regression coverage for the extension plus TypeScript type-checking. This milestone adds focused tests for settings fallback/override and preset rendering.

---

## File Structure Mapping

- Create: `extensions/agentic-harness/ui-settings.ts`
  - Resolves `AgenticUiSettings` from defaults, `PI_AGENTIC_FOOTER_PRESET`, global `~/.pi/agent/settings.json`, and project `.pi/settings.json`.
  - Project settings override global settings; environment overrides both for easy smoke testing.
- Create: `extensions/agentic-harness/tests/ui-settings.test.ts`
  - Covers default fallback, env override, invalid fallback, global settings, project override, malformed JSON fallback.
- Modify: `extensions/agentic-harness/footer.ts`
  - Imports `FooterPresetName`.
  - Adds a data-driven preset layout map.
  - Adds optional constructor options `{ preset?: FooterPresetName }`.
  - Renders `default`, `compact`, and `minimal` as distinct width-safe layouts.
- Modify: `extensions/agentic-harness/tests/footer.test.ts`
  - Adds preset-focused tests at normal and narrow widths.
- Modify: `extensions/agentic-harness/index.ts`
  - Resolves settings during `session_start` and passes `{ preset: uiSettings.footerPreset }` to `RoachFooter`.

## Project Capability Discovery

- Bundled agents available: `plan-compliance`, `plan-worker`, `plan-validator`, `reviewer-*`, `explorer`, `worker`, `planner`.
- No project-local `.pi/skills` or `.pi/agents` were found.
- Relevant verification commands:
  - Focused: `npm --prefix extensions/agentic-harness test -- --run tests/ui-settings.test.ts tests/footer.test.ts tests/extension.test.ts`
  - Full: `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build`

---

### Task 1: Add UI Settings Resolver Tests and Module

**Dependencies:** None
**Files:**
- Create: `extensions/agentic-harness/ui-settings.ts`
- Create: `extensions/agentic-harness/tests/ui-settings.test.ts`

- [ ] **Step 1: Create `ui-settings.ts`**

Write `extensions/agentic-harness/ui-settings.ts` with this complete content:

```typescript
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const FOOTER_PRESETS = ["default", "compact", "minimal"] as const;
export type FooterPresetName = typeof FOOTER_PRESETS[number];

export interface AgenticUiSettings {
  footerPreset: FooterPresetName;
}

export interface UiSettingsResolverOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  readFile?: (path: string) => string;
  exists?: (path: string) => boolean;
}

const DEFAULT_SETTINGS: AgenticUiSettings = {
  footerPreset: "default",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeFooterPreset(value: unknown): FooterPresetName | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (FOOTER_PRESETS as readonly string[]).includes(normalized)
    ? (normalized as FooterPresetName)
    : null;
}

function readSettingsFile(path: string, exists: (path: string) => boolean, readFile: (path: string) => string): Record<string, unknown> {
  if (!exists(path)) return {};
  try {
    const parsed = JSON.parse(readFile(path));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readConfiguredPreset(settings: Record<string, unknown>): FooterPresetName | null {
  const agenticHarness = isRecord(settings.agenticHarness) ? settings.agenticHarness : undefined;
  const powerlineUi = isRecord(settings.powerlineUi) ? settings.powerlineUi : undefined;

  return normalizeFooterPreset(agenticHarness?.footerPreset)
    ?? normalizeFooterPreset(agenticHarness?.preset)
    ?? normalizeFooterPreset(powerlineUi?.footerPreset)
    ?? normalizeFooterPreset(powerlineUi?.preset);
}

export function resolveAgenticUiSettings(options: UiSettingsResolverOptions = {}): AgenticUiSettings {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? env.HOME ?? env.USERPROFILE ?? homedir();
  const exists = options.exists ?? existsSync;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf-8"));

  const globalSettings = readSettingsFile(join(homeDir, ".pi", "agent", "settings.json"), exists, readFile);
  const projectSettings = readSettingsFile(join(cwd, ".pi", "settings.json"), exists, readFile);

  return {
    ...DEFAULT_SETTINGS,
    footerPreset:
      normalizeFooterPreset(env.PI_AGENTIC_FOOTER_PRESET)
      ?? readConfiguredPreset(projectSettings)
      ?? readConfiguredPreset(globalSettings)
      ?? DEFAULT_SETTINGS.footerPreset,
  };
}
```

- [ ] **Step 2: Create `ui-settings.test.ts`**

Write `extensions/agentic-harness/tests/ui-settings.test.ts` with this complete content:

```typescript
import { describe, expect, it } from "vitest";
import { normalizeFooterPreset, resolveAgenticUiSettings } from "../ui-settings.js";

function resolver(files: Record<string, string>, env: NodeJS.ProcessEnv = {}) {
  return resolveAgenticUiSettings({
    cwd: "/repo",
    homeDir: "/home/tester",
    env,
    exists: (path) => Object.prototype.hasOwnProperty.call(files, path),
    readFile: (path) => files[path],
  });
}

describe("normalizeFooterPreset", () => {
  it("accepts the three supported presets case-insensitively", () => {
    expect(normalizeFooterPreset("default")).toBe("default");
    expect(normalizeFooterPreset("COMPACT")).toBe("compact");
    expect(normalizeFooterPreset(" Minimal ")).toBe("minimal");
  });

  it("rejects invalid preset names", () => {
    expect(normalizeFooterPreset("full")).toBeNull();
    expect(normalizeFooterPreset(123)).toBeNull();
    expect(normalizeFooterPreset(undefined)).toBeNull();
  });
});

describe("resolveAgenticUiSettings", () => {
  it("falls back to default when no settings exist", () => {
    expect(resolver({}).footerPreset).toBe("default");
  });

  it("uses PI_AGENTIC_FOOTER_PRESET when valid", () => {
    expect(resolver({}, { PI_AGENTIC_FOOTER_PRESET: "compact" }).footerPreset).toBe("compact");
  });

  it("ignores invalid env preset and falls back to config/default", () => {
    const files = {
      "/home/tester/.pi/agent/settings.json": JSON.stringify({ agenticHarness: { footerPreset: "minimal" } }),
    };

    expect(resolver(files, { PI_AGENTIC_FOOTER_PRESET: "giant" }).footerPreset).toBe("minimal");
  });

  it("reads global agenticHarness footerPreset", () => {
    const files = {
      "/home/tester/.pi/agent/settings.json": JSON.stringify({ agenticHarness: { footerPreset: "compact" } }),
    };

    expect(resolver(files).footerPreset).toBe("compact");
  });

  it("lets project settings override global settings", () => {
    const files = {
      "/home/tester/.pi/agent/settings.json": JSON.stringify({ agenticHarness: { footerPreset: "compact" } }),
      "/repo/.pi/settings.json": JSON.stringify({ agenticHarness: { footerPreset: "minimal" } }),
    };

    expect(resolver(files).footerPreset).toBe("minimal");
  });

  it("supports powerlineUi preset alias and ignores malformed JSON", () => {
    const files = {
      "/home/tester/.pi/agent/settings.json": "{not json",
      "/repo/.pi/settings.json": JSON.stringify({ powerlineUi: { preset: "compact" } }),
    };

    expect(resolver(files).footerPreset).toBe("compact");
  });
});
```

- [ ] **Step 3: Run settings tests**

Run:

```bash
npm --prefix extensions/agentic-harness test -- --run tests/ui-settings.test.ts
```

Expected: PASS.

---

### Task 2: Add Data-Driven Footer Presets

**Dependencies:** Task 1
**Files:**
- Modify: `extensions/agentic-harness/footer.ts`
- Modify: `extensions/agentic-harness/tests/footer.test.ts`

- [ ] **Step 1: Update footer imports and segment types**

In `extensions/agentic-harness/footer.ts`, change the imports/types at the top so they include `FooterPresetName` and segment ids:

```typescript
import { truncateToWidth, visibleWidth, type Component, type TUI } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ReadonlyFooterDataProvider } from "@mariozechner/pi-coding-agent";
import { basename } from "path";
import { PLAN_PROGRESS_SPINNER_MS, type PlanProgressTracker } from "./plan-progress.js";
import type { MilestoneTracker } from "./milestone-tracker.js";
import type { FooterPresetName } from "./ui-settings.js";
```

Replace the `FooterSegment` type with:

```typescript
type FooterSegmentId = "path" | "git" | "model" | "context" | "statuses" | "tools" | "cache";

type FooterSegment = {
  id: FooterSegmentId;
  text: string;
  color: ThemeColor;
  priority: number;
};

type FooterPresetDefinition = {
  lines: FooterSegmentId[][];
};

export interface FooterOptions {
  preset?: FooterPresetName;
}

const FOOTER_PRESET_DEFINITIONS: Record<FooterPresetName, FooterPresetDefinition> = {
  default: {
    lines: [["path", "git", "model"], ["context", "statuses", "tools", "cache"]],
  },
  compact: {
    lines: [["path", "git", "model", "context", "statuses"]],
  },
  minimal: {
    lines: [["path", "git", "statuses"]],
  },
};
```

- [ ] **Step 2: Add preset option to `RoachFooter`**

In `RoachFooter`, add a private preset field and constructor option:

```typescript
  private milestoneTracker: MilestoneTracker | null;
  private preset: FooterPresetName;
```

Change the constructor ending from:

```typescript
    planProgress: PlanProgressTracker | null = null,
    tui: Pick<TUI, "requestRender"> | null = null,
    milestoneTracker: MilestoneTracker | null = null,
  ) {
```

to:

```typescript
    planProgress: PlanProgressTracker | null = null,
    tui: Pick<TUI, "requestRender"> | null = null,
    milestoneTracker: MilestoneTracker | null = null,
    options: FooterOptions = {},
  ) {
```

After `this.milestoneTracker = milestoneTracker;`, add:

```typescript
    this.preset = options.preset ?? "default";
```

- [ ] **Step 3: Replace `renderNormalFooter` with preset-driven rendering**

In `extensions/agentic-harness/footer.ts`, replace the whole `private renderNormalFooter(width: number): string[] { ... }` method with:

```typescript
  private renderNormalFooter(width: number): string[] {
    const t = this.theme;
    const border = t.fg("dim", "─".repeat(Math.max(0, width)));
    const segments = this.buildSegments();
    const preset = FOOTER_PRESET_DEFINITIONS[this.preset] ?? FOOTER_PRESET_DEFINITIONS.default;
    const renderedLines = preset.lines.map((line) => renderSegments(this.pickSegments(line, segments), width, t));
    return [border, ...renderedLines];
  }

  private pickSegments(ids: FooterSegmentId[], segments: Map<FooterSegmentId, FooterSegment>): FooterSegment[] {
    return ids
      .map((id) => segments.get(id))
      .filter((segment): segment is FooterSegment => !!segment);
  }

  private buildSegments(): Map<FooterSegmentId, FooterSegment> {
    const t = this.theme;
    const dirName = basename(this.footerCtx.cwd) || this.footerCtx.cwd;
    const branch = this.footerData.getGitBranch();
    const modelName = this.footerCtx.getModelName() ?? "no model";
    const usage = this.footerCtx.getContextUsage();

    const pct = usage?.percent ?? 0;
    const tokens = usage?.tokens ?? 0;
    const ctxK = usage ? Math.round(usage.contextWindow / 1000) : 0;
    const tokK = Math.round(tokens / 1000);
    const bar = progressBar(pct, 15, t);
    const ctxPart = `${t.fg("dim", "ctx")} ${bar} ${t.fg("dim", `${tokK}k/${ctxK}k`)}`;

    const totalTokens = this.cacheStats.totalInput + this.cacheStats.totalCacheRead;
    const cacheRate = totalTokens > 0
      ? Math.round((this.cacheStats.totalCacheRead / totalTokens) * 100)
      : 0;
    const cacheColor: "success" | "warning" | "dim" = cacheRate >= 50 ? "success" : cacheRate >= 20 ? "warning" : "dim";

    const segments = new Map<FooterSegmentId, FooterSegment>();
    segments.set("path", { id: "path", text: dirName, color: "accent", priority: 0 });
    if (branch && branch !== "detached") segments.set("git", { id: "git", text: branch, color: "success", priority: 1 });
    segments.set("model", { id: "model", text: modelName, color: "dim", priority: 2 });
    segments.set("context", { id: "context", text: ctxPart, color: "dim", priority: 0 });
    segments.set("cache", { id: "cache", text: `cache ${cacheRate}%`, color: cacheColor, priority: 5 });

    const statuses = this.footerData.getExtensionStatuses?.() ?? new Map<string, string>();
    const statusText = getExtensionStatusText(statuses);
    if (statusText) segments.set("statuses", { id: "statuses", text: statusText, color: "warning", priority: 1 });

    if (this.activeTools.running.size > 0) {
      const names = [...new Set(this.activeTools.running.values())];
      const count = this.activeTools.running.size;
      segments.set("tools", { id: "tools", text: `▶${count} ${names.join(",")}`, color: "accent", priority: 4 });
    }

    return segments;
  }
```

- [ ] **Step 4: Add preset tests to `footer.test.ts`**

In `extensions/agentic-harness/tests/footer.test.ts`, update `createFooter` to accept a preset option:

```typescript
function createFooter(statuses: ReadonlyMap<string, string> = new Map(), preset: "default" | "compact" | "minimal" = "default"): RoachFooter {
  return new RoachFooter(
    stubTheme,
    footerData(statuses),
    {
      cwd: "/tmp/powerline-project",
      getModelName: () => "test-model",
      getContextUsage: () => ({ tokens: 42_000, contextWindow: 200_000, percent: 21 }),
    },
    { totalInput: 100, totalCacheRead: 50 },
    { running: new Map([["tool-1", "read"]]) },
    null,
    null,
    null,
    { preset },
  );
}
```

Append these tests to the `describe("RoachFooter status bridge", ...)` block:

```typescript
  it("renders distinct default, compact, and minimal preset layouts", () => {
    const statuses = new Map([["harness", "Ready"]]);
    const defaultLines = createFooter(statuses, "default").render(100);
    const compactLines = createFooter(statuses, "compact").render(100);
    const minimalLines = createFooter(statuses, "minimal").render(100);

    expect(defaultLines.length).toBe(3);
    expect(compactLines.length).toBe(2);
    expect(minimalLines.length).toBe(2);
    expect(defaultLines.join("\n")).toContain("ctx");
    expect(compactLines.join("\n")).toContain("ctx");
    expect(minimalLines.join("\n")).not.toContain("ctx");
    expect(minimalLines.join("\n")).not.toContain("test-model");
    expect(defaultLines.join("\n")).toContain("Ready");
    expect(compactLines.join("\n")).toContain("Ready");
    expect(minimalLines.join("\n")).toContain("Ready");
  });

  it("keeps every preset width-safe at narrow and normal widths", () => {
    const statuses = new Map([["harness", "Preset status that may need truncation"]]);

    for (const preset of ["default", "compact", "minimal"] as const) {
      for (const width of [28, 44, 100]) {
        expectAllLinesFit(createFooter(statuses, preset).render(width), width);
      }
    }
  });
```

- [ ] **Step 5: Run focused footer tests**

Run:

```bash
npm --prefix extensions/agentic-harness test -- --run tests/footer.test.ts tests/ui-settings.test.ts
```

Expected: PASS.

---

### Task 3: Wire Resolved Settings into the Extension Footer

**Dependencies:** Task 2
**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Import the settings resolver in `index.ts`**

Add this import to `extensions/agentic-harness/index.ts` near the other local imports:

```typescript
import { resolveAgenticUiSettings } from "./ui-settings.js";
```

- [ ] **Step 2: Resolve settings during `session_start` footer wiring**

In `extensions/agentic-harness/index.ts`, replace the current footer wiring:

```typescript
      ctx.ui.setFooter((tui, theme, footerData) => {
        return new RoachFooter(theme, footerData, {
          cwd: ctx.cwd,
          getModelName: () => ctx.model?.name,
          getContextUsage: () => ctx.getContextUsage(),
        }, cacheStats, activeTools, planProgress, tui, milestoneTracker);
      });
```

with:

```typescript
      const uiSettings = resolveAgenticUiSettings({ cwd: ctx.cwd });
      ctx.ui.setFooter((tui, theme, footerData) => {
        return new RoachFooter(theme, footerData, {
          cwd: ctx.cwd,
          getModelName: () => ctx.model?.name,
          getContextUsage: () => ctx.getContextUsage(),
        }, cacheStats, activeTools, planProgress, tui, milestoneTracker, {
          preset: uiSettings.footerPreset,
        });
      });
```

- [ ] **Step 3: Add an extension wiring test**

In `extensions/agentic-harness/tests/extension.test.ts`, add this mock before importing `extension`:

```typescript
vi.mock("../ui-settings.js", () => ({
  resolveAgenticUiSettings: vi.fn(() => ({ footerPreset: "compact" })),
}));
```

Then import the mock after the `extension` import:

```typescript
import { resolveAgenticUiSettings } from "../ui-settings.js";
```

Add this test in the session-start/footer describe area, or near the existing session_start footer wiring tests:

```typescript
  it("passes resolved UI settings to the custom footer", async () => {
    const { mockPi, events } = createMockPi();
    extension(mockPi);

    const sessionStart = events.get("session_start")?.[0];
    expect(sessionStart).toBeTypeOf("function");

    const setFooter = vi.fn();
    const ctx: any = {
      cwd: "/tmp/project",
      hasUI: true,
      model: { name: "test-model" },
      getContextUsage: () => ({ tokens: 1, contextWindow: 10, percent: 10 }),
      ui: {
        setHeader: vi.fn(),
        setFooter,
        setWidget: vi.fn(),
        setStatus: vi.fn(),
        setWorkingVisible: vi.fn(),
      },
      sessionManager: { getEntries: () => [], getBranch: () => [] },
    };

    await sessionStart({ reason: "startup" }, ctx);

    expect(resolveAgenticUiSettings).toHaveBeenCalledWith({ cwd: "/tmp/project" });
    expect(setFooter).toHaveBeenCalledTimes(1);
    const factory = setFooter.mock.calls[0][0];
    const footer = factory({ requestRender: vi.fn() }, stubTheme, {
      getGitBranch: () => "main",
      getExtensionStatuses: () => new Map(),
      getAvailableProviderCount: () => 1,
      onBranchChange: () => () => {},
    });

    expect(footer.render(100).length).toBe(2);
  });
```

If `extension.test.ts` already has a reusable session context helper, reuse it instead of duplicating only when the resulting test still asserts exactly the same behavior.

- [ ] **Step 4: Run focused extension tests**

Run:

```bash
npm --prefix extensions/agentic-harness test -- --run tests/ui-settings.test.ts tests/footer.test.ts tests/extension.test.ts
```

Expected: PASS.

---

### Task 4 (Final): End-to-End Verification

**Dependencies:** Task 3
**Files:** None (read-only verification)

- [ ] **Step 1: Run highest-level verification**

Run:

```bash
npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build
```

Expected: ALL PASS.

- [ ] **Step 2: Verify M2 success criteria**

Manually check each criterion against tests and implementation:

- [ ] `default`, `compact`, and `minimal` presets produce distinct, width-safe footer layouts.
- [ ] Missing or invalid config falls back to the default preset.
- [ ] Preset logic is data-driven and not scattered through footer rendering.
- [ ] Tests verify preset behavior at narrow and normal widths.

- [ ] **Step 3: Check for accidental dependency/scope creep**

Run:

```bash
git diff -- extensions/agentic-harness/package.json extensions/agentic-harness/package-lock.json extensions/fff-search/index.ts
```

Expected: no diff.
