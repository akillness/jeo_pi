import { describe, expect, it } from "vitest";
import {
	detectStall,
	extractTask,
	MAX_FAILURES,
	MAX_REPEAT,
	CYCLE_WINDOW,
	type StallMessage,
} from "../stall.js";

// ── Transcript builders mirroring pi's UserMessage/AssistantMessage/ToolResultMessage ──
let idSeq = 0;
function call(name: string, args: Record<string, unknown> = {}): { id: string; name: string; args: Record<string, unknown> } {
	return { id: `tc-${++idSeq}`, name, args };
}
function step(...calls: { id: string; name: string; args: Record<string, unknown> }[]): StallMessage[] {
	const assistant: StallMessage = {
		role: "assistant",
		content: calls.map((c) => ({ type: "toolCall", id: c.id, name: c.name, arguments: c.args })),
	};
	const results: StallMessage[] = calls.map((c) => ({
		role: "toolResult",
		toolCallId: c.id,
		toolName: c.name,
		isError: false,
	}));
	return [assistant, ...results];
}
function stepWith(
	calls: { id: string; name: string; args: Record<string, unknown> }[],
	errors: boolean[]
): StallMessage[] {
	const assistant: StallMessage = {
		role: "assistant",
		content: calls.map((c) => ({ type: "toolCall", id: c.id, name: c.name, arguments: c.args })),
	};
	const results: StallMessage[] = calls.map((c, i) => ({
		role: "toolResult",
		toolCallId: c.id,
		toolName: c.name,
		isError: errors[i] === true,
	}));
	return [assistant, ...results];
}
function user(text: string): StallMessage {
	return { role: "user", content: text };
}

describe("detectStall — consecutive_failure", () => {
	it("classifies MAX_FAILURES consecutive failing non-trivial steps", () => {
		const msgs: StallMessage[] = [user("refactor the parser")];
		for (let i = 0; i < MAX_FAILURES; i++) {
			const c = call("edit", { file: "a.ts", n: i });
			msgs.push(...stepWith([c], [true]));
		}
		const stall = detectStall(msgs);
		expect(stall?.stopClass).toBe("consecutive_failure");
		expect(stall?.steps).toBe(MAX_FAILURES);
		expect(stall?.task).toBe("refactor the parser");
	});

	it("does not fire below the failure threshold", () => {
		const msgs: StallMessage[] = [user("do work")];
		for (let i = 0; i < MAX_FAILURES - 1; i++) {
			msgs.push(...stepWith([call("edit", { n: i })], [true]));
		}
		expect(detectStall(msgs)).toBeNull();
	});

	it("a failing edit is not masked by a passing readonly read in the same step", () => {
		const msgs: StallMessage[] = [user("fix it")];
		for (let i = 0; i < MAX_FAILURES; i++) {
			// edit fails, read succeeds — step must still count as failed
			msgs.push(...stepWith([call("edit", { n: i }), call("read", { n: i })], [true, false]));
		}
		expect(detectStall(msgs)?.stopClass).toBe("consecutive_failure");
	});

	it("a readonly-only failing streak still counts as consecutive_failure", () => {
		const msgs: StallMessage[] = [user("look around")];
		for (let i = 0; i < MAX_FAILURES; i++) {
			msgs.push(...stepWith([call("search", { q: i })], [true]));
		}
		expect(detectStall(msgs)?.stopClass).toBe("consecutive_failure");
	});
});

describe("detectStall — repeat", () => {
	it("classifies MAX_REPEAT identical consecutive (succeeding) steps", () => {
		const msgs: StallMessage[] = [user("run the build")];
		for (let i = 0; i < MAX_REPEAT; i++) {
			// identical signature every step (same tool + same args)
			msgs.push({
				role: "assistant",
				content: [{ type: "toolCall", id: `r-${i}`, name: "bash", arguments: { command: "npm run build" } }],
			});
			msgs.push({ role: "toolResult", toolCallId: `r-${i}`, toolName: "bash", isError: false });
		}
		const stall = detectStall(msgs);
		expect(stall?.stopClass).toBe("repeat");
	});

	it("distinct successful steps do not trip repeat", () => {
		const msgs: StallMessage[] = [user("build stuff")];
		for (let i = 0; i < MAX_REPEAT + 1; i++) {
			msgs.push(...step(call("bash", { command: `echo ${i}` })));
		}
		expect(detectStall(msgs)).toBeNull();
	});
});

describe("detectStall — cycle", () => {
	it("classifies an A↔B ping-pong window as a cycle", () => {
		const msgs: StallMessage[] = [user("investigate the bug")];
		const a = { name: "read", args: { file: "a.ts" } };
		const b = { name: "bash", args: { command: "npm test" } };
		for (let i = 0; i < CYCLE_WINDOW; i++) {
			const spec = i % 2 === 0 ? a : b;
			const id = `c-${i}`;
			msgs.push({
				role: "assistant",
				content: [{ type: "toolCall", id, name: spec.name, arguments: spec.args }],
			});
			msgs.push({ role: "toolResult", toolCallId: id, toolName: spec.name, isError: false });
		}
		expect(detectStall(msgs)?.stopClass).toBe("cycle");
	});

	it("three-distinct-call rotation is not a cycle", () => {
		const msgs: StallMessage[] = [user("explore")];
		const names = ["read", "search", "ls"];
		for (let i = 0; i < CYCLE_WINDOW; i++) {
			msgs.push(...step(call(names[i % 3], { i })));
		}
		expect(detectStall(msgs)).toBeNull();
	});
});

describe("detectStall — negatives and scoping", () => {
	it("returns null for a healthy turn that ends in done", () => {
		const msgs: StallMessage[] = [
			user("add a feature"),
			...step(call("read", { file: "x.ts" })),
			...step(call("edit", { file: "x.ts" })),
			...step(call("bash", { command: "npm test" })),
			{ role: "assistant", content: [{ type: "toolCall", id: "d1", name: "done", arguments: { reason: "shipped" } }] },
		];
		expect(detectStall(msgs)).toBeNull();
	});

	it("returns null when there are no tool steps", () => {
		expect(detectStall([user("hi"), { role: "assistant", content: [{ type: "text", text: "hello" }] }])).toBeNull();
	});

	it("only inspects the current turn (after the last user prompt)", () => {
		const msgs: StallMessage[] = [user("old task")];
		// A resolved stall in a PRIOR turn:
		for (let i = 0; i < MAX_FAILURES; i++) {
			msgs.push(...stepWith([call("edit", { n: i })], [true]));
		}
		// New turn: healthy work.
		msgs.push(user("new healthy task"));
		msgs.push(...step(call("read", { file: "y.ts" })));
		msgs.push(...step(call("edit", { file: "y.ts" })));
		expect(detectStall(msgs)).toBeNull();
	});

	it("attributes the stall to the current turn's task", () => {
		const msgs: StallMessage[] = [user("first"), ...step(call("read", {})), user("port the OKF memory logic")];
		for (let i = 0; i < MAX_FAILURES; i++) {
			msgs.push(...stepWith([call("edit", { n: i })], [true]));
		}
		expect(detectStall(msgs)?.task).toBe("port the OKF memory logic");
	});
});

describe("extractTask", () => {
	it("returns the last non-empty user prompt, whitespace-collapsed", () => {
		expect(extractTask([user("a"), user("  hello   world  ")])).toBe("hello world");
	});
	it("returns empty string when no user message exists", () => {
		expect(extractTask([{ role: "assistant", content: [] }])).toBe("");
	});
});
