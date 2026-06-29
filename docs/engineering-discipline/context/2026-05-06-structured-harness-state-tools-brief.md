# Context Brief: Structured Harness State Tools Migration

### Goal

Replace fragile markdown/parsing-based milestone, plan, and todo tracking with structured tool-driven state management, using canonical JSON/event state as the source of truth and markdown only as rendered human-readable output.

### Scope

- **In scope**
  - Add structured harness tools for:
    - milestone create/load/update/render
    - plan attach/define/load/update/render
    - todo set/update/load/render
  - Introduce canonical structured state model:
    - milestones
    - plans
    - plan tasks
    - todos
    - status transitions
    - event metadata
  - Add durable `state.json` snapshot and session replay/custom-entry integration.
  - Make footer/progress tracking read from structured state, not markdown parsers.
  - Remove or isolate existing markdown parser dependency from primary runtime flow.
  - Update `agentic-run-plan`, `agentic-long-run`, milestone planning/run/review skills so agents call tools instead of hand-authoring parse-sensitive markdown.
  - Keep markdown files as rendered views/exports only.
  - Add tests for tools, storage, reducer, replay, footer integration, and docs/prompt behavior.

- **Out of scope**
  - Preserving automatic compatibility with old markdown-only sessions.
  - Continuing to treat `state.md`, `todo.md`, or plan markdown as source of truth.
  - Building a general markdown import system unless explicitly needed later.

### Technical Context

Current implementation facts:

- Milestones are currently inferred from:
  - `state.md` tables
  - milestone file paths
  - `todo.md`
  - `completion.md`
  - assistant message text
- Plan progress is currently inferred from:
  - `plan-parser.ts`
  - plan file paths in subagent args
  - `read`/`write` tool results
  - session replay of tool calls
  - `plan-progress` custom snapshots
- Todo support exists only as parsed checkbox lines from `todo.md`, attached to the active milestone.
- Tool registration patterns live mainly in `extensions/agentic-harness/index.ts`.
- Durable structured JSON precedent exists in:
  - `team-state.ts`
  - `async-registry.ts`
- Best architecture is likely:
  - `harness-state.ts` — schema + reducer
  - `harness-storage.ts` — JSON snapshot + atomic write/read
  - `harness-events.ts` — session custom entries / replay
  - `harness-render.ts` — markdown renderers
  - `harness-tools.ts` — tool definitions and execution wrappers

Recommended API shape:

```text
harness_milestone
harness_plan
harness_todo
```

with a shared internal reducer/state model.

### Constraints

- Existing markdown parser behavior can be removed or moved to legacy/manual import only.
- New tool schemas must be simple enough for agents to call reliably.
- Session resume must not depend on parsing assistant prose or markdown files.
- Footer progress must remain live and render-triggered.
- Existing tests around milestone/plan progress will need significant rewrite.
- Skill docs must be updated so agents use tools as mandatory workflow steps.

### Success Criteria

- Agents can create/update/load milestone, plan, and todo state through tools without writing parse-sensitive markdown.
- `state.json` or equivalent canonical structured snapshot is written and can restore current progress.
- Session resume reconstructs milestone/plan/todo progress without markdown parsing.
- Footer shows milestone and plan progress from structured state.
- Markdown files are generated from structured state, not parsed as primary input.
- Existing parser-based runtime paths are removed or explicitly marked legacy/manual import.
- `agentic-run-plan` and `agentic-long-run` instructions require structured tool calls.
- Test suite covers:
  - reducer transitions
  - tool schema/execute behavior
  - durable snapshot read/write
  - session replay
  - footer rendering
  - markdown render output
  - parser removal/legacy isolation

### Open Questions

None blocking. Main design decisions are established:

- Full migration
- No markdown parser compatibility requirement
- Separate user-facing tools with shared internal reducer
- Hybrid durable JSON snapshot + session event replay

### Complexity Assessment

| Signal | Score |
|---|---:|
| Scope breadth | 3 |
| File impact | 3 |
| Interface boundaries | 3 |
| Dependency depth | 3 |
| Risk surface | 3 |

**Score:** 15 / 15  
**Verdict:** Complex  
**Rationale:** This changes core state ownership, tool APIs, session replay, footer behavior, and agent skill contracts. It should be decomposed into milestones rather than implemented as one plan.

### Suggested Next Step

Proceed to **`agentic-milestone-planning`**. This needs milestone decomposition before implementation.

Recommended milestone shape:

1. **M1: Canonical State Model + Reducer**
2. **M2: Durable Storage + Session Event Replay**
3. **M3: Structured Harness Tools**
4. **M4: Footer/Runtime Integration**
5. **M5: Markdown Renderers + Legacy Parser Removal**
6. **M6: Skill/Prompt Contract Update**
7. **M7: End-to-End Regression + Dogfood**
