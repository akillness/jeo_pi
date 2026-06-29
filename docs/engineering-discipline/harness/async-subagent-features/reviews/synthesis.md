# Synthesis Report

## Conflict Resolution Log

| # | Conflict | Resolution | Rationale |
|---|----------|-----------|-----------|
| 1 | Registry standalone vs embedded | Embed in M1 | Types-only milestone has zero user value |
| 2 | Extension API spike standalone vs folded | Gate in M1 | Same fail-fast, less overhead |
| 3 | Resume in scope | Defer entirely | Large effort, not true resume |
| 4 | Notification location | Separate M3 | High-uncertainty needs isolation |
| 5 | subagent.ts contention | Sequential only | 450-line file, each milestone different section |
| 6 | Dual backend | Native first, tmux M2 | Simpler to prove pattern |

## Final Milestone DAG

```
M1 (Async Spawn Foundation)
 └──→ M2 (Status Query & Interrupt)
       └──→ M3 (Completion Notification)
             └──→ M4 (Tool Schema & Live Progress)
```

## Rejected Proposals

| Proposal | Source | Reason |
|----------|--------|--------|
| Types-only M1 | Architecture | Zero user value |
| Standalone API spike | Risk | Coordination overhead |
| Resume in scope | Feasibility, Risk | Large effort, separate design problem |
| M2+M4 parallel | Dependency | subagent.ts contention |
| Notification in M4 | Architecture | Couples high-uncertainty with straightforward work |
