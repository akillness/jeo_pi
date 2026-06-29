# Structured Harness Tools Branch Audit Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking. This is an executable audit plan: tasks produce review artifacts and a final risk report; they do not fix product code unless a separate follow-up fix plan is approved.

**Goal:** Verify whether the current `feat/structured-harness-state-tools` branch has correctness, integration, regression, or workflow-contract risks after migrating task, milestone, plan, and todo management to structured tools.

**Architecture:** Run the audit as isolated evidence-gathering tasks that inspect the structured state kernel, tool layer, replay/runtime integration, footer cutover, legacy parser quarantine, and skill contracts. Each audit task writes a separate report artifact to avoid file conflicts; a final synthesis task merges findings into one actionable branch-audit report.

**Tech Stack:** TypeScript, ESM, Vitest, TypeBox schemas, pi extension APIs, structured harness tools (`harness_milestone`, `harness_plan`, `harness_todo`).

**Work Scope:**
- **In scope:** branch status inventory, build/test verification, targeted source review, targeted regression tests, structured-tool dogfood flow, stale snapshot/replay risk review, concurrency risk review, footer/runtime status review, skill contract review, parser isolation review, final issue/risk report.
- **Out of scope:** implementing fixes for discovered issues, changing public tool schemas, importing legacy markdown sessions, redesigning the structured state model, release packaging.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm run build && npm test`
- **What it validates:** TypeScript type correctness and the full agentic-harness Vitest suite, including structured state, tools, storage, replay, footer, parser isolation, skill-doc, and e2e structured workflow tests.

**Project Capability Discovery:**
- Bundled agents available for execution/review: `explorer`, `plan-compliance`, `plan-worker`, `plan-validator`, `reviewer-bug`, `reviewer-security`, `reviewer-performance`, `reviewer-test-coverage`, `reviewer-consistency`, `reviewer-verifier`, `review-synthesis`.
- Project skill docs relevant to this audit: `extensions/agentic-harness/skills/agentic-run-plan/SKILL.md`, `extensions/agentic-harness/skills/agentic-long-run/SKILL.md`, `extensions/agentic-harness/skills/agentic-plan-crafting/SKILL.md`, `extensions/agentic-harness/skills/agentic-review-work/SKILL.md`, `extensions/agentic-harness/skills/agentic-milestone-planning/SKILL.md`.
- No separate project-specific `.agents/` or `.pi/skills/` directories are required for this audit; the extension-local agents and skills are sufficient.

---

## File Structure Mapping

### Audit artifacts to create
- `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/01-baseline-verification.md`
- `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/02-state-tools-integrity.md`
- `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/03-runtime-replay-footer.md`
- `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/04-skill-contract-parser-isolation.md`
- `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/05-dogfood-structured-tools.md`
- `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/git-status.txt`
- `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/diff-name-status.txt`
- `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/baseline-build-test.log`
- `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/state-tools-tests.log`
- `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/runtime-replay-footer-tests.log`
- `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/contract-parser-tests.log`
- `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/final-build-test.log`
- `docs/engineering-discipline/reviews/2026-05-07-structured-harness-tools-branch-audit.md`

### Source files to inspect, not modify
- `extensions/agentic-harness/harness-state.ts`
- `extensions/agentic-harness/harness-render.ts`
- `extensions/agentic-harness/harness-storage.ts`
- `extensions/agentic-harness/harness-events.ts`
- `extensions/agentic-harness/harness-tools.ts`
- `extensions/agentic-harness/harness-progress.ts`
- `extensions/agentic-harness/harness-runtime-progress.ts`
- `extensions/agentic-harness/index.ts`
- `extensions/agentic-harness/footer.ts`
- `extensions/agentic-harness/legacy-import-markdown.ts`
- `extensions/agentic-harness/plan-parser.ts`
- `extensions/agentic-harness/plan-progress.ts`
- `extensions/agentic-harness/plan-progress-events.ts`
- `extensions/agentic-harness/milestone-tracker.ts`
- `extensions/agentic-harness/skills/agentic-run-plan/SKILL.md`
- `extensions/agentic-harness/skills/agentic-long-run/SKILL.md`
- `extensions/agentic-harness/skills/agentic-plan-crafting/SKILL.md`
- `extensions/agentic-harness/skills/agentic-review-work/SKILL.md`
- `extensions/agentic-harness/skills/agentic-milestone-planning/SKILL.md`

### Test files to run or inspect, not modify
- `extensions/agentic-harness/tests/harness-state.test.ts`
- `extensions/agentic-harness/tests/harness-render.test.ts`
- `extensions/agentic-harness/tests/harness-storage.test.ts`
- `extensions/agentic-harness/tests/harness-events.test.ts`
- `extensions/agentic-harness/tests/harness-tools.test.ts`
- `extensions/agentic-harness/tests/harness-progress.test.ts`
- `extensions/agentic-harness/tests/harness-runtime-progress.test.ts`
- `extensions/agentic-harness/tests/session-replay.test.ts`
- `extensions/agentic-harness/tests/parser-isolation.test.ts`
- `extensions/agentic-harness/tests/e2e-structured-workflow.test.ts`
- `extensions/agentic-harness/tests/skill-docs.test.ts`
- `extensions/agentic-harness/tests/footer.test.ts`
- `extensions/agentic-harness/tests/extension.test.ts`

---

## Finding Format for Every Audit Report

When an audit task finds an issue, write it in this exact schema:

```markdown
### Finding 1: Concise observed issue title
- **Severity:** Critical | High | Medium | Low | Info
- **Confidence:** High | Medium | Low
- **Evidence:** `path/to/file.ts:line` plus the command output or code path that proves the issue
- **Impact:** One sentence describing the user-visible or maintainer-visible failure mode
- **Recommendation:** One concrete code, test, or documentation change that would resolve the issue
```

When an audit task finds no issues in its area, write this exact sentence under `## Findings`:

