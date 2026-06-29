# Footer Status Bridge + Powerline MVP Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Restore extension status visibility and introduce a width-safe default Powerline-style footer while preserving existing progress panels.

**Architecture:** Keep the implementation centered in `RoachFooter`, preserving its existing constructor and lifecycle. Add small pure helpers for status normalization and visible-width-safe segmented rendering, then route the normal footer lines through those helpers while keeping plan/milestone panels above the normal footer.

**Tech Stack:** TypeScript, Vitest, `@mariozechner/pi-tui` width utilities, Pi extension footer API.

**Work Scope:**
- **In scope:** `RoachFooter` default Powerline-style segmented lines, `footerData.getExtensionStatuses()` rendering, width-safe truncation/removal behavior, focused footer tests, and required test mock update.
- **Out of scope:** preset/settings support, welcome UI, editor stash, editor composition, new runtime dependencies, or changes to `extensions/fff-search/index.ts`.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build`
- **What it validates:** Vitest regression coverage for the extension plus TypeScript type-checking. This milestone also adds focused footer tests for status rendering and width safety.

---

## File Structure Mapping

- Modify: `extensions/agentic-harness/footer.ts`
  - Responsibility: Render the custom footer and host plan/milestone progress panels.
  - M1 changes: import `visibleWidth`/`truncateToWidth`; add pure helper functions; render Powerline-style segmented base footer; include extension statuses.
- Create: `extensions/agentic-harness/tests/footer.test.ts`
  - Responsibility: Focused tests for footer statuses and width-safe rendering.
- Modify: `extensions/agentic-harness/tests/extension.test.ts`
  - Responsibility: Existing extension registration tests with mocked `@mariozechner/pi-tui`.
  - M1 changes: add `visibleWidth` to the mock because `footer.ts` will import it.

## Project Capability Discovery

- Bundled agents available: `plan-compliance`, `plan-worker`, `plan-validator`, `reviewer-*`, `explorer`, `worker`, `planner`.
- No project-local `.pi/skills` or `.pi/agents` were found.
- Relevant project skill for execution: `agentic-run-plan`.
- Relevant verification commands:
  - Focused: `npm --prefix extensions/agentic-harness test -- --run tests/footer.test.ts tests/plan-progress.test.ts tests/milestone-tracker.test.ts tests/extension.test.ts`
  - Full: `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build`

---

### Task 1: Add Focused Footer Status and Width Tests

**Dependencies:** None
**Files:**
- Create: `extensions/agentic-harness/tests/footer.test.ts`

- [ ] **Step 1: Create the focused footer test file**

Write `extensions/agentic-harness/tests/footer.test.ts` with this complete content:

```typescript
import { describe, expect, it } from "vitest";
import { visibleWidth } from "@mariozechner/pi-tui";
import type { ReadonlyFooterDataProvider } from "@mariozechner/pi-coding-agent";
import { RoachFooter } from "../footer.js";

const stubTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as any;

function footerData(statuses: ReadonlyMap<string, string> = new Map()): ReadonlyFooterDataProvider {
  return {
    getGitBranch: () => "main",
    getExtensionStatuses: () => statuses,
    getAvailableProviderCount: () => 1,
    onBranchChange: () => () => {},
  };
}

function createFooter(statuses: ReadonlyMap<string, string> = new Map()): RoachFooter {
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
  );
}

function expectAllLinesFit(lines: string[], width: number): void {
  for (const line of lines) {
    expect(visibleWidth(line)).toBeLessThanOrEqual(width);
  }
}

