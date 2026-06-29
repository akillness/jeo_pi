# Checkpoint: M7 — Legacy Cleanup and Regression Stabilization

**Completed:** 2026-05-06 00:04
**Attempts:** 1

## Plan File

`docs/engineering-discipline/plans/2026-05-06-m7-legacy-cleanup-and-regression-stabilization.md`

## Review File

`docs/engineering-discipline/reviews/2026-05-06-m7-legacy-cleanup-and-regression-stabilization-review.md`

## Test Results

- `./node_modules/.bin/tsc --noEmit`: PASS — clean build
- `npx vitest run` (full suite): PASS — 675 tests passed, 58 files

## Files Changed

- **Modified:** `extensions/agentic-harness/tests/parser-isolation.test.ts` (added source-level import check)
- **Created:** `extensions/agentic-harness/tests/e2e-structured-workflow.test.ts` (3 end-to-end tests)

## Interface Contracts Established

- Source-level test guarantees no non-legacy module imports `plan-progress-events.ts` directly.
- End-to-end tests prove full structured lifecycle: create → persist → replay → restore → render → update.
- `HarnessProgressProvider` end-to-end test validates snapshot loading, render output, and running task detection.

## State After Milestone

Legacy parser paths are isolated behind `legacy-import-markdown.ts`. Structured state is the primary runtime path with full end-to-end test coverage. Ready for M_final (integration verification).
