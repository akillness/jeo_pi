# User Value Analysis

## Value-Ordered Sequence

1. **M1: Async spawn + runId** — Unblocks parent session. Transformational change.
2. **M2: Status + interrupt** — "What's running?" + "Stop that." Core control.
3. **M3: Completion notification** — Hands-off background execution. Seamless UX.
4. **M4: Tool schema + live progress** — Everything through one tool interface.

## Minimum Viable Milestone

**M1** — proves async concept end-to-end. If spike fails, zero implementation cost wasted.

## Natural Abort Points

| After | Usefulness | Reasoning |
|-------|-----------|-----------|
| M1+M2 | High | Async execution + status/interrupt covers primary use case |
| M3 | Very High | + notification = complete feature for most workflows |
| M4 | Maximum | Full feature set, no remaining gaps |

## Cut Candidates

1. **M4 (interrupt/resume)** — Lowest priority. Safety mechanism, not primary workflow. (Note: resume already cut from scope)
2. **Live progress** within M3 — Status query covers 80% of monitoring need.

## Feedback Sensitivity

| Milestone | Sensitivity | Why |
|-----------|-------------|-----|
| M1 | High | If async breaks blocking mode or API can't support it, plan fails |
| M2 | High | Notification UX must feel natural |
| M3 | Medium | Format decisions benefit from feedback |
| M4 | Low | Straightforward UX |
