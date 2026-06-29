# Architecture Review: Structured Harness State Tools Migration

## Architecture Spine

Recommended dependency direction:

```text
harness-state.ts   -> pure schema, reducer, selectors
harness-render.ts  -> depends only on state types/selectors
harness-storage.ts -> depends on state, fs/path; atomic state.json I/O
harness-events.ts  -> depends on reducer/state; session custom-entry replay/append
harness-tools.ts   -> depends on store/storage/events/render; exports TypeBox tool definitions
index.ts           -> registers tools and wires session lifecycle/footer
footer.ts          -> consumes read-only structured progress provider, not parsers
skills/*.md        -> instruct agents to call tools, not author source-of-truth markdown
```

## Primary Data Flow

```text
Agent tool call
  -> harness-tools validate params
  -> reducer command
  -> canonical state update
  -> append custom event + write state.json
  -> render markdown view/export
  -> notify subscribers
  -> footer rerender
```

On resume:

```text
session_start
  -> load durable snapshot
  -> replay session custom entries after snapshot point
  -> hydrate structured store
  -> footer reads selectors
```

No assistant prose or markdown parsing should participate in the primary path.

## Suggested Architectural Milestones

1. Canonical state model, reducer, selectors, and pure markdown renderers
2. Durable storage and session replay foundation
3. Structured harness tools
4. Skill and prompt workflow migration
5. Footer/progress migration to structured state
6. Runtime replay cutover and parser isolation

## Interface Risks

- State identity: subagents, worktrees, and resumed sessions need a clear intended `state.json` target.
- Event ordering: snapshot vs custom event precedence must be explicit.
- Tool simplicity: flexible nested schemas may make agents call tools incorrectly.
- Status transitions: milestone/plan/todo status enums may need revision after real use.
- Markdown render paths: generated markdown paths should be deterministic and render-only.
- Concurrent updates: atomic write prevents partial files, not lost updates.
- Footer selectors: footer should depend on stable summaries, not raw state internals.

## Pattern Conflicts

- Current progress relies on `plan-parser.ts`, `milestone-tracker.ts`, `plan-progress-events.ts`, tool args, file paths, and assistant messages.
- `index.ts` is already large; full tool logic should not be added there.
- Current markdown files are treated as source artifacts; new design demotes them to views.
- Current footer consumes tracker classes directly; new design should introduce a read-only provider/store interface.
- Current replay uses custom snapshots plus parser replay; new replay should be event/snapshot based only.
