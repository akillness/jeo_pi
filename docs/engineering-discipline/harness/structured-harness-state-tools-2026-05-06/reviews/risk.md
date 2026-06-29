# Risk Review: Structured Harness State Tools Migration

## Key Risks

| Risk | Severity | Affected Areas | Mitigation |
|---|---|---|---|
| Canonical schema/reducer is wrong or unstable | Critical | All milestones | Build state kernel first with invariants and reducer tests. |
| Tool schemas are too complex for agents | High | Tools, skills | Keep small action sets, strict enums, idempotent updates, agent-readable errors. |
| Snapshot/replay precedence ambiguous | Critical | Storage, events, resume | Define snapshot as durable base and custom entries as ordered updates after snapshot. |
| Concurrent updates corrupt state | High | Storage, tools | Use reducer events, ordering metadata, atomic snapshots; add CAS/locking if tests reveal lost updates. |
| Footer stops updating live | High | Footer, runtime | Preserve render notification behavior before deleting tracker paths. |
| Parser removal breaks workflows | High | Runtime, skills | Do not remove parsers until tools, storage, replay, footer, and docs work. |
| Skills remain markdown-centric | High | Skills | Update prompts with mandatory tool-call examples. |
| Markdown rendering becomes source of truth again | Medium | Renderers, docs | Renderers must be pure output; no runtime parser use except explicit legacy import. |
| Existing tests become misleading | Medium | Tests | Add structured coverage before deleting parser assertions. |
| `index.ts` grows too large | Medium | Tool registration | Keep logic in focused modules and `index.ts` as wiring only. |

## Risk-Ordered Sequence

1. State kernel: schema, reducer, invariants, status transitions
2. Durable storage + event/replay model
3. Structured tool APIs over reducer
4. Markdown renderers as structured-state exports
5. Footer/progress integration from structured state
6. Runtime wiring and parser isolation
7. Skill/prompt updates for run-plan, long-run, planning/review
8. Parser removal/legacy/manual import cleanup
9. Full regression suite/build stabilization

## Highest-Risk Decisions

- State identity and state file ownership across root session, subagents, worktrees, and resumed branches.
- Replay precedence and event ordering after snapshot.
- Ensuring agents reliably call structured tools instead of editing markdown.
- Removing parser paths only after replacement coverage exists.
