# Structured Harness Tools Branch Audit

## Verdict
FAIL

## Scope
This audit reviewed the current `feat/structured-harness-state-tools` branch for risks introduced by managing milestones, plans, tasks, and todos through structured tools.

## Evidence
- Baseline: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/01-baseline-verification.md`
- State/tools: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/02-state-tools-integrity.md`
- Runtime/replay/footer: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/03-runtime-replay-footer.md`
- Skill/parser: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/04-skill-contract-parser-isolation.md`
- Dogfood: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/05-dogfood-structured-tools.md`

## High-Risk Areas Checked
- reducer and selector correctness
- snapshot durability and replay event emission
- tool schema validation and error behavior
- session resume without markdown parsing
- footer live/reload source-of-truth consistency
- subagent task status updates
- parser quarantine and skill instructions
- isolated dogfood workflow

## Findings

### Finding 1: Todo reducer lacks plan_task owner test coverage
- **Severity:** Low
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/harness-state.ts:7` defines `HarnessTodoOwnerType = "milestone" | "plan" | "plan_task"`; `extensions/agentic-harness/harness-state.ts:335` and `extensions/agentic-harness/harness-state.ts:372` handle `set_todos` and `clear_todos` for the generic owner type, but `extensions/agentic-harness/tests/harness-state.test.ts:230` only exercises milestone and plan owners, and `grep "ownerType: \"plan_task\"" extensions/agentic-harness/tests/harness-state.test.ts` returned no matches.
- **Impact:** A regression in plan-task-owned todos could pass reducer tests and break task-scoped todo progress.
- **Recommendation:** Add `harness-state` reducer tests that set, update, select, and clear todos for a `plan_task` owner.

### Finding 2: Todo status updates are ambiguous across owners
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/harness-tools.ts:616` accepts `update_status` with only `todoId` and `status`; `extensions/agentic-harness/harness-state.ts:357` checks only `todo.id === command.todoId`, and `extensions/agentic-harness/harness-state.ts:364` updates every todo whose ID matches that value, regardless of `ownerType` or `ownerId`.
- **Impact:** If two milestone, plan, or plan-task owners use the same todo ID, a single `harness_todo update_status` call can update the wrong todo or multiple todos at once.
- **Recommendation:** Require owner context for `update_status` or enforce globally unique todo IDs, then add a regression test with duplicate todo IDs under different owners.

### Finding 3: Structured session restore replays malformed custom entries without validation
- **Severity:** High
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/index.ts:2020` collects every `harness-state-event` custom entry whose `data` is merely an object and passes those objects directly to `replayHarnessEvents` at `extensions/agentic-harness/index.ts:2024`. `extensions/agentic-harness/harness-events.ts:101` provides `extractHarnessReplayEventsFromSessionEntries` to ignore malformed entries, but this restore path does not use it.
- **Impact:** A malformed custom entry for the same run can throw during `session_start`, preventing controlled resume and footer reconstruction.
- **Recommendation:** Use `extractHarnessReplayEventsFromSessionEntries` for session restore and derive `structuredRunId` only from validated replay events, or catch and report replay validation errors without aborting startup.

