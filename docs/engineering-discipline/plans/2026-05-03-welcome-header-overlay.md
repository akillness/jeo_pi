# Welcome Header / Optional Overlay Controller Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Add a dismissible welcome experience that does not block startup input or conflict with the footer.

**Architecture:** Extract the current startup header rendering into `welcome-ui.ts` and expose small functions for show/dismiss/toggle. Use the non-blocking `ctx.ui.setHeader(...)` path as the first implementation because it is already safe in this extension; treat overlay as an explicit future enhancement rather than a startup modal.

**Tech Stack:** TypeScript, Vitest, Pi `ctx.ui.setHeader`, Pi command registration, `Text` from `@mariozechner/pi-tui`.

**Work Scope:**
- **In scope:** reusable welcome header factory, session-local welcome visibility controller, `/welcome on|off|toggle` command, startup show, tests for show/dismiss/restore/no duplicate header registration.
- **Out of scope:** modal overlay focus handling, persistent settings, welcome recent sessions, welcome keyboard capture, editor/fixed-layout work.

**Completed M2 Context:**
- `resolveAgenticUiSettings({ cwd })` exists and is wired into the footer.
- `RoachFooter` supports `default`, `compact`, and `minimal` presets.
- Full test suite passed with 552 tests and build passed.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build`
- **What it validates:** Vitest regression coverage plus TypeScript type-checking. This milestone adds focused welcome controller tests and extension command wiring tests.

---

## File Structure Mapping

- Create: `extensions/agentic-harness/welcome-ui.ts`
  - Owns welcome header rendering and commands.
- Create: `extensions/agentic-harness/tests/welcome-ui.test.ts`
  - Focused controller tests.
- Modify: `extensions/agentic-harness/index.ts`
  - Imports welcome helpers, registers `/welcome`, and replaces inline `setHeader` block with `showWelcomeHeader(ctx.ui)`.
- Modify: `extensions/agentic-harness/tests/extension.test.ts`
  - Verifies `/welcome` command registration and session_start header installation still work.

---

### Task 1: Add Welcome UI Controller and Tests

**Dependencies:** None
**Files:**
- Create: `extensions/agentic-harness/welcome-ui.ts`
- Create: `extensions/agentic-harness/tests/welcome-ui.test.ts`

- [ ] **Step 1: Create `welcome-ui.ts`**

Write `extensions/agentic-harness/welcome-ui.ts` with this complete content:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { keyHint, keyText, rawKeyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

export type HeaderUi = {
  setHeader: (factory: any | undefined) => void;
  notify?: (message: string, level: "info" | "warning" | "error") => void;
};

let welcomeVisible = true;

export function createWelcomeHeader() {
  return (_tui: unknown, theme: any) => {
    const banner = [
      "██████╗  ██████╗  █████╗  ██████╗██╗  ██╗    ██████╗ ██╗",
      "██╔══██╗██╔═══██╗██╔══██╗██╔════╝██║  ██║    ██╔══██╗██║",
      "██████╔╝██║   ██║███████║██║     ███████║    ██████╔╝██║",
      "██╔══██╗██║   ██║██╔══██║██║     ██╔══██║    ██╔═══╝ ██║",
      "██║  ██║╚██████╔╝██║  ██║╚██████╗██║  ██║    ██║     ██║",
      "╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝    ╚═╝     ╚═╝",
    ].map(line => theme.bold(theme.fg("accent", line))).join("\n");

    const tagline = theme.fg("dim", "Engineering Discipline Extension");
    const tipLine = theme.fg("muted", "Tip: Use /plan after clarifying; use /ultraplan for complex work.");
    const clarifyLine = theme.fg("dim", "In most cases, start with /clarify.");
    const hints = [
      keyHint("app.interrupt", "to interrupt"),
      keyHint("app.clear", "to clear"),
      rawKeyHint(`${keyText("app.clear")} twice`, "to exit"),
      keyHint("app.tools.expand", "to expand tools"),
      rawKeyHint("/", "for commands"),
      rawKeyHint("!", "to run bash"),
    ].join("\n");

    return new Text(`\n${banner}\n${tagline}\n\n${tipLine}\n${clarifyLine}\n\n${hints}`, 1, 0);
  };
}

export function showWelcomeHeader(ui: HeaderUi): void {
  welcomeVisible = true;
  ui.setHeader(createWelcomeHeader());
}

export function dismissWelcomeHeader(ui: HeaderUi): void {
  welcomeVisible = false;
  ui.setHeader(undefined);
}

export function toggleWelcomeHeader(ui: HeaderUi): boolean {
  if (welcomeVisible) {
    dismissWelcomeHeader(ui);
    return false;
  }
  showWelcomeHeader(ui);
  return true;
}

export function isWelcomeVisible(): boolean {
  return welcomeVisible;
}

export function registerWelcomeCommand(pi: ExtensionAPI): void {
  pi.registerCommand("welcome", {
    description: "Show, hide, or toggle the Agentic Harness welcome header",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action === "off" || action === "hide" || action === "dismiss") {
        dismissWelcomeHeader(ctx.ui as HeaderUi);
        ctx.ui.notify("Welcome header hidden", "info");
        return;
      }
      if (action === "on" || action === "show" || action === "restore") {
        showWelcomeHeader(ctx.ui as HeaderUi);
        ctx.ui.notify("Welcome header shown", "info");
        return;
      }
      const visible = toggleWelcomeHeader(ctx.ui as HeaderUi);
      ctx.ui.notify(visible ? "Welcome header shown" : "Welcome header hidden", "info");
    },
  });
}
```

