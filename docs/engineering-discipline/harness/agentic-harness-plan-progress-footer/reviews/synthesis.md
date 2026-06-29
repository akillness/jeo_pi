# Synthesis Review: Agentic Harness Plan Progress Footer Stabilization

## Conflict Resolution Log

Reviewers agree that the work is feasible, localized to `extensions/agentic-harness`, should avoid TUI core changes, and must prioritize plan lifecycle correctness before final regression verification.

| Conflict | Resolution | Rationale |
|----------|-----------|-----------|
| Lifecycle completion and non-plan guardrails as separate milestones vs one contract | Combine them into M1 | Architecture/dependency reasoning is stronger: both live in `plan-progress-events.ts` and define one event-to-task mutation contract. |
| Snapshot persistence bundled with lifecycle fix vs separated | Separate into M2 after M1 | Dependency/risk analysis is stronger: `index.ts` should consume the stabilized M1 contract and persist actual affected task IDs. |
| `plan-validator` success with explicit `planTaskId` while `matchedTaskIds` is missing or task is pending | Treat `planTaskId` as authoritative; final state is completed | This directly fixes the user-visible failure and avoids silent no-op completion. If needed, transition pending → running → completed internally. |
| Mixed/nested subagent chains: reject whole call vs filter item-by-item | Filter item-by-item; only whitelisted plan agents mutate plan state | Safer than rejecting legitimate mixed structures while preventing reviewers/workers/explorers from polluting progress. |
| Footer render change before or after lifecycle fix | Footer can run in parallel, but final verification waits for lifecycle + snapshot fixes | Dependency analysis shows no production file conflict; risk analysis still requires integrated validation. |
| `requestRender(false)` vs omitted argument | Allow either, but forbid `requestRender(true)` for footer ticks/state changes | The key architectural requirement is avoiding forced full redraws while still repainting footer state. |

## Milestone DAG

### M1: Plan Lifecycle Event Contract Hardening
- **Goal:** Make plan task state changes correct and limited to intended plan execution agents.
- **Success Criteria:**
  - [ ] `plan-validator` success with explicit `planTaskId` completes the correct task even when `matchedTaskIds` is missing or empty.
  - [ ] Regression test proves expected state such as Task 1 completed and Task 2 still running: `1/4 │ 1 running`.
  - [ ] `plan-compliance` and `plan-worker` success leave tasks running; failures mark the corresponding task failed.
  - [ ] Reviewers, explorer, generic worker, nested non-plan agents, and incidental “Task N” text do not mutate plan task state.
- **Dependencies:** None
- **Files:** `extensions/agentic-harness/plan-progress-events.ts`, `extensions/agentic-harness/tests/plan-progress-events.test.ts`
- **Risk:** High
- **Effort:** Medium
- **User Value:** The tracker becomes trustworthy: validator success advances the task, while unrelated agents no longer corrupt progress.
- **Abort Point:** Yes

### M2: Index Snapshot and Replay Consistency
- **Goal:** Ensure live execution, persistence, and replay use the corrected lifecycle contract.
- **Success Criteria:**
  - [ ] `index.ts` persists `plan-progress` snapshots after actual completion/failure, not only when `matchedTaskIds` existed.
  - [ ] Explicit `planTaskId` validator completion survives session snapshot persistence.
  - [ ] Replay preserves stale `running → pending` behavior.
  - [ ] `extension.test.ts` covers missing/empty `matchedTaskIds`, explicit `planTaskId`, and ignored non-plan events through tool start/end wiring.
- **Dependencies:** M1
- **Files:** `extensions/agentic-harness/index.ts`, `extensions/agentic-harness/tests/extension.test.ts`
- **Risk:** High
- **Effort:** Medium
- **User Value:** Restart/replay behavior remains consistent with what users saw during live execution.
- **Abort Point:** No

