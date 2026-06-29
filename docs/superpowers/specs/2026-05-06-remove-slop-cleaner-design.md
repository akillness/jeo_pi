# Remove the slop-cleaner subsystem

**Status:** Approved (design)
**Date:** 2026-05-06
**Author / driver:** roach
**Target package:** `extensions/agentic-harness`

## Summary

Delete the post-execution AI-slop cleanup subsystem from the agentic harness. This includes the `slop-cleaner` agent definition, the `slop-scope` file-discovery module, the `agentic-clean-ai-slop` bundled skill, and the auto-invocation hook that spawns slop-cleaner after a discipline agent succeeds in single mode. The Karpathy preventative-discipline machinery (system-prompt augmentation before agents run) is retained — it is a separate concept and remains valuable.

## Motivation

The slop-cleaner subsystem represents post-execution remediation of LLM-generated code. It was designed when models produced code that benefited from a separate cleanup pass. Two facts drive the removal:

1. **Model quality has caught up.** With current Claude models and the Karpathy rules already injected into the system prompt of code-writing agents, the marginal value of a cleanup pass is near zero. The post-pass produces few or no changes on most runs.
2. **The hook is unreliable in practice.** The hardcoded task in `getSlopCleanerTask()` instructs the agent to run `git diff --name-only HEAD~1`. `HEAD~1` is fragile: it does not exist in shallow clones, on the first commit of a branch, or when the discipline agent has made multiple commits during its run. A recently observed run showed the slop-cleaner spending 18 turns and ~155K tokens flailing on git commands before recursively spawning a `worker` subagent to run the same commands — the agent was attempting to recover from an environmental mismatch the harness should never have created.

The architectural lesson is that prevention (system-prompt rules) and remediation (cleanup subagents) are distinct strategies. Prevention is cheap, deterministic, and survives improvements in model quality. Remediation pays a per-run token cost, depends on fragile git heuristics, and has diminishing returns as models improve. Keeping prevention while removing remediation is the surgical line.

## Goals

- Remove the slop-cleaner agent, its skill, the `slop-scope` helper module, and the auto-invocation hook in `index.ts`.
- Preserve the Karpathy preventative discipline (`KARPATHY_RULES`, `augmentAgentWithKarpathy`, `isDisciplineAgent`) and all four call sites that use it for system-prompt augmentation in single, chain, parallel, and async modes.
- Keep the harness test suite green at every commit boundary.
- Leave historical plans, reviews, and context documents from April 2026 untouched as project history.

## Non-goals

- Rewriting the Karpathy rules.
- Reworking the discipline-agent injection logic.
- Modifying any of `chain`, `parallel`, or `async` execution modes (none of these invoked slop-cleaner).
- Touching unrelated historical documents that mention slop in passing.

## Architecture impact

Three concerns are entangled in the current "discipline" subsystem:

| Concern | Mechanism | After this change |
| --- | --- | --- |
| **Pre-execution prevention** | Inject `KARPATHY_RULES` into the agent's system prompt before it runs (`augmentAgentWithKarpathy`, gated by `isDisciplineAgent`). | **Kept unchanged.** |
| **Post-execution remediation** | After a discipline agent succeeds in single mode, spawn `slop-cleaner` with `getSlopCleanerTask()` and merge its result text into the response. | **Removed.** |
| **File-discovery for remediation** | `slop-scope.ts` provides snapshot-based change detection. Tested but never wired into the live remediation path (the hook used the agent-driven `HEAD~1` task instead). | **Removed.** No external consumer. |

After this change, the term *discipline* in the harness refers only to pre-execution system-prompt augmentation. There is no post-success branch in single mode.

## Detailed changes

### Files deleted

- `extensions/agentic-harness/agents/slop-cleaner.md` — the agent definition.
- `extensions/agentic-harness/slop-scope.ts` — the snapshot/diff helper. Confirmed via grep that no production code consumes it; only the test file imports it.
- `extensions/agentic-harness/tests/slop-scope.test.ts` — tests for the deleted module.
- `extensions/agentic-harness/skills/agentic-clean-ai-slop/` — bundled skill (entire directory). Skills are auto-discovered from `extensions/agentic-harness/skills/` by `BUNDLED_SKILLS_DIR` in `index.ts:179`; no registration list to update.

### Files edited

**`extensions/agentic-harness/discipline.ts`**

- Remove the `getSlopCleanerTask` function (currently lines 45-55) and its export.
- Keep `KARPATHY_RULES`, `augmentAgentWithKarpathy`, `isDisciplineAgent`, and `DISCIPLINE_AGENTS` unchanged.

**`extensions/agentic-harness/index.ts`**

- Line 22 import: drop `getSlopCleanerTask` from the named imports of `./discipline.js`.
- Lines 931-955: delete the entire `if (isDisciplineAgent(agent) && isResultSuccess(result)) { ... }` block. After deletion, the single-mode handler falls through directly to the existing error-or-success return path that begins at the current line 958. No new code is added.
- The four `isDisciplineAgent(...)` call sites that gate Karpathy injection (currently at lines 734, 806, 875, 911) are unchanged.

**`extensions/agentic-harness/tests/discipline.test.ts`**

- Remove `getSlopCleanerTask` from the import on line 2.
- Delete the `describe("getSlopCleanerTask", …)` block at lines 81-97.
- Delete the `it("returns false for slop-cleaner", …)` case at lines 22-24. The agent no longer exists, so the assertion is vestigial. The `isDisciplineAgent` test cases for `plan-worker`, `worker`, `explorer`, and `plan-validator` remain.

