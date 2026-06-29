# Plan: M4 — Skill and Workflow Migration

## Context

M3 delivered `harness_milestone`, `harness_plan`, and `harness_todo` tools that read/write structured harness state. M4 updates the skill/prompt contracts so agents prefer these tools over hand-editing markdown. The old parser-derived runtime remains as fallback until M6.

## Success Criteria

- [ ] `agentic-run-plan` instructs agents to load, define, and update plans through `harness_plan`.
- [ ] `agentic-long-run` instructs agents to create, load, and update milestones through `harness_milestone`.
- [ ] Todo workflows use `harness_todo` instead of handwritten checkbox files as source of truth.
- [ ] Skill docs include compact examples for create/update/load/render tool calls.
- [ ] Skill docs explicitly state markdown is rendered output only and must not be edited as canonical progress state.
- [ ] Documentation tests or text assertions verify key tool names and source-of-truth language are present.
- [ ] `cd extensions/agentic-harness && npm run build && npm test` passes.

## Out of Scope

- Footer/progress cutover (M5).
- Runtime replay cutover and parser quarantine (M6).
- Legacy cleanup (M7).

## Verification Strategy

- **Level:** test-suite + build
- **Command:** `cd extensions/agentic-harness && npm run build && npm test`
- **What it validates:** TypeScript correctness and full regression suite, including new skill doc assertions.

## Tasks

### Task 1: Update `agentic-run-plan/SKILL.md`

In `extensions/agentic-harness/skills/agentic-run-plan/SKILL.md`:

1. After the "Task Execution Loop" section (around Step 2), add a subsection:

   ````markdown
   ### Structured Plan State Updates

   When executing a plan through the harness, prefer updating plan progress via the `harness_plan` tool rather than editing plan markdown files directly.

   **After completing a task:**
   ```json
   { "runId": "<run-id>", "action": "set_task_status", "planId": "<plan-id>", "taskId": 1, "status": "completed" }
   ```

   **When the plan is first loaded:**
   ```json
   { "runId": "<run-id>", "action": "attach", "planId": "<plan-id>", "milestoneId": "M1", "title": "Plan Title", "goal": "Plan Goal" }
   { "runId": "<run-id>", "action": "define_tasks", "planId": "<plan-id>", "tasks": [{"id":1,"name":"Task 1"}] }
   ```

   Markdown plan files are rendered output only — they are not the canonical source of truth for runtime progress.
   ````

2. Keep all existing content intact.

### Task 2: Update `agentic-long-run/SKILL.md`

In `extensions/agentic-harness/skills/agentic-long-run/SKILL.md`:

1. In "Step 2-2: Plan Crafting Phase", after the instruction to write a plan document, add:

   ````markdown
   - After writing the plan, attach it to the milestone via `harness_plan`:
     ```json
     { "runId": "<run-id>", "action": "attach", "planId": "<plan-id>", "milestoneId": "M1", "title": "...", "goal": "...", "planFile": "docs/.../plan.md" }
     ```
   ````

2. In "Step 2-3: Run Plan Phase", after setting milestone status to `executing`, add:

   ````markdown
   - Update milestone status via `harness_milestone` instead of editing `state.md` tables:
     ```json
     { "runId": "<run-id>", "action": "set_status", "id": "M1", "status": "executing" }
     ```
   ````

3. In "Step 2-4: Review Work Phase", after setting milestone status to `validating`, add:

   ````markdown
   - After review, set final status via `harness_milestone`:
     ```json
     { "runId": "<run-id>", "action": "set_status", "id": "M1", "status": "completed" }
     ```
   ````

4. In "Step 2-6: Checkpoint", after writing the checkpoint file, add:

   ````markdown
   - Render the current state for human readability via `harness_milestone`:
     ```json
     { "runId": "<run-id>", "action": "render" }
     ```
     This produces markdown output from structured state. Do not treat the markdown as editable source of truth.
   ````

5. Add a top-level note near "Context Window Management":

   ````markdown
   ## Structured State vs Markdown

   `state.md`, milestone markdown files, and plan markdown files are rendered views of the canonical structured state stored in `state.json`. Agents must update progress through `harness_milestone`, `harness_plan`, and `harness_todo` tools. Editing markdown files directly bypasses the structured state and will be overwritten on the next render.
   ````

### Task 3: Update `agentic-plan-crafting/SKILL.md`

In `extensions/agentic-harness/skills/agentic-plan-crafting/SKILL.md`:

1. In the "Task Format" section, after the task checkbox example, add:

   ````markdown
   **Tracking plan progress:** After defining tasks in a plan document, register them with the harness via `harness_plan`:
   ```json
   { "runId": "<run-id>", "action": "define_tasks", "planId": "<plan-id>", "tasks": [{"id":1,"name":"Task Name","files":["src/file.ts"],"testCommands":["npm test"],"acceptanceCriteria":["passes"]}] }
   ```
   ````

2. In the "Final Verification Task" section, note:

   ````markdown
   After all tasks complete, update the plan's final status through `harness_plan` rather than editing markdown checkboxes.
   ````

3. Keep all existing content intact.

### Task 4: Update `agentic-review-work/SKILL.md`

In `extensions/agentic-harness/skills/agentic-review-work/SKILL.md`:

1. In the "After review is complete" transition section, add:

   ````markdown
   After review is complete, update the milestone status through `harness_milestone` rather than editing markdown tables:
   ```json
   { "runId": "<run-id>", "action": "set_status", "id": "M1", "status": "completed" }
   ```
   ````

2. Keep all existing content intact.

### Task 5: Update `agentic-milestone-planning/SKILL.md`

In `extensions/agentic-harness/skills/agentic-milestone-planning/SKILL.md`:

1. In "Phase 5: Save Milestone Artifacts", after the state.md format example, add:

   ````markdown
   **Structured state initialization:** After creating milestone definitions, initialize the canonical structured state via `harness_milestone`:
   ```json
   { "runId": "<run-id>", "action": "create", "id": "M1", "name": "Milestone Name", "status": "pending", "dependencies": [] }
   ```
   ````

2. Keep all existing content intact.

### Task 6: Add skill doc text assertions

Create `extensions/agentic-harness/tests/skill-docs.test.ts` with tests that verify:

1. `agentic-run-plan/SKILL.md` contains `"harness_plan"` and `"rendered output only"`.
2. `agentic-long-run/SKILL.md` contains `"harness_milestone"`, `"harness_plan"`, and `"canonical structured state"`.
3. `agentic-plan-crafting/SKILL.md` contains `"harness_plan"` and `"define_tasks"`.
4. `agentic-review-work/SKILL.md` contains `"harness_milestone"`.
5. `agentic-milestone-planning/SKILL.md` contains `"harness_milestone"`.

Use `readFileSync` to read the skill docs relative to the test file.

### Task 7: Build and full test suite

Run:
```bash
cd extensions/agentic-harness && npm run build && npm test
```

Fix any TypeScript errors, test failures, or build issues.

## Self-Review

- Are we modifying completed milestone files? No — M1/M2/M3 files are read-only.
- Are changes surgical? Yes — small additions to existing skill docs, not rewrites.
- Do skill docs remain backward-compatible? Yes — old parser paths still work; tools are preferred, not forced.
- Are there file conflicts with M5? No — M4 touches skill docs and adds a test file; M5 touches footer/runtime.