```markdown
No issues found in this audit area.
```

---

## Tasks

### Task 1: Baseline branch inventory and full-suite verification

**Dependencies:** None (can run in parallel)
**Files:**
- Create: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/01-baseline-verification.md`
- Create: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/git-status.txt`
- Create: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/diff-name-status.txt`
- Create: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/baseline-build-test.log`

- [ ] **Step 1: Create audit artifact directories**

Run:

```bash
mkdir -p docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands
```

Expected: command exits with status `0`.

- [ ] **Step 2: Capture branch and dirty-worktree inventory**

Run:

```bash
{
  echo "branch=$(git branch --show-current)"
  echo
  git status --short
} > docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/git-status.txt

git diff --name-status > docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/diff-name-status.txt
```

Expected: both files exist and include the current branch state.

- [ ] **Step 3: Run highest-level build and test verification**

Run:

```bash
cd extensions/agentic-harness && set -o pipefail && (npm run build && npm test) 2>&1 | tee ../../docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/baseline-build-test.log
```

Expected: `npm run build` exits `0`; `npm test` exits `0`. If the command exits non-zero, keep the log and record the failure as a finding.

- [ ] **Step 4: Write baseline report**

Create `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/01-baseline-verification.md` with these sections:

```markdown
# Baseline Verification

## Commands Run
- `git branch --show-current`
- `git status --short`
- `git diff --name-status`
- `cd extensions/agentic-harness && npm run build && npm test`

## Evidence Files
- `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/git-status.txt`
- `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/diff-name-status.txt`
- `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/baseline-build-test.log`

## Findings
```

Then add findings using the finding schema above, or add `No issues found in this audit area.` if all commands passed and no baseline concerns were observed.

- [ ] **Step 5: Acceptance check**

Verify:

```bash
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/01-baseline-verification.md
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/git-status.txt
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/diff-name-status.txt
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/baseline-build-test.log
```

Expected: every `test -s` command exits `0`.

### Task 2: Structured state, storage, render, and tool integrity audit

**Dependencies:** None (can run in parallel)
**Files:**
- Create: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/02-state-tools-integrity.md`
- Create: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/state-tools-tests.log`
- Read: `extensions/agentic-harness/harness-state.ts`
- Read: `extensions/agentic-harness/harness-storage.ts`
- Read: `extensions/agentic-harness/harness-render.ts`
- Read: `extensions/agentic-harness/harness-events.ts`
- Read: `extensions/agentic-harness/harness-tools.ts`
- Test: `extensions/agentic-harness/tests/harness-state.test.ts`
- Test: `extensions/agentic-harness/tests/harness-storage.test.ts`
- Test: `extensions/agentic-harness/tests/harness-render.test.ts`
- Test: `extensions/agentic-harness/tests/harness-events.test.ts`
- Test: `extensions/agentic-harness/tests/harness-tools.test.ts`
- Test: `extensions/agentic-harness/tests/e2e-structured-workflow.test.ts`

