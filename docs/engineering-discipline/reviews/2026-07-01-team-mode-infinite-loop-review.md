# Team Mode — Infinite Loop / Recursion Safety Review

**Date:** 2026-07-01 16:32 KST (updated same-day with a ponytail-ultra pass)
**Scope:** `jeo team` (`extensions/agentic-harness/team.ts`, `team-state.ts`,
`subagent.ts`, `index.ts`) — verify the orchestrator cannot enter an infinite
loop / unbounded recursion, and propose improvements.
**Verdict:** One real bug found and fixed (unbounded recursion in
`computeTaskDepths`). Recursive-delegation guards verified safe. The one
identified gap (worker wall-clock timeout) is now **implemented**, using
stdlib `AbortSignal.any`/`AbortSignal.timeout` rather than any hand-rolled
timer/cleanup machinery (ponytail rung 2: stdlib beats custom code).

---

## 1. What was checked

| Risk class | Where | Result |
|---|---|---|
| Worker recursively re-spawning `team`/`subagent` (leader/worker cycle) | `index.ts:691`, `index.ts:826`, `subagent.ts` depth env | **Safe** — verified |
| Cyclic task dependency graph (`blockedBy`) | `team.ts` `validateTeamTasks`, `computeTaskDepths`, `scheduleBatches` | **Bug found + fixed** |
| Unbounded retry of a stuck command | `team-state.ts` `retryTeamCommand`/`markStaleCommands` | **Safe** — verified |
| Worker-pool scheduling loop (`while(true)`) | `subagent.ts` `mapWithConcurrencyLimit` | **Safe** — verified |
| Worker hang with no wall-clock timeout | `subagent.ts` native/tmux exec paths, `team.ts` `executeTask`/`runTeamFollowUpCommand` | **Real gap — fixed** (`taskTimeoutMs`) |

## 2. Recursive delegation — verified safe

Two independent, structural guards prevent a worker from re-entering team
orchestration (not just prompt-level instructions, which an LLM could ignore):

1. **The `team` tool is never registered inside a worker process.**
   `index.ts:691`: `if (isRootSession && !isTeamWorker && isTeamModeEnabled)`.
   Workers run with `PI_TEAM_WORKER=1` (`team.ts:975`, `team.ts:663`), so the
   tool object literally does not exist in their tool list — no prompt
   compliance is required.
2. **The `subagent` tool is gated by depth, and workers are pinned to depth 1.**
   `index.ts:826`: `if (depthConfig.canDelegate && !isTeamWorker)`. Team
   workers are launched with `agent.maxSubagentDepth: 1`
   (`index.ts:787`), which `subagent.ts:588` mins against the parent's
   `maxDepth` and writes as `PI_SUBAGENT_MAX_DEPTH` for the child process; the
   child computes `canDelegate = currentDepth < maxDepth` (`subagent.ts:67`),
   which is `1 < 1 = false`. `sanitizedParentEnv()` + `extraEnv` propagation
   (`subagent.ts:590-596`) carries `PI_TEAM_WORKER` and the depth envs through
   both native spawn and the tmux launch-script allowlist
   (`buildTmuxLaunchEnv`, `subagent.ts:306-313`), so this holds for both
   backends.

Confirmed via existing green tests (`subagent.test.ts`, `extension.test.ts`,
`tmux-command.test.ts`) plus reading the guard conditions directly; no change
needed here.

## 3. Cyclic task dependency graph — bug found and fixed

`team.ts` has a DAG scheduler (`validateTeamTasks`, `computeTaskDepths`,
`scheduleBatches`, `runBatchesSequentially`) that lets `blockedBy` express task
dependencies. `validateTeamTasks` does correct DFS cycle detection
(`inStack`/`visited`) and `runTeam` always calls it before scheduling
(`team.ts:775`), so the production `runTeam` path was already safe.

However, `computeTaskDepths`'s `getDepth` helper had **no cycle guard of its
own** — it only memoized *completed* depths, not *in-progress* ones. Calling
it (or the exported `scheduleBatches`, which calls it) directly on a cyclic
graph — bypassing `validateTeamTasks` — recursed forever until the stack blew:

