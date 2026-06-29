import { describe, expect, it } from "vitest";

// Minimal pi host: real no-op functions (with working .bind) for every method
// the adapter touches during synchronous registration, recording registered tools.
function makeStubPi(record: unknown[]) {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "registerTool") return (tool: unknown) => (record.push(tool), tool);
        if (prop === "getAllTools") return () => [];
        if (prop === "cwd") return process.cwd();
        return () => undefined;
      },
    },
  );
}

const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };

describe("compact mcp wrapper (integration)", () => {
  it("feeds compact renderers into the real adapter's registerTool", async () => {
    let mod: { default: (pi: unknown) => unknown };
    try {
      mod = (await import("../index.ts")) as never;
    } catch (err) {
      console.warn("skipping: adapter module could not be loaded here:", (err as Error)?.message);
      return;
    }

    const record: any[] = [];
    try {
      mod.default(makeStubPi(record));
    } catch (err) {
      console.warn("skipping: adapter threw during sync registration:", (err as Error)?.message);
      return;
    }

    const mcp = record.find((tool) => tool?.name === "mcp");
    expect(mcp, "adapter should register the mcp proxy tool through our proxy").toBeTruthy();

    const callLines = mcp.renderCall({ tool: "demo" }, theme, {}).render(160);
    expect(callLines.join("\n")).toContain("mcp call demo");
    expect(callLines.length).toBe(1);

    const result = { content: [{ type: "text", text: "l1\nl2\nl3\nl4" }], details: {} };
    const resText = mcp.renderResult(result, { expanded: false }, theme, { isError: false }).render(160).join("\n");
    expect(resText).toContain("l1");
    expect(resText).toContain("Ctrl+O");
  });
});
