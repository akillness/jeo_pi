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
  antigravityThinkingBudget,
  geminiThinkingBudget,
  antigravityClaudeThinkingBudget,
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

describe("antigravity thinking budgets", () => {
  it("derives gemini in-name depth markers without an explicit effort", () => {
    expect(geminiThinkingBudget("gemini-3-pro-high")).toBe(24000);
    expect(geminiThinkingBudget("gemini-3-pro-low")).toBe(4000);
    expect(geminiThinkingBudget("gemini-2.5-flash-thinking")).toBe(10000);
  });

  it("keeps unmarked flash off by default but pro at its floor", () => {
    expect(geminiThinkingBudget("gemini-3-flash")).toBe(0);
    expect(geminiThinkingBudget("gemini-3-pro")).toBe(128);
  });

  it("returns undefined for non-thinking-capable gemini", () => {
    expect(geminiThinkingBudget("gemini-1.5-pro")).toBeUndefined();
  });

  it("scales claude with explicit effort and stays off when unset", () => {
    expect(antigravityClaudeThinkingBudget("high")).toBe(24000);
    expect(antigravityClaudeThinkingBudget("minimal")).toBe(2000);
    expect(antigravityClaudeThinkingBudget(undefined)).toBeUndefined();
  });

  it("routes claude ids to the anthropic-style budget", () => {
    expect(antigravityThinkingBudget("antigravity/claude-opus-4-8", "medium")).toBe(10000);
    expect(antigravityThinkingBudget("antigravity/claude-opus-4-8")).toBeUndefined();
  });

  it("clamps the gemini budget below maxTokens", () => {
    expect(geminiThinkingBudget("gemini-3-pro-high", undefined, 5000)).toBe(3976);
  });
});

describe("buildCcaRequest thinkingConfig (CCA reasoning wire)", () => {
  const base = {
    project: "proj-1",
    accessToken: "tok-abc",
    messages: msgs({ role: "user", content: "hello" }),
  };

  it("requests includeThoughts for a gemini -high model so CCA streams reasoning", () => {
    const { body } = buildCcaRequest({ model: "antigravity/gemini-3-pro-high", ...base });
    const cfg = JSON.parse(body).request.generationConfig.thinkingConfig;
    expect(cfg).toEqual({ includeThoughts: true, thinkingBudget: 24000 });
  });

  it("threads the pi reasoning level into the gemini budget", () => {
    const { body } = buildCcaRequest({ model: "antigravity/gemini-3-flash", reasoning: "low", ...base });
    expect(JSON.parse(body).request.generationConfig.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 4000 });
  });

  it("enables claude reasoning with the interleaved-thinking beta and a bumped output cap", () => {
    const { headers, body } = buildCcaRequest({ model: "antigravity/claude-opus-4-8", reasoning: "high", maxTokens: 4000, ...base });
    const cfg = JSON.parse(body).request.generationConfig;
    expect(cfg.thinkingConfig).toEqual({ includeThoughts: true, thinkingBudget: 24000 });
    expect(cfg.maxOutputTokens).toBe(24000 + 1024);
    expect(headers["anthropic-beta"]).toBe("interleaved-thinking-2025-05-14");
  });

  it("omits thinkingConfig and the beta header for claude without an effort", () => {
    const { headers, body } = buildCcaRequest({ model: "antigravity/claude-sonnet-4-5", maxTokens: 1234, ...base });
    const cfg = JSON.parse(body).request.generationConfig;
    expect(cfg.thinkingConfig).toBeUndefined();
    expect(cfg.maxOutputTokens).toBe(1234);
    expect(headers["anthropic-beta"]).toBeUndefined();
  });

  it("never sends the anthropic beta header for gemini reasoning", () => {
    const { headers } = buildCcaRequest({ model: "antigravity/gemini-3-pro-high", reasoning: "high", ...base });
    expect(headers["anthropic-beta"]).toBeUndefined();
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
