# Checkpoint: M3 — Background Completion Notification

**Completed:** 2026-05-03
**Attempts:** 1

## Test Results
- 42 test files passed
- 521 tests passed
- `npx tsc --noEmit` — zero errors

## Files Changed

**Modified:**
- `extensions/agentic-harness/async-registry.ts` — Added `CompletionNotifier` type, `setCompletionNotifier()` method, notifier call in `complete()`
- `extensions/agentic-harness/index.ts` — Set up completion notifier on default registry using `pi.sendUserMessage()` with `deliverAs: "followUp"`
- `extensions/agentic-harness/tests/async-registry.test.ts` — 3 new tests for completionNotifier

## Interfaces Established

- `CompletionNotifier = (record: AsyncRunRecord) => void`
- `RunRegistry.setCompletionNotifier(notifier)` — registers callback for run completion
- Notification format: `✅/❌/⚠️ Async subagent completed: {agent} — {task}\nRun: {runId} | {summary} | {elapsed}s`

## State After Milestone

- Background subagent completion triggers automatic `pi.sendUserMessage()` notification to parent session
- Notification delivered as "followUp" — queued behind current turn if agent is streaming
- No polling required — event-driven notification