- [ ] **Step 2: Create `welcome-ui.test.ts`**

Write `extensions/agentic-harness/tests/welcome-ui.test.ts` with this complete content:

```typescript
import { describe, expect, it, vi } from "vitest";
import { createWelcomeHeader, dismissWelcomeHeader, isWelcomeVisible, registerWelcomeCommand, showWelcomeHeader, toggleWelcomeHeader } from "../welcome-ui.js";

function ui() {
  return {
    setHeader: vi.fn(),
    notify: vi.fn(),
  };
}

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as any;

describe("welcome header controller", () => {
  it("creates a non-blocking header component", () => {
    const component = createWelcomeHeader()({}, theme);
    const rendered = component.render(120).join("\n");

    expect(rendered).toContain("Engineering Discipline Extension");
    expect(rendered).toContain("/clarify");
  });

  it("shows, dismisses, and toggles the header", () => {
    const mockUi = ui();

    showWelcomeHeader(mockUi);
    expect(isWelcomeVisible()).toBe(true);
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(expect.any(Function));

    dismissWelcomeHeader(mockUi);
    expect(isWelcomeVisible()).toBe(false);
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(undefined);

    expect(toggleWelcomeHeader(mockUi)).toBe(true);
    expect(isWelcomeVisible()).toBe(true);
  });

  it("registers /welcome command for show/hide/toggle", async () => {
    const commands = new Map<string, any>();
    registerWelcomeCommand({ registerCommand: (name: string, def: any) => commands.set(name, def) } as any);

    const command = commands.get("welcome");
    expect(command).toBeDefined();
    expect(command.description).toContain("welcome header");

    const mockUi = ui();
    await command.handler("off", { ui: mockUi });
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(undefined);
    expect(mockUi.notify).toHaveBeenLastCalledWith("Welcome header hidden", "info");

    await command.handler("on", { ui: mockUi });
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(expect.any(Function));
    expect(mockUi.notify).toHaveBeenLastCalledWith("Welcome header shown", "info");
  });
});
```

- [ ] **Step 3: Run welcome tests**

Run:

```bash
npm --prefix extensions/agentic-harness test -- --run tests/welcome-ui.test.ts
```

Expected: PASS.

---

### Task 2: Wire Welcome Controller into Extension Startup and Commands

**Dependencies:** Task 1
**Files:**
- Modify: `extensions/agentic-harness/index.ts`
- Modify: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Import welcome helpers in `index.ts`**

Add this import near other local imports:

```typescript
import { registerWelcomeCommand, showWelcomeHeader } from "./welcome-ui.js";
```

- [ ] **Step 2: Register `/welcome` command**

Near the other command registrations, after `/reset-phase` is a safe location, add:

```typescript
  registerWelcomeCommand(pi);
```

- [ ] **Step 3: Replace inline startup header with welcome controller**

In `extensions/agentic-harness/index.ts`, replace the entire inline `ctx.ui.setHeader((_tui, theme) => { ... });` block inside `session_start` with:

```typescript
    showWelcomeHeader(ctx.ui as any);
```

Do not change footer wiring.

- [ ] **Step 4: Add extension registration assertions**

In `extensions/agentic-harness/tests/extension.test.ts`, update the root command registration test so it includes:

```typescript
    expect(commands.has("welcome")).toBe(true);
```

Also add this session_start assertion near existing header tests:

```typescript
  it("installs the welcome header exactly once on session_start", async () => {
    const { mockPi, events } = createMockPi();
    extension(mockPi);

    const handlers = events.get("session_start");
    expect(handlers?.length).toBeGreaterThan(0);

    const setHeader = vi.fn();
    await handlers![0]({ type: "session_start" } as any, {
      cwd: ".",
      ui: {
        setHeader,
        setFooter: vi.fn(),
        notify: vi.fn(),
        setWorkingVisible: vi.fn(),
      },
      sessionManager: { getBranch: () => [] },
      model: { name: "test" },
      getContextUsage: () => undefined,
    } as any);

    expect(setHeader).toHaveBeenCalledTimes(1);
    expect(setHeader.mock.calls[0][0]).toBeTypeOf("function");
  });
```

- [ ] **Step 5: Run focused welcome/extension tests**

Run:

```bash
npm --prefix extensions/agentic-harness test -- --run tests/welcome-ui.test.ts tests/extension.test.ts
```

Expected: PASS.

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

- [ ] **Step 2: Verify M3 success criteria**

Manually check each criterion against tests and implementation:

- [ ] Welcome UI appears on startup using `setHeader`.
- [ ] User can dismiss and restore the welcome UI through `/welcome off` and `/welcome on`.
- [ ] Overlay fallback path is non-blocking header behavior; no modal overlay is started on startup.
- [ ] Tests cover show, dismiss, restore, and no duplicate competing header registration.

- [ ] **Step 3: Check for accidental dependency/scope creep**

Run:

```bash
git diff -- extensions/agentic-harness/package.json extensions/agentic-harness/package-lock.json extensions/fff-search/index.ts
```

Expected: no diff.