### M3: Footer Render Invalidation Stabilization
- **Goal:** Stop footer progress updates and spinner ticks from forcing full TUI redraws while keeping progress visible.
- **Success Criteria:**
  - [ ] Tracker changes and spinner ticks request non-forced renders via `requestRender()` or `requestRender(false)`.
  - [ ] Tests assert `requestRender(true)` is not used for repeated footer progress/spinner updates.
  - [ ] Spinner timer starts only while plan tasks are running and stops/cleans up on completion or `dispose()`.
  - [ ] Existing footer rendering remains width-safe and visible.
- **Dependencies:** None
- **Files:** `extensions/agentic-harness/footer.ts`, `extensions/agentic-harness/tests/plan-progress.test.ts`, `extensions/agentic-harness/tests/footer.test.ts`
- **Risk:** High
- **Effort:** Medium
- **User Value:** Terminal output should stop visibly scrolling downward during plan progress updates.
- **Abort Point:** Yes, once M1/M2 are also complete

### M4: Automated Regression and Manual UI Check
- **Goal:** Verify lifecycle, footer, visibility, and extension wiring regression together.
- **Success Criteria:**
  - [ ] `cd extensions/agentic-harness && npm run build` passes.
  - [ ] `cd extensions/agentic-harness && npm test` passes.
  - [ ] Relevant suites pass, including plan progress events, extension wiring, footer, and working visibility tests.
  - [ ] Manual/session-level check or recorded validation note confirms no footer-induced downward scrolling during active spinner updates.
- **Dependencies:** M1, M2, M3
- **Files:** No production files expected; full verification over `extensions/agentic-harness/tests/**`
- **Risk:** Medium
- **Effort:** Small
- **User Value:** Merge-ready confidence with automated and terminal-level validation.
- **Abort Point:** Yes

### M5: Integration Verification
- **Goal:** Validate that all milestones work together as a complete system.
- **Success Criteria:**
  - [ ] `cd extensions/agentic-harness && npm run build && npm test` passes.
  - [ ] All milestone success criteria remain valid after full integration.
  - [ ] No regressions in pre-existing functionality.
  - [ ] Cross-milestone interfaces are exercised end-to-end.
- **Dependencies:** M1, M2, M3, M4
- **Files:** None
- **Risk:** Medium
- **Effort:** Small
- **User Value:** Confidence that the system works as a whole, not just per-milestone.
- **Abort Point:** No

## DAG Validation

- **No circular dependencies:** Yes. Edges are `M1 → M2 → M4 → M5` and `M3 → M4 → M5`.
- **Valid topological order exists:** Yes: `M1, M3, M2, M4, M5`.
- **No file conflicts between parallel milestones:** Yes. M1 touches lifecycle event files; M3 touches footer/render files.
- **Each milestone leaves system working:** Yes; each includes targeted tests or final regression verification.
- **First milestone is minimum viable:** Yes. M1 fixes the core user-visible failure: validator success completes the task via explicit `planTaskId`.

## Execution Order

```text
Phase 1 (parallel): M1, M3
Phase 2 (after M1; can overlap with unfinished M3 if needed): M2
Phase 3 (after M1, M2, M3): M4
Phase 4 (after all): M5 Integration Verification
```

## Rejected Proposals

| Proposal | Source | Reason for rejection |
|----------|--------|---------------------|
| Broad pi TUI core changes | User Value / Risk | Too risky and unnecessary; the issue should be isolated to footer render requests. |
| Hide/redesign the tracker or make styling changes | User Value | Low-value scope creep; does not fix lifecycle correctness. |
| Keep non-plan text matching for `worker`/reviewer agents | Architecture / Risk | Causes accidental task starts/completions from incidental “Task N” text. |
| Complete all matched IDs in a mixed chain when any validator succeeds | Architecture / Dependency | Loses per-agent association and can complete unrelated tasks. |
| Persist snapshots only when `matchedTaskIds` exists | Feasibility / Risk | This is part of the bug; explicit `planTaskId` completion must persist. |
| Reject an entire chain/tool call if it contains any non-plan agent | Feasibility spike | Too strict; item-level filtering preserves legitimate mixed calls safely. |
| Revert to single-listener `setOnChange` | Architecture | Could break footer and working visibility subscribers; keep multi-subscriber behavior. |
