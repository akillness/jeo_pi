# Feasibility Analysis

Overall: **feasible with the existing TypeScript + Vitest stack**. No new dependency or large pi TUI core change appears necessary. The only uncertain part is proving the terminal “scroll downward” symptom is fully eliminated without a live/manual repro; unit tests can verify the extension stops forcing full redraws.

- **Name:** Plan task lifecycle completion semantics  
- **Effort:** Medium  
- **Feasibility risk:** Medium — the core bug is localized in `completePlanSubagentTasks`, but correctness also touches `index.ts` snapshot persistence and session replay behavior.  
- **Key deliverable:** `plan-validator` success with explicit `planTaskId` completes the task even when `matchedTaskIds` is missing; `plan-compliance` / `plan-worker` success keep tasks running; failures still fail tasks. Tests cover the expected `1/4 │ 1 running` state.

- **Name:** Subagent event guardrails  
- **Effort:** Medium  
- **Feasibility risk:** Medium — current behavior allows non-plan agents whose text mentions “Task N” to start plan tasks, so this changes established semantics and tests.  
- **Key deliverable:** Only plan execution agents/stages affect plan task state. Reviewers, generic workers, explorers, and nested/non-plan subagents do not start or complete tracker tasks accidentally.

- **Name:** Footer render stabilization  
- **Effort:** Small to Medium  
- **Feasibility risk:** Medium — changing `footer.ts` from forced `requestRender(true)` to normal/differential render requests is straightforward, but visual scroll elimination may need manual terminal verification beyond Vitest.  
- **Key deliverable:** Plan/footer state changes and spinner ticks request non-forced renders; timers still start/stop correctly; regression tests assert no repeated forced redraw calls.

- **Name:** Integration regression pass  
- **Effort:** Small  
- **Feasibility risk:** Low — existing test suite already covers most affected files.  
- **Key deliverable:** Updated tests in `plan-progress-events.test.ts`, `plan-progress.test.ts`, `footer.test.ts` / `extension.test.ts` as needed, with `npm run build && npm test` passing.

**Spike candidates:**
- Terminal-level confirmation that non-forced footer renders stop the visible downward scrolling in a real pi session.
- Decide exact fallback semantics for `plan-validator` with explicit `planTaskId` when the task is still `pending`: complete directly vs. start-then-complete.
- Confirm whether nested `chain` / `tasks` structures should be filtered item-by-item or rejected wholesale when any non-plan agent is present.

**Underestimation risks:**
- Snapshot persistence currently depends on `matchedTaskIds`; fallback completion may update UI but fail to persist unless `index.ts` uses returned completed IDs.
- Existing tests encode permissive non-plan matching behavior, so guardrail changes may require careful test rewrites.
- Footer line-count changes can still trigger TUI full redraws in some viewport cases even if the extension stops forcing them.
