# Risk Analysis

- **Risk:** `plan-progress-events.ts` and `index.ts` disagree on task identity, especially when `matchedTaskIds` is missing but `planTaskId` is explicit.
- **Severity:** High
- **Affected milestone(s):** Plan lifecycle fix, snapshot/persistence integration
- **Mitigation:** Tackle event-to-task mapping first with focused regression tests. Explicit `planTaskId` should be the authoritative fallback for `plan-validator` success.

- **Risk:** Non-plan agents, reviewers, nested subagents, or text-matched “Task N” references accidentally start/complete plan tasks.
- **Severity:** High
- **Affected milestone(s):** Event filtering, lifecycle semantics
- **Mitigation:** Add guard tests before changing behavior. Whitelist only intended plan roles: `plan-compliance`, `plan-worker`, `plan-validator`; ensure reviewers/nested agents are ignored unless explicitly part of plan execution.

- **Risk:** Completion semantics are easy to misunderstand: `plan-compliance` and `plan-worker` success must keep the task running, while `plan-validator` success completes it.
- **Severity:** High
- **Affected milestone(s):** Plan lifecycle fix
- **Mitigation:** Make this the first behavioral milestone. Encode the lifecycle matrix in tests before implementation.

- **Risk:** Footer render stabilization depends on pi TUI behavior, especially `tui.requestRender(true)` vs non-forced redraws, which may not be fully captured by unit tests.
- **Severity:** High
- **Affected milestone(s):** Footer rendering fix
- **Mitigation:** Isolate extension-level changes only. Prefer replacing forced redraws with non-forced render requests/timer coalescing. Add fake-TUI tests, but reserve manual/interactive verification as a final check.

- **Risk:** Snapshot replay and persistence may regress if task state transitions change.
- **Severity:** Medium/High
- **Affected milestone(s):** Lifecycle fix, integration tests
- **Mitigation:** Keep state-machine changes narrow. Preserve stale `running → pending` replay behavior. Add tests for persisted snapshots with missing/empty matched IDs.

- **Risk:** Spinner timer and tracker change notifications can cause excessive renders or stale renders.
- **Severity:** Medium
- **Affected milestone(s):** Footer rendering fix
- **Mitigation:** Test that tracker changes request render, spinner ticks request render only while running, and disposal clears intervals. Avoid broad TUI core changes.

- **Risk:** `working-visibility.ts` may interact poorly with footer/task state changes, causing duplicate or missing progress UI.
- **Severity:** Medium
- **Affected milestone(s):** Integration verification
- **Mitigation:** Run existing `working-visibility` tests after lifecycle changes. Avoid changing visibility rules unless regression tests prove it is necessary.

- **Risk:** Tests may pass while terminal scrolling remains visible in real usage.
- **Severity:** Medium
- **Affected milestone(s):** Footer rendering fix, final validation
- **Mitigation:** Include one manual/session-level validation note after automated tests. Do not rely solely on mocked `requestRender` assertions for the scrolling symptom.

- **Risk:** Large combined changes across tracker, event mapping, index wiring, footer, and visibility would be expensive to redo.
- **Severity:** High
- **Affected milestone(s):** All
- **Mitigation:** Split into small milestones: lifecycle tests/fix first, footer render behavior second, integration/full suite last.

## Overall risk-ordered milestone sequence

1. **Reproduce and lock lifecycle semantics in tests** — highest ambiguity and regression risk. Add failing tests for explicit `planTaskId` validator completion, compliance/worker non-completion, and non-plan agent guarding.

2. **Fix plan subagent event mapping/completion** — highest integration risk. Make `plan-validator` success complete via explicit `planTaskId` even without `matchedTaskIds`; keep compliance/worker as running-only.

3. **Verify snapshot/index integration** — ensures the event fix survives real `tool_execution_start/end` wiring, persistence, and replay behavior.

4. **Stabilize footer render requests** — tackle visible scrolling after state correctness is fixed. Avoid forced full redraws where possible; keep tracker visible.

5. **Run full regression/build and targeted manual UI check** — final confidence milestone because terminal scrolling may not be fully represented by Vitest mocks.
