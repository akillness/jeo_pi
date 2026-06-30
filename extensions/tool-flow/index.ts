// extensions/tool-flow/index.ts
//
// jeo-pi "tool flow" extension — pi-agent parity for jeo-code's durable hooks.
// Subscribes to pi lifecycle events and runs two fire-and-forget side effects:
//   - tool_execution_end (edit/write) -> mark workspace dirty
//   - turn_end -> graphify refresh (if dirty) + llm-wiki turn ingest
//
// Both are self-guarded no-ops when the underlying tool/vault is absent, mirroring
// the `|| true` guards in setup-all-skills-prompt.md Step 3i.

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn as nodeSpawn } from "node:child_process";
import { ToolFlowRunner, type SpawnLike } from "./runner.js";

/** Detached, output-discarded spawn that never throws into the turn (ENOENT etc. are swallowed). */
const detachedSpawn: SpawnLike = (command, args, options) => {
  try {
    const child = nodeSpawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {
      /* missing binary or other launch failure — silent no-op */
    });
    child.unref();
  } catch {
    /* never let a failed background launch surface into the turn */
  }
};

export default function toolFlowExtension(pi: ExtensionAPI) {
  const runner = new ToolFlowRunner({ spawn: detachedSpawn });

  pi.on("tool_execution_end", async (event) => {
    runner.markToolEnd(event.toolName, event.isError);
  });

  pi.on("turn_end", async (_event, ctx) => {
    runner.onTurnEnd(ctx.cwd);
  });
}