- [ ] **Step 1: Run targeted structured-state/tool tests with an isolated temp directory**

Run:

```bash
cd extensions/agentic-harness && set -o pipefail && mkdir -p ../../docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands node_modules/.tmp/audit-state-tools && TMPDIR=$PWD/node_modules/.tmp/audit-state-tools npm exec -- vitest run \
  tests/harness-state.test.ts \
  tests/harness-storage.test.ts \
  tests/harness-render.test.ts \
  tests/harness-events.test.ts \
  tests/harness-tools.test.ts \
  tests/e2e-structured-workflow.test.ts \
  2>&1 | tee ../../docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/state-tools-tests.log
```

Expected: Vitest exits `0`. If it exits non-zero, record the failing test names and first failing assertion as findings.

- [ ] **Step 2: Inspect reducer command coverage and validation behavior**

Read `extensions/agentic-harness/harness-state.ts` and verify these exact command families are handled and tested:
- milestone upsert/status transitions
- plan attach/task definition/task status transitions
- todo set/update/clear behavior for `milestone`, `plan`, and `plan_task` owners
- selectors for milestone summaries, plan summaries, and todos by owner

Record a finding if a command path exists without a matching test in `extensions/agentic-harness/tests/harness-state.test.ts`.

- [ ] **Step 3: Inspect snapshot durability and path safety**

Read `extensions/agentic-harness/harness-storage.ts` and verify:
- snapshot path is deterministic for `rootDir` and `runId`
- writes are atomic or bounded to a single snapshot path
- missing/corrupt snapshots are handled by returning no state or a clear error
- tests in `extensions/agentic-harness/tests/harness-storage.test.ts` cover read, write, missing snapshot, and malformed snapshot behavior

Record a finding for any durability gap that could lose progress or make resume impossible.

- [ ] **Step 4: Inspect tool parameter requirements and persistence/event ordering**

Read `extensions/agentic-harness/harness-tools.ts` and verify:
- each action rejects missing required parameters with a clear error message
- every mutating action persists state and appends a replay event
- mutating tool output includes human-readable text and structured `details`
- `load` and `render` actions are read-only
- `planId` and `id` aliases behave consistently for plan actions

Record a finding for any tool action that can silently skip persistence, skip replay, or write ambiguous state.

- [ ] **Step 5: Write structured-state/tool integrity report**

Create `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/02-state-tools-integrity.md` with sections:

```markdown
# Structured State, Storage, Render, and Tool Integrity Audit

## Commands Run
- targeted Vitest command from Task 2 Step 1

## Files Reviewed
- `extensions/agentic-harness/harness-state.ts`
- `extensions/agentic-harness/harness-storage.ts`
- `extensions/agentic-harness/harness-render.ts`
- `extensions/agentic-harness/harness-events.ts`
- `extensions/agentic-harness/harness-tools.ts`

## Checks Performed
- reducer command coverage
- snapshot durability and path safety
- tool parameter validation
- mutating action persistence and replay event emission
- load/render read-only behavior

## Findings
```

Then add findings using the finding schema above, or add `No issues found in this audit area.`.

- [ ] **Step 6: Acceptance check**

Run:

```bash
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/02-state-tools-integrity.md
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/state-tools-tests.log
```

Expected: both files exist and are non-empty.

### Task 3: Runtime replay, subagent status bridge, and footer cutover audit

**Dependencies:** None (can run in parallel)
**Files:**
- Create: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/03-runtime-replay-footer.md`
- Create: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/runtime-replay-footer-tests.log`
- Read: `extensions/agentic-harness/index.ts`
- Read: `extensions/agentic-harness/harness-progress.ts`
- Read: `extensions/agentic-harness/harness-runtime-progress.ts`
- Read: `extensions/agentic-harness/footer.ts`
- Test: `extensions/agentic-harness/tests/session-replay.test.ts`
- Test: `extensions/agentic-harness/tests/harness-progress.test.ts`
- Test: `extensions/agentic-harness/tests/harness-runtime-progress.test.ts`
- Test: `extensions/agentic-harness/tests/footer.test.ts`
- Test: `extensions/agentic-harness/tests/extension.test.ts`

