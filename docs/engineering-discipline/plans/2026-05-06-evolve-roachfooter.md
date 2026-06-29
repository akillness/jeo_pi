# Evolve RoachFooter with Powerline Background Blocks & New Segments

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Evolve the existing `RoachFooter` to adopt solid background color blocks, new segments (π logo, model with "latest" tag, thinking level, detailed git stats), while preserving all existing functionality (plan progress, milestone tracker, tools, cache rate).

**Architecture:** Extend `FooterContext` with typed accessors for git stats, thinking level, and model metadata. Compute git stats asynchronously in `index.ts` via `child_process.execFile` with a refresh timer and branch-change subscription. Rewrite the powerline renderer to use raw ANSI background/foreground sequences for solid color blocks with triangle separators (``). Map thinking levels to pi's existing `ThemeColor` palette (`thinkingLow`, `thinkingMedium`, `thinkingHigh`, etc.).

**Tech Stack:** TypeScript, `@mariozechner/pi-tui`, `@mariozechner/pi-coding-agent`, `child_process`, vitest.

**Work Scope:**
- **In scope:** Background-block powerline rendering, π logo segment, model segment with "(latest)" tag, thinking level segment, detailed git stats (ahead/behind/dirty/untracked), preservation of existing plan/milestone/tools/cache segments.
- **Out of scope:** Custom theme JSON changes, new footer presets beyond updating existing ones, changes to pi-coding-agent core, tmux or non-TUI rendering.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm run build && npm test`
- **What it validates:** TypeScript compilation passes and all footer rendering, preset, width-safety, and status-bridge tests pass.

---

## File Structure Mapping

| File | Responsibility |
|------|--------------|
| `extensions/agentic-harness/footer.ts` | `RoachFooter` component — types, segments, rendering, presets |
| `extensions/agentic-harness/index.ts` | Extension entry point — git stats computation, model info detection, context wiring |
| `extensions/agentic-harness/tests/footer.test.ts` | Footer rendering tests — background blocks, new segments, width safety |

---

## Task Decomposition

### Task 1: Types, Context Expansion, and Git Stats Computation

**Dependencies:** None (can run in parallel with nothing; this is the first task)
**Files:**
- Modify: `extensions/agentic-harness/footer.ts`
- Modify: `extensions/agentic-harness/index.ts`

- [ ] **Step 1: Add new types and extend FooterContext in footer.ts**

Add these types immediately after the existing `FooterContext` interface:

```ts
export interface GitStats {
  ahead: number;
  behind: number;
  dirty: number;
  untracked: number;
}

export interface ModelInfo {
  name: string;
  isLatest: boolean;
}

export interface FooterContext {
  cwd: string;
  getModelName: () => string | undefined;
  getContextUsage: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
  getGitStats: () => GitStats | undefined;
  getThinkingLevel: () => "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined;
  getModelInfo: () => ModelInfo | undefined;
}
```

Update `FooterSegmentId` to include new segments:

```ts
type FooterSegmentId = "logo" | "path" | "git" | "model" | "thinking" | "context" | "statuses" | "tools" | "cache";
```

- [ ] **Step 2: Add imports and git stats helper in index.ts**

Add to the top of `extensions/agentic-harness/index.ts` (with existing imports):

```ts
import { execFile } from "child_process";
import { promisify } from "util";
import type { GitStats, ModelInfo } from "./footer.js";

const execFileAsync = promisify(execFile);

