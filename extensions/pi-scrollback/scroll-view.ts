/**
 * A scrollable, read-only overlay component for pi's TUI. Given a list of
 * logical text lines it renders a bordered viewport that the user can scroll
 * up/down through the conversation history with the arrow/page keys.
 *
 * pi's main chat viewport has no in-app scroll API (it relies on native
 * terminal scrollback), so this overlay is how we offer "scroll up through the
 * conversation" inside the app.
 */

import type { Component } from "@mariozechner/pi-tui";
import { matchesKey, visibleWidth } from "@mariozechner/pi-tui";

export interface ScrollViewStyles {
  border?: (s: string) => string;
  dim?: (s: string) => string;
  bold?: (s: string) => string;
}

export interface ScrollViewOptions {
  title?: string;
  /** Close the overlay (wired to the `done` callback of `ctx.ui.custom`). */
  onClose: () => void;
  /** Number of content lines the viewport may use (recomputed each render). */
  getViewportHeight: () => number;
  /** Ask the TUI to repaint after the scroll offset changes. */
  requestRender: () => void;
  styles?: ScrollViewStyles;
}

const identity = (s: string): string => s;

/**
 * Overlay geometry for the `/scrollback` window, shared by the overlay options
 * and the viewport-height calculation so the two can never drift apart.
 *
 * The TUI clips overlay content to `maxHeightPercent` of the terminal rows
 * (see pi-tui `compositeOverlays` → `render(width).slice(0, maxHeight)`), so the
 * ScrollView must render at most that many lines. ScrollView spends 2 of them on
 * its own chrome (the title border row + the status/hint footer row), leaving
 * `maxHeight - 2` rows for actual content.
 */
export const SCROLLBACK_OVERLAY = {
  widthPercent: 90,
  maxHeightPercent: 90,
} as const;

/** Rows ScrollView reserves for its own frame (top border + status footer). */
const SCROLLBACK_CHROME_ROWS = 2;

/**
 * Content viewport height for the `/scrollback` overlay on a terminal of
 * `terminalRows` rows. Derived from the same percentage the overlay is clipped
 * to, minus ScrollView's own chrome, so the rendered overlay fits the visible
 * band exactly: no clipped footer, and End/G can always reach the final line.
 */
export function scrollbackViewportHeight(terminalRows: number): number {
  const maxHeight = Math.floor((terminalRows * SCROLLBACK_OVERLAY.maxHeightPercent) / 100);
  return Math.max(3, maxHeight - SCROLLBACK_CHROME_ROWS);
}

/** Clamp a scroll offset to the valid `[0, max]` range for the content. */
export function clampOffset(offset: number, total: number, viewport: number): number {
  const max = Math.max(0, total - viewport);
  if (Number.isNaN(offset)) return 0;
  return Math.min(Math.max(0, Math.floor(offset)), max);
}

/**
 * Hard-wrap logical lines to a display width, honouring wide (CJK) characters.
 * Empty lines are preserved as empty lines.
 */
export function wrapToWidth(lines: readonly string[], width: number): string[] {
  if (width <= 0) return [...lines];
  const out: string[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      out.push("");
      continue;
    }
    let current = "";
    let currentWidth = 0;
    for (const ch of Array.from(line)) {
      const w = visibleWidth(ch);
      if (currentWidth + w > width && current.length > 0) {
        out.push(current);
        current = ch;
        currentWidth = w;
      } else {
        current += ch;
        currentWidth += w;
      }
    }
    out.push(current);
  }
  return out;
}

/** Strip ANSI SGR sequences so width math ignores styling. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

export class ScrollView implements Component {
  private offset = 0;
  private lastViewport = 1;
  private lastTotal = 0;
  private readonly border: (s: string) => string;
  private readonly dim: (s: string) => string;
  private readonly bold: (s: string) => string;

  constructor(
    private readonly lines: readonly string[],
    private readonly options: ScrollViewOptions,
  ) {
    this.border = options.styles?.border ?? identity;
    this.dim = options.styles?.dim ?? identity;
    this.bold = options.styles?.bold ?? identity;
  }

  /** Current scroll offset (top visible wrapped line). Exposed for tests. */
  get scrollOffset(): number {
    return this.offset;
  }

  invalidate(): void {
    // No cached state beyond the scroll offset, which must survive invalidate.
  }

  private scrollBy(delta: number): void {
    const next = clampOffset(this.offset + delta, this.lastTotal, this.lastViewport);
    if (next !== this.offset) {
      this.offset = next;
      this.options.requestRender();
    }
  }

  private scrollTo(offset: number): void {
    const next = clampOffset(offset, this.lastTotal, this.lastViewport);
    if (next !== this.offset) {
      this.offset = next;
      this.options.requestRender();
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.options.onClose();
      return;
    }
    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      this.scrollBy(-1);
    } else if (matchesKey(data, "down") || matchesKey(data, "j")) {
      this.scrollBy(1);
    } else if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+b")) {
      this.scrollBy(-this.lastViewport);
    } else if (
      matchesKey(data, "pageDown") ||
      matchesKey(data, "ctrl+f") ||
      matchesKey(data, "space")
    ) {
      this.scrollBy(this.lastViewport);
    } else if (matchesKey(data, "home") || matchesKey(data, "g")) {
      this.scrollTo(0);
    } else if (matchesKey(data, "end") || matchesKey(data, "shift+g")) {
      this.scrollTo(Number.MAX_SAFE_INTEGER);
    }
  }

  render(width: number): string[] {
    const frameWidth = Math.max(8, width);
    const innerWidth = frameWidth - 4;
    const viewport = Math.max(1, Math.floor(this.options.getViewportHeight()));

    const wrapped = wrapToWidth(this.lines, innerWidth);
    this.lastTotal = wrapped.length;
    this.lastViewport = viewport;
    this.offset = clampOffset(this.offset, wrapped.length, viewport);

    const windowLines = wrapped.slice(this.offset, this.offset + viewport);
    while (windowLines.length < viewport) windowLines.push("");

    const firstShown = wrapped.length === 0 ? 0 : this.offset + 1;
    const lastShown = Math.min(wrapped.length, this.offset + viewport);
    const atTop = this.offset === 0;
    const atBottom = this.offset >= Math.max(0, wrapped.length - viewport);
    const upArrow = atTop ? " " : "↑";
    const downArrow = atBottom ? " " : "↓";

    const title = this.options.title ?? "Scrollback";
    const status = `${firstShown}-${lastShown}/${wrapped.length} ${upArrow}${downArrow}`;
    const hint = "↑/↓ PgUp/PgDn  g/G top/bottom  q close";

    return [
      this.frameTop(this.bold(title), frameWidth),
      ...windowLines.map((line) => this.frameLine(line, innerWidth)),
      this.frameBottom(this.dim(`${status}  ${hint}`), frameWidth),
    ];
  }

  // Border line layout: "╭─ " (3) + label + " " (1) + dashes + "╮" (1).
  private frameTop(label: string, frameWidth: number): string {
    const dashes = Math.max(0, frameWidth - visibleWidth(stripAnsi(label)) - 5);
    return this.border("╭─ ") + label + this.border(` ${"─".repeat(dashes)}╮`);
  }

  private frameBottom(label: string, frameWidth: number): string {
    const dashes = Math.max(0, frameWidth - visibleWidth(stripAnsi(label)) - 5);
    return this.border("╰─ ") + label + this.border(` ${"─".repeat(dashes)}╯`);
  }

  private frameLine(line: string, innerWidth: number): string {
    const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(line)));
    return `${this.border("│")} ${line}${padding} ${this.border("│")}`;
  }
}
