import { describe, it, expect } from "vitest";
import type { Context } from "@mariozechner/pi-ai";
import {
  ANTIGRAVITY_DAILY_ENDPOINT,
  antigravityModelId,
  getAntigravityUserAgent,
  antigravityContents,
  buildCcaRequest,
  ccaText,
  ccaThought,
  ccaFunctionCalls,
} from "../antigravity/cca.js";

type Msg = Context["messages"][number];
const msgs = (...m: unknown[]): Context["messages"] => m as Context["messages"];

describe("antigravityModelId", () => {
  it("strips the antigravity/ prefix", () => {
    expect(antigravityModelId("antigravity/gemini-3-pro")).toBe("gemini-3-pro");
    expect(antigravityModelId("gemini-3-pro")).toBe("gemini-3-pro");
  });
});

describe("getAntigravityUserAgent", () => {
  it("formats as antigravity/<version> <os>/<arch>", () => {
    expect(getAntigravityUserAgent()).toMatch(/^antigravity\/[\d.]+ \S+\/\S+$/);
  });
});

describe("antigravityContents", () => {
  it("maps assistant→model and user→user roles", () => {
    const contents = antigravityContents(msgs(
      { role: "user", content: "hi" },
      { role: "assistant", content: "yo" },
    ));
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "yo" }] },
    ]);
  });

  it("collapses consecutive same-role turns into one content", () => {
    const contents = antigravityContents(msgs(
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ));
    expect(contents).toHaveLength(1);
    expect(contents[0].parts).toEqual([{ text: "a" }, { text: "b" }]);
  });

  it("emits inlineData parts for user image content", () => {
    const contents = antigravityContents(msgs({
      role: "user",
      content: [
        { type: "image", mimeType: "image/png", data: "BASE64" },
        { type: "text", text: "caption" },
      ],
    }));
    expect(contents[0].parts).toContainEqual({ inlineData: { mimeType: "image/png", data: "BASE64" } });
    expect(contents[0].parts).toContainEqual({ text: "caption" });
  });

  it("folds tool results back in as user text", () => {
    const contents = antigravityContents(msgs(
      { role: "assistant", content: "call" },
      { role: "toolResult", content: "result-text" },
    ));
    expect(contents[contents.length - 1]).toEqual({ role: "user", parts: [{ text: "result-text" }] });
  });
});

describe("buildCcaRequest", () => {
  const base = {
    project: "proj-1",
    accessToken: "tok-abc",
    messages: msgs({ role: "user", content: "hello" }),
  };

  it("targets the SSE streamGenerateContent endpoint with auth + UA headers", () => {
    const { url, headers } = buildCcaRequest({ model: "antigravity/gemini-3-pro", ...base });
    expect(url).toBe(`${ANTIGRAVITY_DAILY_ENDPOINT}/v1internal:streamGenerateContent?alt=sse`);
    expect(headers.authorization).toBe("Bearer tok-abc");
    expect(headers.accept).toBe("text/event-stream");
    expect(headers["User-Agent"]).toMatch(/^antigravity\//);
  });

  it("strips the model prefix and sets agent request metadata in the body", () => {
    const { body } = buildCcaRequest({ model: "antigravity/gemini-3-pro", ...base });
    const parsed = JSON.parse(body);
    expect(parsed.model).toBe("gemini-3-pro");
    expect(parsed.project).toBe("proj-1");
    expect(parsed.requestType).toBe("agent");
    expect(parsed.requestId).toMatch(/^agent-/);
    expect(parsed.request.contents).toEqual([{ role: "user", parts: [{ text: "hello" }] }]);
  });

  it("includes maxOutputTokens only for Claude models", () => {
    const claude = JSON.parse(buildCcaRequest({ model: "antigravity/claude-sonnet-4-5", maxTokens: 1234, ...base }).body);
    expect(claude.request.generationConfig.maxOutputTokens).toBe(1234);
    const gemini = JSON.parse(buildCcaRequest({ model: "antigravity/gemini-3-pro", maxTokens: 1234, ...base }).body);
    expect(gemini.request.generationConfig?.maxOutputTokens).toBeUndefined();
  });

  it("passes temperature through generationConfig", () => {
    const parsed = JSON.parse(buildCcaRequest({ model: "antigravity/gemini-3-pro", temperature: 0.5, ...base }).body);
    expect(parsed.request.generationConfig.temperature).toBe(0.5);
  });

  it("attaches a system instruction when a system prompt is supplied", () => {
    const parsed = JSON.parse(buildCcaRequest({ model: "antigravity/gemini-3-pro", systemPrompt: "be terse", ...base }).body);
    expect(parsed.request.systemInstruction).toEqual({ role: "user", parts: [{ text: "be terse" }] });
  });

  it("maps tools into functionDeclarations with AUTO calling", () => {
    const parsed = JSON.parse(buildCcaRequest({
      model: "antigravity/gemini-3-pro",
      ...base,
      tools: [{ name: "grep", description: "search", parameters: { type: "object" } }] as unknown as Context["tools"],
    }).body);
    expect(parsed.request.tools[0].functionDeclarations[0].name).toBe("grep");
    expect(parsed.request.toolConfig.functionCallingConfig.mode).toBe("AUTO");
  });
});

describe("CCA chunk parsers", () => {
  const chunk = {
    response: {
      candidates: [
        {
          content: {
            parts: [
              { text: "thinking…", thought: true },
              { text: "answer" },
              { functionCall: { name: "read", args: { path: "x" } } },
            ],
          },
        },
      ],
    },
  };

  it("ccaText returns only non-thought text", () => {
    expect(ccaText(chunk)).toBe("answer");
  });

  it("ccaThought returns only thought text", () => {
    expect(ccaThought(chunk)).toBe("thinking…");
  });

  it("ccaFunctionCalls extracts named calls with args", () => {
    expect(ccaFunctionCalls(chunk)).toEqual([{ name: "read", args: { path: "x" } }]);
  });

  it("parsers tolerate empty chunks", () => {
    expect(ccaText({})).toBe("");
    expect(ccaThought({})).toBe("");
    expect(ccaFunctionCalls({})).toEqual([]);
  });
});

// Keep the Msg type referenced for documentation of the message shape under test.
export type _Msg = Msg;