- [ ] **Step 1: Run targeted runtime/replay/footer tests with an isolated temp directory**

Run:

```bash
cd extensions/agentic-harness && set -o pipefail && mkdir -p ../../docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands node_modules/.tmp/audit-runtime-footer && TMPDIR=$PWD/node_modules/.tmp/audit-runtime-footer npm exec -- vitest run \
  tests/session-replay.test.ts \
  tests/harness-progress.test.ts \
  tests/harness-runtime-progress.test.ts \
  tests/footer.test.ts \
  tests/extension.test.ts \
  2>&1 | tee ../../docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/runtime-replay-footer-tests.log
```

Expected: Vitest exits `0`. If it exits non-zero, record the failing test names and first failing assertion as findings.

- [ ] **Step 2: Inspect session replay source-of-truth ordering**

Read `extensions/agentic-harness/index.ts`, `extensions/agentic-harness/harness-events.ts`, and `extensions/agentic-harness/harness-progress.ts`; verify:
- `session_start` structured custom entries can reconstruct progress without parsing assistant prose or markdown
- snapshot state and replayed custom events cannot produce stale footer state after resume
- malformed custom entries for the same run are ignored or produce controlled errors
- parser fallback is gated when structured state exists

Record a finding for any stale snapshot, malformed event, or fallback race that can show incorrect task/milestone progress.

- [ ] **Step 3: Inspect subagent status bridge behavior**

Read `extensions/agentic-harness/harness-runtime-progress.ts` and the related hooks in `extensions/agentic-harness/index.ts`; verify:
- plan task status updates map subagent lifecycle states to `running`, `completed`, or `failed`
- task selection by `planFile` and task ID is deterministic
- multi-task plans cannot update the wrong task when several subagents finish close together
- emitted events include enough metadata for replay and debugging

Record a finding for any path that can update the wrong plan task or skip a terminal status.

- [ ] **Step 4: Inspect footer structured-provider cutover**

Read `extensions/agentic-harness/footer.ts` and `extensions/agentic-harness/harness-progress.ts`; verify:
- footer prefers structured `HarnessProgressProvider` when state exists
- legacy `PlanProgressTracker` and `MilestoneTracker` are used only as fallback
- live render refresh occurs after structured state changes
- reload/history reconstruction displays the same milestone and plan progress as live execution

Record a finding for any state source mismatch between live execution and resume.

- [ ] **Step 5: Write runtime/replay/footer report**

Create `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/03-runtime-replay-footer.md` with sections:

```markdown
# Runtime Replay, Subagent Status Bridge, and Footer Cutover Audit

## Commands Run
- targeted Vitest command from Task 3 Step 1

## Files Reviewed
- `extensions/agentic-harness/index.ts`
- `extensions/agentic-harness/harness-events.ts`
- `extensions/agentic-harness/harness-progress.ts`
- `extensions/agentic-harness/harness-runtime-progress.ts`
- `extensions/agentic-harness/footer.ts`

## Checks Performed
- session replay source of truth
- snapshot versus custom-event ordering
- parser fallback gating
- subagent task status updates
- footer structured provider cutover

## Findings
```

Then add findings using the finding schema above, or add `No issues found in this audit area.`.

- [ ] **Step 6: Acceptance check**

Run:

```bash
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/03-runtime-replay-footer.md
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/runtime-replay-footer-tests.log
```

Expected: both files exist and are non-empty.

### Task 4: Skill contract and legacy parser isolation audit

