<!-- Parent: ../../AGENTS.md -->

# agentic-harness

## Purpose

The `pi-agentic-harness` extension: agentic harness commands for clarification,
durable goals, subagents, and verification. It hosts jeo-pi's spec-first
workflow — the `spec-stack` (Interview → Seed → Execute → Evaluate → Evolve) and
`spec-deep-dive` (trace → clarify) skills reflected from jeo-code — together with
the role subagents and the durable `/goal` runtime that execute against a frozen
seed.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Extension entry point and command registration |
| `agents.ts` | Loads agent prompts (`loadAgentsFromDir`, `parseFrontmatter`) |
| `clarification-*.ts` | `/clarify` loop: state, storage, events, service |
| `discipline.ts` | Engineering-discipline guardrails surfaced to the agent |
| `autopilot.ts` | `/autopilot` ratchet engine (frozen eval, keep-if-improved/revert ledger) ported from jeo-code |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `agents/` | Role-specific subagent prompts (see `agents/AGENTS.md`) |
| `skills/` | Bundled workflow skills (see `skills/AGENTS.md`) |
| `tests/` | Vitest suites run via `npm test` / `bun run test` |
| `sandbox/` | Sandbox execution helpers |
| `scripts/` | Test runner and build helpers (`run-vitest.cjs`) |
| `types/` | Shared TypeScript types |
| `webfetch/` | Web fetch / HTML-to-Markdown utilities |

## For AI Agents

### Working In This Directory

- Tests run via vitest, not `bun test` (the suites use the vitest API such as
  `vi.useFakeTimers`). Use `npm test` or `bun run test`.
- Keep `agents/AGENTS.md` and `skills/AGENTS.md` in sync with their directories;
  the registry tests fail otherwise.

### Testing Requirements

- `npm test` → vitest suite must stay green.
- `npm run build` → `tsc --noEmit` must report zero errors.
- `tests/docs-tree.test.ts` enforces parent/child AGENTS.md reference integrity.

## Dependencies

### Internal

- `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui` (upstream pi runtime).

### External

- `@sinclair/typebox`, `turndown`, `turndown-plugin-gfm`.
