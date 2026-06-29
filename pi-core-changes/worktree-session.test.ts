import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	captureWorktreeDiff,
	createWorktreeSession,
	isWorktreeDirty,
	removeWorktree,
	WorktreeError,
} from "../src/core/worktree-session.ts";

function initTempGitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-worktree-test-repo-"));
	execSync("git init", { cwd: dir, stdio: "pipe" });
	execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "pipe" });
	execSync("git config user.name 'Test'", { cwd: dir, stdio: "pipe" });
	writeFileSync(join(dir, "README.md"), "# Hello\n", "utf8");
	execSync("git add README.md", { cwd: dir, stdio: "pipe" });
	execSync("git commit -m 'initial'", { cwd: dir, stdio: "pipe" });
	return dir;
}

describe("createWorktreeSession", () => {
	let repoDir: string;

	beforeAll(() => {
		repoDir = initTempGitRepo();
	});

	test("creates worktree and maps cwd for repo root", async () => {
		const session = await createWorktreeSession(repoDir);
		expect(session.gitRoot).toBe(repoDir);
		expect(session.originalCwd).toBe(repoDir);
		expect(session.relativeCwd).toBe("");
		expect(session.mappedCwd).toBe(session.worktreePath);
		expect(session.worktreePath.startsWith(tmpdir())).toBe(true);

		// Cleanup
		await removeWorktree(session.worktreePath, true, session.gitRoot);
	});

	test("creates worktree and maps cwd for subdirectory", async () => {
		const subdir = join(repoDir, "src", "components");
		mkdirSync(subdir, { recursive: true });
		const session = await createWorktreeSession(subdir);
		expect(session.gitRoot).toBe(repoDir);
		expect(session.originalCwd).toBe(subdir);
		expect(session.relativeCwd).toBe(join("src", "components"));
		expect(session.mappedCwd).toBe(join(session.worktreePath, "src", "components"));

		// Cleanup
		await removeWorktree(session.worktreePath, true, session.gitRoot);
	});

	test("throws for non-git cwd", async () => {
		const nonGitDir = mkdtempSync(join(tmpdir(), "pi-worktree-test-nogit-"));
		await expect(createWorktreeSession(nonGitDir)).rejects.toThrow(WorktreeError);
	});

	test("removes worktree paths containing spaces", async () => {
		const parentDir = mkdtempSync(join(tmpdir(), "pi-worktree parent-"));
		const worktreePath = join(parentDir, "tree with spaces");
		execFileSync("git", ["worktree", "add", "--detach", worktreePath], { cwd: repoDir, stdio: "pipe" });

		await removeWorktree(worktreePath, true, repoDir);

		expect(existsSync(worktreePath)).toBe(false);
		rmSync(parentDir, { recursive: true, force: true });
	});
});

describe("isWorktreeDirty", () => {
	let repoDir: string;
	let session: Awaited<ReturnType<typeof createWorktreeSession>>;

	beforeAll(async () => {
		repoDir = initTempGitRepo();
		session = await createWorktreeSession(repoDir);
	});

	afterAll(async () => {
		await removeWorktree(session.worktreePath, true, session.gitRoot);
	});

	test("returns false for clean worktree", async () => {
		const dirty = await isWorktreeDirty(session.worktreePath);
		expect(dirty).toBe(false);
	});

	test("returns true for unstaged changes", async () => {
		writeFileSync(join(session.worktreePath, "new-file.txt"), "hello", "utf8");
		const dirty = await isWorktreeDirty(session.worktreePath);
		expect(dirty).toBe(true);
	});

	test("returns true for staged changes", async () => {
		writeFileSync(join(session.worktreePath, "staged.txt"), "staged content", "utf8");
		execSync("git add staged.txt", { cwd: session.worktreePath, stdio: "pipe" });
		const dirty = await isWorktreeDirty(session.worktreePath);
		expect(dirty).toBe(true);
	});

	test("returns true for untracked files", async () => {
		writeFileSync(join(session.worktreePath, "untracked.txt"), "untracked content", "utf8");
		const dirty = await isWorktreeDirty(session.worktreePath);
		expect(dirty).toBe(true);
	});
});

describe("captureWorktreeDiff", () => {
	let repoDir: string;
	let session: Awaited<ReturnType<typeof createWorktreeSession>>;

	beforeAll(async () => {
		repoDir = initTempGitRepo();
		session = await createWorktreeSession(repoDir);
	});

	afterAll(async () => {
		await removeWorktree(session.worktreePath, true, session.gitRoot);
	});

	test("writes diff artifact for dirty worktree", async () => {
		writeFileSync(join(session.worktreePath, "dirty.txt"), "dirty content", "utf8");
		const artifactPath = join(tmpdir(), `pi-worktree-diff-${Date.now()}.md`);
		await captureWorktreeDiff(session.worktreePath, artifactPath);
		expect(require("node:fs").readFileSync(artifactPath, "utf8")).toContain("dirty.txt");
	});
});
