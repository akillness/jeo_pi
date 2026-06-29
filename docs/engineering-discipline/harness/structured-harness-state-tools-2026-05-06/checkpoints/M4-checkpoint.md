# Checkpoint: M4 — Skill and Workflow Migration

**Completed:** 2026-05-06 23:15
**Attempts:** 1

## Plan File

`docs/engineering-discipline/plans/2026-05-06-m4-skill-and-workflow-migration.md`

## Review File

`docs/engineering-discipline/reviews/2026-05-06-m4-skill-and-workflow-migration-review.md`

## Test Results

- `npx vitest run tests/skill-docs.test.ts`: PASS — 5 tests passed
- `npx vitest run` (full suite): PASS — 663 tests passed, 55 files

## Files Changed

- **Modified:** `extensions/agentic-harness/skills/agentic-run-plan/SKILL.md`
- **Modified:** `extensions/agentic-harness/skills/agentic-long-run/SKILL.md`
- **Modified:** `extensions/agentic-harness/skills/agentic-plan-crafting/SKILL.md`
- **Modified:** `extensions/agentic-harness/skills/agentic-review-work/SKILL.md`
- **Modified:** `extensions/agentic-harness/skills/agentic-milestone-planning/SKILL.md`
- **Created:** `extensions/agentic-harness/tests/skill-docs.test.ts`

## Interface Contracts Established

- Skill docs now instruct agents to prefer `harness_milestone`, `harness_plan`, and `harness_todo` tools over hand-editing markdown.
- All skill docs include compact JSON tool-call examples.
- All skill docs state that markdown files are rendered output only, not canonical source of truth.

## State After Milestone

Agents reading skill docs are now guided toward structured tool usage. Old parser-derived runtime remains as fallback until M6.
