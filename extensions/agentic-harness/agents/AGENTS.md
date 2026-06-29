<!-- Parent: ../AGENTS.md -->

# agents

## Purpose

Role-specific system prompts defining jeo_pi subagent behavior. The four
spec-stack roles (planner, architect, critic, executor) are reflected from
jeo-code; the remaining agents are jeo_pi-native execution and review roles.

## Key Files

| File | Capability | Description |
|------|------------|-------------|
| `planner.md` | read-only | Evidence-backed, execution-ready implementation plans |
| `architect.md` | read-only | Architecture / maintainability / spec-compliance review |
| `critic.md` | read-only | Decides whether a plan is actionable before execution |
| `executor.md` | write | Turns a bounded task into a verified outcome |
| `explorer.md` | read-only | Fast codebase exploration and investigation |
| `worker.md` | write | General-purpose execution with full tool access |
| `plan-worker.md` | write | Follows plan steps exactly, writes code, runs tests, commits |
| `plan-compliance.md` | read-only | Pre-task check of predecessor outputs and file state |
| `plan-validator.md` | read-only | Independent plan-task validator under information barrier |
| `reviewer-architecture.md` | read-only | Interfaces, data flow, incremental deliverability |
| `reviewer-feasibility.md` | read-only | Technical viability, effort, spike candidates |
| `reviewer-risk.md` | read-only | Integration risk, ambiguity, regressions, recovery cost |
| `reviewer-verifier.md` | read-only | Dedupe findings, filter false positives, final severity |

## For AI Agents

### Working In This Directory

- Each agent is a Markdown file with valid frontmatter (`name`, `description`,
  optional `tools`, `model`) followed by the system prompt body.
- Read-only roles MUST declare a restricted `tools` list with no `edit`/`write`.
- The write-capable executor declares no `tools` line so it inherits the full
  toolset.
- The spec-stack roles must keep their `done.reason` output contract sections
  (see `tests/spec-stack-docs.test.ts`).

### Testing Requirements

- `tests/agents.test.ts` validates frontmatter parsing for every agent file.
- `tests/spec-stack-docs.test.ts` validates the four spec-stack role contracts
  and tool restrictions.
- `tests/agents-registry.test.ts` keeps this table in sync with the directory.

## Dependencies

### Internal

- `agents.ts` (`loadAgentsFromDir`, `parseFrontmatter`) loads these prompts.

### External

- None.
