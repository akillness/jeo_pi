# Milestone: Background Completion Notification

**ID:** M3
**Status:** pending
**Dependencies:** M2
**Risk:** High
**Effort:** Medium

## Goal

When a background subagent finishes, notify the parent session so it can process results without polling.

## Success Criteria

- [ ] Spike: Determine notification mechanism (Pi extension API hook vs file-based polling vs deferred tool result). Document findings.
- [ ] Background completion triggers a notification to the parent session containing: runId, agent, task, status, summary (exit code, key output)
- [ ] Notification delivery works for both native and tmux backends
- [ ] Parent can acknowledge notification (clears it from pending)
- [ ] Multiple concurrent completions are queued, not dropped
- [ ] If no native API hook exists: file-based notification with parent-side polling (≤500ms latency)

## Files Affected

- Modify: `extensions/agentic-harness/async-registry.ts`
- Modify: `extensions/agentic-harness/subagent.ts`
- Modify: `extensions/agentic-harness/types.ts`

## User Value

Parent gets told when background work finishes — no manual status checks needed. This is the UX that makes async feel seamless.

## Abort Point

Yes — if neither API hook nor file polling works acceptably, async is still useful (users poll manually via M2 status). Notification is high-value but not blocking.

## Notes

- Highest risk milestone due to unknown Pi extension API capabilities.
- Spike must happen before any implementation.
- Fallback: file-based notification with parent-side polling. Reuse tmux 25ms poll pattern.
- If Pi API has `pi.sendUserMessage()` or similar post-return hook, use that instead.