```
$ vitest: computeTaskDepths([a→b, b→a])
THREW: RangeError Maximum call stack size exceeded
```

reproduced before the fix. This was a real defense-in-depth gap: both
functions are exported and have no compile-time or runtime enforcement that
callers validate first — only `runTeam`'s specific call order made the
overall system safe today.

**Fix (`team.ts`):** added an `inProgress` set to `getDepth`, mirroring
`hasCycle`'s pattern, so a cycle now throws
`Circular dependency detected involving task: <id>` instead of recursing
unbounded.

**Regression test (`tests/integration-dag.test.ts`):** added
`"computeTaskDepths/scheduleBatches reject a cycle directly instead of
stack-overflowing"`, calling both functions directly (not through
`validateTeamTasks`) on a 2-node cycle and asserting a clean `/circular/i`
throw, not a stack-overflow `RangeError`.

**Ponytail note on the two DFS guards:** `hasCycle` (in `validateTeamTasks`)
and `getDepth` (in `computeTaskDepths`) are structurally near-identical
guarded-DFS traversals. That duplication *looks* like bloat, but it is
intentional defense-in-depth: `validateTeamTasks` runs first in the production
path and gives a task-scoped error, while `getDepth`'s own guard protects the
two functions as standalone, independently-callable exports (as this section
demonstrates). Collapsing them into one shared traversal would trade a
real safety property (two independent guards) for fewer lines — rejected as
an anti-pattern for this file, per Ponytail's "laziness ≠ negligence" rule.

## 4. Retry/resume loops — verified safe

`TEAM_COMMAND_MAX_ATTEMPT = 3` (`team-state.ts:10`) is enforced inside
`retryTeamCommand` (`team-state.ts:372-389`) and the `attempt` counter lives in
the persisted `TeamCommand` record, not in per-process state — so repeatedly
resuming a run with `resumeMode: "retry-stale"` cannot reset the counter and
retry forever; after 3 attempts the command is blocked permanently
(`blockTeamCommand`). `mapWithConcurrencyLimit`'s `while (true)` worker-pool
loop (`subagent.ts:153`) terminates deterministically once
`nextIndex >= items.length`.

## 5. Worker wall-clock timeout — implemented

Neither `TeamRunOptions` nor the native/tmux exec paths in `subagent.ts` had
an absolute per-task deadline. A worker only stopped when: its process
closed, it emitted `agent_end` (grace timer), the output artifact was
hydrated, or the caller's own `AbortSignal` fired. If a worker process or
tmux pane genuinely hung (crashed pane, stalled network call, human stepped
away with `-p` disabled) with none of those happening, `runtime.runTask` for
that task never resolved. This did **not** burn CPU (no spin loop — the
`setTimeout(poll, 25ms)` in tmux mode and the process event listeners in
native mode are both idle waits), but it had the same practical failure mode
the user asked about: the run makes no forward progress and never completes.

**Fix — `opts.taskTimeoutMs` (`TeamRunOptions`):**

- `team.ts`'s `createTaskExecutionSignal(baseSignal, taskTimeoutMs)` builds the
  `AbortSignal` passed into a single worker's `runtime.runTask` call: unset/`0`
  returns `baseSignal` unchanged (no behavior change); when set, it starts a
  `setTimeout` (`.unref()`'d so it can't keep the process alive) that aborts a
  fresh `AbortController` with `Error("worker exceeded taskTimeoutMs (<n>ms)")`,
  and combines that with any caller/user `AbortSignal` via the stdlib
  `AbortSignal.any([...])` — so a user abort still wins immediately if it
  fires first, and only one of the two reasons ends up on the combined
  signal's `.reason`.
- Both call sites that invoke `runtime.runTask` (`executeTask` in the main
  `runTeam` path, and `runTeamFollowUpCommand`) build this combined signal per
  task and thread it through `TeamRunTaskInput.signal`, clearing the timer in
  a `finally` block so nothing leaks.
- `index.ts`'s `runTask` callback passes `input.signal ?? signal` into
  `runAgent` instead of the raw top-level `signal`, so the timeout reaches the
  **existing** termination machinery in `subagent.ts` (`requestTermination`:
  SIGTERM then SIGKILL escalation for native, `sendPaneSignal` for tmux) with
  **zero new kill-path code** — this is the same code that already runs on a
  user abort today.
