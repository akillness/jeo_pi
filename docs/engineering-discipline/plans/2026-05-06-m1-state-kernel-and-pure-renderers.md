# M1 State Kernel and Pure Renderers Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking. Do not create git commits for this plan.

**Goal:** Establish the canonical structured harness state model, reducer, selectors, invariants, and pure markdown renderers without changing runtime behavior.

**Architecture:** Add pure TypeScript modules under `extensions/agentic-harness`: `harness-state.ts` owns schema, reducer, transition validation, and selectors; `harness-render.ts` renders human-readable markdown from structured state only. Runtime wiring, storage, tools, footer cutover, and parser removal are explicitly deferred to later milestones.

**Tech Stack:** TypeScript, Vitest, existing ESM module style, existing `extensions/agentic-harness` test/build scripts.

**Work Scope:**
- **In scope:** canonical state types, reducer actions, selector summaries, pure markdown rendering, reducer/render tests.
- **Out of scope:** registering tools, persisting `state.json`, session replay, footer integration, runtime parser removal, skill documentation changes.

**Verification Strategy:**
- **Level:** test-suite + build
- **Command:** `cd extensions/agentic-harness && npm run build && npm test`
- **What it validates:** TypeScript correctness and full agentic-harness regression coverage including new state/render tests.

---

## File Structure Mapping

- Create `extensions/agentic-harness/harness-state.ts`
  - Export schema/version constants, entity/status types, reducer command types, reducer function, state factory, selectors, and validation helpers.
- Create `extensions/agentic-harness/harness-render.ts`
  - Export pure render functions for long-run state markdown, plan markdown, and todo markdown generated from `HarnessState`.
- Create `extensions/agentic-harness/tests/harness-state.test.ts`
  - Cover state initialization, milestone/plan/todo reducer actions, transition validation, idempotence, and selectors.
- Create `extensions/agentic-harness/tests/harness-render.test.ts`
  - Cover deterministic markdown output for state, plan, and todo renderers.

---

### Task 1: Add canonical harness state model and reducer

**Dependencies:** None
**Files:**
- Create: `extensions/agentic-harness/harness-state.ts`
- Create: `extensions/agentic-harness/tests/harness-state.test.ts`

- [ ] **Step 1: Create state model types**

Create `extensions/agentic-harness/harness-state.ts` with exported types and constants:

- `HARNESS_STATE_SCHEMA_VERSION = 1`
- `HarnessMilestoneStatus = "pending" | "planning" | "executing" | "validating" | "completed" | "failed" | "skipped"`
- `HarnessPlanTaskStatus = "pending" | "running" | "completed" | "failed" | "skipped"`
- `HarnessTodoStatus = "pending" | "completed"`
- `HarnessMilestone` with `id`, `name`, `status`, `dependencies`, `attempts`, optional `planFile`, `reviewFile`, `createdAt`, `updatedAt`
- `HarnessPlanTask` with numeric `id`, `name`, `status`, `dependencies`, `files`, `testCommands`, `acceptanceCriteria`, optional `startedAt`, `completedAt`
- `HarnessPlan` with `id`, `milestoneId`, `title`, optional `planFile`, `goal`, `tasks`, `createdAt`, `updatedAt`
- `HarnessTodo` with `id`, `ownerType: "milestone" | "plan" | "plan_task"`, `ownerId`, `text`, `status`, `createdAt`, `updatedAt`
- `HarnessState` with `schemaVersion`, `runId`, `title`, `status`, `milestones`, `plans`, `todos`, `eventSeq`, `createdAt`, `updatedAt`

- [ ] **Step 2: Add state factory and reducer command union**

In `harness-state.ts`, implement:

- `createHarnessState(input: { runId: string; title: string; now?: string }): HarnessState`
- `HarnessCommand` union covering:
  - `upsert_milestone`
  - `set_milestone_status`
  - `attach_plan`
  - `define_plan_tasks`
  - `set_plan_task_status`
  - `set_todos`
  - `set_todo_status`
  - `clear_todos`
- `HarnessReducerResult = { state: HarnessState; event: HarnessStateEvent }`
- `HarnessStateEvent` with `seq`, `type`, `at`, and `command`

- [ ] **Step 3: Implement reducer behavior**

Implement `applyHarnessCommand(state, command, options?: { now?: string }): HarnessReducerResult` so it:

- Returns a new state object without mutating the input.
- Increments `eventSeq` by 1.
- Sets `updatedAt` to `options.now` or current ISO timestamp.
- Upserts milestones idempotently by `id` while preserving existing status/attempts unless provided.
- Sets milestone status only for existing milestones, otherwise throws a clear `Error` containing the missing milestone id.
- Attaches/upserts plans by `id` and milestone id.
- Replaces plan tasks for `define_plan_tasks` while preserving matching task statuses by `id` when possible.
- Sets plan task status only for an existing plan/task, otherwise throws a clear `Error` containing the missing plan/task id.
- Replaces todos for an owner on `set_todos`.
- Updates todo status only for existing todos, otherwise throws a clear `Error` containing the missing todo id.
- Clears todos by owner.

- [ ] **Step 4: Add reducer tests**

Create `extensions/agentic-harness/tests/harness-state.test.ts` covering:

- `createHarnessState` initializes schema version, run id, title, empty arrays, `eventSeq: 0`.
- `upsert_milestone` adds a milestone and increments `eventSeq`.
- repeated `upsert_milestone` updates name/dependencies without duplicating.
- `set_milestone_status` updates existing milestone and throws for missing milestone.
- `attach_plan` and `define_plan_tasks` create a plan with tasks.
- redefining tasks preserves matching task status.
- `set_plan_task_status` updates an existing task and throws for missing plan/task.
- `set_todos`, `set_todo_status`, and `clear_todos` work by owner.
- reducer does not mutate the original state object.

Run: `cd extensions/agentic-harness && mkdir -p node_modules/.tmp && TMPDIR=$PWD/node_modules/.tmp npm exec -- vitest run tests/harness-state.test.ts`
Expected: PASS.

---

### Task 2: Add selectors for footer/tool summaries

**Dependencies:** Task 1
**Files:**
- Modify: `extensions/agentic-harness/harness-state.ts`
- Modify: `extensions/agentic-harness/tests/harness-state.test.ts`

- [ ] **Step 1: Implement selectors**

In `harness-state.ts`, export selectors:

- `selectMilestoneSummary(state)` returning `{ total, completed, failed, executing, pending, items }` where `items` are milestones sorted by natural `M<number>` order when possible.
- `selectPlanSummary(state, planId?: string)` returning summaries for the selected plan or first active plan. Include `total`, `completed`, `failed`, `running`, `pending`, `plan`, and task `items`.
- `selectTodosForOwner(state, ownerType, ownerId)` returning todos sorted by insertion order.
- `selectActiveMilestone(state)` returning the first milestone in `planning`, `executing`, or `validating`, sorted by milestone order.
- `selectActivePlan(state)` returning the first plan whose milestone is active, otherwise first plan with a running task, otherwise first plan.

- [ ] **Step 2: Add selector tests**

Extend `harness-state.test.ts` to cover:

- milestone natural sorting (`M1`, `M2`, `M10`).
- milestone summary counts.
- active milestone selection.
- active plan selection by active milestone and running task fallback.
- plan task summary counts.
- todo owner filtering.

Run: `cd extensions/agentic-harness && mkdir -p node_modules/.tmp && TMPDIR=$PWD/node_modules/.tmp npm exec -- vitest run tests/harness-state.test.ts`
Expected: PASS.

---

### Task 3: Add pure markdown renderers

**Dependencies:** Task 1, Task 2
**Files:**
- Create: `extensions/agentic-harness/harness-render.ts`
- Create: `extensions/agentic-harness/tests/harness-render.test.ts`

- [ ] **Step 1: Implement renderer functions**

Create `extensions/agentic-harness/harness-render.ts` exporting:

- `renderHarnessStateMarkdown(state: HarnessState): string`
  - Includes title, run id, schema version, status, timestamps, milestone table, and generated execution metadata from structured state only.
- `renderHarnessPlanMarkdown(state: HarnessState, planId: string): string`
  - Includes plan title, milestone id, goal, task sections with dependencies, files, test commands, acceptance criteria, and task statuses.
  - Throws a clear error when plan id is missing.
- `renderHarnessTodoMarkdown(state: HarnessState, ownerType: HarnessTodo["ownerType"], ownerId: string): string`
  - Includes owner heading and checkbox list generated from todo status.

Renderer output must be deterministic and end with a single trailing newline.

- [ ] **Step 2: Add renderer tests**

Create `extensions/agentic-harness/tests/harness-render.test.ts` covering:

- `renderHarnessStateMarkdown` includes milestone table rows and status values.
- `renderHarnessPlanMarkdown` includes task sections, files, test commands, acceptance criteria, and task status.
- `renderHarnessPlanMarkdown` throws for unknown plan id.
- `renderHarnessTodoMarkdown` renders `[ ]` for pending and `[x]` for completed.
- renderers do not import or call markdown parsers.

Run: `cd extensions/agentic-harness && mkdir -p node_modules/.tmp && TMPDIR=$PWD/node_modules/.tmp npm exec -- vitest run tests/harness-render.test.ts`
Expected: PASS.

---

### Task 4 (Final): M1 verification

**Dependencies:** Task 1, Task 2, Task 3
**Files:**
- Test: `extensions/agentic-harness/harness-state.ts`
- Test: `extensions/agentic-harness/harness-render.ts`
- Test: `extensions/agentic-harness/tests/harness-state.test.ts`
- Test: `extensions/agentic-harness/tests/harness-render.test.ts`

- [ ] **Step 1: Run targeted tests**

Run: `cd extensions/agentic-harness && mkdir -p node_modules/.tmp && TMPDIR=$PWD/node_modules/.tmp npm exec -- vitest run tests/harness-state.test.ts tests/harness-render.test.ts`
Expected: PASS.

- [ ] **Step 2: Run full verification**

Run: `cd extensions/agentic-harness && npm run build && npm test`
Expected: PASS.

- [ ] **Step 3: Confirm scope isolation**

Verify no runtime files were modified for M1 except allowed test/build-adjacent files if absolutely necessary. Expected files changed for M1 are only:

- `extensions/agentic-harness/harness-state.ts`
- `extensions/agentic-harness/harness-render.ts`
- `extensions/agentic-harness/tests/harness-state.test.ts`
- `extensions/agentic-harness/tests/harness-render.test.ts`
- `extensions/agentic-harness/package.json` (test script temp-directory hardening for sandboxed subagents)

Expected: no runtime wiring, storage, tool registration, footer, skill, or parser-path changes in this milestone.