### Finding 4: Structured footer reload can show stale snapshot state after resume
- **Severity:** High
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/index.ts:2024` reconstructs state from snapshot plus custom events, but later `extensions/agentic-harness/index.ts:2118` only calls `harnessProgress.setRunId(data.runId)`. `extensions/agentic-harness/harness-progress.ts:70` reloads only `snapshot?.state`, so replayed post-snapshot events used for `reconstructedState` are not reflected in the structured footer provider cache.
- **Impact:** After session resume, the footer can display older task or milestone progress than live execution/replay state until another structured tool write refreshes the snapshot.
- **Recommendation:** Persist the reconstructed state back to the snapshot during restore or add a provider hydrate path that seeds `HarnessProgressProvider` with the replayed state.

### Finding 5: Structured subagent status bridge falls back to the first plan on ambiguous plan path matches
- **Severity:** Medium
- **Confidence:** Medium
- **Evidence:** `extensions/agentic-harness/harness-runtime-progress.ts:18` selects a matching `planFile` but falls back to `state.plans[0]` when no supplied path matches. `extensions/agentic-harness/index.ts:1886` uses that selection before applying task status updates, so a multi-plan state with missing or mismatched subagent plan paths can update task IDs on the wrong plan.
- **Impact:** Concurrent or resumed multi-plan workflows can mark the wrong plan task as running, completed, or failed when subagent metadata is incomplete or path normalization does not match.
- **Recommendation:** Require an exact plan match when more than one structured plan exists, or carry explicit `planId` metadata through subagent lifecycle events and skip ambiguous updates.

### Finding 6: Plan-crafting template still describes markdown checkboxes as progress tracking
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/skills/agentic-plan-crafting/SKILL.md:63` says "Each step uses checkbox (`- [ ]`) syntax for progress tracking" while the same skill later says task completion should be recorded through `harness_plan` rather than editing markdown checkboxes.
- **Impact:** New plans can preserve an instruction that agents interpret as permission to mark task progress by editing rendered plan markdown.
- **Recommendation:** Change the worker-note template to say checkbox syntax is part of rendered task formatting only, and explicitly require `harness_plan define_tasks` / `harness_plan set_task_status` for canonical progress.

