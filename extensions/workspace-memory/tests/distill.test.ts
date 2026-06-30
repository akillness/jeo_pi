import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
	serializeTranscript,
	buildDistillContext,
	extractDistilledMemories,
	distillSession,
	DISTILL_MIN_TRANSCRIPT_CHARS,
	DISTILL_MAX_MEMORIES_PER_SESSION,
} from "../distill.js";
import { createAndSaveMemory } from "../save.js";
import { getCachedIndex, invalidateCache } from "../storage.js";

const tempRoots: string[] = [];
function tempCwd(): string {
	const root = mkdtempSync(join(tmpdir(), "distill-test-"));
	tempRoots.push(root);
	return root;
}

afterEach(() => {
	delete process.env.JEO_NO_MEMORY;
	for (const root of tempRoots.splice(0, tempRoots.length)) {
		invalidateCache(root);
		rmSync(root, { recursive: true, force: true });
	}
});

/** A long, realistic transcript well over the minimum threshold. */
function longTranscript() {
	return [
		{ role: "user", content: "The redis connection keeps timing out under load, can you fix it?" },
		{
			role: "assistant",
			content: [
				{ type: "thinking", text: "secret scratch — must not be distilled" },
				{ type: "text", text: "Looking at the pool config. ".repeat(20) },
				{ type: "toolCall", name: "read" },
			],
		},
		{ role: "toolResult", content: [{ type: "text", text: "pool max = 5 ".repeat(20) }], isError: false },
		{ role: "toolResult", content: [{ type: "text", text: "connection refused" }], isError: true },
		{
			role: "assistant",
			content: [{ type: "text", text: "Raised the pool size to 50 and added a retry. ".repeat(20) }],
		},
	];
}

describe("serializeTranscript", () => {
	it("labels roles, marks tool errors, and excludes thinking blocks", () => {
		const text = serializeTranscript(longTranscript());
		expect(text).toContain("USER: The redis connection");
		expect(text).toContain("ASSISTANT:");
		expect(text).toContain("TOOL: pool max = 5");
		expect(text).toContain("TOOL(error): connection refused");
		expect(text).toContain("[tool:read]");
		expect(text).not.toContain("secret scratch");
	});

	it("keeps the most recent tail when over the char budget", () => {
		const messages = [
			{ role: "user", content: "OLD_HEAD_MARKER " + "x".repeat(500) },
			{ role: "assistant", content: [{ type: "text", text: "y".repeat(500) + " RECENT_TAIL_MARKER" }] },
		];
		const text = serializeTranscript(messages, 300);
		expect(text.length).toBeLessThanOrEqual(300);
		expect(text).toContain("RECENT_TAIL_MARKER");
		expect(text).not.toContain("OLD_HEAD_MARKER");
	});

	it("returns empty string for messages with no renderable content", () => {
		expect(serializeTranscript([{ role: "assistant", content: [{ type: "thinking", text: "x" }] }])).toBe("");
	});
});

describe("buildDistillContext", () => {
	it("embeds the transcript and lists existing summaries to avoid duplication", () => {
		const ctx = buildDistillContext("TRANSCRIPT_BODY", ["already known thing"]);
		expect(ctx.systemPrompt).toContain("distill durable engineering knowledge");
		const userMsg = ctx.messages[0];
		expect(typeof userMsg.content === "string" && userMsg.content).toContain("TRANSCRIPT_BODY");
		expect(typeof userMsg.content === "string" && userMsg.content).toContain("already known thing");
	});

	it("omits the duplication section when there are no existing summaries", () => {
		const ctx = buildDistillContext("BODY", []);
		const content = ctx.messages[0].content as string;
		expect(content).not.toContain("Already-recorded");
	});
});

