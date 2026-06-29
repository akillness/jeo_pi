# Shimmer Working Status Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Checkbox syntax is rendered task formatting only; canonical progress is read with `todoread` and updated with `todowrite`.

**Goal:** Add gajae-code style shimmer animation to the built-in Working row and to the agentic-harness footer's active tool intent/status display.

**Architecture:** Implement shimmer as a small pure formatting utility inside `extensions/agentic-harness`, then reuse it from the footer and from extension UI event handlers. The built-in Working row will be customized through Pi's public `ctx.ui.setWorkingMessage()` and `ctx.ui.setWorkingIndicator()` APIs; this repo does not vendor Pi core, so no global package source is patched. Footer tool display will consume richer active-tool state from existing `tool_execution_start` / `tool_execution_end` hooks.

**Tech Stack:** TypeScript ESM, `@mariozechner/pi-coding-agent` extension API, `@mariozechner/pi-tui` width helpers, Vitest.

**Work Scope:**
- **In scope:** Shimmer utility; animated Working row message via extension APIs; active tool intent tracking; footer shimmer for currently running tool intent; unit tests for shimmer/footer/extension wiring; build and test verification.
- **Out of scope:** Modifying the globally installed `@earendil-works` or `@mariozechner` Pi core packages; changing chat transcript tool-call rendering; adding user-facing settings for shimmer modes.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm test && npm run build`
- **What it validates:** Unit tests cover the shimmer formatter, footer active-tool rendering, and extension Working-row wiring; TypeScript build validates exported types and integration.

**Success Criteria:**
- The built-in Working row displays a shimmer-colored `Working…` message during agent turns.
- When a tool exposes an intent/status during execution, the Working row updates to that intent and keeps shimmering until the tool/turn completes.
- The custom footer displays the active tool intent, or tool name fallback, with shimmer while tools are running.
- Footer lines remain width-safe when shimmer ANSI sequences are present.
- Existing footer/status/todo behavior remains unchanged when no tools are running.

---

## File Structure Mapping

- Create `extensions/agentic-harness/shimmer.ts`
  - Pure ANSI shimmer helpers modeled after gajae-code's `shimmerText` / `shimmerSegments`, adapted to the installed Pi `Theme` surface.
- Create `extensions/agentic-harness/tests/shimmer.test.ts`
  - Unit tests for ANSI output, disabled empty input behavior, visible-width preservation, and deterministic time-based color tier changes.
- Modify `extensions/agentic-harness/footer.ts`
  - Expand `ActiveTools` value type to carry `name`, `intent`, and `startedAt`.
  - Add shimmer rendering for active tool labels.
  - Keep existing `Map<string, string>` test compatibility through a normalizer.
  - Keep footer render timer active while plan tasks or active tools are present.
- Modify `extensions/agentic-harness/index.ts`
  - Track active tool intent/status on start/end events.
  - Add Working row shimmer driver using `ctx.ui.setWorkingMessage()` and `ctx.ui.setWorkingIndicator()`.
  - Reset Working row state at session start, session shutdown, and assistant message end.
- Modify `extensions/agentic-harness/tests/footer.test.ts`
  - Add footer tests for active tool intent shimmer and width safety.
- Modify `extensions/agentic-harness/tests/extension.test.ts`
  - Add tests for Working row shimmer setup and tool intent updates.
- Create `extensions/agentic-harness/scripts/run-vitest.cjs`
  - Portable test runner used by `npm test` so the verification command works on Windows and POSIX shells.
- Modify `extensions/agentic-harness/package.json`
  - Point the existing `test` script at the portable runner without changing the public test command.

## Project Capability Discovery

- Bundled agents available for execution/review: `plan-compliance`, `plan-worker`, `plan-validator`, `reviewer-bug`, `reviewer-consistency`, `reviewer-test-coverage`.
- Relevant local skills: `agentic-run-plan`, `agentic-review-work`, `agentic-simplify`.
- Use `plan-worker` / `plan-validator` for each task if executing via subagents.

---

### Task 1: Add reusable shimmer formatter

**Dependencies:** None (can run in parallel)
**Files:**
- Create: `extensions/agentic-harness/shimmer.ts`
- Create: `extensions/agentic-harness/tests/shimmer.test.ts`
- Create: `extensions/agentic-harness/scripts/run-vitest.cjs`
- Modify: `extensions/agentic-harness/package.json`

- [x] **Step 1: Create the shimmer formatter**

Create `extensions/agentic-harness/shimmer.ts` with this complete content:

```ts
import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";