**Dependencies:** None (can run in parallel)
**Files:**
- Create: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/04-skill-contract-parser-isolation.md`
- Create: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/contract-parser-tests.log`
- Read: `extensions/agentic-harness/skills/agentic-run-plan/SKILL.md`
- Read: `extensions/agentic-harness/skills/agentic-long-run/SKILL.md`
- Read: `extensions/agentic-harness/skills/agentic-plan-crafting/SKILL.md`
- Read: `extensions/agentic-harness/skills/agentic-review-work/SKILL.md`
- Read: `extensions/agentic-harness/skills/agentic-milestone-planning/SKILL.md`
- Read: `extensions/agentic-harness/legacy-import-markdown.ts`
- Read: `extensions/agentic-harness/plan-parser.ts`
- Read: `extensions/agentic-harness/plan-progress.ts`
- Read: `extensions/agentic-harness/plan-progress-events.ts`
- Read: `extensions/agentic-harness/milestone-tracker.ts`
- Test: `extensions/agentic-harness/tests/skill-docs.test.ts`
- Test: `extensions/agentic-harness/tests/parser-isolation.test.ts`

- [ ] **Step 1: Run targeted skill-doc and parser-isolation tests with an isolated temp directory**

Run:

```bash
cd extensions/agentic-harness && set -o pipefail && mkdir -p ../../docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands node_modules/.tmp/audit-contract-parser && TMPDIR=$PWD/node_modules/.tmp/audit-contract-parser npm exec -- vitest run \
  tests/skill-docs.test.ts \
  tests/parser-isolation.test.ts \
  2>&1 | tee ../../docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/contract-parser-tests.log
```

Expected: Vitest exits `0`. If it exits non-zero, record the failing test names and first failing assertion as findings.

- [ ] **Step 2: Inspect mandatory tool-use contract in skill docs**

Read the five skill docs listed above and verify:
- plan crafting registers tasks with `harness_plan` after defining tasks
- run-plan uses `harness_plan` for task status and does not mark progress by editing plan markdown checkboxes
- long-run uses `harness_milestone`, `harness_plan`, and `harness_todo` for milestone and todo state
- review and milestone planning write rendered markdown as output only, not as state source
- every skill tells agents to prefer structured tools over hand-editing milestone, plan, or todo markdown

Record a finding for each workflow instruction that can cause agents to bypass structured tools.

- [ ] **Step 3: Inspect parser quarantine boundary**

Run:

```bash
grep -R "from .*plan-parser\|require(.*plan-parser\|parsePlan\|PlanProgressTracker\|MilestoneTracker" extensions/agentic-harness --exclude-dir=node_modules --exclude-dir=dist > /tmp/structured-harness-parser-usage.txt || true
```

Then read `/tmp/structured-harness-parser-usage.txt` and verify parser/progress imports are limited to explicit legacy fallback paths or tests.

Record a finding for any primary runtime path that still treats `state.md`, `todo.md`, plan markdown, assistant prose, or checkbox parsing as canonical progress state.

- [ ] **Step 4: Write skill-contract/parser-isolation report**

Create `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/04-skill-contract-parser-isolation.md` with sections:

```markdown
# Skill Contract and Legacy Parser Isolation Audit

## Commands Run
- targeted Vitest command from Task 4 Step 1
- parser usage grep from Task 4 Step 3

## Files Reviewed
- `extensions/agentic-harness/skills/agentic-run-plan/SKILL.md`
- `extensions/agentic-harness/skills/agentic-long-run/SKILL.md`
- `extensions/agentic-harness/skills/agentic-plan-crafting/SKILL.md`
- `extensions/agentic-harness/skills/agentic-review-work/SKILL.md`
- `extensions/agentic-harness/skills/agentic-milestone-planning/SKILL.md`
- `extensions/agentic-harness/legacy-import-markdown.ts`
- `extensions/agentic-harness/plan-parser.ts`
- `extensions/agentic-harness/plan-progress.ts`
- `extensions/agentic-harness/plan-progress-events.ts`
- `extensions/agentic-harness/milestone-tracker.ts`

## Checks Performed
- mandatory structured tool usage in skill contracts
- no progress-by-markdown-checklist instruction remains in primary workflows
- parser quarantine boundary
- rendered markdown treated as output only

## Findings
```

Then add findings using the finding schema above, or add `No issues found in this audit area.`.

- [ ] **Step 5: Acceptance check**

Run:

```bash
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/04-skill-contract-parser-isolation.md
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/contract-parser-tests.log
test -e /tmp/structured-harness-parser-usage.txt
```

Expected: the report and log `test -s` commands exit `0`; the parser usage file `test -e` command exits `0`. If `/tmp/structured-harness-parser-usage.txt` is empty, record that no parser usage was found.

