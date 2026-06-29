# Welcome Header / Optional Overlay Controller Review

**Date:** 2026-05-03 21:11
**Plan Document:** `docs/engineering-discipline/plans/2026-05-03-welcome-header-overlay.md`
**Verdict:** PASS

## Scope Baseline Decision

The repository contains unrelated dirty/untracked files from separate work. As with M1/M2, this review verifies M3 planned files and explicit out-of-scope guards.

## File Inspection Against Plan

| Planned File | Status | Notes |
|---|---|---|
| `extensions/agentic-harness/welcome-ui.ts` | OK | Extracts welcome header rendering and exposes show, dismiss, toggle, visibility, and `/welcome` command registration. |
| `extensions/agentic-harness/tests/welcome-ui.test.ts` | OK | Covers header render, show/dismiss/toggle, and `/welcome on/off/toggle`. |
| `extensions/agentic-harness/index.ts` | OK | Registers `/welcome` and replaces inline startup header with `showWelcomeHeader(ctx.ui)` while preserving footer wiring. |
| `extensions/agentic-harness/tests/extension.test.ts` | OK | Verifies command registration and exactly one startup header installation. |

## Acceptance Criteria

| Criterion | Status | Evidence |
|---|---|---|
| Welcome UI appears on startup using `setHeader`. | OK | `index.ts` calls `showWelcomeHeader(ctx.ui)` during `session_start`. |
| User can dismiss and restore the welcome UI. | OK | `/welcome off` clears header; `/welcome on` restores header; toggle covered too. |
| Overlay fallback path uses non-blocking header behavior. | OK | No modal/overlay startup path added; header factory returns `Text`. |
| Tests cover show, dismiss, restore, and no duplicate competing header registration. | OK | `welcome-ui.test.ts` and `extension.test.ts` cover these behaviors. |

## Test Results

- `npm --prefix extensions/agentic-harness test -- --run tests/welcome-ui.test.ts tests/extension.test.ts` — PASS, 54 tests.
- `npm --prefix extensions/agentic-harness test && npm --prefix extensions/agentic-harness run build` — PASS, 556 tests; `tsc --noEmit` passed.
- `git diff -- extensions/agentic-harness/package.json extensions/agentic-harness/package-lock.json extensions/fff-search/index.ts` — PASS, no diff.

## Code Quality

- No new runtime dependencies.
- No `pi-powerline-footer` dependency or vendored code.
- Welcome header is modular and no longer embedded in `index.ts`.
- Startup remains non-blocking; no risky overlay focus behavior was introduced.

## Overall Assessment

M3 satisfies the plan and milestone criteria. The welcome UI is now first-class, command-controllable, and safely implemented via the existing header API.