describe("RoachFooter status bridge", () => {
  it("renders the base footer without extension statuses", () => {
    const footer = createFooter();
    const lines = footer.render(80);

    expect(lines.length).toBe(3);
    expect(lines.join("\n")).toContain("powerline-project");
    expect(lines.join("\n")).toContain("main");
    expect(lines.join("\n")).toContain("test-model");
    expect(lines.join("\n")).toContain("ctx");
    expect(lines.join("\n")).toContain("cache 33%");
    expect(lines.join("\n")).toContain("read");
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

    expect(lines.join("\n")).toContain("Deploying");
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
});
```

- [ ] **Step 2: Run the new test file and verify it fails before implementation**

Run:

```bash
npm --prefix extensions/agentic-harness test -- --run tests/footer.test.ts
```

Expected: FAIL. At least the status-related tests should fail because `RoachFooter` does not currently read `footerData.getExtensionStatuses()`, and width-safety may fail for long lines.

---

### Task 2: Implement Width-Safe Powerline Footer and Status Bridge

**Dependencies:** Task 1
**Files:**
- Modify: `extensions/agentic-harness/footer.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Replace `footer.ts` with the M1 implementation**

Replace the complete contents of `extensions/agentic-harness/footer.ts` with:

```typescript
import { truncateToWidth, visibleWidth, type Component, type TUI } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ReadonlyFooterDataProvider } from "@mariozechner/pi-coding-agent";
import { basename } from "path";
import { PLAN_PROGRESS_SPINNER_MS, type PlanProgressTracker } from "./plan-progress.js";
import type { MilestoneTracker } from "./milestone-tracker.js";

export interface FooterContext {
  cwd: string;
  getModelName: () => string | undefined;
  getContextUsage: () => { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
}

export interface CacheStats {
  totalInput: number;
  totalCacheRead: number;
}

export interface ActiveTools {
  running: Map<string, string>;
}

type ThemeColor = "accent" | "success" | "warning" | "error" | "muted" | "dim" | "text";

type FooterSegment = {
  id: string;
  text: string;
  color: ThemeColor;
  priority: number;
};

const POWERLINE_SEPARATOR = "  ";

function progressBar(percent: number, barWidth: number, theme: Theme): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * barWidth);
  const empty = barWidth - filled;

  let color: "success" | "warning" | "error";
  if (clamped < 60) color = "success";
  else if (clamped < 85) color = "warning";
  else color = "error";

  const bar = theme.fg(color, "█".repeat(filled)) + theme.fg("dim", "░".repeat(empty));
  const label = theme.fg(color, `${Math.round(clamped)}%`);
  return `${bar} ${label}`;
}

function fitLine(text: string, width: number): string {
  if (width <= 0) return "";
  return truncateToWidth(text, width, "");
}

function normalizeStatusText(text: string): string | null {
  const trimmed = text.trim();
  return visibleWidth(trimmed) > 0 ? trimmed : null;
}

function getExtensionStatusText(statuses: ReadonlyMap<string, string>): string | null {
  const parts = [...statuses.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => normalizeStatusText(value))
    .filter((value): value is string => value !== null);

  return parts.length > 0 ? parts.join(" ") : null;
}

function renderSegments(segments: FooterSegment[], width: number, theme: Theme): string {
  if (width <= 0) return "";

  const separator = theme.fg("dim", POWERLINE_SEPARATOR);
  const candidates = segments.filter((segment) => visibleWidth(segment.text) > 0);

  while (candidates.length > 1 && visibleWidth(renderSegmentLine(candidates, separator, theme)) > width) {
    const lowestValuePriority = Math.max(...candidates.map((segment) => segment.priority));
    const removeAt = candidates.findLastIndex((segment) => segment.priority === lowestValuePriority);
    candidates.splice(removeAt >= 0 ? removeAt : candidates.length - 1, 1);
  }

  return fitLine(renderSegmentLine(candidates, separator, theme), width);
}

function renderSegmentLine(segments: FooterSegment[], separator: string, theme: Theme): string {
  if (segments.length === 0) return "";
  const rendered = segments.map((segment) => theme.fg(segment.color, segment.text));
  return ` ${rendered.join(separator)} `;
}

export class RoachFooter implements Component {
  private theme: Theme;
  private footerData: ReadonlyFooterDataProvider;
  private footerCtx: FooterContext;
  private cacheStats: CacheStats;
  private activeTools: ActiveTools;
  private planProgress: PlanProgressTracker | null;
  private tui: Pick<TUI, "requestRender"> | null;
  private milestoneTracker: MilestoneTracker | null;
  private unsubscribePlanProgress: (() => void) | null = null;
  private unsubscribeMilestone: (() => void) | null = null;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    theme: Theme,
    footerData: ReadonlyFooterDataProvider,
    footerCtx: FooterContext,
    cacheStats: CacheStats,
    activeTools: ActiveTools,
    planProgress: PlanProgressTracker | null = null,
    tui: Pick<TUI, "requestRender"> | null = null,
    milestoneTracker: MilestoneTracker | null = null,
  ) {
    this.theme = theme;
    this.footerData = footerData;
    this.footerCtx = footerCtx;
    this.cacheStats = cacheStats;
    this.activeTools = activeTools;
    this.planProgress = planProgress;
    this.milestoneTracker = milestoneTracker;
    this.tui = tui;
    this.unsubscribePlanProgress = this.planProgress?.subscribeOnChange(() => {
      this.schedulePlanRender();
    }) ?? null;
    this.unsubscribeMilestone = this.milestoneTracker?.subscribeOnChange(() => {
      this.schedulePlanRender();
    }) ?? null;
    this.updateSpinnerTimer();
  }

  invalidate(): void {
    this.schedulePlanRender();
  }

  dispose(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    this.unsubscribePlanProgress?.();
    this.unsubscribePlanProgress = null;
    this.unsubscribeMilestone?.();
    this.unsubscribeMilestone = null;
  }

  private schedulePlanRender(): void {
    this.updateSpinnerTimer();
    this.tui?.requestRender(true);
  }

  private updateSpinnerTimer(): void {
    const hasRunningTask = (this.planProgress?.getProgress().running ?? 0) > 0;
    if (hasRunningTask && !this.spinnerTimer) {
      this.spinnerTimer = setInterval(() => {
        if ((this.planProgress?.getProgress().running ?? 0) === 0) {
          this.updateSpinnerTimer();
          return;
        }
        this.tui?.requestRender(true);
      }, PLAN_PROGRESS_SPINNER_MS);
      return;
    }

    if (!hasRunningTask && this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
  }

  render(width: number): string[] {
    this.updateSpinnerTimer();
    const normalLines = this.renderNormalFooter(width);
    const border = normalLines[0] ?? this.theme.fg("dim", "─".repeat(Math.max(0, width)));

    const milestoneTracker = this.milestoneTracker;
    const planProgress = this.planProgress;
    const hasMilestones = milestoneTracker?.hasMilestones() ?? false;
    const hasPlan = planProgress?.hasPlan() ?? false;

    if (hasMilestones || hasPlan) {
      const lines: string[] = [border];
      const panelWidth = Math.max(0, width - 4);

      if (milestoneTracker && hasMilestones) {
        lines.push(...milestoneTracker.render(this.theme, panelWidth).map((line) => fitLine(line, width)));
        if (hasPlan) lines.push(fitLine(this.theme.fg("dim", "  ─"), width));
      }

      if (planProgress && hasPlan) {
        lines.push(...planProgress.render(this.theme, panelWidth).map((line) => fitLine(line, width)));
      }

      lines.push(...normalLines);
      return lines;
    }

    return normalLines;
  }

  private renderNormalFooter(width: number): string[] {
    const t = this.theme;
    const border = t.fg("dim", "─".repeat(Math.max(0, width)));

    const dirName = basename(this.footerCtx.cwd) || this.footerCtx.cwd;
    const branch = this.footerData.getGitBranch();
    const modelName = this.footerCtx.getModelName() ?? "no model";
    const usage = this.footerCtx.getContextUsage();

    const line1Segments: FooterSegment[] = [
      { id: "path", text: dirName, color: "accent", priority: 0 },
    ];

    if (branch && branch !== "detached") {
      line1Segments.push({ id: "git", text: branch, color: "success", priority: 1 });
    }

    line1Segments.push({ id: "model", text: modelName, color: "dim", priority: 2 });

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

    const line2Segments: FooterSegment[] = [
      { id: "context", text: ctxPart, color: "dim", priority: 0 },
      { id: "cache", text: `cache ${cacheRate}%`, color: cacheColor, priority: 5 },
    ];

    const statuses = this.footerData.getExtensionStatuses?.() ?? new Map<string, string>();
    const statusText = getExtensionStatusText(statuses);
    if (statusText) {
      line2Segments.push({ id: "statuses", text: statusText, color: "warning", priority: 1 });
    }

    if (this.activeTools.running.size > 0) {
      const names = [...new Set(this.activeTools.running.values())];
      const count = this.activeTools.running.size;
      line2Segments.push({ id: "tools", text: `▶${count} ${names.join(",")}`, color: "accent", priority: 4 });
    }

    return [
      border,
      renderSegments(line1Segments, width, t),
      renderSegments(line2Segments, width, t),
    ];
  }
}
```

- [ ] **Step 2: Update the `@mariozechner/pi-tui` mock in `extension.test.ts`**

In `extensions/agentic-harness/tests/extension.test.ts`, replace this mock:

```typescript
vi.mock("@mariozechner/pi-tui", () => ({
  Text: class MockText {},
  truncateToWidth: (text: string) => text,
}));
```

with:

```typescript
vi.mock("@mariozechner/pi-tui", () => ({
  Text: class MockText {},
  truncateToWidth: (text: string, width?: number) => typeof width === "number" ? text.slice(0, width) : text,
  visibleWidth: (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "").length,
}));
```

- [ ] **Step 3: Run focused footer and existing footer-host tests**

Run:

```bash
npm --prefix extensions/agentic-harness test -- --run tests/footer.test.ts tests/plan-progress.test.ts tests/milestone-tracker.test.ts tests/extension.test.ts
```

Expected: PASS. If a test fails because the real `truncateToWidth` keeps an ellipsis or counts a wide glyph differently, fix the implementation by preserving the invariant that `visibleWidth(line) <= width` and preserving visible status prefixes.

---

### Task 3 (Final): End-to-End Verification

**Dependencies:** Task 2
**Files:** None (read-only verification)

- [ ] **Step 1: Run highest-level verification**

Run:

```bash
npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build
```

Expected: ALL PASS.

- [ ] **Step 2: Verify M1 success criteria**

Manually check each criterion against tests and implementation:

- [ ] `footerData.getExtensionStatuses()` renders visible statuses for none, one, multiple, long, and cleared states.
- [ ] Footer visible width never exceeds `render(width)` across narrow and wide test cases.
- [ ] Existing cwd, git, model, context, cache, tools, plan, and milestone information remains visible according to priority.
- [ ] `RoachFooter` lifecycle, subscriptions, timers, and `dispose()` behavior remain covered by tests.

- [ ] **Step 3: Check for accidental dependency/scope creep**

Run:

```bash
git diff -- extensions/agentic-harness/package.json extensions/agentic-harness/package-lock.json extensions/fff-search/index.ts
```

Expected: no diff. This proves M1 did not add `pi-powerline-footer` or modify `fff-search`.
