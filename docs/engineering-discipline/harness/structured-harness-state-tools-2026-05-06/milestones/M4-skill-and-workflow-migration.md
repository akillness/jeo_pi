# Milestone: Skill and Workflow Migration

**ID:** M4
**Status:** pending
**Dependencies:** M3
**Risk:** High
**Effort:** Medium

## Goal

Update agentic workflows so structured tools are mandatory source-of-truth operations and markdown is rendered output only.

## Success Criteria

- [ ] `agentic-run-plan` instructs agents to load, define, and update plans through `harness_plan`.
- [ ] `agentic-long-run` instructs agents to create, load, and update milestones through `harness_milestone`.
- [ ] Todo workflows use `harness_todo` instead of handwritten checkbox files as source of truth.
- [ ] Skill docs include compact examples for create/update/load/render tool calls.
- [ ] Skill docs explicitly state markdown is rendered output only and must not be edited as canonical progress state.
- [ ] Documentation tests or text assertions verify key tool names and source-of-truth language are present.

## Files Affected

- Modify: `extensions/agentic-harness/skills/agentic-run-plan/SKILL.md`
- Modify: `extensions/agentic-harness/skills/agentic-long-run/SKILL.md`
- Modify: `extensions/agentic-harness/skills/agentic-plan-crafting/SKILL.md`
- Modify: `extensions/agentic-harness/skills/agentic-review-work/SKILL.md`
- Modify: `extensions/agentic-harness/skills/agentic-milestone-planning/SKILL.md`
- Modify/Create: relevant skill documentation tests if present.

## User Value

New agent sessions are guided toward structured progress updates while old parser fallback still protects compatibility until final cutover.

## Abort Point

Yes — workflow docs can be reviewed independently before parser removal.

## Notes

This milestone can run in parallel with M5 because it primarily touches skill docs, while M5 touches runtime/footer integration.
