# User Value Analysis

**Value-ordered milestone sequence:**
1. **Fix plan task completion semantics** — **Value:** User sees the core expected state: `1/4 │ 1 running`, Task 1 as `✓`, Task 2 spinning after Task 1 validator succeeds. — **Demo:** Add/run a targeted `plan-progress-events` regression where `plan-validator` succeeds with explicit `planTaskId` but no `matchedTaskIds`.

2. **Guard task state from non-plan / nested agents** — **Value:** Tracker stops being polluted by reviewers, nested subagents, or incidental “Task N” text. Progress becomes trustworthy. — **Demo:** Tests showing `plan-compliance` / `plan-worker` do not complete tasks, reviewers do not start tasks, and nested subagents cannot mutate unrelated task state.

3. **Stabilize footer rendering behavior** — **Value:** During plan execution/spinner ticks, the terminal no longer visibly scrolls downward while the tracker remains visible. — **Demo:** Footer tests asserting tracker change/tick renders avoid forced full redraw behavior, plus manual run if available.

4. **Snapshot/replay consistency pass** — **Value:** Restart/replay behavior remains stable; stale running tasks are demoted correctly without reintroducing incorrect completion/start states. — **Demo:** Existing/new `extension.test.ts` or snapshot tests covering persisted plan progress across session replay.

5. **Full regression/build verification** — **Value:** Confidence that the fix did not regress footer, working visibility, milestone tracker, or extension wiring. — **Demo:** `cd extensions/agentic-harness && npm run build && npm test`.

**Minimum viable milestone:** Milestone 1. It proves the primary user-visible failure is fixed: validator success advances the tracker to completed even when `matchedTaskIds` is unavailable.

**Natural abort points:** After milestone 1 if the main correctness bug is urgent; after milestone 3 if both visible symptoms are fixed; after milestone 5 for merge-ready confidence.

**Low-value milestones:** Broad TUI-core changes, tracker redesign/hiding, styling tweaks, unrelated prompt/product changes, and large refactors not needed for lifecycle or render stability.