const CLASSIC_PADDING = 10;
const CLASSIC_SWEEP_MS = 1400;
const CLASSIC_BAND_HALF_WIDTH = 6;
const TIER_HIGH = 0.65;
const TIER_MID = 0.22;
const FG_RESET = "\x1b[39m";
const BOLD_OPEN = "\x1b[1m";
const BOLD_CLOSE = "\x1b[22m";

type ShimmerTheme = Pick<Theme, "getFgAnsi">;
type ShimmerPaletteTier = ThemeColor | { ansi: string };
type Tier = "low" | "mid" | "high";

export interface ShimmerPalette {
  low: ShimmerPaletteTier;
  mid: ShimmerPaletteTier;
  high: ShimmerPaletteTier;
  bold?: boolean;
}

export interface ShimmerSegment {
  text: string;
  palette?: ShimmerPalette;
}

export const DEFAULT_SHIMMER_PALETTE: ShimmerPalette = {
  low: "dim",
  mid: "accent",
  high: "warning",
  bold: true,
};

function resolveTierAnsi(theme: ShimmerTheme, tier: ShimmerPaletteTier): string {
  return typeof tier === "string" ? theme.getFgAnsi(tier) : tier.ansi;
}

function classicIntensity(time: number, index: number, length: number): number {
  const period = length + CLASSIC_PADDING * 2;
  const pos = ((time % CLASSIC_SWEEP_MS) / CLASSIC_SWEEP_MS) * period;
  const dist = Math.abs(index + CLASSIC_PADDING - pos);
  if (dist >= CLASSIC_BAND_HALF_WIDTH) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * dist) / CLASSIC_BAND_HALF_WIDTH));
}

function tierFor(intensity: number): Tier {
  if (intensity >= TIER_HIGH) return "high";
  if (intensity >= TIER_MID) return "mid";
  return "low";
}

