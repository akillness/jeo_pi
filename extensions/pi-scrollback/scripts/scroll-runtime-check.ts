/**
 * Real-runtime verification for the /scrollback overlay.
 *
 * This does NOT re-test the ScrollView unit logic (tests/scroll-view.test.ts
 * already covers clampOffset / handleInput / render). Instead it drives the
 * *real* pi-tui `TUI` overlay machinery the extension actually depends on:
 *
 *   1. Build a fake Terminal of a given size.
 *   2. Construct the real `TUI`, `showOverlay(new ScrollView(...))` exactly the
 *      way `openScrollback` does (same width/maxHeight + viewport formula).
 *   3. Feed keystrokes through the TUI's own input dispatch (`tui.handleInput`)
 *      — the same entry point ProcessTerminal wires to stdin — and confirm the
 *      focused overlay actually scrolls.
 *   4. Reproduce the TUI's real overlay compositing clip
 *      (`render(width).slice(0, maxHeight)`, verbatim from
 *      pi-tui `compositeOverlays`) to measure what the user actually sees, and
 *      assert the footer is visible and pressing End reveals the final line.
 *
 * The viewport formula is imported from the extension, so this driver fails
 * before the fix and passes after it.
 */

import { TUI } from "@mariozechner/pi-tui";
import type { Terminal } from "@mariozechner/pi-tui/dist/terminal.js";
import { ScrollView } from "../scroll-view.ts";
import { scrollbackViewportHeight, SCROLLBACK_OVERLAY } from "../scroll-view.ts";

const PASS = "\u2713";
const FAIL = "\u2717";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  ${PASS} ${label}`);
  } else {
    failures++;
    console.log(`  ${FAIL} ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Minimal Terminal stub: enough surface for TUI construction + dispatch. */
function fakeTerminal(rows: number, columns: number): Terminal & { feed?: (d: string) => void } {
  let onInput: (data: string) => void = () => {};
  return {
    start(handler) {
      onInput = handler;
    },
    stop() {},
    async drainInput() {},
    write() {},
    get columns() {
      return columns;
    },
    get rows() {
      return rows;
    },
    get kittyProtocolActive() {
      return false;
    },
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
    // Test hook: deliver a keystroke the way the real stdin handler would.
    feed: (d: string) => onInput(d),
  };
}

/** Percentage resolution identical to pi-tui parseSizeValue("90%"). */
function pct(value: number, ref: number): number {
  return Math.floor((ref * value) / 100);
}

/** Mirror pi-tui compositeOverlays: render at overlay width, clip to maxHeight. */
function visibleOverlayLines(view: ScrollView, termRows: number, termCols: number): string[] {
  const width = pct(SCROLLBACK_OVERLAY.widthPercent, termCols);
  const maxHeight = pct(SCROLLBACK_OVERLAY.maxHeightPercent, termRows);
  const lines = view.render(width);
  return lines.length > maxHeight ? lines.slice(0, maxHeight) : lines;
}

function isFooter(line: string): boolean {
  // The bottom frame carries the scroll position + key hints.
  return line.includes("q close") || /\d+-\d+\/\d+/.test(line);
}

function makeTranscript(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `line ${i + 1} of ${n}`);
}

function runScenario(name: string, rows: number, cols: number, transcriptLines: number): void {
  console.log(`\n[${name}] terminal ${cols}x${rows}, transcript ${transcriptLines} lines`);
  const term = fakeTerminal(rows, cols);
  const tui = new TUI(term as Terminal);
  tui.start(); // wires term.start(handler) -> term.feed dispatches to tui.handleInput

  const lines = makeTranscript(transcriptLines);
  const view = new ScrollView(lines, {
    title: "Conversation history",
    onClose: () => {},
    getViewportHeight: () => scrollbackViewportHeight(term.rows),
    requestRender: () => tui.requestRender(),
  });

  tui.showOverlay(view, {
    width: `${SCROLLBACK_OVERLAY.widthPercent}%`,
    maxHeight: `${SCROLLBACK_OVERLAY.maxHeightPercent}%`,
  });

  // Establish viewport/total exactly like the first real paint.
  view.render(pct(SCROLLBACK_OVERLAY.widthPercent, cols));

  // 1) Real dispatch: a Down key routed through the TUI scrolls the overlay.
  const before = view.scrollOffset;
  (term as { feed: (d: string) => void }).feed("\x1b[B"); // ArrowDown
  check("ArrowDown routed through TUI focus scrolls the overlay", view.scrollOffset === before + 1, `offset ${before} -> ${view.scrollOffset}`);

  // 2) End reveals the final transcript line within the *visible* region.
  (term as { feed: (d: string) => void }).feed("\x1b[F"); // End
  const visible = visibleOverlayLines(view, rows, cols);
  const showsLastLine = visible.some((l) => l.includes(`line ${transcriptLines} of ${transcriptLines}`));
  check("End scrolls so the final transcript line is actually visible", showsLastLine);

  // 3) The footer (scroll position + key hints) is never clipped away.
  const hasFooter = visible.some(isFooter);
  check("footer/status row is visible (not clipped by overlay maxHeight)", hasFooter);

  // 4) Rendered overlay never exceeds the overlay's own maxHeight band.
  const maxHeight = pct(SCROLLBACK_OVERLAY.maxHeightPercent, rows);
  const rendered = view.render(pct(SCROLLBACK_OVERLAY.widthPercent, cols));
  check("rendered overlay fits within maxHeight (no silent clipping)", rendered.length <= maxHeight, `rendered ${rendered.length} > maxHeight ${maxHeight}`);

  tui.stop();
}

function main(): void {
  console.log("=== /scrollback real-runtime verification ===");
  // Small terminal: historically fine.
  runScenario("small", 24, 80, 60);
  // Mid terminal: footer starts getting clipped under the old rows-6 formula.
  runScenario("mid", 50, 100, 120);
  // Tall terminal: old formula also makes the last line unreachable at End.
  runScenario("tall", 64, 120, 200);

  console.log("");
  if (failures > 0) {
    console.log(`${FAIL} ${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`${PASS} ALL RUNTIME CHECKS PASSED`);
  process.exit(0);
}

main();
