import { describe, expect, test } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";

describe("BUILTIN_SLASH_COMMANDS", () => {
	test("includes /quit command", () => {
		const quit = BUILTIN_SLASH_COMMANDS.find((cmd) => cmd.name === "quit");
		expect(quit).toBeDefined();
	});

	test("includes /exit alias", () => {
		const exit = BUILTIN_SLASH_COMMANDS.find((cmd) => cmd.name === "exit");
		expect(exit).toBeDefined();
		expect(exit?.description.toLowerCase()).toContain("alias");
	});
});