function openCloseFor(theme: ShimmerTheme, palette: ShimmerPalette, tier: Tier): { open: string; close: string } {
  const ansi = resolveTierAnsi(theme, palette[tier]);
  if (tier === "high" && palette.bold) return { open: `${BOLD_OPEN}${ansi}`, close: `${BOLD_CLOSE}${FG_RESET}` };
  return { open: ansi, close: FG_RESET };
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function shimmerSegments(
  segments: readonly ShimmerSegment[],
  theme: ShimmerTheme,
  now: number = Date.now(),
): string {
  const prepared = segments.map((segment) => ({
    chars: Array.from(segment.text),
    palette: segment.palette ?? DEFAULT_SHIMMER_PALETTE,
  }));
  const total = prepared.reduce((sum, segment) => sum + segment.chars.length, 0);
  if (total === 0) return "";

  let out = "";
  let globalIndex = 0;
  for (const segment of prepared) {
    let runTier: Tier | null = null;
    let runText = "";

    for (const char of segment.chars) {
      const tier = tierFor(classicIntensity(now, globalIndex, total));
      if (runTier !== null && tier !== runTier) {
        const seq = openCloseFor(theme, segment.palette, runTier);
        out += `${seq.open}${runText}${seq.close}`;
        runText = "";
      }
      runTier = tier;
      runText += char;
      globalIndex++;
    }

    if (runTier !== null && runText.length > 0) {
      const seq = openCloseFor(theme, segment.palette, runTier);
      out += `${seq.open}${runText}${seq.close}`;
    }
  }

  return out;
}

export function shimmerText(
  text: string,
  theme: ShimmerTheme,
  palette?: ShimmerPalette,
  now: number = Date.now(),
): string {
  return shimmerSegments([{ text, palette }], theme, now);
}
```

- [x] **Step 2: Add shimmer formatter tests**

Create `extensions/agentic-harness/tests/shimmer.test.ts` with this complete content:

```ts
import { describe, expect, it } from "vitest";
import { visibleWidth } from "@mariozechner/pi-tui";
import { shimmerSegments, shimmerText, stripAnsi } from "../shimmer.js";

const theme = {
  getFgAnsi: (color: string) => `<${color}>`,
} as any;

describe("shimmer formatter", () => {
  it("preserves visible text while adding ANSI/style sequences", () => {
    const rendered = shimmerText("Working…", theme, undefined, 0);

    expect(stripAnsi(rendered).replace(/<[^>]+>/g, "")).toBe("Working…");
    expect(rendered).toContain("<");
  });

  it("returns an empty string for empty input", () => {
    expect(shimmerText("", theme, undefined, 0)).toBe("");
    expect(shimmerSegments([], theme, 0)).toBe("");
  });

  it("keeps terminal visible width equal to source text width when ANSI colors are used", () => {
    const ansiTheme = {
      getFgAnsi: (color: string) => color === "accent" ? "\x1b[38;5;33m" : "\x1b[38;5;244m",
    } as any;
    const rendered = shimmerText("Reading files", ansiTheme, undefined, 350);

    expect(visibleWidth(rendered)).toBe(visibleWidth("Reading files"));
  });

  it("moves the shimmer band as time changes", () => {
    const first = shimmerText("Working…", theme, undefined, 0);
    const second = shimmerText("Working…", theme, undefined, 700);

    expect(second).not.toBe(first);
    expect(stripAnsi(second).replace(/<[^>]+>/g, "")).toBe("Working…");
  });
});
```

- [x] **Step 3: Run the shimmer tests and verify they pass**

Run: `cd extensions/agentic-harness && npm test -- tests/shimmer.test.ts`
Expected: PASS with all `shimmer formatter` tests green.

---

### Task 2: Render active tool intent shimmer in the footer

**Dependencies:** Runs after Task 1 completes
**Files:**
- Modify: `extensions/agentic-harness/footer.ts`
- Modify: `extensions/agentic-harness/tests/footer.test.ts`

- [x] **Step 1: Import shimmer utilities and expand active tool types**

In `extensions/agentic-harness/footer.ts`, add this import after the existing local imports:

```ts
import { shimmerText, type ShimmerPalette } from "./shimmer.js";
```

Replace the current `ActiveTools` interface:

```ts
export interface ActiveTools {
  running: Map<string, string>;
}
```

with:

```ts
export interface ActiveToolStatus {
  name: string;
  intent?: string;
  startedAt: number;
}

export interface ActiveTools {
  running: Map<string, string | ActiveToolStatus>;
}
```

- [x] **Step 2: Add active tool shimmer helpers**

In `footer.ts`, after `getExtensionStatusText`, insert:

```ts
const ACTIVE_TOOL_SHIMMER_PALETTE: ShimmerPalette = {
  low: "dim",
  mid: "accent",
  high: "warning",
  bold: true,
};

function normalizeActiveToolStatus(value: string | ActiveToolStatus): ActiveToolStatus {
  return typeof value === "string"
    ? { name: value, startedAt: 0 }
    : value;
}

function activeToolDisplayText(values: Iterable<string | ActiveToolStatus>): string | null {
  const tools = [...values].map(normalizeActiveToolStatus);
  if (tools.length === 0) return null;
  tools.sort((a, b) => b.startedAt - a.startedAt);
  const primary = tools.find((tool) => tool.intent && tool.intent.trim().length > 0) ?? tools[0];
  const label = primary.intent?.trim() || primary.name;
  const suffix = tools.length > 1 ? ` +${tools.length - 1}` : "";
  return `${label}${suffix}`;
}
```

- [x] **Step 3: Keep the footer animation timer active for running tools**

Replace the private method:

```ts
  private hasRunningPlanTasks(): boolean {
    return getCurrentTodos().some((t) => t.status === "in_progress");
  }
```

with:

```ts
  private hasAnimatedFooterContent(): boolean {
    return getCurrentTodos().some((t) => t.status === "in_progress") || this.activeTools.running.size > 0;
  }
```

Then replace every `this.hasRunningPlanTasks()` call in `updateSpinnerTimer()` with `this.hasAnimatedFooterContent()`.

- [x] **Step 4: Render shimmer text for the tools segment**

Replace the current active tools block in `buildSegments()`:

```ts
    if (this.activeTools.running.size > 0) {
      const names = [...new Set(this.activeTools.running.values())];
      const count = this.activeTools.running.size;
      segs.set("tools", { id: "tools", text: `${count} ${names.join(",")}`, icon: icons.tool, color: "accent", priority: 4 });
    }
```

with:

```ts
    const activeToolText = activeToolDisplayText(this.activeTools.running.values());
    if (activeToolText) {
      segs.set("tools", {
        id: "tools",
        text: shimmerText(activeToolText, this.theme, ACTIVE_TOOL_SHIMMER_PALETTE),
        icon: icons.tool,
        color: "accent",
        priority: 4,
      });
    }
```

- [x] **Step 5: Add footer tests for shimmer intent and width safety**

Append these tests to the `describe("RoachFooter status bridge", ...)` block in `extensions/agentic-harness/tests/footer.test.ts`:

```ts
  it("renders active tool intent text in the tools segment", () => {
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
      { running: new Map([["tool-1", { name: "read", intent: "Reading project files", startedAt: 10 }]]) },
      null,
    );

    const rendered = footer.render(160).join("\n");
    const plain = rendered.replace(/\x1b\[[0-9;]*m/g, "");

    expect(plain).toContain("Reading project files");
    expect(plain).not.toContain("1 read");
  });

  it("keeps footer width-safe with shimmered active tool intent", () => {
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
      { running: new Map([["tool-1", { name: "bash", intent: "Running a very long command that must be truncated safely", startedAt: 10 }]]) },
      null,
    );

    for (const width of [28, 44, 80]) {
      expectAllLinesFit(footer.render(width), width);
    }
  });
