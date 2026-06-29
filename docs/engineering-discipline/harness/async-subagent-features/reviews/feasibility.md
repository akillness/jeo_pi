# Feasibility Analysis

## Component Assessment

### 1. Async Fire-and-Forget Spawn
- **Feasibility:** Yes, with significant refactor
- **Effort:** Large
- **Key risk:** runAgent() is ~450-line monolith. Worktree/sandbox cleanup must work in background.

### 2. Run Status Query
- **Feasibility:** Yes
- **Effort:** Small
- **Key risk:** Need RunStatusSummary type (messages array can be large)

### 3. Interrupt
- **Feasibility:** Yes for same-session, Medium for cross-session
- **Effort:** Medium
- **Key risk:** Resume is Large effort — defer.

### 4. Background Completion Notification
- **Feasibility:** Uncertain — depends on Pi extension API
- **Effort:** Uncertain (Small if API supports, Large if polling infra needed)
- **Key risk:** Post-return notification mechanism unknown

### 5. Live Progress
- **Feasibility:** Yes (80% already implemented)
- **Effort:** Small
- **Key risk:** None significant

## Spike Candidates

1. Pi extension API post-return notification
2. runAgent() monolith decomposition
3. Worktree cleanup in background mode

## Underestimation Risks

1. runAgent() refactor scope (likely 2x estimated)
2. Cross-session process management (stale records, PID reuse, orphans)
3. Backward compatibility of subagent tool schema
4. Notification mechanism
5. Tmux session lifetime management
