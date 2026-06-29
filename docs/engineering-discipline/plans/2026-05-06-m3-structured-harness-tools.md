# Plan: M3 — Structured Harness Tools

## Context

M1 delivered the canonical state kernel (`harness-state.ts`) and pure markdown renderers (`harness-render.ts`). M2 delivered durable JSON snapshot storage (`harness-storage.ts`) and session event replay (`harness-events.ts`).

M3 exposes three agent-facing tools — `harness_milestone`, `harness_plan`, `harness_todo` — that read/write structured state through the reducer, persist snapshots atomically, append replay events to the session, and return structured summaries plus optional rendered markdown.

## Success Criteria

- [ ] `harness_milestone`, `harness_plan`, `harness_todo` are registered as pi tools.
- [ ] Each tool supports small validated action sets (create/load/update/render).
- [ ] Tool calls dispatch reducer events, persist snapshots, append replay events, and return structured summaries.
- [ ] Render commands generate markdown from structured state only.
- [ ] `index.ts` only performs thin registration/wiring; tool logic lives in `harness-tools.ts`.
- [ ] Tool schemas use strict enums and agent-readable validation errors.
- [ ] Tests cover tool registration, schema shape, successful executes, invalid input, persistence calls, and render outputs.
- [ ] `cd extensions/agentic-harness && npm run build && npm test` passes.

## Out of Scope

- Skill/prompt contract updates (M4).
- Footer/progress cutover (M5).
- Runtime replay cutover and parser quarantine (M6).
- Legacy cleanup (M7).

## Tasks

### Task 1: Create `harness-tools.ts` — core tool logic

Create `extensions/agentic-harness/harness-tools.ts` with the following design:

**Shared helpers:**
- `loadHarnessState(runId, rootDir?, now?)` — reads snapshot from `harnessStateSnapshotPath`; if missing, auto-creates a default `HarnessState` with `title = runId`.
- `persistHarnessState(state, rootDir?, now?)` — writes snapshot via `writeHarnessStateSnapshot`.
- `emitHarnessEvent(ctx, state, command, now?)` — appends a `HARNESS_STATE_EVENT_CUSTOM_TYPE` custom entry via `ctx.sessionManager?.appendCustomEntry` using `createHarnessReplayEvent`.
- `applyAndPersist(runId, rootDir, command, ctx)` — loads state, applies command via `applyHarnessCommand`, persists snapshot, emits replay event, returns `{ state, event }`.

**Tool: `harness_milestone`**
- Parameters schema (TypeBox):
  - `runId`: string (required)
  - `action`: enum `["create", "update", "set_status", "load", "render"]`
  - `rootDir`: optional string
  - `id`: string (required for update/set_status/load/render)
  - `name`: string (required for create)
  - `status`: enum of `HarnessMilestoneStatus` (for create/update/set_status)
  - `dependencies`: optional string[]
  - `attempts`: optional number
  - `planFile`: optional string
  - `reviewFile`: optional string
- Execute logic:
  - `create`: `upsert_milestone` command with `status` defaulting to `"pending"`, `attempts` defaulting to `0`.
  - `update`: `upsert_milestone` command merging provided fields.
  - `set_status`: `set_milestone_status` command.
  - `load`: returns `selectMilestoneSummary(state)` JSON.
  - `render`: returns `renderHarnessStateMarkdown(state)` text.
- Validation:
  - Reject missing `id` for non-create actions.
  - Reject invalid `status` enum values.
  - Return agent-readable error messages.

**Tool: `harness_plan`**
- Parameters schema:
  - `runId`: string (required)
  - `action`: enum `["attach", "define_tasks", "set_task_status", "load", "render"]`
  - `rootDir`: optional string
  - `id` / `planId`: string
  - `milestoneId`: string (required for attach)
  - `title`: string (required for attach)
  - `goal`: string (required for attach)
  - `planFile`: optional string
  - `tasks`: array of task objects (for define_tasks)
  - `taskId`: number (for set_task_status)
  - `status`: enum of `HarnessPlanTaskStatus` (for set_task_status)
  - `startedAt` / `completedAt`: optional ISO strings
- Execute logic:
  - `attach`: `attach_plan` command. If plan already exists, merges/upgrades.
  - `define_tasks`: `define_plan_tasks` command.
  - `set_task_status`: `set_plan_task_status` command.
  - `load`: returns `selectPlanSummary(state, planId)` JSON.
  - `render`: returns `renderHarnessPlanMarkdown(state, planId)` text.