```

- [x] **Step 6: Run footer tests and verify they pass**

Run: `cd extensions/agentic-harness && npm test -- tests/footer.test.ts`
Expected: PASS with existing footer tests and the two new shimmer active-tool tests green.

---

### Task 3: Drive the built-in Working row and active tool intent from extension events

**Dependencies:** Runs after Task 1 and Task 2 complete
**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [x] **Step 1: Import shimmer and active tool status type**

In `extensions/agentic-harness/index.ts`, update the footer import:

```ts
import { RoachFooter, type CacheStats, type ActiveTools, type ActiveToolStatus } from "./footer.js";
```

Add this import near the other local imports:

```ts
import { shimmerText, type ShimmerPalette } from "./shimmer.js";
```

- [x] **Step 2: Add Working row shimmer state helpers**

In `index.ts`, after `let harnessProgress: HarnessProgressProvider | null = null;`, insert:

```ts
const WORKING_SHIMMER_INTERVAL_MS = 80;
const WORKING_BASE_MESSAGE = "Working…";
const WORKING_SHIMMER_PALETTE: ShimmerPalette = {
  low: "dim",
  mid: "accent",
  high: "warning",
  bold: true,
};
const WORKING_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

let workingUiContext: any | null = null;
let workingMessageBase = WORKING_BASE_MESSAGE;
let workingMessageTimer: ReturnType<typeof setInterval> | null = null;

function formatToolIntent(toolName: string, intent: unknown): string | undefined {
  if (typeof intent === "string" && intent.trim().length > 0) return intent.trim();
  return undefined;
}

function currentWorkingBaseMessage(activeTools: ActiveTools): string {
  const tools = [...activeTools.running.values()]
    .map((value) => typeof value === "string" ? { name: value, startedAt: 0 } : value)
    .sort((a, b) => b.startedAt - a.startedAt);
  const current = tools.find((tool) => tool.intent && tool.intent.trim().length > 0) ?? tools[0];
  return current?.intent?.trim() || current?.name || WORKING_BASE_MESSAGE;
}

function applyWorkingMessageFrame(ctx: any): void {
  if (!ctx?.ui?.setWorkingMessage || !ctx?.ui?.theme) return;
  ctx.ui.setWorkingMessage(shimmerText(workingMessageBase, ctx.ui.theme, WORKING_SHIMMER_PALETTE));
}

