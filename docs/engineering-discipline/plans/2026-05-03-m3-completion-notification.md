# Plan: M3 — Background Completion Notification

**Goal:** When a background subagent finishes, notify the parent session so it can process results without polling.

**Verification:** `npm test`

---

## Spike Result

Pi ExtensionAPI provides `pi.sendUserMessage(content, { deliverAs: "followUp" })` which injects a user-role message that triggers an LLM turn. Works after tool returns because `pi` is captured in extension closure with extension lifetime.

## Tasks

### Task 1: Add CompletionNotifier to RunRegistry
- Add `CompletionNotifier` type and `setCompletionNotifier()` method
- `complete()` calls the notifier when a run reaches terminal state

### Task 2: Wire notification in index.ts
- In extension factory, set up completion notifier on default registry
- Uses `pi.sendUserMessage()` with `deliverAs: "followUp"` to notify parent
- Format: emoji + agent + task summary + runId + elapsed time

### Task 3: Tests
- CompletionNotifier fires on complete/fail
- Does not fire on register/update
