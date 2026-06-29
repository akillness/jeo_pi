# Worktree Session Implementation Plan

## Overview
Implement first-class `pi --worktree` support in pi core, including `/exit` alias and cleanup prompting on all normal exits.

## Target Repository
`C:/Users/tmdgu/.pi/agent/git/github.com/earendil-works/pi` (external pi core checkout)

## Affected Files

### 1. `packages/coding-agent/src/cli/args.ts`
**Change**: Add `--worktree` boolean flag parsing.

- Add `worktree?: boolean` to `Args` interface.
- In `parseArgs()`, handle `--worktree` before the unknown flags fallback (so it becomes a known core flag).
- Add `--worktree` description in `printHelp()`.

### 2. `packages/coding-agent/src/core/worktree-session.ts` (NEW)
**Purpose**: Core worktree lifecycle helper, independent of roach-pi extension.

```typescript
export interface WorktreeSession {
  gitRoot: string;
  worktreePath: string;
  originalCwd: string;
  relativeCwd: string;
  mappedCwd: string;
}

export async function createWorktreeSession(originalCwd: string): Promise<WorktreeSession>
export async function isWorktreeDirty(worktreePath: string): Promise<boolean>
export async function captureWorktreeDiff(worktreePath: string, artifactPath: string): Promise<void>
export async function removeWorktree(worktreePath: string, force: boolean): Promise<void>
```

Implementation details:
- Use `git rev-parse --show-toplevel` to find git root.
- Compute `relativeCwd = path.relative(gitRoot, originalCwd)`.
- Create temp worktree: `git worktree add --detach <tmp> HEAD`.
- Compute `mappedCwd = path.join(worktreePath, relativeCwd)`.
- Ensure `mappedCwd` exists (mkdir -p if needed).
- Dirty detection: `git status --porcelain=v1 -uall --ignored=no` non-empty.
- Diff capture: save `status`, `diff --stat`, `diff`, `diff --cached` to artifact file.
- Cleanup: `git worktree remove --force`.

### 3. `packages/coding-agent/src/core/session-manager.ts`
**Change**: Add optional worktree metadata to `SessionHeader`.

```typescript
export interface SessionHeader {
  // ... existing fields
  worktree?: {
    ownedBy: "pi";
    originalCwd: string;
    gitRoot: string;
    worktreePath: string;
    relativeCwd: string;
    createdAt: string;
  };
}
```

- `SessionManager.create()` and `SessionManager.open()` must preserve unknown header fields for backward compatibility.
- Already the case (header is read as JSON), but verify with tests.

### 4. `packages/coding-agent/src/main.ts`
**Change**: Integrate worktree creation before session manager initialization.

In `main()`:
- After `parseArgs()` and validation, check `parsed.worktree`.
- If true:
  1. Verify `cwd = process.cwd()` is inside a git repo (`git rev-parse --show-toplevel`).
  2. If not git or bare repo, emit diagnostic error and exit.
  3. Call `createWorktreeSession(cwd)`.
  4. Replace effective cwd with `mappedCwd` for `createSessionManager()`.
  5. Pass worktree metadata to `SessionManager.create()` for header storage.
- If `--worktree` combined with `--fork`, `--session`, `--resume`, or `--continue`, emit error (non-goals for v1).

### 5. `packages/coding-agent/src/core/slash-commands.ts`
**Change**: Add `/exit` alias.

```typescript
{ name: "exit", description: `Quit ${APP_NAME} (alias for /quit)` },
```

### 6. `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
**Change**: Handle `/exit` alias and add pre-shutdown cleanup prompt.

- In the slash command handler (around line 2610), add `text === "/exit"` alongside `text === "/quit"`.
- In `shutdown()` (before the normal interactive quit path):
  1. Check if `sessionManager` header contains `worktree?.ownedBy === "pi"`.
  2. If yes, call `isWorktreeDirty(worktreePath)`.
  3. If dirty, show prompt: "Worktree has uncommitted changes. Keep worktree? [Y/n]" (default keep).
  4. If clean, show prompt: "Remove temporary worktree? [y/N]" (default keep).
  5. If user chooses remove, call `removeWorktree(worktreePath, false)`.
  6. If user chooses keep, print worktree path for reference.
  7. Update session header `worktree.cleanupStatus` if field exists.
- For double Ctrl+C (emergency): skip prompt, keep worktree (do not auto-remove).
- The prompt must use the existing TUI selector component or a simple readline confirm, occurring BEFORE `this.stop()` is called.

### 7. `packages/coding-agent/src/core/agent-session-runtime.ts`
**Change**: Minimal — cleanup logic lives in interactive-mode.ts; no runtime changes needed for v1 unless we want to add worktree metadata to `SessionShutdownEvent`. Not required for v1.

## Test Plan

### Unit Tests
1. **`test/args.test.ts`**
   - `--worktree` sets `worktree: true`.
   - `--worktree` appears in help output.
   - Conflicts: `--worktree` + `--resume`, `--continue`, `--fork`, `--session` emit errors.

2. **`test/slash-commands.test.ts`** (or add to existing)
   - `/exit` is present in `BUILTIN_SLASH_COMMANDS`.

3. **`test/session-manager/file-operations.test.ts`**
   - Session with `worktree` metadata in header round-trips correctly.
   - Old sessions without `worktree` field still load.

4. **`test/suite/agent-session-runtime.test.ts`**
   - No changes needed for v1 (runtime itself unaffected).

### Integration Tests
5. **`test/worktree-session.test.ts`** (NEW)
   - Create temp git repo with a file.
   - `createWorktreeSession()` creates detached worktree and correct `mappedCwd`.
   - Dirty detection: staged, unstaged, untracked all report dirty.
   - Clean detection: returns false.
   - `removeWorktree()` removes the worktree directory.
   - Non-git cwd throws clear error.

## Exit Path Behavior Matrix

| Exit Path | Worktree Owned? | Dirty? | Behavior |
|-----------|----------------|--------|----------|
| `/quit` | Yes | Clean | Prompt: remove? default keep |
| `/quit` | Yes | Dirty | Prompt: keep? default keep |
| `/exit` | Yes | Clean | Same as `/quit` |
| `/exit` | Yes | Dirty | Same as `/quit` |
| Ctrl+D | Yes | Clean | Same as `/quit` |
| Ctrl+D | Yes | Dirty | Same as `/quit` |
| Double Ctrl+C | Yes | Any | Skip prompt, keep worktree |
| SIGTERM/SIGHUP | Yes | Any | Skip prompt, emit session_shutdown, keep worktree |

## Constraints
- Implement only in pi core, not roach-pi.
- No named worktrees, no resume recovery, no orphan cleanup.
- Dirty default = preserve.
- Prompt must happen before TUI shutdown.

## Subgoal Mapping

| Subgoal | Files | Key Deliverable |
|---------|-------|-----------------|
| subgoal-2 | `args.ts`, `worktree-session.ts` | `--worktree` flag + helper |
| subgoal-3 | `main.ts`, `session-manager.ts` | Cwd remapping + metadata |
| subgoal-4 | `slash-commands.ts`, `interactive-mode.ts` | `/exit` alias + cleanup prompt |
| subgoal-5 | `test/*.test.ts` | Tests + verification |
