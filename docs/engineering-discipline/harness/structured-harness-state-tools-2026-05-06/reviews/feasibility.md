# Feasibility Review: Structured Harness State Tools Migration

## Overall Feasibility

This migration is feasible with the current TypeScript/TypeBox/pi extension stack. The repository already has relevant primitives:

- Tool registration in `extensions/agentic-harness/index.ts`
- Session custom entries and replay through `session_start`
- Footer render hooks and change notification patterns
- Atomic JSON-write precedent in `team-state.ts` and `async-registry.ts`

The core feasibility risk is not whether JSON/tool state can replace markdown parsing. It can. The hard part is state ownership across root agent, subagents, session replay, and concurrent tool calls.

## Component Effort Map

| Component | Feasibility | Effort | Notes |
|---|---:|---:|---|
| Canonical state schema/reducer | High | Medium | Pure TypeScript, but status transitions need discipline. |
| Durable `state.json` storage | High | Medium | Atomic write is known; concurrency still needs ordering discipline. |
| Session custom-entry replay | High | Medium/Large | Precedence vs `state.json` must be designed. |
| `harness_milestone` tool | High | Medium | Simple if action schema is narrow. |
| `harness_plan` tool | High | Large | Plan/task lifecycle and subagent integration are complex. |
| `harness_todo` tool | High | Medium | Easy model, but active owner rules matter. |
| Markdown renderers | High | Medium | Safer than parsers; mostly formatting/snapshot tests. |
| Footer/progress cutover | High | Large | Must preserve live render and spinner behavior. |
| Parser removal/isolation | High | Medium/Large | Many current hooks infer progress. |
| Skill/prompt updates | High | Medium | Easy to edit; reliability depends on clear instructions. |
| Test migration | High | Large | Existing parser/progress tests need broad rewrite. |

## Recommended Boundaries

1. Core structured state model and reducer
2. Durable storage and session replay foundation
3. Structured harness tools and markdown renderers
4. Footer/progress integration cutover
5. Runtime parser-path removal and legacy quarantine
6. Skill and workflow migration
7. Full regression rewrite and build stabilization

## Spike Candidates

- Cross-process state updates from subagents to root footer/session
- Concurrent writes and lost-update prevention
- Session replay precedence
- Tool schema ergonomics for agents
- Footer live update source for external/subagent writes
- Strict vs forgiving status transitions

## Underestimation Risks

- Subagent/root state synchronization is the biggest hidden complexity.
- Removing heuristic inference can remove behavior users rely on unless the new workflow is enforced.
- Test migration will likely take longer than implementation of individual modules.
- Markdown render-only can regress if skills still ask agents to hand-edit markdown.