async function computeGitStats(cwd: string): Promise<GitStats> {
  const result: GitStats = { ahead: 0, behind: 0, dirty: 0, untracked: 0 };

  try {
    const { stdout: abStdout } = await execFileAsync(
      "git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
      { cwd, encoding: "utf-8", timeout: 3000 }
    );
    const parts = abStdout.trim().split("\t");
    if (parts.length === 2) {
      result.behind = Number(parts[0]) || 0;
      result.ahead = Number(parts[1]) || 0;
    }
  } catch {
    // No upstream or not a git repo
  }

  try {
    const { stdout: stStdout } = await execFileAsync(
      "git", ["status", "--porcelain"],
      { cwd, encoding: "utf-8", timeout: 3000 }
    );
    const lines = stStdout.trim().split("\n").filter((l) => l.length > 0);
    for (const line of lines) {
      if (line.startsWith("??")) {
        result.untracked++;
      } else {
        result.dirty++;
      }
    }
  } catch {
    // Not a git repo
  }

  return result;
}
```

- [ ] **Step 3: Add model info helper in index.ts**

Add this function in `index.ts` near the git stats helper:

```ts
function getModelInfo(ctx: ExtensionContext): ModelInfo {
  const model = ctx.model;
  if (!model) return { name: "no model", isLatest: false };

  const available = ctx.modelRegistry.getAvailable();
  const sameProvider = available.filter((m) => m.provider === model.provider);
  if (sameProvider.length === 0) return { name: model.name, isLatest: false };

  // Sort by contextWindow descending; highest is considered "latest" flagship
  sameProvider.sort((a, b) => b.contextWindow - a.contextWindow);
  const isLatest = sameProvider[0].id === model.id;

  return { name: model.name, isLatest };
}
```

- [ ] **Step 4: Wire git stats timer and new context into setFooter callback**

Replace the existing `ctx.ui.setFooter(...)` block in `index.ts` (around line 1936) with:

```ts
  const uiSettings = resolveAgenticUiSettings({ cwd: ctx.cwd });
  ctx.ui.setFooter((tui, theme, footerData) => {
    let gitStats: GitStats = { ahead: 0, behind: 0, dirty: 0, untracked: 0 };

    async function refreshGitStats() {
      gitStats = await computeGitStats(ctx.cwd);
      tui.requestRender();
    }

    const gitTimer = setInterval(refreshGitStats, 5000);
    refreshGitStats();
    const unsubBranch = footerData.onBranchChange(() => refreshGitStats());

    const footer = new RoachFooter(theme, footerData, {
      cwd: ctx.cwd,
      getModelName: () => ctx.model?.name,
      getContextUsage: () => ctx.getContextUsage(),
      getGitStats: () => gitStats,
      getThinkingLevel: () => ctx.getThinkingLevel(),
      getModelInfo: () => getModelInfo(ctx),
    }, cacheStats, activeTools, planProgress, tui, milestoneTracker, {
      preset: uiSettings.footerPreset,
    });

    const originalDispose = footer.dispose.bind(footer);
    footer.dispose = () => {
      originalDispose();
      clearInterval(gitTimer);
      unsubBranch();
    };

    return footer;
  });
```

- [ ] **Step 5: Commit**

```bash
git add extensions/agentic-harness/footer.ts extensions/agentic-harness/index.ts
git commit -m "feat(footer): expand FooterContext with git stats, thinking level, model info"
```

---

### Task 2: Footer Segment Building and Background-Block Rendering

**Dependencies:** Task 1 completes
**Files:**
- Modify: `extensions/agentic-harness/footer.ts`

- [ ] **Step 1: Update Nerd Font icons and add new color constants**

Replace the existing `ICONS` and `POWERLINE_COLORS` blocks with:

```ts
const ICONS = {
  logo: "π",
  folder: "",
  branch: "󰘬",
  model: "",
  thinking: "󰌵",
  context: "󰍛",
  cache: "󰆼",
  tool: "󰒓",
  status: "󰄬",
} as const;

const ICONS_PLAIN = {
  logo: "π",
  folder: "📁",
  branch: "⎇",
  model: "◆",
  thinking: "◇",
  context: "◈",
  cache: "⊡",
  tool: "▶",
  status: "●",
} as const;
```

Replace `POWERLINE_COLORS` and helpers with background-aware constants:

```ts
const POWERLINE_COLORS: Record<string, { fg: string; bg: string }> = {
  logo:     { fg: "\x1b[38;2;255;255;255m", bg: "\x1b[48;2;0;175;175m" },
  path:     { fg: "\x1b[38;2;255;255;255m", bg: "\x1b[48;2;0;175;175m" },
  model:    { fg: "\x1b[38;2;255;255;255m", bg: "\x1b[48;2;215;135;175m" },
  thinking: { fg: "\x1b[38;2;255;255;255m", bg: "\x1b[48;2;150;200;100m" },
  git:      { fg: "\x1b[38;2;255;255;255m", bg: "\x1b[48;2;200;150;50m" },
  context:  { fg: "\x1b[38;2;255;255;255m", bg: "\x1b[48;2;80;80;80m" },
  default:  { fg: "\x1b[39m", bg: "\x1b[49m" },
};