function configureWorkingIndicator(ctx: any): void {
  if (!ctx?.ui?.setWorkingIndicator || !ctx?.ui?.theme) return;
  ctx.ui.setWorkingIndicator({
    frames: WORKING_SPINNER_FRAMES.map((frame) => ctx.ui.theme.fg("accent", frame)),
    intervalMs: WORKING_SHIMMER_INTERVAL_MS,
  });
}

function startWorkingMessageShimmer(ctx: any): void {
  workingUiContext = ctx;
  configureWorkingIndicator(ctx);
  applyWorkingMessageFrame(ctx);
  if (workingMessageTimer) return;
  workingMessageTimer = setInterval(() => {
    if (workingUiContext) applyWorkingMessageFrame(workingUiContext);
  }, WORKING_SHIMMER_INTERVAL_MS);
}

function stopWorkingMessageShimmer(): void {
  if (workingMessageTimer) {
    clearInterval(workingMessageTimer);
    workingMessageTimer = null;
  }
  if (workingUiContext?.ui?.setWorkingMessage) workingUiContext.ui.setWorkingMessage();
  workingUiContext = null;
  workingMessageBase = WORKING_BASE_MESSAGE;
}

function refreshWorkingMessageFromTools(ctx: any, activeTools: ActiveTools): void {
  workingMessageBase = currentWorkingBaseMessage(activeTools);
  if (workingUiContext || activeTools.running.size > 0) startWorkingMessageShimmer(ctx);
}
```

- [x] **Step 3: Store active tool statuses on tool start/end and refresh Working row**

In the existing `pi.on("tool_execution_start", ...)` handler, replace:

```ts
    activeTools.running.set(event.toolCallId, event.toolName);
```

with:

```ts
    activeTools.running.set(event.toolCallId, {
      name: event.toolName,
      intent: formatToolIntent(event.toolName, (event as any).intent),
      startedAt: Date.now(),
    } satisfies ActiveToolStatus);
    refreshWorkingMessageFromTools(ctx, activeTools);
```

In the existing `pi.on("tool_execution_end", ...)` handler, immediately after:

```ts
    activeTools.running.delete(event.toolCallId);
```

add:

```ts
    refreshWorkingMessageFromTools(ctx, activeTools);
