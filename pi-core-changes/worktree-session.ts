/**
 * Worktree session lifecycle helper.
 *
 * Creates and manages temporary git worktrees for pi sessions started with
 * `--worktree`. This module is independent of the roach-pi extension worktree
 * helper and operates at the pi core session level.
 */

import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

export interface WorktreeSession {
	/** Absolute path to the original git repository root. */
	gitRoot: string;
	/** Absolute path to the created worktree directory. */
	worktreePath: string;
	/** Absolute path to the original cwd when pi was invoked. */
	originalCwd: string;
	/** Relative path from gitRoot to originalCwd. */
	relativeCwd: string;
	/** Absolute path to the equivalent cwd inside the worktree. */
	mappedCwd: string;
}

export class WorktreeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorktreeError";
	}
}

/**
 * Create a temporary detached git worktree from HEAD and return the mapped
 * session cwd inside it.
 *
 * @param originalCwd The cwd where `pi --worktree` was invoked.
 * @returns WorktreeSession with paths for remapping cwd.
 * @throws WorktreeError if cwd is not inside a git repo, repo is bare, or
 *         git worktree add fails.
 */
export async function createWorktreeSession(originalCwd: string): Promise<WorktreeSession> {
	const gitRoot = resolveGitRoot(originalCwd);
	if (!gitRoot) {
		throw new WorktreeError(`Not a git repository: ${originalCwd}`);
	}

	const isBare = checkBareRepo(gitRoot);
	if (isBare) {
		throw new WorktreeError(`Bare repositories are not supported for --worktree: ${gitRoot}`);
	}

	const normalizedOriginalCwd = resolve(originalCwd);
	const relativeCwd = relative(gitRoot, normalizedOriginalCwd);
	const worktreePath = mkdtempSync(join(tmpdir(), "pi-session-worktree-"));

	try {
		execFileSync("git", ["worktree", "add", "--detach", worktreePath], { cwd: gitRoot, stdio: "pipe" });
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		throw new WorktreeError(`Failed to create git worktree: ${message}`);
	}

	const mappedCwd = resolve(worktreePath, relativeCwd);
	if (mappedCwd !== worktreePath) {
		try {
			mkdirSync(mappedCwd, { recursive: true });
		} catch {
			// Best-effort; git worktree add already creates the root.
		}
	}

	return {
		gitRoot,
		worktreePath,
		originalCwd: normalizedOriginalCwd,
		relativeCwd,
		mappedCwd,
	};
}

/**
 * Check whether the worktree has any uncommitted changes (staged, unstaged,
 * or untracked).
 */
export async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
	try {
		const output = execSync("git status --porcelain=v1 -uall --ignored=no", {
			cwd: worktreePath,
			encoding: "utf8",
			stdio: "pipe",
		});
		return output.trim().length > 0;
	} catch {
		return false;
	}
}

/**
 * Capture worktree diff/status artifact before cleanup.
 *
 * @param worktreePath Path to the worktree.
 * @param artifactPath Path to write the diff markdown file.
 */
export async function captureWorktreeDiff(worktreePath: string, artifactPath: string): Promise<void> {
	const sections: string[] = [];

	try {
		const status = execSync("git status --short", { cwd: worktreePath, encoding: "utf8", stdio: "pipe" });
		if (status.trim()) {
			sections.push("## Status\n\n```\n" + status + "\n```\n");
		}
	} catch {
		sections.push("## Status\n\n(failed to capture)\n");
	}

	try {
		const diffStat = execSync("git diff --stat", { cwd: worktreePath, encoding: "utf8", stdio: "pipe" });
		if (diffStat.trim()) {
			sections.push("## Unstaged diff stat\n\n```\n" + diffStat + "\n```\n");
		}
	} catch {
		// no diff
	}

	try {
		const diff = execSync("git diff --no-ext-diff", { cwd: worktreePath, encoding: "utf8", stdio: "pipe" });
		if (diff.trim()) {
			sections.push("## Unstaged diff\n\n```diff\n" + diff + "\n```\n");
		}
	} catch {
		// no diff
	}

	try {
		const staged = execSync("git diff --cached --no-ext-diff", {
			cwd: worktreePath,
			encoding: "utf8",
			stdio: "pipe",
		});
		if (staged.trim()) {
			sections.push("## Staged diff\n\n```diff\n" + staged + "\n```\n");
		}
	} catch {
		// no staged diff
	}

	const content = sections.length > 0 ? sections.join("\n") : "## Status\n\n(clean)\n";
	writeFileSync(artifactPath, content, "utf8");
}

/**
 * Remove a git worktree.
 *
 * @param worktreePath Path to the worktree directory.
 * @param force If true, uses `--force` to remove even if dirty.
 * @param gitRoot Optional git repository root to run removal from.
 */
export async function removeWorktree(worktreePath: string, force: boolean, gitRoot?: string): Promise<void> {
	const args = force ? ["worktree", "remove", "--force", worktreePath] : ["worktree", "remove", worktreePath];
	try {
		execFileSync("git", args, { cwd: gitRoot, stdio: "pipe" });
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		throw new WorktreeError(`Failed to remove worktree: ${message}`);
	}
}

function resolveGitRoot(cwd: string): string | undefined {
	try {
		const root = execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf8", stdio: "pipe" }).trim();
		return root ? resolve(root) : undefined;
	} catch {
		return undefined;
	}
}

function checkBareRepo(gitRoot: string): boolean {
	try {
		const result = execSync("git rev-parse --is-bare-repository", {
			cwd: gitRoot,
			encoding: "utf8",
			stdio: "pipe",
		}).trim();
		return result === "true";
	} catch {
		return false;
	}
}
