# Checkpoint: M3 — Welcome Header / Optional Overlay Controller

**Completed:** 2026-05-03 21:11
**Attempts:** 1

## Plan File

`docs/engineering-discipline/plans/2026-05-03-welcome-header-overlay.md`

## Review File

`docs/engineering-discipline/reviews/2026-05-03-welcome-header-overlay-review.md`

## Test Results

- `npm --prefix extensions/agentic-harness test -- --run tests/welcome-ui.test.ts tests/extension.test.ts` — PASS (54/54 tests)
- `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build` — PASS (556/556 tests; `tsc --noEmit` passed)
- `git diff -- extensions/agentic-harness/package.json extensions/agentic-harness/package-lock.json extensions/fff-search/index.ts` — PASS (no diff)

## Files Changed

- Created: `extensions/agentic-harness/welcome-ui.ts`
- Created: `extensions/agentic-harness/tests/welcome-ui.test.ts`
- Modified: `extensions/agentic-harness/index.ts`
- Modified: `extensions/agentic-harness/tests/extension.test.ts`

## Interface Contracts Established

- `createWelcomeHeader()` returns a Pi header factory.
- `showWelcomeHeader(ui)` installs the header via `setHeader`.
- `dismissWelcomeHeader(ui)` clears the header via `setHeader(undefined)`.
- `toggleWelcomeHeader(ui)` toggles session-local visibility and returns the new visible state.
- `/welcome on|show|restore`, `/welcome off|hide|dismiss`, and `/welcome toggle` are supported.

## State After Milestone

The startup welcome header is extracted from `index.ts`, can be dismissed/restored by command, and remains non-blocking. No overlay/modal behavior was introduced because safe header composition satisfies the first-release UX goal.
