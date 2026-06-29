# Synthesis Review: Structured Harness State Tools Migration

## Conflict Resolution Log

| Conflict | Resolution | Rationale |
|----------|-----------|-----------|
| Where markdown renderers belong | Pure render functions ship in M1; tool-driven render/export behavior ships in M3. | Renderers depend only on state/selectors, but tool integration should wait for storage/tools. |
| Skill migration ordering | Migrate skills after structured tools exist and before parser removal. | Agents need accurate tool instructions before destructive cleanup. |
| Parser removal timing | Parser paths are quarantined after tools/footer/docs work, then deleted or restricted in final cleanup. | Parser removal is destructive and should happen last. |
| Storage strategy | Use reducer-applied events with ordering metadata plus atomic snapshot writes. | Atomic writes prevent partial files but not lost updates. |
| Replay precedence | Snapshot is durable base; custom events replay after snapshot point; markdown is never primary input. | This removes the current fragile markdown/prose dependency. |

## Final Milestone DAG

1. M1: State Kernel and Pure Renderers
2. M2: Durable Storage and Replay Foundation
3. M3: Structured Harness Tools
4. M4: Skill and Workflow Migration
5. M5: Footer and Progress Cutover
6. M6: Runtime Replay Cutover and Parser Quarantine
7. M7: Legacy Cleanup and Regression Stabilization
8. M_final: Integration Verification

## Execution Order

```text
Phase 1: M1
Phase 2: M2
Phase 3: M3
Phase 4 parallel: M4, M5
Phase 5: M6
Phase 6: M7
Phase 7: M_final
```

## DAG Validation

- No circular dependencies.
- Valid topological order exists.
- M4 and M5 can run in parallel because M4 touches skill docs while M5 touches runtime/footer integration.
- M6 depends on both M4 and M5 because parser quarantine requires both agent workflow migration and footer cutover to be ready.
- M7 is destructive cleanup and therefore follows M6.
- M_final depends on all implementation milestones.

## Rejected Proposals

| Proposal | Source | Reason for rejection |
|----------|--------|---------------------|
| Delete parser-derived runtime paths before skill migration | Feasibility ordering | Too risky; agents may still follow markdown-centric workflows until skills are updated. |
| Put full tool logic in `index.ts` | Architecture conflict note | Would worsen coupling; `index.ts` should remain thin wiring. |
| Treat atomic `state.json` writes alone as sufficient concurrency handling | Feasibility caveat | Atomic writes prevent partial files but not lost updates; reducer events and ordering metadata are needed. |
| Keep markdown parsing as automatic fallback forever | Legacy compatibility path | Undermines structured state as source of truth. |
| Build footer cutover before structured tools exist | UI-first path | Footer needs real structured updates and replay semantics first. |
