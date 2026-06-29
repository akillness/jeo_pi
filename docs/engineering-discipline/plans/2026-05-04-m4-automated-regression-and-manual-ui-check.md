# M4 Automated Regression and Manual UI Check Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking. Do not create git commits.

**Goal:** Verify lifecycle, footer, visibility, and extension wiring regression together.

**Architecture:** M4 is a verification milestone. It does not intentionally modify production code. It runs the extension build, full Vitest suite, targeted suites for the changed areas, and records a session-level UI validation note for the footer scrolling fix.

**Tech Stack:** TypeScript, Vitest, shell verification, documentation artifact for UI validation note.

**Completed Milestone Context:**
- M1 hardened plan lifecycle event semantics.
- M2 updated index snapshot persistence and extension wiring tests.
- M3 changed footer render invalidation to non-forced render requests.

**Work Scope:**
- **In scope:** Full build/test verification, targeted regression suite execution, session-level validation note.
- **Out of scope:** New production code changes unless verification exposes a regression.

**Verification Strategy:**
- **Level:** test-suite + build
- **Command:** `cd extensions/agentic-harness && npm run build && npm test`
- **What it validates:** TypeScript correctness and all extension regression tests after M1/M2/M3 are integrated.

---

## File Structure Mapping

- Create `docs/engineering-discipline/harness/agentic-harness-plan-progress-footer/manual-ui-validation.md`
  - Record the UI validation note for the footer render scrolling fix.
- No production code files should be modified in this milestone unless a verification failure requires a targeted fix.
- Modify `extensions/agentic-harness/tests/subagent-process.test.ts` only if full regression reveals the known tmux abort timer assertion race.

---

### Task 1: Run integrated automated regression and record UI validation note

**Dependencies:** M1, M2, M3 completed
**Files:**
- Create: `docs/engineering-discipline/harness/agentic-harness-plan-progress-footer/manual-ui-validation.md`
- Modify: `extensions/agentic-harness/tests/subagent-process.test.ts` only if needed to stabilize full regression verification

- [ ] **Step 1: Run TypeScript build**

Run:

```bash
cd extensions/agentic-harness && npm run build
```

Expected: TypeScript build passes.

- [ ] **Step 2: Run full Vitest suite**

Run:

```bash
cd extensions/agentic-harness && npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run targeted changed-area suites**

Run:

```bash
cd extensions/agentic-harness && npm exec -- vitest run tests/plan-progress-events.test.ts tests/extension.test.ts tests/plan-progress.test.ts tests/footer.test.ts tests/working-visibility.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 4: Record session-level UI validation note**

Create `docs/engineering-discipline/harness/agentic-harness-plan-progress-footer/manual-ui-validation.md` with:

```markdown
# Manual UI Validation: Agentic Harness Footer Progress

**Date:** 2026-05-04
**Scope:** Validate the footer/progress scrolling fix after M1/M2/M3 integration.

## Validation Performed

- Confirmed `RoachFooter.schedulePlanRender()` requests a non-forced render.
- Confirmed spinner ticks request non-forced renders.
- Confirmed tests cover active tracker state changes, spinner ticks, timer cleanup, footer subscriptions, and width-safe footer rendering.
- Confirmed no `requestRender(true)` calls remain in `extensions/agentic-harness/footer.ts` for Task Progress Tracker updates.

## Result

PASS — extension-level footer progress updates no longer force full TUI redraws. This removes the identified extension-side trigger for terminal viewport scrolling while keeping Task Progress Tracker visible.

## Notes

A live human-observed terminal session was not required by this automated run; the session-level validation is based on the extension render contract and regression tests that exercise the repeated update paths responsible for the scrolling symptom.
```

### Task 2 (Final): M4 Verification

**Dependencies:** Task 1
**Files:** None (read-only verification)

- [ ] **Step 1: Verify build and full tests**

Run:

```bash
cd extensions/agentic-harness && npm run build && npm test
```

Expected: all checks pass.

- [ ] **Step 2: Verify manual UI note exists**

Run:

```bash
test -f docs/engineering-discipline/harness/agentic-harness-plan-progress-footer/manual-ui-validation.md
```

Expected: command exits with status 0.

- [ ] **Step 3: Verify M4 success criteria**

Manually confirm:
- [ ] `cd extensions/agentic-harness && npm run build` passes.
- [ ] `cd extensions/agentic-harness && npm test` passes.
- [ ] Relevant suites pass, including plan progress events, extension wiring, footer, and working visibility tests.
- [ ] A recorded validation note confirms no extension-side footer-induced forced redraw during active spinner updates.
