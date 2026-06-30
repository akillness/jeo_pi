import { describe, expect, it } from "vitest";
import {
  buildTranscript,
  lastAssistantMessage,
  messageToBlock,
  normaliseParts,
  type TranscriptMessage,
} from "../transcript.ts";

describe("normaliseParts", () => {
  it("wraps a non-empty string into a single text part", () => {
    expect(normaliseParts("hello")).toEqual([{ type: "text", text: "hello" }]);
  });

  it("returns an empty array for empty/undefined content", () => {
    expect(normaliseParts("")).toEqual([]);
    expect(normaliseParts(undefined)).toEqual([]);
  });

  it("passes part arrays through unchanged", () => {
    const parts = [{ type: "text", text: "a" }];
    expect(normaliseParts(parts)).toBe(parts);
  });
});

describe("messageToBlock", () => {
  it("renders user text", () => {
    expect(messageToBlock({ role: "user", content: "hi there" })).toBe("## User\nhi there");
  });

  it("skips empty user messages", () => {
    expect(messageToBlock({ role: "user", content: "   " })).toBeNull();
  });

  it("renders assistant text and skips empty parts", () => {
    const msg: TranscriptMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "   " },
        { type: "text", text: "second" },
      ],
    };
    expect(messageToBlock(msg)).toBe("## Assistant\nfirst\nsecond");
  });

  it("includes tool calls by default and excludes them when asked", () => {
    const msg: TranscriptMessage = {
      role: "assistant",
      content: [{ type: "toolCall", name: "read", arguments: { path: "a.ts" } }],
    };
    expect(messageToBlock(msg)).toBe('## Assistant\n→ called read({"path":"a.ts"})');
    expect(messageToBlock(msg, { includeToolCalls: false })).toBeNull();
  });

  it("truncates very long tool-call arguments", () => {
    const big = "x".repeat(500);
    const block = messageToBlock({
      role: "assistant",
      content: [{ type: "toolCall", name: "run", arguments: { cmd: big } }],
    });
    expect(block).not.toBeNull();
    expect(block).toContain("…");
    expect(block!.length).toBeLessThan(200);
  });

  it("excludes thinking by default and includes it when asked", () => {
    const msg: TranscriptMessage = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "secret plan" },
        { type: "text", text: "answer" },
      ],
    };
    expect(messageToBlock(msg)).toBe("## Assistant\nanswer");
    expect(messageToBlock(msg, { includeThinking: true })).toBe(
      "## Assistant\n> (thinking) secret plan\nanswer",
    );
  });

  it("renders tool results only when requested, with name and error flag", () => {
    const msg: TranscriptMessage = {
      role: "toolResult",
      toolName: "bash",
      isError: true,
      content: [{ type: "text", text: "boom" }],
    };
    expect(messageToBlock(msg)).toBeNull();
    expect(messageToBlock(msg, { includeToolResults: true })).toBe(
      "## Tool result (bash) [error]\nboom",
    );
  });

  it("returns null for unknown roles", () => {
    expect(messageToBlock({ role: "system", content: "x" })).toBeNull();
    expect(messageToBlock({ content: "x" })).toBeNull();
  });
});

describe("buildTranscript", () => {
  it("joins blocks with a blank line and drops skipped messages", () => {
    const messages: TranscriptMessage[] = [
      { role: "user", content: "hi" },
      { role: "system", content: "ignored" },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ];
    expect(buildTranscript(messages)).toBe("## User\nhi\n\n## Assistant\nhello");
  });

  it("returns an empty string when there is nothing to render", () => {
    expect(buildTranscript([{ role: "system", content: "x" }])).toBe("");
    expect(buildTranscript([])).toBe("");
  });
});

describe("lastAssistantMessage", () => {
  it("returns the most recent assistant message", () => {
    const a1: TranscriptMessage = { role: "assistant", content: "one" };
    const a2: TranscriptMessage = { role: "assistant", content: "two" };
    const messages: TranscriptMessage[] = [a1, { role: "user", content: "q" }, a2];
    expect(lastAssistantMessage(messages)).toBe(a2);
  });

  it("returns undefined when there is no assistant message", () => {
    expect(lastAssistantMessage([{ role: "user", content: "q" }])).toBeUndefined();
  });
});