const RESET = "\x1b[0m";

function segmentColor(name: string): { fg: string; bg: string } {
  return POWERLINE_COLORS[name] ?? POWERLINE_COLORS.default;
}
```

- [ ] **Step 2: Rewrite renderPowerlineLine with background blocks**

Replace the existing `renderPowerlineLine` function with:

```ts
function renderPowerlineLine(segments: FooterSegment[], width: number, _theme: Theme): string {
  if (width <= 0 || segments.length === 0) return "";

  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const color = segmentColor(seg.color);
    const nextSeg = segments[i + 1];
    const nextColor = nextSeg ? segmentColor(nextSeg.color) : POWERLINE_COLORS.default;

    const icon = seg.icon ? `${seg.icon} ` : "";
    const text = ` ${icon}${seg.text} `;

    // Segment body: fg + bg
    parts.push(`${color.fg}${color.bg}${text}`);

    // Separator: fg = current bg, bg = next bg (or default)
    if (i < segments.length - 1) {
      parts.push(`\x1b[38;2;${extractRgb(color.bg)}m${nextColor.bg}`);
    } else {
      // Final separator back to default background
      parts.push(`\x1b[38;2;${extractRgb(color.bg)}m\x1b[49m${RESET}`);
    }
  }

  return fitLine(parts.join(""), width);
}

function extractRgb(bgAnsi: string): string {
  // Extract R;G;B from \x1b[48;2;R;G;Bm
  const match = bgAnsi.match(/48;2;(\d+);(\d+);(\d+)m/);
  return match ? `${match[1]};${match[2]};${match[3]}` : "0;0;0";
}
```

- [ ] **Step 3: Update buildSegments with new segments**

Replace the existing `buildSegments` method with:

```ts
  private buildSegments(): Map<FooterSegmentId, FooterSegment> {
    const t = this.theme;
    const icons = getIcons();
    const dirName = basename(this.footerCtx.cwd) || this.footerCtx.cwd;
    const branch = this.footerData.getGitBranch();
    const modelInfo = this.footerCtx.getModelInfo();
    const modelName = modelInfo?.name ?? this.footerCtx.getModelName() ?? "no model";
    const modelDisplay = modelInfo?.isLatest ? `${modelName} (latest)` : modelName;
    const usage = this.footerCtx.getContextUsage();
    const gitStats = this.footerCtx.getGitStats();
    const thinkingLevel = this.footerCtx.getThinkingLevel();

    const pct = usage?.percent ?? 0;
    const tokens = usage?.tokens ?? 0;
    const ctxK = usage ? Math.round(usage.contextWindow / 1000) : 0;
    const tokK = Math.round(tokens / 1000);
    const bar = progressBar(pct, 15, t);
    const ctxPart = `${t.fg("dim", "ctx")} ${bar} ${t.fg("dim", `${tokK}k/${ctxK}k`)}`;

    const totalTokens = this.cacheStats.totalInput + this.cacheStats.totalCacheRead;
    const cacheRate = totalTokens > 0 ? Math.round((this.cacheStats.totalCacheRead / totalTokens) * 100) : 0;
    let cacheColor: ThemeColor;
    if (cacheRate >= 50) cacheColor = "success";
    else if (cacheRate >= 20) cacheColor = "warning";
    else cacheColor = "dim";

    const segs = new Map<FooterSegmentId, FooterSegment>();

    segs.set("logo", { id: "logo", text: "", icon: icons.logo, color: "logo", priority: 0 });
    segs.set("path", { id: "path", text: dirName, icon: icons.folder, color: "path", priority: 0 });

    if (branch && branch !== "detached") {
      const stats = gitStats;
      let gitText = branch;
      if (stats) {
        const parts: string[] = [];
        if (stats.ahead > 0) parts.push(`⇡${stats.ahead}`);
        if (stats.behind > 0) parts.push(`⇣${stats.behind}`);
        if (stats.dirty > 0) parts.push(`*${stats.dirty}`);
        if (stats.untracked > 0) parts.push(`?${stats.untracked}`);
        if (parts.length > 0) gitText += ` ${parts.join(" ")}`;
      }
      segs.set("git", { id: "git", text: gitText, icon: icons.branch, color: "git", priority: 1 });
    }

    segs.set("model", { id: "model", text: modelDisplay, icon: icons.model, color: "model", priority: 2 });

    if (thinkingLevel && thinkingLevel !== "off") {
      segs.set("thinking", { id: "thinking", text: `thinking:${thinkingLevel}`, icon: icons.thinking, color: "thinking", priority: 3 });
    }

    segs.set("context", { id: "context", text: ctxPart, icon: icons.context, color: "dim", priority: 0 });
    segs.set("cache", { id: "cache", text: `cache ${cacheRate}%`, icon: icons.cache, color: cacheColor, priority: 5 });

    const statuses = this.footerData.getExtensionStatuses?.() ?? new Map<string, string>();
    const statusText = getExtensionStatusText(statuses);
    if (statusText) {
      segs.set("statuses", { id: "statuses", text: statusText, icon: icons.status, color: "warning", priority: 1 });
    }

    if (this.activeTools.running.size > 0) {
      const names = [...new Set(this.activeTools.running.values())];
      const count = this.activeTools.running.size;
      segs.set("tools", { id: "tools", text: `${count} ${names.join(",")}`, icon: icons.tool, color: "accent", priority: 4 });
    }

    return segs;
  }