**`extensions/agentic-harness/tests/review-commands.test.ts`**

- Lines 180-182 contain a guard verifying that the `/ultrareview` prompt forbids dispatching agents whose name contains "worker". The comment on line 180 reads `// ai-slop-cleaner isolation guard`, which mislabels the assertion's purpose. Replace the comment with `// worker isolation guard`. The two assertions on lines 181-182 are unchanged — they protect an invariant (ultrareview cannot dispatch workers) that is independent of slop-cleaner.

**`extensions/agentic-harness/skills/agentic-karpathy/SKILL.md`**

- Line 190 currently reads:
  `- If AI-generated code smells remain → use `agentic-clean-ai-slop` to run a corrective pass`
  Delete this single bullet from the Transition section. Lines 191-192 (the `agentic-systematic-debugging` and `agentic-rob-pike` bullets) remain.

### Documentation updates

**`docs/engineering-discipline/plans/2026-04-05-ai-slop-cleanup-pilot.md`**

Add a header block immediately under the existing `# AI Slop Cleanup Pilot Implementation Plan` title:

```
> **Superseded — 2026-05-06.** The slop-cleaner subsystem was removed; see CHANGELOG and `docs/superpowers/specs/2026-05-06-remove-slop-cleaner-design.md`. The body below is preserved as project history and reflects an earlier model-quality assumption.
```

The remaining body of the plan is preserved verbatim as historical record.

**`CHANGELOG.md`**

Add an entry under the next `### Changed` / `### Removed` section for the upcoming release describing the removal: agent file, slop-scope module, bundled skill, and the auto-invocation hook in `index.ts`. Use the project's existing `feat:` / `chore:` / `refactor:` convention; the actual release note wording is left to the release commit and is not part of this spec.

### Files left untouched (per scope)

- All other historical documents in `docs/engineering-discipline/plans/`, `reviews/`, and `context/` that mention slop in passing.
- Past `CHANGELOG.md` entries that mention slop. Those are git history and remain accurate as a record.
- `extensions/agentic-harness/skills/agentic-karpathy/SKILL.md` outside line 190.
- The `DISCIPLINE_AGENTS` set membership in `discipline.ts:4`.

## Single-mode result flow, before vs after

Before, in `extensions/agentic-harness/index.ts`:

```
runAgent(...) → result
  ├─ if isDisciplineAgent(agent) && success → spawn slop-cleaner
  │    └─ merge slop-cleaner result text into the main response → return
  ├─ if error → return error response
  └─ else → return success response
```

After:

```
runAgent(...) → result
  ├─ if error → return error response
  └─ else → return success response
```

Discipline agents flow through the same return path as any other agent. Karpathy system-prompt augmentation at the existing line 911 is preserved.

## Order of operations

The change ships as three commits to keep CI green at every boundary and to make the type-check act as an independent witness for the file deletion.

1. **Commit 1 — Remove the hook and unused helpers.**
   Edit `index.ts` (drop the import and the post-success block), edit `discipline.ts` (drop `getSlopCleanerTask`), edit `tests/discipline.test.ts` (drop the matching test cases and import), edit `tests/review-commands.test.ts` (fix the misleading comment), edit `skills/agentic-karpathy/SKILL.md` (drop the cross-reference bullet). After this commit, nothing in the codebase imports `slop-scope.ts` or references `slop-cleaner` / `agentic-clean-ai-slop`.
   Verification: `cd extensions/agentic-harness && npm test && npm run build` passes.

2. **Commit 2 — Delete orphaned files.**
   Delete `slop-scope.ts`, `tests/slop-scope.test.ts`, `agents/slop-cleaner.md`, and the entire `skills/agentic-clean-ai-slop/` directory. Pure file deletion; type-check and tests pass because step 1 severed all references.
   Verification: `cd extensions/agentic-harness && npm test && npm run build` passes.

3. **Commit 3 — Docs.**
   Add the superseded header to `2026-04-05-ai-slop-cleanup-pilot.md`. Add the CHANGELOG entry under the next release section.
   Verification: docs-only; no test or build run required, but `npm run build` is a cheap sanity check.

The three commits can be combined into one if the reviewer prefers a single artifact. The split is for review clarity.

## Verification strategy

- **Level:** test-suite + build.
- **Commands:** `cd extensions/agentic-harness && npm test` and `cd extensions/agentic-harness && npm run build`.
- **What this validates:** all surviving tests pass (extension registration, command delegation, discipline injection, parser, render, subagent, ultraplan, review-commands), no TypeScript errors after import removal, and no leftover references to deleted modules. `tsc` is the witness that the file deletion in commit 2 is consistent.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| A code path I missed still imports `slop-scope.ts` or invokes slop-cleaner. | A full grep-based inventory was completed before writing this spec (results documented in the conversation that produced it). The TypeScript build in commit 1 is the second line of defense. |
| `tests/review-commands.test.ts` assertions on lines 181-182 actually depend on slop-cleaner existing. | They do not. The assertions check that the `/ultrareview` prompt forbids dispatching agents whose name contains "worker"; this is independent of slop-cleaner's existence and protects against a separate recursion-style threat. |
| External users / downstream consumers reference the bundled `agentic-clean-ai-slop` skill. | The skill is bundled inside this extension and not published independently. Its removal is documented in the CHANGELOG. The Karpathy skill, which superseded it as the recommended discipline, is unchanged. |
| Historical plan documents reference the removed subsystem and become misleading. | The pilot plan that drove the original implementation receives an explicit `Superseded` header. Other historical mentions are dated and contextually self-evidently historical, so they are intentionally not edited. |
