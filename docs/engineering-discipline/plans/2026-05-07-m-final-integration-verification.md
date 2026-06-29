# Plan: M_final — Integration Verification

## Goal

Validate that the structured harness state migration works end-to-end as a complete system.

## Tasks

### Task 1: Package build and full test suite

Run:

```bash
cd extensions/agentic-harness && npm run build && npm test
```

Acceptance criteria:
- Build passes.
- Full test suite passes.

### Task 2: Structured workflow verification

Verify structured milestone/plan/todo workflow works through harness tools and structured tests.

Acceptance criteria:
- `harness_milestone`, `harness_plan`, and `harness_todo` tool tests pass.
- Structured end-to-end workflow test passes.

### Task 3: Session resume and footer verification

Verify structured session restore and footer progress use structured state/custom events.

Acceptance criteria:
- Session replay tests pass.
- Footer and harness progress tests pass.

### Task 4: Parser quarantine and rendered markdown verification

Verify markdown/prose parsers remain isolated behind explicit legacy import and rendered markdown is not primary input.

Acceptance criteria:
- Parser isolation tests pass.
- Skill docs require structured tools and rendered output only.

### Task 5: Milestone criteria audit

Audit M1–M7 reviews/checkpoints and current test coverage to ensure milestone success criteria remain valid after integration.

Acceptance criteria:
- Completed milestone checkpoints/reviews exist.
- No final integration evidence contradicts prior success criteria.

### Task 6: Correct concurrent structured tool mutation race

During final structured state backfill, same-run parallel `harness_milestone` mutations exposed a snapshot overwrite race. Fix the mutation path and verify it cannot lose concurrent updates.

Acceptance criteria:
- Same-run concurrent harness mutations are serialized.
- Regression test proves all concurrent milestone creates persist.
- Full build and test suite passes after the fix.