### Task 5: Dogfood structured harness tools in an isolated run

**Dependencies:** None (can run in parallel)
**Files:**
- Create: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/05-dogfood-structured-tools.md`
- Create: `/tmp/pi-harness-tools-audit/structured-tools-audit-dogfood-2026-05-07/state.json`

- [ ] **Step 1: Clear isolated dogfood state root**

Run:

```bash
rm -rf /tmp/pi-harness-tools-audit/structured-tools-audit-dogfood-2026-05-07
mkdir -p /tmp/pi-harness-tools-audit docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07
```

Expected: command exits with status `0`.

- [ ] **Step 2: Create a milestone through `harness_milestone`**

Call tool:

```json
{
  "runId": "structured-tools-audit-dogfood-2026-05-07",
  "rootDir": "/tmp/pi-harness-tools-audit",
  "action": "create",
  "id": "M1",
  "name": "Dogfood Structured Tools",
  "status": "planning",
  "dependencies": [],
  "attempts": 0,
  "planFile": "docs/engineering-discipline/plans/2026-05-07-structured-harness-tools-branch-audit.md"
}
```

Expected: tool output text includes `Milestone created: M1` and `details` includes milestone `M1` with status `planning`.

- [ ] **Step 3: Attach a plan and define two tasks through `harness_plan`**

Call tool:

```json
{
  "runId": "structured-tools-audit-dogfood-2026-05-07",
  "rootDir": "/tmp/pi-harness-tools-audit",
  "action": "attach",
  "planId": "dogfood-plan",
  "milestoneId": "M1",
  "title": "Dogfood Plan",
  "goal": "Verify structured plan state through tool calls",
  "planFile": "docs/engineering-discipline/plans/2026-05-07-structured-harness-tools-branch-audit.md"
}
```

Then call tool:

```json
{
  "runId": "structured-tools-audit-dogfood-2026-05-07",
  "rootDir": "/tmp/pi-harness-tools-audit",
  "action": "define_tasks",
  "planId": "dogfood-plan",
  "tasks": [
    {
      "id": 1,
      "name": "Create structured state",
      "dependencies": [],
      "files": ["/tmp/pi-harness-tools-audit/structured-tools-audit-dogfood-2026-05-07/state.json"],
      "testCommands": ["harness_plan load dogfood-plan"],
      "acceptanceCriteria": ["Task appears in plan summary"]
    },
    {
      "id": 2,
      "name": "Render structured state",
      "dependencies": [1],
      "files": ["rendered markdown output"],
      "testCommands": ["harness_plan render dogfood-plan"],
      "acceptanceCriteria": ["Rendered plan contains two tasks"]
    }
  ]
}
```

Expected: attach output includes `Plan attached: dogfood-plan`; define output includes `Tasks defined for plan dogfood-plan: 2 tasks`.

- [ ] **Step 4: Update task and todo state through tools**

Call tool:

```json
{
  "runId": "structured-tools-audit-dogfood-2026-05-07",
  "rootDir": "/tmp/pi-harness-tools-audit",
  "action": "set_task_status",
  "planId": "dogfood-plan",
  "taskId": 1,
  "status": "completed",
  "startedAt": "2026-05-07T00:00:00.000Z",
  "completedAt": "2026-05-07T00:01:00.000Z"
}
```

Then call tool:

```json
{
  "runId": "structured-tools-audit-dogfood-2026-05-07",
  "rootDir": "/tmp/pi-harness-tools-audit",
  "action": "set",
  "ownerType": "plan",
  "ownerId": "dogfood-plan",
  "todos": [
    { "id": "verify-load", "text": "Verify load output", "status": "completed" },
    { "id": "verify-render", "text": "Verify render output", "status": "pending" }
  ]
}
```

Then call tool:

```json
{
  "runId": "structured-tools-audit-dogfood-2026-05-07",
  "rootDir": "/tmp/pi-harness-tools-audit",
  "action": "update_status",
  "ownerType": "plan",
  "ownerId": "dogfood-plan",
  "todoId": "verify-render",
  "status": "completed"
}
```

Expected: task status output includes `task 1 status set to completed`; todo update output includes `Todo verify-render status set to completed`.

- [ ] **Step 5: Load and render structured state through tools**

Call `harness_milestone`:

```json
{
  "runId": "structured-tools-audit-dogfood-2026-05-07",
  "rootDir": "/tmp/pi-harness-tools-audit",
  "action": "load"
}
```

Call `harness_plan`:

```json
{
  "runId": "structured-tools-audit-dogfood-2026-05-07",
  "rootDir": "/tmp/pi-harness-tools-audit",
  "action": "render",
  "planId": "dogfood-plan"
}
```

Call `harness_todo`:

```json
{
  "runId": "structured-tools-audit-dogfood-2026-05-07",
  "rootDir": "/tmp/pi-harness-tools-audit",
  "action": "load",
  "ownerType": "plan",
  "ownerId": "dogfood-plan"
}
```

Expected:
- milestone load includes `M1` and `planning`
- plan render includes `Dogfood Plan`, `Create structured state`, and `Render structured state`
- todo load includes both todo IDs with status `completed`

- [ ] **Step 6: Verify snapshot file directly**

Run:

```bash
test -s /tmp/pi-harness-tools-audit/structured-tools-audit-dogfood-2026-05-07/state.json
node -e "const fs=require('fs'); const p='/tmp/pi-harness-tools-audit/structured-tools-audit-dogfood-2026-05-07/state.json'; const s=JSON.parse(fs.readFileSync(p,'utf8')).state; if(s.runId!=='structured-tools-audit-dogfood-2026-05-07') throw new Error('bad runId'); if(!s.milestones.find(m=>m.id==='M1'&&m.status==='planning')) throw new Error('missing milestone'); const plan=s.plans.find(p=>p.id==='dogfood-plan'); if(!plan) throw new Error('missing plan'); const task=plan.tasks.find(t=>t.id===1); if(!task||task.status!=='completed') throw new Error('bad task status'); const todos=s.todos.filter(t=>t.ownerId==='dogfood-plan'); if(todos.length!==2||todos.some(t=>t.status!=='completed')) throw new Error('bad todos'); console.log('snapshot ok')"
```

Expected: output includes `snapshot ok`.

- [ ] **Step 7: Write dogfood report**

Create `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/05-dogfood-structured-tools.md` with sections:

```markdown
# Dogfood Structured Harness Tools Audit