### Finding 7: Long-run bootstrap and recovery still use `state.md`, milestone files, and checkpoints as state inputs
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/skills/agentic-long-run/SKILL.md:17` says the state file must be updated before and after every milestone, `:40` requires a directory containing `state.md` and `milestones/*.md`, `:48-51` tells agents to read and validate `state.md` and milestone files, `:369` says all state lives in `state.md` and milestone files, and `:371` says checkpoint files are the source of truth.
- **Impact:** Long-run agents can treat rendered markdown/checkpoint artifacts as canonical resume state and bypass `harness_milestone`, `harness_plan`, and `harness_todo` snapshots/events.
- **Recommendation:** Rewrite bootstrap and recovery instructions to load canonical structured state through harness tools first, then treat `state.md`, milestone files, and checkpoint markdown as rendered/audit outputs only.

### Finding 8: Long-run recovery still resumes plan tasks from markdown checkboxes
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/skills/agentic-long-run/SKILL.md:324` instructs agents: `For executing milestones: check if tasks in the plan have checkboxes marked. Resume from the first unchecked task.`
- **Impact:** A resumed long-run can choose the next task from stale rendered checklist state instead of canonical `harness_plan` task status.
- **Recommendation:** Replace the checkbox recovery instruction with `harness_plan load` / structured task selection and state that plan markdown checkboxes are not progress state.

### Finding 9: Long-run completion and checklist still direct agents to update `state.md`
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/skills/agentic-long-run/SKILL.md:270` says `Update state.md: set overall status to completing`, `extensions/agentic-harness/skills/agentic-long-run/SKILL.md:279` says `Update state.md: set overall status to completed`, and `extensions/agentic-harness/skills/agentic-long-run/SKILL.md:408` requires `State.md updated before and after every phase transition`.
- **Impact:** Agents following these instructions can hand-edit rendered markdown state instead of persisting canonical milestone state through `harness_milestone`.
- **Recommendation:** Rewrite completion and checklist instructions to update canonical state through structured harness tools first, then render markdown as an output artifact.

### Finding 10: Runtime subagent task status bridge still derives task IDs through legacy plan progress parsing
- **Severity:** Medium
- **Confidence:** Medium
- **Evidence:** The parser usage grep recorded `extensions/agentic-harness/index.ts:40` importing `reloadPlanFromSubagentArgs`/`startPlanSubagentTasks` from `legacy-import-markdown.ts`; `extensions/agentic-harness/index.ts:1926-1930` then calls those parser-derived helpers on every subagent start before persisting `running` status to structured state.
- **Impact:** A primary runtime path can derive task IDs from plan markdown parsing and legacy `PlanProgressTracker` state before writing structured status, so stale or ambiguous markdown can drive the canonical update.
- **Recommendation:** Select plan/task IDs from structured state for subagent lifecycle updates first, and keep legacy parser-derived task matching behind an explicit no-structured-state fallback.

### Finding 11: Contract and parser isolation tests do not cover the remaining bypass instructions or broader parser usage
- **Severity:** Low
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/tests/skill-docs.test.ts:34-37` only checks that plan-crafting mentions `harness_plan` and `define_tasks`, so it passed while `agentic-plan-crafting/SKILL.md:63` still says checkboxes are for progress tracking. `extensions/agentic-harness/tests/parser-isolation.test.ts:48-56` only blocks direct `plan-progress-events` imports, while the Task 4 grep output still includes primary-runtime references to `parsePlan`, `PlanProgressTracker`, and `MilestoneTracker`.
- **Impact:** The targeted tests can pass even when skill contracts and runtime parser boundaries regress against the structured-state migration contract.
- **Recommendation:** Expand the skill-doc tests to assert absence of markdown-checkbox/state.md source-of-truth instructions, and expand parser-isolation tests to cover the same parser/progress usage boundary as the audit grep.

## Recommended Follow-Up
- Fix `extensions/agentic-harness/index.ts` structured session restore to validate replay events with `extractHarnessReplayEventsFromSessionEntries` or handle replay validation errors without aborting startup; reason: High-severity malformed replay entries can break resume; verify with `cd extensions/agentic-harness && npm exec -- vitest run tests/session-replay.test.ts`.
- Fix `extensions/agentic-harness/index.ts` / `extensions/agentic-harness/harness-progress.ts` footer hydration after replay reconstruction; reason: High-severity stale footer state can appear after resume; verify with `cd extensions/agentic-harness && npm exec -- vitest run tests/session-replay.test.ts tests/harness-progress.test.ts tests/footer.test.ts`.
- Fix `extensions/agentic-harness/harness-state.ts`, `extensions/agentic-harness/harness-tools.ts`, and related tests so todo updates are owner-scoped or todo IDs are globally unique; reason: duplicate todo IDs can update the wrong owner and plan-task owner coverage is missing; verify with `cd extensions/agentic-harness && npm exec -- vitest run tests/harness-state.test.ts tests/harness-tools.test.ts`.
- Fix `extensions/agentic-harness/harness-runtime-progress.ts` and `extensions/agentic-harness/index.ts` to avoid ambiguous first-plan fallback for subagent status updates and prefer explicit structured plan/task IDs; reason: multi-plan runs can update the wrong plan; verify with `cd extensions/agentic-harness && npm exec -- vitest run tests/harness-runtime-progress.test.ts tests/session-replay.test.ts`.
- Fix `extensions/agentic-harness/skills/agentic-plan-crafting/SKILL.md` to describe markdown checkboxes as rendering only and structured tools as canonical progress; reason: current wording permits markdown-driven progress; verify with `cd extensions/agentic-harness && npm exec -- vitest run tests/skill-docs.test.ts`.
- Fix `extensions/agentic-harness/skills/agentic-long-run/SKILL.md` bootstrap, recovery, completion, and checklist instructions to load/update canonical structured state through harness tools before rendering artifacts; reason: current instructions treat markdown/checkpoint files as state inputs; verify with `cd extensions/agentic-harness && npm exec -- vitest run tests/skill-docs.test.ts`.
- Fix `extensions/agentic-harness/index.ts` parser-derived subagent status path to use structured state first and restrict legacy parsing to explicit fallback; reason: legacy markdown parsing can drive canonical structured status; verify with `cd extensions/agentic-harness && npm exec -- vitest run tests/parser-isolation.test.ts tests/harness-runtime-progress.test.ts`.
- Expand `extensions/agentic-harness/tests/skill-docs.test.ts` and `extensions/agentic-harness/tests/parser-isolation.test.ts` to cover absence of markdown source-of-truth instructions and broader parser/progress usage boundaries; reason: current regression tests missed documented bypasses; verify with `cd extensions/agentic-harness && npm exec -- vitest run tests/skill-docs.test.ts tests/parser-isolation.test.ts`.
