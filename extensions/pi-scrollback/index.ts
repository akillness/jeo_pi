/**
 * pi-scrollback — adds two TUI conveniences to pi:
 *
 *   1. Scroll up through the conversation history inside the app via a
 *      keyboard-focused overlay (`/scrollback`, default `alt+s`). pi's main
 *      viewport has no in-app scroll API, so the overlay renders the transcript
 *      in a scrollable bordered window.
 *   2. Copy the conversation transcript to the system clipboard
 *      (`/copy`, default `alt+c`). `/copy last` copies only the last assistant
 *      reply.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { buildSessionContext, copyToClipboard } from "@mariozechner/pi-coding-agent";
import { ScrollView, SCROLLBACK_OVERLAY, scrollbackViewportHeight } from "./scroll-view.ts";
import {
  buildTranscript,
  lastAssistantMessage,
  type TranscriptMessage,
  type TranscriptOptions,
} from "./transcript.ts";

/** Resolved conversation messages for the active session leaf. */
function getMessages(ctx: ExtensionContext): TranscriptMessage[] {
  const sm = ctx.sessionManager;
  const context = buildSessionContext(sm.getEntries(), sm.getLeafId());
  return context.messages as unknown as TranscriptMessage[];
}

function describeCount(n: number): string {
  return `${n} ${n === 1 ? "message" : "messages"}`;
}

/** Copy the whole transcript (or just the last assistant reply) to the clipboard. */
async function runCopy(args: string, ctx: ExtensionContext): Promise<void> {
  const mode = args.trim().toLowerCase();
  const messages = getMessages(ctx);
  if (messages.length === 0) {
    ctx.ui.notify("Nothing to copy yet — the conversation is empty.", "warning");
    return;
  }

  const options: TranscriptOptions = { includeThinking: false, includeToolResults: false };
  let text: string;
  let label: string;
  if (mode === "last") {
    const last = lastAssistantMessage(messages);
    if (!last) {
      ctx.ui.notify("No assistant reply to copy yet.", "warning");
      return;
    }
    text = buildTranscript([last], options);
    label = "last reply";
  } else {
    text = buildTranscript(messages, options);
    label = `transcript (${describeCount(messages.length)})`;
  }

  if (text.trim().length === 0) {
    ctx.ui.notify("Nothing to copy — no text content found.", "warning");
    return;
  }

  try {
    await copyToClipboard(text);
    ctx.ui.notify(`Copied ${label} to clipboard.`, "info");
  } catch (error) {
    ctx.ui.notify(
      `Failed to copy to clipboard: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
}

/** Open the scrollable conversation-history overlay. */
async function openScrollback(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("Scrollback is only available in the interactive TUI.", "warning");
    return;
  }
  const messages = getMessages(ctx);
  const transcript = buildTranscript(messages, {
    includeThinking: false,
    includeToolResults: true,
  });
  if (transcript.trim().length === 0) {
    ctx.ui.notify("No conversation history to scroll through yet.", "warning");
    return;
  }
  const lines = transcript.split("\n");

  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) =>
      new ScrollView(lines, {
        title: "Conversation history",
        onClose: () => done(undefined),
        getViewportHeight: () => scrollbackViewportHeight(tui.terminal.rows),
        requestRender: () => tui.requestRender(),
        styles: {
          border: (s) => theme.fg("dim", s),
          dim: (s) => theme.fg("dim", s),
          bold: (s) => theme.bold(s),
        },
      }),
    {
      overlay: true,
      overlayOptions: {
        width: `${SCROLLBACK_OVERLAY.widthPercent}%`,
        maxHeight: `${SCROLLBACK_OVERLAY.maxHeightPercent}%`,
      },
    },
  );
}

export default function piScrollback(pi: ExtensionAPI): void {
  pi.registerCommand("copy", {
    description: "Copy the conversation to the clipboard ('last' = last reply, default = full)",
    getArgumentCompletions: (prefix: string) => {
      const items = [
        { value: "last", label: "last", description: "Copy only the last assistant reply" },
        { value: "all", label: "all", description: "Copy the full conversation transcript" },
      ];
      const lower = prefix.trim().toLowerCase();
      return items.filter((item) => item.value.startsWith(lower));
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await runCopy(args, ctx);
    },
  });

  pi.registerCommand("scrollback", {
    description: "Open a scrollable view of the conversation history",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await openScrollback(ctx);
    },
  });

  pi.registerShortcut("alt+s", {
    description: "Open conversation scrollback",
    handler: (ctx: ExtensionContext) => openScrollback(ctx),
  });

  pi.registerShortcut("alt+c", {
    description: "Copy conversation transcript to clipboard",
    handler: (ctx: ExtensionContext) => runCopy("all", ctx),
  });
}
