/**
 * Pure helpers that turn a pi conversation (a list of messages) into plain
 * text. Kept free of any pi runtime imports so it is trivially unit-testable
 * and reusable by both the `/copy` command and the scrollback overlay.
 *
 * The shapes below are a deliberately loose structural subset of pi's
 * `AgentMessage` union (`@mariozechner/pi-agent-core`). We only read the few
 * fields we render, which keeps this module decoupled from the exact runtime
 * types while remaining assignable from the real messages.
 */

export interface TranscriptContentPart {
  type: string;
  /** Present on `text` parts. */
  text?: string;
  /** Present on `thinking` parts. */
  thinking?: string;
  /** Present on `toolCall` parts. */
  name?: string;
  /** Present on `toolCall` parts. */
  arguments?: unknown;
}

export interface TranscriptMessage {
  role?: string;
  content?: string | TranscriptContentPart[];
  /** Present on `toolResult` messages. */
  toolName?: string;
  /** Present on `toolResult` messages. */
  isError?: boolean;
}

export interface TranscriptOptions {
  /** Include assistant "thinking" content. Default false. */
  includeThinking?: boolean;
  /** Include tool-result messages. Default false. */
  includeToolResults?: boolean;
  /** Include "called tool(...)" lines inside assistant blocks. Default true. */
  includeToolCalls?: boolean;
}

const TOOL_ARGS_MAX = 120;

/** Normalise message content (string or part array) into a part array. */
export function normaliseParts(
  content: string | TranscriptContentPart[] | undefined,
): TranscriptContentPart[] {
  if (content === undefined) return [];
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }
  return content;
}

/** Concatenate the text of all `text` parts. */
function textOf(parts: TranscriptContentPart[]): string {
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

function compactArgs(args: unknown): string {
  let serialised: string;
  try {
    serialised = typeof args === "string" ? args : JSON.stringify(args ?? {});
  } catch {
    serialised = String(args);
  }
  if (serialised === undefined) serialised = "";
  if (serialised.length > TOOL_ARGS_MAX) {
    return `${serialised.slice(0, TOOL_ARGS_MAX - 1)}…`;
  }
  return serialised;
}

/**
 * Render a single message into a transcript block, or `null` when there is
 * nothing worth showing for the current options.
 */
export function messageToBlock(
  message: TranscriptMessage,
  options: TranscriptOptions = {},
): string | null {
  const { includeThinking = false, includeToolResults = false, includeToolCalls = true } = options;
  const parts = normaliseParts(message.content);

  switch (message.role) {
    case "user": {
      const text = textOf(parts).trim();
      if (text.length === 0) return null;
      return `## User\n${text}`;
    }
    case "assistant": {
      const lines: string[] = [];
      for (const part of parts) {
        if (part.type === "text" && typeof part.text === "string") {
          const trimmed = part.text.trim();
          if (trimmed.length > 0) lines.push(trimmed);
        } else if (part.type === "thinking" && includeThinking && typeof part.thinking === "string") {
          const trimmed = part.thinking.trim();
          if (trimmed.length > 0) lines.push(`> (thinking) ${trimmed.replace(/\n/g, "\n> ")}`);
        } else if (part.type === "toolCall" && includeToolCalls) {
          lines.push(`→ called ${part.name ?? "tool"}(${compactArgs(part.arguments)})`);
        }
      }
      if (lines.length === 0) return null;
      return `## Assistant\n${lines.join("\n")}`;
    }
    case "toolResult": {
      if (!includeToolResults) return null;
      const text = textOf(parts).trim();
      const header = `## Tool result${message.toolName ? ` (${message.toolName})` : ""}${
        message.isError ? " [error]" : ""
      }`;
      return text.length > 0 ? `${header}\n${text}` : header;
    }
    default:
      return null;
  }
}

/** Build the full transcript as a single string (blocks separated by a blank line). */
export function buildTranscript(
  messages: readonly TranscriptMessage[],
  options: TranscriptOptions = {},
): string {
  const blocks: string[] = [];
  for (const message of messages) {
    const block = messageToBlock(message, options);
    if (block !== null) blocks.push(block);
  }
  return blocks.join("\n\n");
}

/** Return the last assistant message, or undefined when there is none. */
export function lastAssistantMessage(
  messages: readonly TranscriptMessage[],
): TranscriptMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") return messages[i];
  }
  return undefined;
}
