# Dependency Analysis

Assuming this milestone split:

- **M1:** Fix plan-progress event semantics/guards in `plan-progress-events.ts`.
- **M2:** Update `index.ts` event wiring/snapshot persistence to consume M1 behavior.
- **M3:** Stabilize footer render requests in `footer.ts`.
- **M4:** Final build/test verification.

**Dependency DAG:**
```text
M1 plan-validator completion + non-plan guard
  └─→ M2 index event bridge + snapshot persistence
        └─┐
          ├─→ M4 build + full Vitest verification
M3 footer incremental render behavior
  └───────┘
```

**File conflict matrix:**

| File | Milestones | Ordering constraint |
|------|-----------|-------------------|
| `extensions/agentic-harness/plan-progress-events.ts` | M1 | Produces lifecycle semantics consumed by M2. |
| `extensions/agentic-harness/index.ts` | M2 | Depends on M1 return/side-effect contract; persist snapshots after fallback completion. |
| `extensions/agentic-harness/footer.ts` | M3 | Independent of M1/M2; must stop using forced full redraw for tracker ticks/changes. |
| `extensions/agentic-harness/tests/plan-progress-events.test.ts` | M1 | Add validator fallback + non-plan/reviewer/nested guard regressions. |
| `extensions/agentic-harness/tests/extension.test.ts` | M2 | Add integration test for missing `matchedTaskIds` + snapshot persistence. Depends on M1. |
| `extensions/agentic-harness/tests/plan-progress.test.ts` | M3 | Existing assertions expecting `requestRender(true)` must change. |
| `extensions/agentic-harness/tests/footer.test.ts` | M3 optional | Use here if render behavior tests are kept footer-specific. Avoid duplicating with `plan-progress.test.ts`. |
| `extensions/agentic-harness/working-visibility.ts` | none expected | Do not modify unless M1 breaks `running` semantics; it consumes tracker state only. |

**Interface dependencies:**

- **M1 → M2**
  - `startPlanSubagentTasks(...)`
  - `completePlanSubagentTasks(...)`
  - `subagentItemRecords(...)`
  - New/updated guard semantics for allowed plan agents:
    - allow: `plan-compliance`, `plan-worker`, `plan-validator`
    - reject for plan task state: reviewers, explorer, worker, nested/non-plan agents
  - Critical contract: successful `plan-validator` with explicit `planTaskId` completes a currently-running task even when `matchedTaskIds` is missing/empty.

- **M2 → session replay/persistence**
  - `index.ts` must persist a `plan-progress` snapshot after actual completion/failure, not only when `matchedTaskIds` existed.
  - Replay must use the same M1 helpers so live execution and session reconstruction match.

- **M3 → tests only**
  - `RoachFooter` should request non-forced/incremental renders for plan changes and spinner ticks.
  - Existing tests that assert `requestRender(true)` must be updated to assert no forced redraw.

**Parallelizable groups:**

- **Group A: [M1, M3]** — no shared production files; event semantics and footer render behavior are independent.
- **Group B: [M2]** — can start after M1 contract is stable; can run while M3 is finishing if tests are kept separate.
- **Group C: [M4]** — after M1/M2/M3; run `cd extensions/agentic-harness && npm run build && npm test`.

**External dependencies:**

- `@mariozechner/pi-tui`: required by M3; setup needed: no if dependencies installed. Key API: `TUI.requestRender`.
- `@mariozechner/pi-coding-agent` extension event API: required by M2; setup needed: no, mocked in tests.
- Pi `sessionManager.appendCustomEntry/getBranch`: required by M2; setup needed: no, mocked in tests.
- Node.js + TypeScript + Vitest: required by all verification; setup needed: yes on fresh clone via npm install.
- Filesystem plan loading/replay: required by M1 tests; setup needed: no beyond temp dirs.

**Shared state requiring strict ordering:**

- `planProgress` singleton in `index.ts`: M1 semantics must be correct before M2 persists/replays state.
- `toolCallArgsById` and `planTaskIdsByToolCallId`: start/end correlation must clear only after completion handling.
- `plan-progress` custom session snapshots: persist after actual task state changes, especially fallback validator completion.
- `RoachFooter.spinnerTimer` and tracker subscriptions: M3 must keep dispose/stop behavior intact to avoid leaked render ticks.