## Tool Calls Run
- `harness_milestone create`
- `harness_plan attach`
- `harness_plan define_tasks`
- `harness_plan set_task_status`
- `harness_todo set`
- `harness_todo update_status`
- `harness_milestone load`
- `harness_plan render`
- `harness_todo load`

## Snapshot Checked
- `/tmp/pi-harness-tools-audit/structured-tools-audit-dogfood-2026-05-07/state.json`

## Findings
```

Then add findings using the finding schema above, or add `No issues found in this audit area.`.

- [ ] **Step 8: Acceptance check**

Run:

```bash
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/05-dogfood-structured-tools.md
test -s /tmp/pi-harness-tools-audit/structured-tools-audit-dogfood-2026-05-07/state.json
```

Expected: both files exist and are non-empty.

### Task 6: Final synthesis and risk register

**Dependencies:** Runs after Tasks 1, 2, 3, 4, and 5 complete
**Files:**
- Create: `docs/engineering-discipline/reviews/2026-05-07-structured-harness-tools-branch-audit.md`
- Read: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/01-baseline-verification.md`
- Read: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/02-state-tools-integrity.md`
- Read: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/03-runtime-replay-footer.md`
- Read: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/04-skill-contract-parser-isolation.md`
- Read: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/05-dogfood-structured-tools.md`

- [ ] **Step 1: Verify all audit area reports exist**

Run:

```bash
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/01-baseline-verification.md
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/02-state-tools-integrity.md
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/03-runtime-replay-footer.md
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/04-skill-contract-parser-isolation.md
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/05-dogfood-structured-tools.md
```

Expected: every `test -s` command exits `0`.

- [ ] **Step 2: Extract findings from area reports**

Run:

```bash
grep -R "^### Finding" docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/*.md > /tmp/structured-harness-audit-findings.txt || true
```

Expected: `/tmp/structured-harness-audit-findings.txt` exists. An empty file means no findings were recorded by area tasks.

- [ ] **Step 3: Write final branch audit report**