- Validation:
  - Reject missing plan IDs.
  - Reject invalid task statuses.
  - Reject `define_tasks` with non-array tasks.

**Tool: `harness_todo`**
- Parameters schema:
  - `runId`: string (required)
  - `action`: enum `["set", "update_status", "clear", "load", "render"]`
  - `rootDir`: optional string
  - `ownerType`: enum `["milestone", "plan", "plan_task"]`
  - `ownerId`: string
  - `todos`: array of `{ id, text, status? }` (for set)
  - `todoId`: string (for update_status)
  - `status`: enum `["pending", "completed"]` (for update_status)
- Execute logic:
  - `set`: `set_todos` command replacing all todos for the owner.
  - `update_status`: `set_todo_status` command.
  - `clear`: `clear_todos` command.
  - `load`: returns `selectTodosForOwner(state, ownerType, ownerId)` JSON.
  - `render`: returns `renderHarnessTodoMarkdown(state, ownerType, ownerId)` text.
- Validation:
  - Reject missing ownerType/ownerId for set/clear/load/render.
  - Reject missing todoId for update_status.

**Schema constraints:**
- Use `stringEnum` helper (same pattern as `index.ts`) for all enum fields.
- All tool descriptions and prompt snippets must guide the agent to prefer these tools over hand-editing markdown.

### Task 2: Wire tools in `index.ts`

In `extensions/agentic-harness/index.ts`:
- Import `registerHarnessTools` from `./harness-tools.js`.
- Call `registerHarnessTools(pi)` inside the main `export default function (pi: ExtensionAPI)` body, after the existing `pi.registerTool` calls and before command registrations.
- Ensure `registerHarnessTools` receives the same `pi` instance.
- No inline tool logic in `index.ts`.

### Task 3: Create `harness-tools.test.ts`

Create `extensions/agentic-harness/tests/harness-tools.test.ts` covering:

1. **Schema validation:**
   - Each tool's parameter schema accepts valid input.
   - Each tool rejects invalid enum values and missing required fields.

2. **Execution — happy path:**
   - `harness_milestone` create → state persisted, event emitted.
   - `harness_milestone` update → fields merged, snapshot updated.
   - `harness_milestone` set_status → status changed.
   - `harness_milestone` load → returns milestone summary JSON.
   - `harness_milestone` render → returns markdown string.
   - `harness_plan` attach → plan added to state.
   - `harness_plan` define_tasks → tasks defined.
   - `harness_plan` set_task_status → task status updated.
   - `harness_plan` load/render → correct summaries/markdown.
   - `harness_todo` set → todos created for owner.
   - `harness_todo` update_status → todo toggled.
   - `harness_todo` clear → todos removed.
   - `harness_todo` load/render → correct output.

3. **Execution — error handling:**
   - Missing `id` for update/set_status/load/render on milestone.
   - Invalid `status` enum rejected with readable message.
   - Plan not found for set_task_status.
   - Todo not found for update_status.

4. **Persistence integration:**
   - After write, snapshot file exists and can be re-read.
   - After write, custom entry is appended to mock session manager.
   - Auto-creation of default state when snapshot missing on first write.

5. **Render output correctness:**
   - Render actions return non-empty markdown containing expected identifiers (runId, milestone names, etc.).

Use temporary directories for snapshot files. Mock `ctx.sessionManager.appendCustomEntry` to capture replay events.

### Task 4: Update `extension.test.ts`

In `extensions/agentic-harness/tests/extension.test.ts`:
- Verify that the extension registers `harness_milestone`, `harness_plan`, and `harness_todo` alongside existing tools (`subagent`, `webfetch`, etc.).
- Assert that the tool names exist in the registered tool set.

### Task 5: Build and full test suite

Run the verification strategy:
```bash
cd extensions/agentic-harness && npm run build && npm test
```

Fix any TypeScript errors, test failures, or build issues.

## Self-Review

- Are tools too large? No — three focused tools with small action enums.
- Is `index.ts` kept thin? Yes — only one `registerHarnessTools(pi)` call.
- Are we modifying completed milestone files? No — M1/M2 files are read-only; only `index.ts` is modified.
- Does this satisfy all M3 success criteria? Yes.
- Are there file conflicts with parallel milestones (M4/M5)? No — M4 touches skill docs, M5 touches footer/runtime; M3 only touches tools and `index.ts` wiring.
