import { describe, expect, it, vi } from "vitest";
import { clampOffset, ScrollView, wrapToWidth } from "../scroll-view.ts";

describe("clampOffset", () => {
  it("keeps a valid offset", () => {
    expect(clampOffset(2, 10, 3)).toBe(2);
  });

  it("clamps negatives to 0", () => {
    expect(clampOffset(-5, 10, 3)).toBe(0);
  });

  it("clamps past the maximum (total - viewport)", () => {
    expect(clampOffset(99, 10, 3)).toBe(7);
  });

  it("returns 0 when content fits in the viewport", () => {
    expect(clampOffset(5, 2, 3)).toBe(0);
  });

  it("treats NaN as 0", () => {
    expect(clampOffset(Number.NaN, 10, 3)).toBe(0);
  });
});

describe("wrapToWidth", () => {
  it("hard-wraps long lines to the width", () => {
    expect(wrapToWidth(["abcdef"], 2)).toEqual(["ab", "cd", "ef"]);
  });

  it("preserves empty lines", () => {
    expect(wrapToWidth(["", "ab", ""], 5)).toEqual(["", "ab", ""]);
  });

  it("returns a copy untouched for non-positive width", () => {
    const input = ["abc"];
    const out = wrapToWidth(input, 0);
    expect(out).toEqual(["abc"]);
    expect(out).not.toBe(input);
  });

  it("accounts for wide (CJK) characters as width 2", () => {
    // Width 3 cannot fit a second 2-wide glyph, so each wraps onto its own line.
    expect(wrapToWidth(["한글"], 3)).toEqual(["한", "글"]);
  });
});

function makeView(lines: string[], viewport = 3) {
  const requestRender = vi.fn();
  const onClose = vi.fn();
  const view = new ScrollView(lines, {
    title: "T",
    onClose,
    getViewportHeight: () => viewport,
    requestRender,
  });
  return { view, requestRender, onClose };
}

/** Extract the inner text of content rows (strip the "│ ... │" frame). */
function contentRows(rendered: string[]): string[] {
  return rendered.slice(1, -1).map((row) => row.replace(/^│ /, "").replace(/ │$/, "").trimEnd());
}

const TEN = Array.from({ length: 10 }, (_, i) => `l${i + 1}`);

describe("ScrollView rendering", () => {
  it("renders a border plus exactly viewport content rows", () => {
    const { view } = makeView(TEN, 3);
    const out = view.render(40);
    expect(out).toHaveLength(5); // top border + 3 content + bottom border
    expect(contentRows(out)).toEqual(["l1", "l2", "l3"]);
  });

  it("shows the scroll position and a down arrow when not at the bottom", () => {
    const { view } = makeView(TEN, 3);
    const out = view.render(40);
    expect(out.at(-1)).toContain("1-3/10");
    expect(out.at(-1)).toContain("↓");
  });

  it("pads the final window so the viewport height stays stable", () => {
    const { view } = makeView(["only one line"], 3);
    const out = view.render(40);
    expect(out).toHaveLength(5);
    expect(contentRows(out)).toEqual(["only one line", "", ""]);
  });
});

describe("ScrollView keyboard scrolling", () => {
  it("scrolls down and up by one line and repaints", () => {
    const { view, requestRender } = makeView(TEN, 3);
    view.render(40); // establishes viewport/total
    view.handleInput("\x1b[B"); // down
    expect(view.scrollOffset).toBe(1);
    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(contentRows(view.render(40))).toEqual(["l2", "l3", "l4"]);

    view.handleInput("\x1b[A"); // up
    expect(view.scrollOffset).toBe(0);
  });

  it("supports vim j/k keys", () => {
    const { view } = makeView(TEN, 3);
    view.render(40);
    view.handleInput("j");
    view.handleInput("j");
    expect(view.scrollOffset).toBe(2);
    view.handleInput("k");
    expect(view.scrollOffset).toBe(1);
  });

  it("pages by the viewport height", () => {
    const { view } = makeView(TEN, 3);
    view.render(40);
    view.handleInput("\x1b[6~"); // pageDown
    expect(view.scrollOffset).toBe(3);
  });

  it("clamps at the bottom and does not repaint when already there", () => {
    const { view, requestRender } = makeView(TEN, 3);
    view.render(40);
    view.handleInput("\x1b[F"); // end → max offset (10 - 3 = 7)
    expect(view.scrollOffset).toBe(7);
    requestRender.mockClear();
    view.handleInput("\x1b[B"); // down past the end
    expect(view.scrollOffset).toBe(7);
    expect(requestRender).not.toHaveBeenCalled();
  });

  it("jumps to top and bottom with g / G", () => {
    const { view } = makeView(TEN, 3);
    view.render(40);
    view.handleInput("G"); // shift+g → bottom
    expect(view.scrollOffset).toBe(7);
    view.handleInput("g"); // top
    expect(view.scrollOffset).toBe(0);
  });

  it("closes on escape and on q", () => {
    const a = makeView(TEN, 3);
    a.view.render(40);
    a.view.handleInput("\x1b");
    expect(a.onClose).toHaveBeenCalledTimes(1);

    const b = makeView(TEN, 3);
    b.view.render(40);
    b.view.handleInput("q");
    expect(b.onClose).toHaveBeenCalledTimes(1);
  });
});
