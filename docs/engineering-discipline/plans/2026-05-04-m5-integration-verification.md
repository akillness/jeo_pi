# M5 Integration Verification Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking. Do not create git commits.

**Goal:** Validate that all milestones work together as a complete system.

**Architecture:** M5 is a read-only final verification milestone. It verifies the build, full test suite, changed-area tests, milestone success criteria, and cross-milestone interfaces after M1 through M4 are complete.

**Tech Stack:** TypeScript, Vitest, shell verification, checkpoint/review artifacts.

**Completed Milestone Context:**
- M1: lifecycle event contract hardened.
- M2: index snapshot persistence updated to use actual affected IDs.
- M3: footer render invalidation changed to non-forced render requests.
- M4: full regression and UI validation note completed.

**Work Scope:**
- **In scope:** Read-only final integration verification and completion summary.
- **Out of scope:** New production/test code changes unless final verification exposes a blocking regression.

**Verification Strategy:**
- **Level:** test-suite + build
- **Command:** `cd extensions/agentic-harness && npm run build && npm test`
- **What it validates:** TypeScript correctness and all extension regression tests after all milestones are integrated.

---

## File Structure Mapping

- Create `docs/engineering-discipline/harness/agentic-harness-plan-progress-footer/completion-summary.md`
  - Record final verification results and aggregate files changed.
- No production or test files should be modified in this milestone unless final verification exposes a blocking regression.

---

### Task 1: Final integration verification

**Dependencies:** M1, M2, M3, M4 completed
**Files:**
- Create: `docs/engineering-discipline/harness/agentic-harness-plan-progress-footer/completion-summary.md`

- [ ] **Step 1: Run final build and full test suite**

Run:

```bash
cd extensions/agentic-harness && npm run build && npm test
```

Expected: build passes and all tests pass.

- [ ] **Step 2: Run changed-area targeted suites**

Run:

```bash
cd extensions/agentic-harness && npm exec -- vitest run tests/plan-progress-events.test.ts tests/extension.test.ts tests/plan-progress.test.ts tests/footer.test.ts tests/working-visibility.test.ts tests/subagent-process.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 3: Verify required artifacts exist**

Run:

```bash
test -f docs/engineering-discipline/harness/agentic-harness-plan-progress-footer/checkpoints/M1-checkpoint.md && \
test -f docs/engineering-discipline/harness/agentic-harness-plan-progress-footer/checkpoints/M2-checkpoint.md && \
test -f docs/engineering-discipline/harness/agentic-harness-plan-progress-footer/checkpoints/M3-checkpoint.md && \
test -f docs/engineering-discipline/harness/agentic-harness-plan-progress-footer/checkpoints/M4-checkpoint.md && \
test -f docs/engineering-discipline/harness/agentic-harness-plan-progress-footer/manual-ui-validation.md
```

Expected: command exits with status 0.

- [ ] **Step 4: Record completion summary**

Create `docs/engineering-discipline/harness/agentic-harness-plan-progress-footer/completion-summary.md` with final test results, milestone summary, and aggregate files changed.

### Task 2 (Final): M5 Verification

**Dependencies:** Task 1
**Files:** None (read-only verification)

- [ ] **Step 1: Verify final build and full tests**

Run:

```bash
cd extensions/agentic-harness && npm run build && npm test
```

Expected: all checks pass.

- [ ] **Step 2: Verify completion summary exists**

Run:

```bash
test -f docs/engineering-discipline/harness/agentic-harness-plan-progress-footer/completion-summary.md
```

Expected: command exits with status 0.

- [ ] **Step 3: Verify M5 success criteria**

Manually confirm:
- [ ] `cd extensions/agentic-harness && npm run build && npm test` passes.
- [ ] All milestone success criteria remain valid after full integration.
- [ ] No regressions in pre-existing functionality.
- [ ] Cross-milestone interfaces are exercised end-to-end.
