import { describe, expect, it } from "vitest";
import piScrollback from "../index.ts";

interface CommandRecord {
  description?: string;
  getArgumentCompletions?: (prefix: string) => unknown;
  handler: (...args: unknown[]) => unknown;
}
interface ShortcutRecord {
  description?: string;
  handler: (...args: unknown[]) => unknown;
}

function fakeApi() {
  const commands = new Map<string, CommandRecord>();
  const shortcuts = new Map<string, ShortcutRecord>();
  const pi = {
    registerCommand(name: string, options: CommandRecord) {
      commands.set(name, options);
    },
    registerShortcut(key: string, options: ShortcutRecord) {
      shortcuts.set(key, options);
    },
  };
  // The real ExtensionAPI is far larger; the extension only uses these two.
  piScrollback(pi as never);
  return { commands, shortcuts };
}

describe("piScrollback registration", () => {
  it("registers the /copy and /scrollback commands with descriptions", () => {
    const { commands } = fakeApi();
    expect([...commands.keys()].sort()).toEqual(["copy", "scrollback"]);
    expect(commands.get("copy")?.description).toMatch(/clipboard/i);
    expect(commands.get("scrollback")?.description).toMatch(/scroll/i);
  });

  it("registers the alt+c / alt+s shortcuts", () => {
    const { shortcuts } = fakeApi();
    expect([...shortcuts.keys()].sort()).toEqual(["alt+c", "alt+s"]);
    expect(shortcuts.get("alt+c")?.description).toMatch(/copy/i);
    expect(shortcuts.get("alt+s")?.description).toMatch(/scroll/i);
  });

  it("filters /copy argument completions by prefix", () => {
    const { commands } = fakeApi();
    const complete = commands.get("copy")!.getArgumentCompletions!;
    expect((complete("") as { value: string }[]).map((i) => i.value)).toEqual(["last", "all"]);
    expect((complete("l") as { value: string }[]).map((i) => i.value)).toEqual(["last"]);
    expect((complete("a") as { value: string }[]).map((i) => i.value)).toEqual(["all"]);
    expect((complete("z") as { value: string }[]).map((i) => i.value)).toEqual([]);
  });
});