describe("extractDistilledMemories", () => {
	it("parses a bare JSON object", () => {
		const out = extractDistilledMemories(
			'{"memories":[{"template":"post-mortem","tags":["redis"],"content":"Problem: x\\nFix: y"}]}',
		);
		expect(out).toHaveLength(1);
		expect(out[0].template).toBe("post-mortem");
		expect(out[0].tags).toEqual(["redis"]);
	});

	it("parses JSON wrapped in a ```json fence with surrounding prose", () => {
		const text = "Here you go:\n```json\n{\"memories\":[{\"template\":\"compact-note\",\"content\":\"Summary: z\"}]}\n```\nDone.";
		const out = extractDistilledMemories(text);
		expect(out).toHaveLength(1);
		expect(out[0].template).toBe("compact-note");
	});

	it("normalizes unknown templates to compact-note and drops empty content", () => {
		const out = extractDistilledMemories(
			'{"memories":[{"template":"bogus","content":"Summary: kept"},{"template":"post-mortem","content":"   "}]}',
		);
		expect(out).toHaveLength(1);
		expect(out[0].template).toBe("compact-note");
	});

	it("caps the number of memories per session", () => {
		const many = Array.from({ length: 10 }, (_, i) => `{"template":"compact-note","content":"Summary: ${i}"}`);
		const out = extractDistilledMemories(`{"memories":[${many.join(",")}]}`);
		expect(out).toHaveLength(DISTILL_MAX_MEMORIES_PER_SESSION);
	});

	it("returns [] for malformed or empty output", () => {
		expect(extractDistilledMemories("not json at all")).toEqual([]);
		expect(extractDistilledMemories("")).toEqual([]);
		expect(extractDistilledMemories('{"memories":"oops"}')).toEqual([]);
	});
});

describe("distillSession", () => {
	const okModel = async () =>
		JSON.stringify({
			memories: [
				{ template: "post-mortem", tags: ["redis", "pool"], content: "Problem: redis timeouts\nRoot Cause: tiny pool\nFix: raise pool to 50\nPrevention: load test" },
				{ template: "compact-note", tags: ["ops"], content: "Summary: monitor pool saturation" },
			],
		});

	it("files distilled memories through the shared save path", async () => {
		const cwd = tempCwd();
		const result = await distillSession({ messages: longTranscript(), cwd, complete: okModel });
		expect(result.saved).toBe(2);
		expect(result.savedIds).toHaveLength(2);

		const index = getCachedIndex(cwd);
		expect(index.memories).toHaveLength(2);
		const templates = index.memories.map((m) => m.template).sort();
		expect(templates).toEqual(["compact-note", "post-mortem"]);
	});

	it("is disabled by JEO_NO_MEMORY=1", async () => {
		process.env.JEO_NO_MEMORY = "1";
		const cwd = tempCwd();
		const result = await distillSession({ messages: longTranscript(), cwd, complete: okModel });
		expect(result.saved).toBe(0);
		expect(result.skipped).toContain("JEO_NO_MEMORY");
		expect(getCachedIndex(cwd).memories).toHaveLength(0);
	});

	it("skips a transcript that is too short to be worth distilling", async () => {
		const cwd = tempCwd();
		let called = false;
		const result = await distillSession({
			messages: [{ role: "user", content: "hi" }],
			cwd,
			complete: async () => {
				called = true;
				return "{}";
			},
		});
		expect(result.skipped).toContain("too short");
		expect(result.saved).toBe(0);
		expect(called).toBe(false);
		expect("hi".length).toBeLessThan(DISTILL_MIN_TRANSCRIPT_CHARS);
	});

	it("skips memories that duplicate an already-recorded summary", async () => {
		const cwd = tempCwd();
		const dupContent = "Summary: monitor pool saturation closely in prod";
		createAndSaveMemory({ content: dupContent, template: "compact-note" }, cwd);

		const result = await distillSession({
			messages: longTranscript(),
			cwd,
			complete: async () => JSON.stringify({ memories: [{ template: "compact-note", content: dupContent }] }),
		});

		expect(result.saved).toBe(0);
		expect(result.skipped).toContain("duplicate");
		// Only the originally-created memory remains; the duplicate was not filed.
		expect(getCachedIndex(cwd).memories).toHaveLength(1);
	});

	it("returns a skip reason instead of throwing when the model call fails", async () => {
		const cwd = tempCwd();
		const result = await distillSession({
			messages: longTranscript(),
			cwd,
			complete: async () => {
				throw new Error("provider unavailable");
			},
		});
		expect(result.saved).toBe(0);
		expect(result.skipped).toContain("model call failed");
		expect(getCachedIndex(cwd).memories).toHaveLength(0);
	});

	it("skips gracefully when the model returns no memories", async () => {
		const cwd = tempCwd();
		const result = await distillSession({
			messages: longTranscript(),
			cwd,
			complete: async () => JSON.stringify({ memories: [] }),
		});
		expect(result.saved).toBe(0);
		expect(result.skipped).toContain("no memories");
	});
});
