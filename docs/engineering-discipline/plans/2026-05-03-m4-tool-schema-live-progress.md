# Plan: M4 — Tool Schema Integration & Live Progress

**Goal:** Expose all async features through a backward-compatible `subagent` tool schema with live progress reporting.

**Verification:** `npm test`

---

## Tasks

### Task 1: Add asyncRun to SubagentDetails
- `SubagentDetails.asyncRun?: AsyncRunRecord` — optional field for async run metadata

### Task 2: Return asyncRun in async spawn result
- Async spawn returns `details.asyncRun` with the registry record

### Task 3: E2E lifecycle test
- Full lifecycle: register → update(progress) → complete with result
- Interrupt lifecycle: register → abort via controller

### Task 4: Build + test verification