- `subagent.ts`'s abort branch now sets `result.errorMessage` from
  `signal.reason` (a `DOMException`/`Error`, both `instanceof Error`) instead
  of the fixed string `"Subagent was aborted."`, so a timed-out task surfaces
  `"worker exceeded taskTimeoutMs (<n>ms)"` specifically, distinguishable from
  a plain user abort.
- Net new production code: one ~15-line helper (`createTaskExecutionSignal`)
  plus three call-site wirings — no new timer bookkeeping, no synthetic
  `SingleResult` construction, no duplicate termination path.

**Tests added (`tests/team.test.ts`):**
- `"aborts a hung worker after taskTimeoutMs instead of leaving the run hung
  forever"` — a worker that never resolves on its own but honors the abort
  signal (mirroring `runAgent`'s real behavior) ends up `"failed"` with an
  error matching `/taskTimeoutMs/`.
- `"does not abort a worker that finishes well inside taskTimeoutMs"` — no
  false positives when the deadline is generous.
- `"lets a user abort win over a longer taskTimeoutMs without
  double-aborting"` — combining a user `AbortSignal` with a much longer
  `taskTimeoutMs` still reports the user's abort reason.
- `"bounds a hung follow-up command with taskTimeoutMs instead of hanging the
  run forever"` — same guarantee for the `commandTarget` follow-up path, not
  just the initial dispatch path.

## 6. Documentation drift fixed

`TEAM_ARCH.md` (the team-mode engineering contract) stated in 5 places that
`blockedBy` "must be empty" / is "rejected by `validateTeamTasks`" and that
"the MVP scheduler has no task dependency DAG" — this was stale; the DAG
scheduler (`scheduleBatches`, `computeTaskDepths`, `runBatchesSequentially`)
is implemented, tested (`tests/integration-dag.test.ts`), and reachable from
`runTeam`. Updated invariant #2, the `TeamTask` data-model comment, the fresh
run lifecycle diagram, and the failure-handling table to describe the actual
current behavior (validated acyclic DAG, batch-sequential scheduling,
dependency-failure propagation to `blocked`). Also documented `taskTimeoutMs`
under `TeamRunOptions`.

## 7. Verification performed

```
cd extensions/agentic-harness && npm test    # 78 files / 811 tests passed
cd extensions/agentic-harness && npm run build  # tsc --noEmit, 0 errors
git diff --check                              # clean
```

Targeted repro before the `computeTaskDepths` fix: threw
`RangeError: Maximum call stack size exceeded`; after the fix it throws
`Error: Circular dependency detected involving task: a`.

Targeted repro for `taskTimeoutMs`: a `runTask` mock that only ever resolves
via its `signal`'s `"abort"` listener (never on its own) completes the
`runTeam` call within `taskTimeoutMs` and reports `task.status === "failed"`
with an error matching `/taskTimeoutMs/`, instead of the test (and a real run)
hanging forever.

## 8. Files changed

- `extensions/agentic-harness/team.ts` — cycle guard in `computeTaskDepths`;
  `taskTimeoutMs` option, `TeamRunTaskInput.signal`, and
  `createTaskExecutionSignal` wired into both `runtime.runTask` call sites.
- `extensions/agentic-harness/subagent.ts` — abort `errorMessage` now carries
  `signal.reason` instead of a fixed string, so a timeout is distinguishable
  from a user abort.
- `extensions/agentic-harness/index.ts` — `taskTimeoutMs` tool parameter
  plumbed from the `team` tool schema through to `runTeam`; `runTask` callback
  uses `input.signal ?? signal`.
- `extensions/agentic-harness/tests/integration-dag.test.ts` — regression test
  + import of `computeTaskDepths`.
- `extensions/agentic-harness/tests/team.test.ts` — 4 new tests covering
  `taskTimeoutMs` (hang bounded, no false positive, user-abort precedence,
  follow-up-command path).
- `TEAM_ARCH.md` — invariant #2, `TeamTask` comment, lifecycle diagram,
  failure-handling table, `taskTimeoutMs` documentation.
- This review document.
