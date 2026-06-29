# Architecture Analysis

## Milestone Boundaries

### M1: Data Model + Process Registry + Async Spawn
- **Rationale:** Types + registry + spawn are one cohesive concern
- **Interfaces:** AsyncRunRecord, RunRegistry, ToolActivity, RunProgress
- **Leaves system working:** Yes — blocking mode untouched

### M2: Status Query & Interrupt
- **Rationale:** Control plane extends registry
- **Interfaces:** RunRegistry.interrupt(), disk persistence
- **Leaves system working:** Yes — additive capabilities

### M3: Completion Notification
- **Rationale:** High-uncertainty spike needs isolation
- **Interfaces:** Notification delivery mechanism
- **Leaves system working:** Yes — additive

### M4: Tool Schema & Live Progress
- **Rationale:** Integration boundary where all prior work converges
- **Interfaces:** Extended SubagentParams schema
- **Leaves system working:** Yes — backward compatible

## Dependency Graph

```
M1 → M2 → M3 → M4
```

Linear chain. No parallel tracks.

## Interface Risks

1. AsyncRunRecord shape may evolve during resume (deferred)
2. Parent notification mechanism undefined (spike in M3)
3. lastActivity formalization may surface type errors
4. TypeBox schema backward compatibility

## Pattern Conflicts

1. No EventEmitter in extension — use PlanProgressTracker.subscribeOnChange() pattern
2. Durable persistence: extract shared atomic-write utility from team-state.ts
3. lastActivity set via any-typed result — formalize in types.ts
