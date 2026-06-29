// Vendored wrapper around `pi-mcp-adapter`.
//
// We don't fork the whole adapter (41 files + the MCP protocol/OAuth/UI stack);
// we "swallow" only the part we care about — tool-call rendering. The heavy MCP
// engine stays in node_modules and keeps doing its job. We wrap the extension's
// `pi` with a Proxy that intercepts `registerTool`, replacing every tool's
// renderers with our own one-line, Claude-Code-style versions (./compact.ts).
//
// Loaded via package.json `pi.extensions` in place of the upstream entry, so the
// adapter runs exactly once — through this wrapper.

import mcpAdapter from "../../node_modules/pi-mcp-adapter/index.ts";
// Use the same pi-tui the rest of this repo's extensions depend on; the host
// renders Text from this scope identically to the adapter's own pi-tui scope.
import { Text } from "@mariozechner/pi-tui";
import { compactCallText, compactResultText } from "./compact.ts";

type AnyRecord = Record<string, unknown>;

export default function compactMcpAdapter(pi: AnyRecord): unknown {
  const proxied = new Proxy(pi, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        const original = Reflect.get(target, prop, receiver) as (tool: unknown) => unknown;
        return (tool: unknown) => original.call(target, withCompactRenderers(tool));
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return (mcpAdapter as (pi: unknown) => unknown)(proxied);
}

function withCompactRenderers(tool: unknown): unknown {
  if (!tool || typeof tool !== "object") return tool;
  const spec = tool as AnyRecord;
  const name = typeof spec.name === "string" ? spec.name : "";
  const originalCall = spec.renderCall as ((...args: unknown[]) => unknown) | undefined;
  const originalResult = spec.renderResult as ((...args: unknown[]) => unknown) | undefined;

  return {
    ...spec,
    renderCall: (args: AnyRecord, theme: AnyRecord, context: unknown) => {
      try {
        return new Text(compactCallText(name, args ?? {}, theme as never), 0, 0);
      } catch {
        return originalCall ? originalCall(args, theme, context) : new Text(name, 0, 0);
      }
    },
    renderResult: (result: AnyRecord, options: AnyRecord, theme: AnyRecord, context: AnyRecord) => {
      try {
        if (options?.isPartial)
          return new Text((theme as never as { fg: (n: string, t: string) => string }).fg("warning", "Running MCP tool..."), 0, 0);
        const isError = context?.isError === true || Boolean((result?.details as AnyRecord | undefined)?.error);
        const text = compactResultText(
          resultText(result),
          { expanded: Boolean(options?.expanded), isError },
          theme as never,
          1,
        );
        return new Text(text, 0, 0);
      } catch {
        return originalResult ? originalResult(result, options, theme, context) : new Text("", 0, 0);
      }
    },
  };
}

/** Flatten an MCP tool result's content blocks into plain text lines. */
function resultText(result: AnyRecord): string {
  const content = Array.isArray(result?.content) ? (result.content as AnyRecord[]) : [];
  return content
    .map((block) =>
      block?.type === "text"
        ? String(block.text ?? "")
        : `[${String(block?.mimeType ?? block?.type ?? "content")}]`,
    )
    .join("\n");
}
