# Dependency Analysis

## File Inventory

**Created:** `async-registry.ts` (M1)
**Modified:** `types.ts` (M1,M4), `subagent.ts` (M1,M2,M3,M4), `index.ts` (M2,M3), `runner-events.ts` (M4)

## Dependency DAG

```
M1 (no deps)
 └──→ M2 (depends: M1)
       └──→ M3 (depends: M2)
             └──→ M4 (depends: M3)
```

## File Conflict Matrix

| File | M1 | M2 | M3 | M4 | Constraint |
|------|:--:|:--:|:--:|:--|------------|
| async-registry.ts | CREATE | modify | modify | — | M1 first |
| types.ts | modify | — | — | modify | M1 before M4 |
| subagent.ts | modify | modify | modify | modify | Sequential required |
| index.ts | — | modify | modify | — | M2 before M3 |
| runner-events.ts | — | — | — | modify | M4 only |

## Parallelization

None — subagent.ts contention across all milestones forces sequential execution.

## External Dependencies

- Node.js child_process.spawn() — existing
- Node.js process.kill() — existing
- fs/promises atomic write — existing pattern from team-state.ts
- Pi Extension API — existing (spike needed for notification)
- tmux binary — conditional (executionMode: "tmux")