Create `docs/engineering-discipline/reviews/2026-05-07-structured-harness-tools-branch-audit.md` with this structure:

```markdown
# Structured Harness Tools Branch Audit

## Verdict
Write exactly one verdict line here: `PASS`, `PASS WITH FOLLOW-UPS`, or `FAIL`.

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
```

Use these verdict rules:
- Write `PASS` only if every area report says no issues and final verification passes.
- Write `PASS WITH FOLLOW-UPS` if all tests pass but any Low, Medium, or Info finding remains.
- Write `FAIL` if build/tests fail or any Critical/High finding remains.

Under `## Findings`, copy every finding from the area reports. If there are no findings, write `No issues found.`.

Then add:

```markdown
## Recommended Follow-Up
- If verdict is `PASS`, write: `No follow-up required before merge.`
- If verdict is `PASS WITH FOLLOW-UPS` or `FAIL`, list each follow-up as a concrete task with file path, reason, and verification command.
```

- [ ] **Step 4: Acceptance check**

Run:

```bash
test -s docs/engineering-discipline/reviews/2026-05-07-structured-harness-tools-branch-audit.md
grep -E "^PASS$|^PASS WITH FOLLOW-UPS$|^FAIL$" docs/engineering-discipline/reviews/2026-05-07-structured-harness-tools-branch-audit.md
```

Expected: final report exists and contains exactly one verdict line.

### Task 7 (Final): End-to-end verification and plan success check

**Dependencies:** Runs after Task 6 completes
**Files:**
- Read: `docs/engineering-discipline/reviews/2026-05-07-structured-harness-tools-branch-audit.md`
- Create: `docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/final-build-test.log`

- [ ] **Step 1: Run highest-level verification**

Run:

```bash
cd extensions/agentic-harness && set -o pipefail && (npm run build && npm test) 2>&1 | tee ../../docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/final-build-test.log
```

Expected: `npm run build` exits `0`; `npm test` exits `0`.

- [ ] **Step 2: Verify final report integrity**

Run:

```bash
test -s docs/engineering-discipline/reviews/2026-05-07-structured-harness-tools-branch-audit.md
test -s docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/final-build-test.log
grep -E "^PASS$|^PASS WITH FOLLOW-UPS$|^FAIL$" docs/engineering-discipline/reviews/2026-05-07-structured-harness-tools-branch-audit.md
```

Expected: all commands exit `0`.

- [ ] **Step 3: Verify plan success criteria**

Manually check each item and update the final report if any item is false:
- [ ] Branch status inventory was captured.
- [ ] Full build and test suite were run at least twice: baseline and final.
- [ ] Structured state, storage, render, event, and tool code were reviewed.
- [ ] Runtime replay, subagent status bridge, and footer cutover were reviewed.
- [ ] Skill contracts and parser quarantine were reviewed.
- [ ] A dogfood workflow exercised `harness_milestone`, `harness_plan`, and `harness_todo` in an isolated state root.
- [ ] Final audit report contains a single verdict and concrete follow-up tasks for every unresolved finding.

- [ ] **Step 4: Record completion in structured harness state**

Call tool:

```json
{
  "runId": "structured-harness-tools-branch-audit-2026-05-07",
  "action": "set_task_status",
  "planId": "branch-audit-plan",
  "taskId": 7,
  "status": "completed"
}
```

Expected: tool output includes `Plan branch-audit-plan task 7 status set to completed`.

---

## Self-Review

- **Spec coverage:** PASS — the plan checks the exact migration concern: milestones, plans, tasks, and todos managed through tools; it covers state, storage, tools, replay, footer, parser isolation, skill docs, dogfood, and full-suite verification.
- **Placeholder scan:** PASS — no implementation step contains deferred work; dynamic audit findings use a fixed schema with explicit no-finding text.
- **Type consistency:** PASS — tool action names, statuses, owner types, and IDs match the exposed structured harness tool schemas.
- **Dependency verification:** PASS — Tasks 1–5 create separate report files and can run in parallel; Task 6 depends on all audit reports; Task 7 depends on final synthesis.
- **Verification coverage:** PASS — the final task runs the discovered highest-level command `cd extensions/agentic-harness && npm run build && npm test` and verifies all success criteria.
