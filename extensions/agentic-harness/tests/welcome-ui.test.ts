import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-coding-agent", () => ({
  keyHint: (key: string, description?: string) => `${key}${description ? ` ${description}` : ""}`,
  keyText: (key: string) => key,
  rawKeyHint: (key: string, description?: string) => `${key}${description ? ` ${description}` : ""}`,
}));

import {
  BANNER_LINES,
  createWelcomeHeader,
  dismissWelcomeHeader,
  isWelcomeVisible,
  registerWelcomeCommand,
  showWelcomeHeader,
  toggleWelcomeHeader,
} from "../welcome-ui.js";
import { SHIMMER_SWEEP_MS } from "../shimmer.js";

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

const shimmerTheme = {
  ...theme,
  getFgAnsi: (color: string) => color === "warning" ? "\x1b[33m" : "\x1b[36m",
} as any;

const SHIMMER_HIGHLIGHT_ANSI = "\x1b[38;2;241;248;242m";

function render(component: { render(width: number): string[] }): string {
  return component.render(120).join("\n");
}

beforeEach(() => {
  // welcomeVisible is module-level state shared across tests; force a known
  // hidden baseline so each toggle assertion is order-independent.
  dismissWelcomeHeader(ui() as any);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("jeopi banner wordmark", () => {
  it("is a 6-row ANSI Shadow wordmark with uniform display width", () => {
    expect(BANNER_LINES).toHaveLength(6);
    const widths = BANNER_LINES.map((line) => Array.from(line).length);
    // Every row must share one display width or the block-letters shear apart.
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBeGreaterThan(0);
  });

  it("kerns the five letters into one cohesive JEOPI with no inter-letter gap", () => {
    // The retired wordmark was "JEO PI" — a 4-space inter-word gap split it in
    // two. Block letters legitimately carry interior gaps up to 5 cells (e.g.
    // the P stem row), but a run of 6+ spaces only happens when whole letters
    // are pushed apart, so guard against that to keep "JEOPI" reading as one.
    for (const line of BANNER_LINES) {
      const interior = line.replace(/^ +| +$/g, "");
      expect(interior).not.toMatch(/ {6,}/);
    }
  });

  it("renders the wordmark into the static (non-shimmer) header", () => {
    const rendered = createWelcomeHeader()({} as any, theme).render(120).join("\n");
    for (const line of BANNER_LINES) {
      expect(rendered).toContain(line.trimEnd());
    }
  });
});

describe("welcome header controller", () => {

  it("creates a non-blocking header component", () => {
    const component = createWelcomeHeader()({} as any, theme);
    const rendered = component.render(120).join("\n");

    expect(rendered).toContain("Engineering Discipline Extension");
    expect(rendered).toContain("/clarify");
  });

  it("renders the jeo-pi landing page overview and core workflow", () => {
    const component = createWelcomeHeader()({} as any, theme);
    const rendered = component.render(120).join("\n");

    expect(rendered).toContain("Spec-driven agentic harness for pi");
    expect(rendered).toContain("Core workflow");
    for (const command of ["/clarify", "/goal", "/team", "/welcome"]) {
      expect(rendered).toContain(command);
    }
    expect(rendered).toContain("planner → executor → verifier loop");
  });

  it("keeps the banner shimmer running while the header is shown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const component = createWelcomeHeader()({ requestRender: vi.fn() } as any, shimmerTheme);

    const initialRender = render(component);
    expect(initialRender).toContain("\x1b[");
    expect(initialRender).toContain(SHIMMER_HIGHLIGHT_ANSI);
    expect(initialRender).not.toContain("\x1b[33m");

    vi.setSystemTime(350);
    expect(render(component)).not.toBe(initialRender);

    vi.setSystemTime(SHIMMER_SWEEP_MS * 3);
    const laterRender = render(component);

    expect(laterRender).toContain("\x1b[");
    expect(laterRender).toContain("Engineering Discipline Extension");
  });

  it("clears the shimmer timer on dispose", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const requestRender = vi.fn();

    const component = createWelcomeHeader()({ requestRender } as any, shimmerTheme);
    component.dispose?.();
    vi.advanceTimersByTime(80);

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it("shows, dismisses, and round-trips the header via toggle", () => {
    const mockUi = ui();

    showWelcomeHeader(mockUi as any);
    expect(isWelcomeVisible()).toBe(true);
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(expect.any(Function));

    dismissWelcomeHeader(mockUi as any);
    expect(isWelcomeVisible()).toBe(false);
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(undefined);

    // Full toggle round-trip: hidden -> shown (true) -> hidden (false).
    expect(toggleWelcomeHeader(mockUi as any)).toBe(true);
    expect(isWelcomeVisible()).toBe(true);
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(expect.any(Function));

    expect(toggleWelcomeHeader(mockUi as any)).toBe(false);
    expect(isWelcomeVisible()).toBe(false);
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(undefined);
  });

  it("registers /welcome command for show, hide, and toggle", async () => {
    const commands = new Map<string, any>();
    registerWelcomeCommand({ registerCommand: (name: string, def: any) => commands.set(name, def) } as any);

    const command = commands.get("welcome");
    expect(command).toBeDefined();
    expect(command.description).toContain("welcome header");

    const mockUi = ui();
    await command.handler("off", { ui: mockUi });
    expect(isWelcomeVisible()).toBe(false);
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(undefined);
    expect(mockUi.notify).toHaveBeenLastCalledWith("Welcome header hidden", "info");

    await command.handler("on", { ui: mockUi });
    expect(isWelcomeVisible()).toBe(true);
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(expect.any(Function));
    expect(mockUi.notify).toHaveBeenLastCalledWith("Welcome header shown", "info");

    await command.handler("toggle", { ui: mockUi });
    expect(isWelcomeVisible()).toBe(false);
    expect(mockUi.setHeader).toHaveBeenLastCalledWith(undefined);
    expect(mockUi.notify).toHaveBeenLastCalledWith("Welcome header hidden", "info");

    // Bare toggle (no args) flips from hidden back to shown.
    await command.handler("", { ui: mockUi });
    expect(isWelcomeVisible()).toBe(true);
    expect(mockUi.notify).toHaveBeenLastCalledWith("Welcome header shown", "info");
  });

  it("honors every /welcome alias for hide and show", async () => {
    const commands = new Map<string, any>();
    registerWelcomeCommand({ registerCommand: (name: string, def: any) => commands.set(name, def) } as any);
    const command = commands.get("welcome");
    const mockUi = ui();

    for (const hideAlias of ["off", "hide", "dismiss", "OFF", " Hide "]) {
      showWelcomeHeader(mockUi as any);
      await command.handler(hideAlias, { ui: mockUi });
      expect(isWelcomeVisible()).toBe(false);
      expect(mockUi.notify).toHaveBeenLastCalledWith("Welcome header hidden", "info");
    }

    for (const showAlias of ["on", "show", "restore", "ON", " Show "]) {
      dismissWelcomeHeader(mockUi as any);
      await command.handler(showAlias, { ui: mockUi });
      expect(isWelcomeVisible()).toBe(true);
      expect(mockUi.notify).toHaveBeenLastCalledWith("Welcome header shown", "info");
    }
  });
});
