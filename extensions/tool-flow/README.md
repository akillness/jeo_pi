# tool-flow

Durable-structure refresh + knowledge capture for jeo-pi — the **pi-agent parity** of
jeo-code's `~/.jeo/config.json` hooks.

jeo-code wires two global hooks during installation
(`setup-all-skills-prompt.md` Step 3i):

| jeo-code hook event | Action |
|---|---|
| `post-implementation` | `graphify update .` (refresh the durable knowledge graph) |
| `post-turn` | `python3 <vault>/scripts/ingest-prompt.py` (capture the turn into llm-wiki) |

`pi` has no shell-hook config file, so this extension reproduces the same behavior by
subscribing to pi's lifecycle events instead:

| pi event | Handler |
|---|---|
| `tool_execution_end` (`edit` / `write`, success only) | mark the workspace **dirty** |
| `turn_end` | if dirty → `graphify update .`; then ingest the turn into the llm-wiki vault |

## Guarantees

- **Fire-and-forget**: every side effect is a detached, `stdio:"ignore"` child process.
  A launch failure (`ENOENT`, etc.) is swallowed by an `error` handler and never blocks
  or fails the turn — matching the `|| true` guards in the jeo-code setup.
- **Self-guarding no-ops**: graphify only runs when a `edit`/`write` succeeded this turn;
  ingest only runs when `<vault>/scripts/ingest-prompt.py` exists. Absent tooling = no-op.
- **Vault resolution**: `$LLM_WIKI_VAULT` if set, else `~/vaults/llm-wiki`
  (identical to the setup script's Step 3e/3i default).

## Files

- `runner.ts` — pure, injectable logic (`ToolFlowRunner`, `resolveVault`, `ingestScriptPath`).
- `index.ts` — pi wiring: detached spawn + event subscriptions.
- `tests/runner.test.ts` — unit tests for dirty tracking, graphify/ingest gating, and env injection.