```

- [ ] **Step 4: Update presets to include new segments**

Replace `FOOTER_PRESET_DEFINITIONS` with:

```ts
const FOOTER_PRESET_DEFINITIONS: Record<FooterPresetName, FooterPresetDefinition> = {
  default:  { lines: [["logo", "model", "thinking", "path", "git"], ["context", "statuses", "tools", "cache"]] },
  compact:  { lines: [["logo", "model", "thinking", "path", "git", "context", "statuses"]] },
  minimal:  { lines: [["logo", "path", "git", "statuses"]] },
};
```

- [ ] **Step 5: Commit**

```bash
git add extensions/agentic-harness/footer.ts
git commit -m "feat(footer): background-block powerline rendering and new segments"
```

---

### Task 3: Update Footer Tests

**Dependencies:** Task 2 completes
**Files:**
- Modify: `extensions/agentic-harness/tests/footer.test.ts`

- [ ] **Step 1: Update test imports and stubs**

Replace the top of `footer.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { visibleWidth } from "@mariozechner/pi-tui";
import type { ReadonlyFooterDataProvider } from "@mariozechner/pi-coding-agent";
import { ICONS, RoachFooter, setUseNerdIcons } from "../footer.js";

setUseNerdIcons(false);

const stubTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  getFgAnsi: (_color: string) => "",
} as any;

const ansiTheme = {
  fg: (color: string, text: string) => `${ansiTheme.getFgAnsi(color)}${text}\x1b[39m`,
  bold: (text: string) => text,
  getFgAnsi: (color: string) => {
    const codes: Record<string, number> = {
      accent: 33, success: 34, warning: 35, error: 196, dim: 238, text: 15,
    };
    return `\x1b[38;5;${codes[color] ?? 15}m`;
  },
} as any;

function footerData(statuses: ReadonlyMap<string, string> = new Map()): ReadonlyFooterDataProvider {
  return {
    getGitBranch: () => "main",
    getExtensionStatuses: () => statuses,
    getAvailableProviderCount: () => 1,
    onBranchChange: () => () => {},
  };
}

function createFooter(
  statuses: ReadonlyMap<string, string> = new Map(),
  preset: "default" | "compact" | "minimal" = "default",
  gitStats = { ahead: 0, behind: 0, dirty: 0, untracked: 0 },
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined = "high",
  modelInfo = { name: "test-model", isLatest: false }
): RoachFooter {
  return new RoachFooter(
    stubTheme,
    footerData(statuses),
    {
      cwd: "/tmp/powerline-project",
      getModelName: () => modelInfo.name,
      getContextUsage: () => ({ tokens: 42_000, contextWindow: 200_000, percent: 21 }),
      getGitStats: () => gitStats,
      getThinkingLevel: () => thinkingLevel,
      getModelInfo: () => modelInfo,
    },
    { totalInput: 100, totalCacheRead: 50 },
    { running: new Map([["tool-1", "read"]]) },
    null,
    null,
    null,
    { preset },
  );
}

