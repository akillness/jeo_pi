# M3 Footer Render Invalidation Stabilization Implementation Plan

> **Worker note:** Execute this plan task-by-task using the agentic-run-plan skill or subagents. Each step uses checkbox (`- [ ]`) syntax for progress tracking. Do not create git commits.

**Goal:** Stop footer progress updates and spinner ticks from forcing full TUI redraws while keeping Task Progress Tracker visible.

**Architecture:** Keep `RoachFooter` render output unchanged and only change render invalidation behavior. Tracker changes and spinner ticks should still request a render, but they must use non-forced rendering (`requestRender()` or `requestRender(false)`) rather than `requestRender(true)`.

**Tech Stack:** TypeScript, Vitest, existing `RoachFooter`, `PlanProgressTracker`, and mocked TUI render requests.

**Work Scope:**
- **In scope:** `RoachFooter` render request calls, timer behavior tests, tests that assert no forced full redraws for progress/spinner updates.
- **Out of scope:** Task lifecycle semantics, `index.ts` snapshot persistence, footer visual redesign, pi TUI core changes.

**Verification Strategy:**
- **Level:** test-suite
- **Command:** `cd extensions/agentic-harness && npm exec -- vitest run tests/plan-progress.test.ts tests/footer.test.ts`
- **What it validates:** Footer progress rendering remains visible/width-safe and render invalidation no longer forces full redraws.

---

## File Structure Mapping

- Modify `extensions/agentic-harness/footer.ts`
  - Replace repeated forced render requests in `schedulePlanRender()` and spinner ticks with non-forced render requests.
  - Preserve spinner timer start/stop/dispose behavior.
- Modify `extensions/agentic-harness/tests/plan-progress.test.ts`
  - Update assertions that currently expect `requestRender(true)` so they expect non-forced calls and explicitly reject `true`.
- Modify `extensions/agentic-harness/tests/footer.test.ts` only if needed for footer-specific regression coverage.

---

### Task 1: Stabilize RoachFooter render invalidation

**Dependencies:** None
**Files:**
- Modify: `extensions/agentic-harness/footer.ts`
- Modify: `extensions/agentic-harness/tests/plan-progress.test.ts`
- Modify: `extensions/agentic-harness/tests/footer.test.ts` only if needed

- [ ] **Step 1: Update tests to reject forced renders**

In `extensions/agentic-harness/tests/plan-progress.test.ts`, update the `RoachFooter plan progress hosting` tests so they assert these behaviors:

1. For `requests a TUI render when tracked plan state changes`, after `tracker.startTask(1)`:

```ts
expect(requestRender).toHaveBeenCalledWith();
expect(requestRender.mock.calls.every((call) => call[0] !== true)).toBe(true);
```

2. For spinner timer tests, keep the existing call-count assertions but add:

```ts
expect(requestRender.mock.calls.every((call) => call[0] !== true)).toBe(true);
```

3. For `keeps active footer subscriptions when another footer is disposed`, replace `toHaveBeenCalledWith(true)` with `toHaveBeenCalledWith()` and assert the active footer did not receive forced calls:

```ts
expect(firstRender).toHaveBeenCalledWith();
expect(secondRender).toHaveBeenCalledWith();
expect(firstRender.mock.calls.every((call) => call[0] !== true)).toBe(true);
expect(secondRender.mock.calls.every((call) => call[0] !== true)).toBe(true);
```

- [ ] **Step 2: Verify updated tests fail before implementation**

Run:

```bash
cd extensions/agentic-harness && npm exec -- vitest run tests/plan-progress.test.ts tests/footer.test.ts
```

Expected before implementation: assertions that reject `requestRender(true)` fail.

- [ ] **Step 3: Replace forced render requests in RoachFooter**

In `extensions/agentic-harness/footer.ts`, update `RoachFooter.schedulePlanRender()` and the spinner interval callback so they call the TUI without the forced flag:

```ts
private schedulePlanRender() {
  this.updateSpinnerTimer();
  this.tui?.requestRender();
}
```

And inside `setInterval`:

```ts
this.tui?.requestRender();
```

Do not change `render(width)` output, footer presets, Powerline rendering, tracker state logic, or pi TUI internals.

- [ ] **Step 4: Run targeted footer tests**

Run:

```bash
cd extensions/agentic-harness && npm exec -- vitest run tests/plan-progress.test.ts tests/footer.test.ts
```

Expected: all targeted footer/progress tests pass.

- [ ] **Step 5: Run TypeScript build**

Run:

```bash
cd extensions/agentic-harness && npm run build
```

Expected: TypeScript build passes.

### Task 2 (Final): M3 Verification

**Dependencies:** Task 1
**Files:** None (read-only verification)

- [ ] **Step 1: Run M3 highest-level verification**

Run:

```bash
cd extensions/agentic-harness && npm exec -- vitest run tests/plan-progress.test.ts tests/footer.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run build**

Run:

```bash
cd extensions/agentic-harness && npm run build
```

Expected: TypeScript build passes.

- [ ] **Step 3: Verify M3 success criteria**

Manually confirm:
- [ ] Tracker changes and spinner ticks request non-forced renders via `requestRender()` or `requestRender(false)`.
- [ ] Tests assert `requestRender(true)` is not used for repeated footer progress/spinner updates.
- [ ] Spinner timer starts only while plan tasks are running and stops/cleans up on completion or `dispose()`.
- [ ] Existing footer rendering remains width-safe and visible.
