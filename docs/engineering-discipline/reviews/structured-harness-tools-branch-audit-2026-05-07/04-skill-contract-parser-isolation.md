# Skill Contract and Legacy Parser Isolation Audit

## Commands Run
- `cd extensions/agentic-harness && set -o pipefail && mkdir -p ../../docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands node_modules/.tmp/audit-contract-parser && TMPDIR=$PWD/node_modules/.tmp/audit-contract-parser npm exec -- vitest run tests/skill-docs.test.ts tests/parser-isolation.test.ts 2>&1 | tee ../../docs/engineering-discipline/reviews/structured-harness-tools-branch-audit-2026-05-07/commands/contract-parser-tests.log`
- `grep -R "from .*plan-parser\|require(.*plan-parser\|parsePlan\|PlanProgressTracker\|MilestoneTracker" extensions/agentic-harness --exclude-dir=node_modules --exclude-dir=dist > /tmp/structured-harness-parser-usage.txt || true`

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

### Finding 1: Plan-crafting template still describes markdown checkboxes as progress tracking
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/skills/agentic-plan-crafting/SKILL.md:63` says "Each step uses checkbox (`- [ ]`) syntax for progress tracking" while the same skill later says task completion should be recorded through `harness_plan` rather than editing markdown checkboxes.
- **Impact:** New plans can preserve an instruction that agents interpret as permission to mark task progress by editing rendered plan markdown.
- **Recommendation:** Change the worker-note template to say checkbox syntax is part of rendered task formatting only, and explicitly require `harness_plan define_tasks` / `harness_plan set_task_status` for canonical progress.

### Finding 2: Long-run bootstrap and recovery still use `state.md`, milestone files, and checkpoints as state inputs
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/skills/agentic-long-run/SKILL.md:17` says the state file must be updated before and after every milestone, `:40` requires a directory containing `state.md` and `milestones/*.md`, `:48-51` tells agents to read and validate `state.md` and milestone files, `:369` says all state lives in `state.md` and milestone files, and `:371` says checkpoint files are the source of truth.
- **Impact:** Long-run agents can treat rendered markdown/checkpoint artifacts as canonical resume state and bypass `harness_milestone`, `harness_plan`, and `harness_todo` snapshots/events.
- **Recommendation:** Rewrite bootstrap and recovery instructions to load canonical structured state through harness tools first, then treat `state.md`, milestone files, and checkpoint markdown as rendered/audit outputs only.

### Finding 3: Long-run recovery still resumes plan tasks from markdown checkboxes
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/skills/agentic-long-run/SKILL.md:324` instructs agents: `For executing milestones: check if tasks in the plan have checkboxes marked. Resume from the first unchecked task.`
- **Impact:** A resumed long-run can choose the next task from stale rendered checklist state instead of canonical `harness_plan` task status.
- **Recommendation:** Replace the checkbox recovery instruction with `harness_plan load` / structured task selection and state that plan markdown checkboxes are not progress state.

### Finding 4: Long-run completion and checklist still direct agents to update `state.md`
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/skills/agentic-long-run/SKILL.md:270` says `Update state.md: set overall status to completing`, `extensions/agentic-harness/skills/agentic-long-run/SKILL.md:279` says `Update state.md: set overall status to completed`, and `extensions/agentic-harness/skills/agentic-long-run/SKILL.md:408` requires `State.md updated before and after every phase transition`.
- **Impact:** Agents following these instructions can hand-edit rendered markdown state instead of persisting canonical milestone state through `harness_milestone`.
- **Recommendation:** Rewrite completion and checklist instructions to update canonical state through structured harness tools first, then render markdown as an output artifact.

### Finding 5: Runtime subagent task status bridge still derives task IDs through legacy plan progress parsing
- **Severity:** Medium
- **Confidence:** Medium
- **Evidence:** The parser usage grep recorded `extensions/agentic-harness/index.ts:40` importing `reloadPlanFromSubagentArgs`/`startPlanSubagentTasks` from `legacy-import-markdown.ts`; `extensions/agentic-harness/index.ts:1926-1930` then calls those parser-derived helpers on every subagent start before persisting `running` status to structured state.
- **Impact:** A primary runtime path can derive task IDs from plan markdown parsing and legacy `PlanProgressTracker` state before writing structured status, so stale or ambiguous markdown can drive the canonical update.
- **Recommendation:** Select plan/task IDs from structured state for subagent lifecycle updates first, and keep legacy parser-derived task matching behind an explicit no-structured-state fallback.

### Finding 6: Contract and parser isolation tests do not cover the remaining bypass instructions or broader parser usage
- **Severity:** Low
- **Confidence:** High
- **Evidence:** `extensions/agentic-harness/tests/skill-docs.test.ts:34-37` only checks that plan-crafting mentions `harness_plan` and `define_tasks`, so it passed while `agentic-plan-crafting/SKILL.md:63` still says checkboxes are for progress tracking. `extensions/agentic-harness/tests/parser-isolation.test.ts:48-56` only blocks direct `plan-progress-events` imports, while the Task 4 grep output still includes primary-runtime references to `parsePlan`, `PlanProgressTracker`, and `MilestoneTracker`.
- **Impact:** The targeted tests can pass even when skill contracts and runtime parser boundaries regress against the structured-state migration contract.
- **Recommendation:** Expand the skill-doc tests to assert absence of markdown-checkbox/state.md source-of-truth instructions, and expand parser-isolation tests to cover the same parser/progress usage boundary as the audit grep.