function expectAllLinesFit(lines: string[], width: number): void {
  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
}
```

- [ ] **Step 2: Update powerline styling tests**

Replace the `RoachFooter Powerline styling` describe block with:

```ts
describe("RoachFooter Powerline styling", () => {
  it("renders concrete Nerd Font icons and the Powerline segment separator", () => {
    setUseNerdIcons(true);
    try {
      expect(Object.values(ICONS).every((icon) => icon.length > 0)).toBe(true);

      const rendered = createFooter().render(100).join("\n");

      expect(rendered).toContain("");
      expect(rendered).toContain(ICONS.folder);
      expect(rendered).toContain(ICONS.branch);
      expect(rendered).toContain(ICONS.model);
      expect(rendered).toContain(ICONS.logo);
      expect(rendered).toContain(ICONS.thinking);
    } finally {
      setUseNerdIcons(false);
    }
  });

  it("renders solid background blocks with 48;2 ANSI sequences", () => {
    const footer = new RoachFooter(
      ansiTheme,
      footerData(),
      {
        cwd: "/tmp/powerline-project",
        getModelName: () => "test-model",
        getContextUsage: () => ({ tokens: 42_000, contextWindow: 200_000, percent: 21 }),
        getGitStats: () => ({ ahead: 0, behind: 0, dirty: 0, untracked: 0 }),
        getThinkingLevel: () => "high",
        getModelInfo: () => ({ name: "test-model", isLatest: false }),
      },
      { totalInput: 100, totalCacheRead: 50 },
      { running: new Map() },
    );

    const rendered = footer.render(100).join("\n");

    expect(rendered).toContain("\x1b[48;2;0;175;175m");
    expect(rendered).toContain("\x1b[48;2;215;135;175m");
    expect(rendered).toContain("\x1b[48;2;200;150;50m");
    expect(rendered).toContain("");
  });
});
```

- [ ] **Step 3: Update status bridge tests**

Replace the `RoachFooter status bridge` describe block with:

```ts
describe("RoachFooter status bridge", () => {
  it("renders the base footer without extension statuses", () => {
    const footer = createFooter();
    const lines = footer.render(80);

    expect(lines.length).toBe(3);
    const rendered = lines.join("\n");
    expect(rendered).toContain("powerline-project");
    expect(rendered).toContain("main");
    expect(rendered).toContain("test-model");
    expect(rendered).toContain("thinking:high");
    expect(rendered).toContain("ctx");
    expect(rendered).toContain("cache 33%");
    expect(rendered).toContain("read");
    expectAllLinesFit(lines, 80);
  });

  it("renders one extension status from footerData.getExtensionStatuses", () => {
    const footer = createFooter(new Map([["harness", "Team running"]]));
    const lines = footer.render(100);

    expect(lines.join("\n")).toContain("Team running");
    expectAllLinesFit(lines, 100);
  });

  it("renders multiple extension statuses in stable key order", () => {
    const footer = createFooter(new Map([
      ["zeta", "Zed status"],
      ["alpha", "Alpha status"],
    ]));
    const rendered = footer.render(120).join("\n");

    expect(rendered).toContain("Alpha status");
    expect(rendered).toContain("Zed status");
    expect(rendered.indexOf("Alpha status")).toBeLessThan(rendered.indexOf("Zed status"));
  });

  it("ignores empty and whitespace-only extension statuses", () => {
    const footer = createFooter(new Map([
      ["empty", ""],
      ["spaces", "   "],
      ["ready", "Ready"],
    ]));
    const rendered = footer.render(100).join("\n");

    expect(rendered).toContain("Ready");
    expect(rendered).not.toContain("empty");
    expect(rendered).not.toContain("spaces");
  });

  it("truncates long extension statuses without exceeding width", () => {
    const footer = createFooter(new Map([
      ["harness", "Deploying a very long background operation that should be truncated safely"],
    ]));
    const width = 44;
    const lines = footer.render(width);

    expect(lines.join("\n")).toContain("Dep");
    expectAllLinesFit(lines, width);
  });

  it("keeps every normal footer line within narrow render widths", () => {
    const footer = createFooter(new Map([
      ["harness", "Narrow status"],
      ["memory", "Memory warm"],
    ]));

    for (const width of [24, 32, 40, 60]) {
      expectAllLinesFit(footer.render(width), width);
    }
  });

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

  it("renders git stats when available", () => {
    const footer = createFooter(new Map(), "default", { ahead: 3, behind: 0, dirty: 5, untracked: 2 });
    const rendered = footer.render(100).join("\n");

    expect(rendered).toContain("⇡3");
    expect(rendered).toContain("*5");
    expect(rendered).toContain("?2");
  });

  it("renders model with (latest) tag when isLatest is true", () => {
    const footer = createFooter(new Map(), "default", { ahead: 0, behind: 0, dirty: 0, untracked: 0 }, "high", { name: "Opus 4.5", isLatest: true });
    const rendered = footer.render(100).join("\n");

    expect(rendered).toContain("Opus 4.5 (latest)");
  });

  it("hides thinking segment when level is off", () => {
    const footer = createFooter(new Map(), "default", { ahead: 0, behind: 0, dirty: 0, untracked: 0 }, "off");
    const rendered = footer.render(100).join("\n");

    expect(rendered).not.toContain("thinking:");
  });
});
```

- [ ] **Step 4: Run tests and fix any failures**

Run:
```bash
cd extensions/agentic-harness
npm test -- tests/footer.test.ts
```

Expected: All tests pass. If any fail, fix the implementation in `footer.ts` or the test expectations until they pass.

- [ ] **Step 5: Commit**

```bash
git add extensions/agentic-harness/tests/footer.test.ts
git commit -m "test(footer): update tests for background blocks and new segments"
```

---

### Task 4 (Final): End-to-End Verification

**Dependencies:** All preceding tasks
**Files:** None (read-only verification)

- [ ] **Step 1: Run build**

```bash
cd extensions/agentic-harness
npm run build
```

Expected: `tsc --noEmit` completes with zero errors.

- [ ] **Step 2: Run full test suite**

```bash
cd extensions/agentic-harness
npm test
```

Expected: All tests pass, including the updated `footer.test.ts` and any pre-existing tests.

- [ ] **Step 3: Verify plan success criteria**

Manually check each criterion:
- [ ] Footer renders with solid background color blocks (`[48;2;...`)
- [ ] π logo segment appears at the start of the main line
- [ ] Model segment shows name and "(latest)" when applicable
- [ ] Thinking level segment appears when not "off"
- [ ] Git segment shows branch name + ahead/behind/dirty/untracked counts
- [ ] Existing segments (context, cache, tools, statuses) still render
- [ ] Plan progress and milestone tracker panels still render above footer
- [ ] All three presets (default, compact, minimal) work correctly
- [ ] Width safety maintained at narrow widths (24–100)

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "feat(footer): complete RoachFooter evolution with background blocks and new segments"
```

---

## Self-Review

**Spec coverage:**
- Background blocks → Task 2, Step 2 (`renderPowerlineLine` rewrite)
- π logo → Task 2, Step 3 (`logo` segment in `buildSegments`)
- Model with "latest" → Task 1, Step 3 (`getModelInfo`) + Task 2, Step 3 (`modelDisplay`)
- Thinking level → Task 1, Step 4 (`getThinkingLevel` from `ctx`) + Task 2, Step 3 (`thinking` segment)
- Detailed git stats → Task 1, Step 2 (`computeGitStats`) + Task 2, Step 3 (`git` segment formatting)
- Preserve existing segments → Task 2, Step 3 (context, cache, tools, statuses remain)
- Preserve plan/milestone panels → No changes to plan/milestone rendering logic
- Presets updated → Task 2, Step 4

**Placeholder scan:** No TBD, TODO, or vague instructions found. Every step includes exact code or commands.

**Type consistency:**
- `GitStats`, `ModelInfo`, `FooterContext` defined in Task 1 and used consistently in Task 2 and Task 3.
- `getThinkingLevel` returns `"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined` throughout.

**Dependency verification:**
- Task 1 and Task 2 both modify `footer.ts` → sequential dependency is correct.
- Task 3 modifies only `tests/footer.test.ts` → depends on Task 2.
- Task 4 is final verification → depends on all.

**Verification coverage:** Final Verification Task (Task 4) runs `npm run build` and `npm test`.