```

- [x] **Step 4: Start and stop shimmer on agent turn boundaries**

In the existing `pi.on("before_agent_start", async (event, _ctx) => {` handler, rename `_ctx` to `ctx` and insert this as the first statement in the handler body:

```ts
    workingMessageBase = currentWorkingBaseMessage(activeTools);
    startWorkingMessageShimmer(ctx);
```

In the existing assistant `message_end` handler:

```ts
  (pi as any).on("message_end", async (event: any, ctx: any) => {
    const msg = event.message;
    if (msg.role === "assistant") {
      const usage = msg.usage;
      if (usage) {
        cacheStats.totalInput += usage.input;
        cacheStats.totalCacheRead += usage.cacheRead;
      }
    }
  });
```

add `stopWorkingMessageShimmer();` before the closing brace of the `if (msg.role === "assistant")` block, after the cache stats update logic:

```ts
      stopWorkingMessageShimmer();
```

In the existing `pi.on("session_shutdown", ...)` handler, add this statement at the start of the handler body:

```ts
    stopWorkingMessageShimmer();
```

In the existing `pi.on("session_start", ...)` handler, after `activeTools.running.clear();`, add:

```ts
    stopWorkingMessageShimmer();
```

- [x] **Step 5: Add extension tests for Working row shimmer**

Append this `describe` block to `extensions/agentic-harness/tests/extension.test.ts`:

```ts
describe("working row shimmer", () => {
  it("configures the built-in working row and updates it from tool intent", async () => {
    vi.useFakeTimers();
    try {
      const { mockPi, events } = createMockPi();
      extension(mockPi);

      const setWorkingMessage = vi.fn();
      const setWorkingIndicator = vi.fn();
      const ctx: any = {
        cwd: ".",
        ui: {
          setWorkingMessage,
          setWorkingIndicator,
          setFooter: vi.fn(),
          setHeader: vi.fn(),
          notify: vi.fn(),
          theme: {
            fg: (_color: string, text: string) => text,
            bold: (text: string) => text,
            getFgAnsi: (_color: string) => "\x1b[38;5;33m",
          },
        },
        sessionManager: { getBranch: () => [] },
        model: { id: "mock/model", name: "mock", provider: "mock" },
        getContextUsage: () => undefined,
      };

      await events.get("session_start")![0]({ type: "session_start" } as any, ctx);
      await events.get("before_agent_start")![0]({ type: "before_agent_start", prompt: "hello", systemPrompt: "base" } as any, ctx);

      const plainWorkingMessage = () => String(setWorkingMessage.mock.calls.at(-1)?.[0] ?? "").replace(/\x1b\[[0-9;]*m/g, "");

      expect(setWorkingIndicator).toHaveBeenCalledWith(expect.objectContaining({ intervalMs: 80 }));
      expect(plainWorkingMessage()).toContain("Working…");

      await events.get("tool_execution_start")![0]({ toolCallId: "tool-1", toolName: "read", intent: "Reading project files" } as any, ctx);
      expect(plainWorkingMessage()).toContain("Reading project files");

      vi.advanceTimersByTime(80);
      expect(plainWorkingMessage()).toContain("Reading project files");

      await events.get("tool_execution_end")![0]({ toolCallId: "tool-1", toolName: "read", isError: false } as any, ctx);
      expect(plainWorkingMessage()).toContain("Working…");

      await events.get("message_end")![0]({ message: { role: "assistant", usage: undefined } } as any, ctx);
      expect(setWorkingMessage).toHaveBeenLastCalledWith();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [x] **Step 6: Run extension tests and verify they pass**

Run: `cd extensions/agentic-harness && npm test -- tests/extension.test.ts`
Expected: PASS with the new `working row shimmer` test green and no existing regression.

---

### Task 4 (Final): Full verification

**Dependencies:** Runs after Task 1, Task 2, and Task 3 complete
**Files:** None (read-only verification)

- [x] **Step 1: Run the full agentic-harness test suite and build**

Run: `cd extensions/agentic-harness && npm test && npm run build`
Expected: all Vitest tests pass and `tsc --noEmit` completes without errors.

- [x] **Step 2: Verify success criteria**

Manually verify each criterion against the final code:
- [ ] `extensions/agentic-harness/index.ts` calls `ctx.ui.setWorkingMessage()` with shimmer-formatted text during agent turns.
- [ ] `extensions/agentic-harness/index.ts` updates the Working row from `tool_execution_start` intent and resets it after assistant `message_end`.
- [ ] `extensions/agentic-harness/footer.ts` renders active tool intent through `shimmerText()` when `activeTools.running.size > 0`.
- [ ] `extensions/agentic-harness/tests/footer.test.ts` includes width-safety coverage for shimmered tool intent.
- [ ] No global `node_modules` Pi core files are modified.

- [x] **Step 3: Check changed files only**

Run: `git diff -- extensions/agentic-harness/shimmer.ts extensions/agentic-harness/footer.ts extensions/agentic-harness/index.ts extensions/agentic-harness/tests/shimmer.test.ts extensions/agentic-harness/tests/footer.test.ts extensions/agentic-harness/tests/extension.test.ts extensions/agentic-harness/package.json extensions/agentic-harness/scripts/run-vitest.cjs`
Expected: diff contains only shimmer utility, active tool status rendering, Working row UI wiring, portable test runner wiring, and tests described in this plan.

---

## Self-Review

- **Spec coverage:** The plan covers both requested surfaces: built-in Working row via public UI APIs and footer active tool intent via `RoachFooter`.
- **Placeholder scan:** No placeholders are left; every task has exact files, code snippets, commands, and expected results.
- **Type consistency:** `ActiveToolStatus` is introduced in `footer.ts`, imported in `index.ts`, and `ActiveTools.running` remains backward-compatible with existing `Map<string, string>` tests.
- **Dependency verification:** Task 1 creates the shared utility. Task 2 and Task 3 both depend on Task 1; Task 3 also depends on Task 2 because it writes the richer active tool state consumed by the footer. Final verification runs last.
- **Verification coverage:** The plan includes targeted tests per task plus the final `npm test && npm run build` verification command.
