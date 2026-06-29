# Subagent Render Ellipsis Fix Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Checkbox (`- [ ]`) syntax is rendered task formatting only; canonical progress is stored with `harness_plan define_tasks` and `harness_plan set_task_status`.

**Goal:** Improve agentic-harness subagent rendering so recent partial-argument rendering no longer appears as ambiguous `subagent ... / ...`, while completed/running collapsed results continue to show what agent work was spawned.

**Architecture:** Keep the fix in the UI rendering layer. The subagent execution, async registry, process management, and event parsing paths remain unchanged; only renderer input forwarding, preview formatting, and render tests change.

**Tech Stack:** TypeScript, pi extension tool render callbacks, `@mariozechner/pi-tui` `Text` components, Vitest.

**Work Scope:**
- **In scope:** Single-mode `subagent` call rendering for partial args, single-result collapsed rendering with task preview, collapsed running-result rendering with `lastActivity` priority, focused tests, build/test verification.
- **Out of scope:** `team` tool renderer separation, async execution semantics, subagent lifecycle behavior, core pi TUI changes, full prompt/task expansion in collapsed views.

**Verification Strategy:**
- **Level:** e2e-capable test suite
- **Focused command:** `cd extensions/agentic-harness && npm test -- tests/render.test.ts`
- **Final command:** `cd extensions/agentic-harness && npm run build && npm test`
- **What it validates:** Focused render tests prove partial args no longer render as raw ellipses and collapsed results retain useful agent work context; the full build and Vitest suite prove TypeScript and existing extension behavior did not regress.

**Project Capability Discovery:**
- Bundled execution agents are available: `plan-compliance`, `plan-worker`, and `plan-validator` can be used for task-by-task execution and validation.
- Project skills relevant after approval: `agentic-run-plan` for execution, `agentic-review-work` for independent review, and `agentic-simplify` for post-change cleanup review.
- Existing tests live under `extensions/agentic-harness/tests/`; package scripts are defined in `extensions/agentic-harness/package.json`.

---

## File Structure Mapping

- Modify `extensions/agentic-harness/render.ts`
  - Add a small one-line preview helper.
  - Accept optional render context for `argsComplete`.
  - Replace single-mode raw `...` fallbacks with explicit starting/missing labels.
  - Add collapsed result preview logic that prefers `lastActivity`, then task preview.
- Modify `extensions/agentic-harness/index.ts`
  - Forward the tool render context into the subagent renderer so `argsComplete` reaches `render.ts`.
- Modify `extensions/agentic-harness/tests/render.test.ts`
  - Import `renderCall`.
  - Add focused tests for partial call rendering and collapsed single-result previews.

All implementation tasks touch shared render files, so they must run sequentially.

---

## Task 1: Make single-mode subagent call rendering explicit for partial args

**Dependencies:** None
**Files:**
- Modify: `extensions/agentic-harness/render.ts`
- Modify: `extensions/agentic-harness/index.ts`
- Test: `extensions/agentic-harness/tests/render.test.ts`

- [ ] **Step 1: Add failing renderCall tests**

Edit the import in `extensions/agentic-harness/tests/render.test.ts` from:

```ts
import { formatTokens, formatUsage, statusIcon, formatToolCall, renderResult } from "../render.js";
```

to:

```ts
import { formatTokens, formatUsage, statusIcon, formatToolCall, renderCall, renderResult } from "../render.js";
```

Then insert this test block after the `theme` constant:

```ts
describe("subagent call rendering", () => {
  it("shows an explicit starting state while single-mode args are incomplete", () => {
    const rendered = renderCall({}, theme, { argsComplete: false });
    const text = rendered.render(80).join("\n");

    expect(text).toContain("subagent starting...");
    expect(text).toContain("receiving task...");
    expect(text).not.toContain("subagent ...");
  });

  it("shows agent and one-line task preview when single-mode args are complete", () => {
    const rendered = renderCall(
      { agent: "explorer", task: "Read-only investigation:\ninspect subagent rendering" },
      theme,
      { argsComplete: true },
    );
    const text = rendered.render(80).join("\n");

    expect(text).toContain("subagent explorer");
    expect(text).toContain("Read-only investigation: inspect subagent rendering");
  });

  it("shows explicit missing labels when completed single-mode args are invalid", () => {
    const rendered = renderCall({}, theme, { argsComplete: true });
    const text = rendered.render(80).join("\n");

    expect(text).toContain("subagent missing agent");
    expect(text).toContain("missing task");
    expect(text).not.toContain("subagent ...");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails for the current behavior**

Run:

```bash
cd extensions/agentic-harness && npm test -- tests/render.test.ts
```

Expected: FAIL. The failure should show that `renderCall` currently accepts only two declared parameters or renders `subagent ...` / `...` for empty args.

- [ ] **Step 3: Add render context and preview helpers**

In `extensions/agentic-harness/render.ts`, replace the current `truncate` helper block:

```ts
function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}
```

with:

```ts
interface RenderCallContext {
  argsComplete?: boolean;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function previewText(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine.length === 0) return undefined;
  return truncate(oneLine, maxLen);
}
```

- [ ] **Step 4: Update single-mode renderCall behavior**

In `extensions/agentic-harness/render.ts`, change the `renderCall` function signature from:

```ts
export function renderCall(
  args: Record<string, any>,
  theme: Theme,
): Component {
```

to:

```ts
export function renderCall(
  args: Record<string, any>,
  theme: Theme,
  context: RenderCallContext = {},
): Component {
```

Then replace the current single-mode block:

```ts
  // Single mode
  const agentName = args.agent || "...";
  const preview = args.task ? truncate(args.task, 60) : "...";
  let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", agentName);
  text += `\n  ${theme.fg("dim", preview)}`;
  return new Text(text, 0, 0);
```

with:

```ts
  // Single mode
  const isReceivingArgs = context.argsComplete === false;
  const agentName = previewText(args.agent, 40) ?? (isReceivingArgs ? "starting..." : "missing agent");
  const preview = previewText(args.task, 60) ?? (isReceivingArgs ? "receiving task..." : "missing task");
  let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", agentName);
  text += `\n  ${theme.fg("dim", preview)}`;
  return new Text(text, 0, 0);
```

- [ ] **Step 5: Forward render context for the subagent tool**

In `extensions/agentic-harness/index.ts`, replace the subagent tool render callback:

```ts
      renderCall: (args, theme) => renderCall(args, theme),
```

inside the `name: "subagent"` registration with:

```ts
      renderCall: (args, theme, context) => renderCall(args, theme, context),
```

Do not change the `team` tool registration in this task.

- [ ] **Step 6: Run focused tests and build**

Run:

```bash
cd extensions/agentic-harness && npm test -- tests/render.test.ts && npm run build
```

Expected: PASS. The three new `subagent call rendering` tests pass, existing render tests pass, and TypeScript accepts the optional render context.

---

## Task 2: Keep task/activity context visible in collapsed single-result rendering

**Dependencies:** Runs after Task 1 completes
**Files:**
- Modify: `extensions/agentic-harness/render.ts`
- Test: `extensions/agentic-harness/tests/render.test.ts`

- [ ] **Step 1: Add failing collapsed result preview tests**

Append these tests to the existing `describe("metadata rendering via renderResult", ...)` block or insert them before `describe("nested subagent rendering via renderResult", ...)` in `extensions/agentic-harness/tests/render.test.ts`:

```ts
describe("single subagent collapsed result preview", () => {
  it("shows task preview on the collapsed success header", () => {
    const result: SingleResult = {
      agent: "explorer",
      agentSource: "bundled",
      task: "Read-only investigation: inspect subagent rendering behavior after recent updates",
      exitCode: 0,
      messages: [],
      stderr: "",
      usage: emptyUsage(),
    };
    const details: SubagentDetails = { mode: "single", results: [result] };
    const rendered = renderResult({ content: [{ type: "text", text: "" }], details }, false, theme);
    const firstLine = rendered.render(140).join("\n").split("\n")[0];

    expect(firstLine).toContain("✓ explorer (bundled)");
    expect(firstLine).toContain("Read-only investigation: inspect subagent rendering behavior");
  });

  it("prefers lastActivity over task preview on the collapsed running header", () => {
    const result: SingleResult = {
      agent: "explorer",
      agentSource: "bundled",
      task: "Original research task that should not be the header preview while activity exists",
      exitCode: -1,
      messages: [],
      stderr: "",
      usage: emptyUsage(),
      lastActivity: { name: "grep", args: { pattern: "renderCall", path: "extensions/agentic-harness" }, timestamp: 123 },
    };
    const details: SubagentDetails = { mode: "single", results: [result] };
    const rendered = renderResult({ content: [{ type: "text", text: "(running...)" }], details }, false, theme);
    const firstLine = rendered.render(160).join("\n").split("\n")[0];

    expect(firstLine).toContain("⏳ explorer (bundled)");
    expect(firstLine).toContain("grep /renderCall/ in extensions/agentic-harness");
    expect(firstLine).not.toContain("Original research task");
  });

  it("truncates long collapsed task previews", () => {
    const result: SingleResult = {
      agent: "worker",
      agentSource: "bundled",
      task: `Investigate ${"rendering ".repeat(30)}TAIL_MARKER`,
      exitCode: 0,
      messages: [],
      stderr: "",
      usage: emptyUsage(),
    };
    const details: SubagentDetails = { mode: "single", results: [result] };
    const rendered = renderResult({ content: [{ type: "text", text: "" }], details }, false, theme);
    const firstLine = rendered.render(200).join("\n").split("\n")[0];

    expect(firstLine).toContain("Investigate rendering rendering");
    expect(firstLine).toContain("...");
    expect(firstLine).not.toContain("TAIL_MARKER");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails for missing collapsed previews**

Run:

```bash
cd extensions/agentic-harness && npm test -- tests/render.test.ts
```

Expected: FAIL. The new collapsed result preview tests fail because the collapsed header currently contains only icon, agent, source, and error stop reason.

- [ ] **Step 3: Add collapsed result preview helper**

In `extensions/agentic-harness/render.ts`, insert this helper immediately after `renderMetadata`:

```ts
function renderSingleResultPreview(r: SingleResult, fg: ThemeFg): string {
  if (r.lastActivity) return formatToolCall(r.lastActivity.name, r.lastActivity.args, fg);
  const taskPreview = previewText(r.task, 90);
  return taskPreview ? fg("dim", taskPreview) : "";
}
```

- [ ] **Step 4: Add preview text to collapsed single-result header**

In `extensions/agentic-harness/render.ts`, inside `renderSingleResult`, replace the collapsed header block:

```ts
  // Collapsed
  let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
  if (error && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
  const metadataText = renderMetadata(r, theme.fg.bind(theme));
```

with:

```ts
  // Collapsed
  let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
  const resultPreview = renderSingleResultPreview(r, theme.fg.bind(theme));
  if (resultPreview) text += ` ${theme.fg("muted", "—")} ${resultPreview}`;
  if (error && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
  const metadataText = renderMetadata(r, theme.fg.bind(theme));
```

- [ ] **Step 5: Run focused tests and build**

Run:

```bash
cd extensions/agentic-harness && npm test -- tests/render.test.ts && npm run build
```

Expected: PASS. The collapsed header shows task previews for completed results, shows formatted `lastActivity` for running results, truncates long task previews, and existing render tests still pass.

---

## Task 3 (Final): Full verification and regression review

**Dependencies:** Runs after Task 2 completes
**Files:** None (read-only verification)

- [ ] **Step 1: Run the focused render test file**

Run:

```bash
cd extensions/agentic-harness && npm test -- tests/render.test.ts
```

Expected: PASS. The output includes the new `subagent call rendering` and `single subagent collapsed result preview` cases.

- [ ] **Step 2: Run TypeScript build**

Run:

```bash
cd extensions/agentic-harness && npm run build
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run the full agentic-harness test suite**

Run:

```bash
cd extensions/agentic-harness && npm test
```

Expected: PASS. Existing e2e, integration, extension, and rendering tests all pass.

- [ ] **Step 4: Inspect the final diff for scope control**

Run:

```bash
git diff -- extensions/agentic-harness/render.ts extensions/agentic-harness/index.ts extensions/agentic-harness/tests/render.test.ts
```

Expected: The diff is limited to render context forwarding, render preview helpers, single-mode subagent call display, collapsed single-result display, and focused render tests. No async execution, registry, process, or runner-event logic changes appear.

- [ ] **Step 5: Manually verify success criteria**

Confirm each item:

- [ ] Partial single-mode subagent calls no longer render `subagent ...`.
- [ ] Incomplete args are displayed as `subagent starting...` and `receiving task...`.
- [ ] Invalid completed args are displayed as `missing agent` and `missing task`.
- [ ] Collapsed completed single-result headers include a one-line task preview.
- [ ] Collapsed running single-result headers prefer formatted `lastActivity` over task preview.
- [ ] Long previews are truncated and normalized to one line.
- [ ] Execution and async lifecycle code is unchanged.

---

## Self-Review

**Spec coverage:** The plan covers the clarified goal: partial args handling, retained collapsed agent/task/activity visibility, and focused tests. `team` renderer separation is explicitly out of scope as requested.

**Placeholder scan:** The plan contains concrete file paths, exact code snippets, exact commands, and expected outcomes. There are no unresolved implementation blanks.

**Type consistency:** `RenderCallContext`, `previewText`, and `renderSingleResultPreview` are introduced before use. `SingleResult.lastActivity` already exists in `types.ts` with `{ name, args, timestamp }`, and `formatToolCall` accepts the helper inputs.

**Dependency verification:** Tasks 1 and 2 both modify `render.ts` and `tests/render.test.ts`, so Task 2 depends on Task 1. Task 3 depends on Task 2 and is read-only verification.

**Verification coverage:** The final task runs focused render tests, TypeScript build, the full `agentic-harness` suite, and a scoped diff review against the success criteria.
