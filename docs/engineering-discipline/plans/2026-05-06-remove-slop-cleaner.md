# Remove Slop-Cleaner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the post-execution AI-slop cleanup subsystem (agent, helper module, bundled skill, and auto-invocation hook) from the agentic harness while preserving the Karpathy preventative-discipline machinery.

**Architecture:** Three-commit surgical removal. Commit 1 severs all in-source references so the type-checker becomes the witness for orphan deletion. Commit 2 deletes the now-orphaned files. Commit 3 updates docs (superseded marker on the original pilot plan + CHANGELOG entry). Karpathy injection (`KARPATHY_RULES`, `augmentAgentWithKarpathy`, `isDisciplineAgent`) and its four call sites in single/chain/parallel/async modes remain untouched.

**Tech Stack:** TypeScript, Vitest, pi extension APIs.

**Spec:** `docs/superpowers/specs/2026-05-06-remove-slop-cleaner-design.md`

---

## File Structure Mapping

### Files modified

- `extensions/agentic-harness/index.ts` — drop one named import; delete one `if` block (post-success slop-cleaner invocation).
- `extensions/agentic-harness/discipline.ts` — delete one exported function (`getSlopCleanerTask`).
- `extensions/agentic-harness/tests/discipline.test.ts` — drop one import name; delete one `it` case and one full `describe` block.
- `extensions/agentic-harness/tests/review-commands.test.ts` — replace one comment line.
- `extensions/agentic-harness/skills/agentic-karpathy/SKILL.md` — delete one bullet.
- `docs/engineering-discipline/plans/2026-04-05-ai-slop-cleanup-pilot.md` — insert one superseded-header block.
- `CHANGELOG.md` — append one removal entry under the next-release section.

### Files deleted

- `extensions/agentic-harness/agents/slop-cleaner.md`
- `extensions/agentic-harness/slop-scope.ts`
- `extensions/agentic-harness/tests/slop-scope.test.ts`
- `extensions/agentic-harness/skills/agentic-clean-ai-slop/` (entire directory; auto-discovered by `BUNDLED_SKILLS_DIR` in `index.ts:179`, no registration list to update)

### Files explicitly untouched

- `extensions/agentic-harness/discipline.ts` — `KARPATHY_RULES`, `augmentAgentWithKarpathy`, `isDisciplineAgent`, `DISCIPLINE_AGENTS` set.
- `extensions/agentic-harness/index.ts` — the four `isDisciplineAgent(...)` call sites that gate Karpathy injection at lines 734, 806, 875, 911.
- All other historical plans/reviews/context docs that mention slop in passing.
- Past `CHANGELOG.md` entries that mention slop (git history).

---

## Verification commands

These are the only verification commands used in this plan. Run from the repo root unless noted.

- **Test suite:** `cd extensions/agentic-harness && npm test`
- **Type-check build:** `cd extensions/agentic-harness && npm run build`

Expected baseline (pre-implementation): **PASS** for both. If the baseline is red before Task 1, stop and report the existing failure rather than proceeding.

---

## Task 1: Sever in-source references to slop-cleaner

**Dependencies:** None (must run first)

**Files:**
- Modify: `extensions/agentic-harness/index.ts:22`
- Modify: `extensions/agentic-harness/index.ts:931-955`
- Modify: `extensions/agentic-harness/discipline.ts:45-55`
- Modify: `extensions/agentic-harness/tests/discipline.test.ts:2`
- Modify: `extensions/agentic-harness/tests/discipline.test.ts:22-24`
- Modify: `extensions/agentic-harness/tests/discipline.test.ts:81-97`
- Modify: `extensions/agentic-harness/tests/review-commands.test.ts:180`
- Modify: `extensions/agentic-harness/skills/agentic-karpathy/SKILL.md:190`

- [ ] **Step 1: Confirm green baseline**

Run: `cd extensions/agentic-harness && npm test`
Expected: PASS for the full suite, including `tests/discipline.test.ts`, `tests/slop-scope.test.ts`, `tests/review-commands.test.ts`.

If anything is failing already, stop and report the failure. Do not proceed.

- [ ] **Step 2: Drop `getSlopCleanerTask` from the `index.ts` import**

In `extensions/agentic-harness/index.ts`, replace this line (currently line 22):

```ts
import { isDisciplineAgent, augmentAgentWithKarpathy, getSlopCleanerTask } from "./discipline.js";
```

with:

```ts
import { isDisciplineAgent, augmentAgentWithKarpathy } from "./discipline.js";
```

- [ ] **Step 3: Delete the slop-cleaner post-success block in `index.ts`**

In `extensions/agentic-harness/index.ts`, delete lines 931-955 (the entire `if (isDisciplineAgent(agent) && isResultSuccess(result)) { ... }` block plus its trailing blank line). The exact block to delete is:

```ts
          if (isDisciplineAgent(agent) && isResultSuccess(result)) {
            const slopCleaner = findAgent("slop-cleaner");
            if (slopCleaner) {
              const cleanResult = await runAgent({
                agent: slopCleaner,
                agentName: "slop-cleaner",
                task: getSlopCleanerTask(),
                cwd: cwd || defaultCwd,
                depthConfig,
                signal,
                sandbox: sandboxFor(cwd || defaultCwd),
                onUpdate,
                makeDetails: makeDetails("single"),
                maxOutput,
                contextMode: context,
              });
              const mainText = getResultSummaryText(result, maxOutput);
              const cleanText = isResultSuccess(cleanResult)
                ? `\n\n[slop-cleaner] completed: ${getResultSummaryText(cleanResult, maxOutput)}`
                : `\n\n[slop-cleaner] failed: ${getResultSummaryText(cleanResult, maxOutput)}`;
              return {
                content: [{ type: "text" as const, text: mainText + cleanText }],
                details: makeDetails("single")([result, cleanResult]),
              };
            }
          }

```

After this deletion, the next surviving line in single-mode (`if (isResultError(result)) { ... }`) sits directly under the closing brace of the `runAgent({ ... })` call. The single-mode handler now flows: call `runAgent`, then check error, then return success.

- [ ] **Step 4: Delete `getSlopCleanerTask` from `discipline.ts`**

In `extensions/agentic-harness/discipline.ts`, delete the entire function definition (currently lines 45-55, plus the leading blank line at 44 if present). The exact block to delete:

```ts
export function getSlopCleanerTask(): string {
  return `Review the most recently changed files in this project and clean up any AI-generated code smells.

Steps to identify changed files:
1. Run \`git status\` to see uncommitted changes
2. Run \`git diff --name-only HEAD~1\` to see the last commit's changes
3. Focus on the source files identified above (skip test files, config files, lock files)

Follow your 6-pass cleanup process on those files. Run tests after each pass.
If no AI slop is found, report "No cleanup needed" and exit.`;
}
```

After deletion, the surviving exports of `discipline.ts` are: `DISCIPLINE_AGENTS` (private), `isDisciplineAgent`, `KARPATHY_RULES`, and `augmentAgentWithKarpathy`.

- [ ] **Step 5: Drop `getSlopCleanerTask` from the `tests/discipline.test.ts` import**

In `extensions/agentic-harness/tests/discipline.test.ts`, replace this line (currently line 2):

```ts
import { isDisciplineAgent, augmentAgentWithKarpathy, KARPATHY_RULES, getSlopCleanerTask } from "../discipline.js";
```

with:

```ts
import { isDisciplineAgent, augmentAgentWithKarpathy, KARPATHY_RULES } from "../discipline.js";
```

- [ ] **Step 6: Delete the slop-cleaner case in the `isDisciplineAgent` describe block**

In `extensions/agentic-harness/tests/discipline.test.ts`, delete this `it` case (currently lines 22-24, plus the leading blank line at 21):

```ts

  it("returns false for slop-cleaner", () => {
    expect(isDisciplineAgent("slop-cleaner")).toBe(false);
  });
```

The other four cases in `describe("isDisciplineAgent", ...)` (`plan-worker`, `worker`, `explorer`, `plan-validator`) remain.

- [ ] **Step 7: Delete the entire `getSlopCleanerTask` describe block**

In `extensions/agentic-harness/tests/discipline.test.ts`, delete lines 81-97 (the full `describe("getSlopCleanerTask", ...)` block, plus the leading blank line at 80):

```ts

describe("getSlopCleanerTask", () => {
  it("returns a non-empty task string", () => {
    const task = getSlopCleanerTask();
    expect(task.length).toBeGreaterThan(0);
  });

  it("references git commands for file discovery", () => {
    const task = getSlopCleanerTask();
    expect(task).toContain("git status");
    expect(task).toContain("git diff");
  });

  it("mentions the 6-pass cleanup process", () => {
    const task = getSlopCleanerTask();
    expect(task).toContain("6-pass");
  });
});
```

After this deletion, `tests/discipline.test.ts` contains exactly three top-level `describe` blocks: `isDisciplineAgent`, `augmentAgentWithKarpathy`, `KARPATHY_RULES`.

- [ ] **Step 8: Fix the misleading comment in `tests/review-commands.test.ts`**

In `extensions/agentic-harness/tests/review-commands.test.ts`, replace this single line (currently line 180):

```ts
    // ai-slop-cleaner isolation guard
```

with:

```ts
    // worker isolation guard
```

The two assertions on lines 181-182 (`expect(prompt).toContain("worker")` and `expect(prompt).toMatch(/NEVER dispatch any agent whose name contains "worker"/)`) are unchanged. They protect a separate invariant (`/ultrareview` cannot dispatch worker-named agents) that is independent of slop-cleaner.

- [ ] **Step 9: Drop the cross-reference bullet in `agentic-karpathy/SKILL.md`**

In `extensions/agentic-harness/skills/agentic-karpathy/SKILL.md`, delete this single line (currently line 190):

```
- If AI-generated code smells remain → use `agentic-clean-ai-slop` to run a corrective pass
```

The two surrounding bullets (`agentic-systematic-debugging` and `agentic-rob-pike`) remain.

- [ ] **Step 10: Run the test suite**

Run: `cd extensions/agentic-harness && npm test`
Expected: PASS. (Note: `tests/slop-scope.test.ts` still runs — its module is not yet deleted. That happens in Task 2.)

If any test fails, do not proceed. Investigate the failure: most likely culprits are a missed import of `getSlopCleanerTask` or a stale assertion referencing slop-cleaner that wasn't covered above.

- [ ] **Step 11: Run the type-check build**

Run: `cd extensions/agentic-harness && npm run build`
Expected: PASS with no TypeScript errors.

- [ ] **Step 12: Commit**

```bash
git add extensions/agentic-harness/index.ts \
        extensions/agentic-harness/discipline.ts \
        extensions/agentic-harness/tests/discipline.test.ts \
        extensions/agentic-harness/tests/review-commands.test.ts \
        extensions/agentic-harness/skills/agentic-karpathy/SKILL.md
git commit -m "refactor(harness): sever slop-cleaner references"
```

---

## Task 2: Delete orphaned files

**Dependencies:** Runs after Task 1 completes (Task 1 must have severed all references).

**Files:**
- Delete: `extensions/agentic-harness/agents/slop-cleaner.md`
- Delete: `extensions/agentic-harness/slop-scope.ts`
- Delete: `extensions/agentic-harness/tests/slop-scope.test.ts`
- Delete: `extensions/agentic-harness/skills/agentic-clean-ai-slop/` (entire directory)

- [ ] **Step 1: Verify nothing in source still references the about-to-be-deleted files**

Run: `cd /Users/roach/.pi/agent/git/github.com/tmdgusya/pi-engineering-discipline-extension && grep -rn "slop-scope\|slop-cleaner\|agentic-clean-ai-slop\|getSlopCleanerTask\|captureSlopScopeSnapshot\|getChangedSourceFilesForSlopCleaner\|isSourceCodePath\|SlopScopeSnapshot" extensions/agentic-harness --include="*.ts" --include="*.md" --include="*.json"`

Expected output: only the files about to be deleted reference these names. Specifically:
- `extensions/agentic-harness/slop-scope.ts` (self-references)
- `extensions/agentic-harness/tests/slop-scope.test.ts` (imports from slop-scope)
- `extensions/agentic-harness/agents/slop-cleaner.md` (the agent file itself)
- `extensions/agentic-harness/skills/agentic-clean-ai-slop/SKILL.md` (the skill file itself)

If any other file matches, stop and report — Task 1 missed a reference.

- [ ] **Step 2: Delete the four targets**

Run: `cd /Users/roach/.pi/agent/git/github.com/tmdgusya/pi-engineering-discipline-extension && rm extensions/agentic-harness/slop-scope.ts extensions/agentic-harness/tests/slop-scope.test.ts extensions/agentic-harness/agents/slop-cleaner.md && rm -rf extensions/agentic-harness/skills/agentic-clean-ai-slop`

Expected: command exits with status 0 and no output.

- [ ] **Step 3: Run the test suite**

Run: `cd extensions/agentic-harness && npm test`
Expected: PASS. The `slop-scope.test.ts` file is gone, so its tests no longer run; everything else passes unchanged.

- [ ] **Step 4: Run the type-check build**

Run: `cd extensions/agentic-harness && npm run build`
Expected: PASS. The build is the witness that no surviving TypeScript file imported the deleted module.

If the build fails with `Cannot find module './slop-scope.js'` or similar, return to Task 1: a reference was missed. Do not "fix" it by recreating the deleted file.

- [ ] **Step 5: Commit**

```bash
git add -A extensions/agentic-harness/slop-scope.ts \
           extensions/agentic-harness/tests/slop-scope.test.ts \
           extensions/agentic-harness/agents/slop-cleaner.md \
           extensions/agentic-harness/skills/agentic-clean-ai-slop
git commit -m "chore(harness): delete orphaned slop-cleaner files"
```

(`git add -A <path>` correctly stages the deletions of those exact paths.)

---

## Task 3: Documentation updates

**Dependencies:** Runs after Task 2 completes.

**Files:**
- Modify: `docs/engineering-discipline/plans/2026-04-05-ai-slop-cleanup-pilot.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a superseded header to the original pilot plan**

In `docs/engineering-discipline/plans/2026-04-05-ai-slop-cleanup-pilot.md`, insert a new block immediately after the existing `# AI Slop Cleanup Pilot Implementation Plan` line and before the existing `> **Worker note:** ...` line. The exact insertion is two new lines:

```markdown
> **Superseded — 2026-05-06.** The slop-cleaner subsystem was removed; see `CHANGELOG.md` and `docs/superpowers/specs/2026-05-06-remove-slop-cleaner-design.md`. The body below is preserved as project history and reflects an earlier model-quality assumption.

```

(The empty line after the blockquote separates it from the existing `> **Worker note:**` paragraph.)

The remainder of the file is unchanged.

- [ ] **Step 2: Add a CHANGELOG entry under the next-release section**

In `CHANGELOG.md`, locate the topmost (most recent) version section. If a section for the next unreleased version does not yet exist at the top, leave that to the release process and skip to the existing topmost section's `### Removed` (or appropriate) subsection.

If there is an unreleased section header already, add this bullet under its `### Removed` subsection (creating the subsection heading if absent):

```
- harness: remove slop-cleaner agent, slop-scope module, agentic-clean-ai-slop skill, and the post-success auto-invocation hook in single mode. Karpathy preventative discipline is unchanged. Migration: none required for downstream users; bundled skill `agentic-clean-ai-slop` is no longer available — use `agentic-karpathy` for preventative discipline instead. See `docs/superpowers/specs/2026-05-06-remove-slop-cleaner-design.md`.
```

If the project's CHANGELOG follows Conventional Changelog conventions and is auto-generated from commit messages by a release tool (the previous entries' format `* feat: ... ([hash](url))` suggests this), instead of editing CHANGELOG.md directly, ensure the Task 1 and Task 2 commit messages convey the change clearly (they do: `refactor(harness): sever slop-cleaner references` and `chore(harness): delete orphaned slop-cleaner files`). In that case, skip this step and let the release tool regenerate the CHANGELOG at release time.

To decide which case applies: open `CHANGELOG.md` and check whether the top of the file is hand-edited or generated. If you see a tool comment like `# Changelog ... generated by ...` or every entry is a `* type(scope): ...` bullet with a commit hash, it's generated — skip this step. Otherwise, add the entry by hand.

- [ ] **Step 3: Run the type-check build as a sanity check**

Run: `cd extensions/agentic-harness && npm run build`
Expected: PASS. (Pure docs change; this is just a no-regression check.)

- [ ] **Step 4: Commit**

```bash
git add docs/engineering-discipline/plans/2026-04-05-ai-slop-cleanup-pilot.md
# If you also edited CHANGELOG.md by hand in Step 2:
git add CHANGELOG.md
git commit -m "docs: mark slop-cleanup pilot superseded"
```

---

## Task 4: Final end-to-end verification

**Dependencies:** Runs after Task 3 completes.

**Files:** None (read-only verification).

- [ ] **Step 1: Run the full test suite**

Run: `cd extensions/agentic-harness && npm test`
Expected: ALL PASS.

- [ ] **Step 2: Run the full type-check build**

Run: `cd extensions/agentic-harness && npm run build`
Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Verify there are no stale references to deleted symbols**

Run: `cd /Users/roach/.pi/agent/git/github.com/tmdgusya/pi-engineering-discipline-extension && grep -rn "getSlopCleanerTask\|slop-scope\|slop-cleaner\|agentic-clean-ai-slop" extensions/agentic-harness --include="*.ts" --include="*.md" --include="*.json"`

Expected output: empty (no matches).

- [ ] **Step 4: Verify Karpathy machinery is intact**

Run: `cd /Users/roach/.pi/agent/git/github.com/tmdgusya/pi-engineering-discipline-extension && grep -n "isDisciplineAgent\|augmentAgentWithKarpathy\|KARPATHY_RULES" extensions/agentic-harness/discipline.ts extensions/agentic-harness/index.ts | head -20`

Expected: matches across both files. Specifically `discipline.ts` exports `KARPATHY_RULES`, `augmentAgentWithKarpathy`, `isDisciplineAgent`; `index.ts` references `isDisciplineAgent` at four call sites (single, chain, parallel, async modes).

- [ ] **Step 5: Verify each plan success criterion**

- [ ] All references to `getSlopCleanerTask`, `slop-scope`, `slop-cleaner`, and `agentic-clean-ai-slop` are gone from `extensions/agentic-harness/`.
- [ ] `discipline.ts` retains `KARPATHY_RULES`, `augmentAgentWithKarpathy`, `isDisciplineAgent`, and `DISCIPLINE_AGENTS`.
- [ ] `index.ts` retains the four `isDisciplineAgent(...)` call sites that gate Karpathy injection.
- [ ] `tests/discipline.test.ts` retains the three describe blocks: `isDisciplineAgent` (without the slop-cleaner case), `augmentAgentWithKarpathy`, `KARPATHY_RULES`.
- [ ] `tests/review-commands.test.ts:181-182` (worker isolation assertions) are unchanged.
- [ ] `agents/slop-cleaner.md`, `slop-scope.ts`, `tests/slop-scope.test.ts`, and `skills/agentic-clean-ai-slop/` are deleted.
- [ ] `2026-04-05-ai-slop-cleanup-pilot.md` has a superseded header.
- [ ] All other historical docs are unchanged.

---

## Self-Review

- **Spec coverage:** Each section of the spec maps to a task:
  - Spec §3 "Files deleted" → Task 2 Step 2.
  - Spec §3 "Files edited" → Task 1 Steps 2-9.
  - Spec §3 "Documentation updates" → Task 3 Steps 1-2.
  - Spec §3 "Files left untouched" → Task 4 Step 5 (verification).
  - Spec §5 "Order of operations" → the three-task split with verification gates.
  - Spec §6 "Verification strategy" → Tasks 1, 2, 3 each end with `npm test` + `npm run build`; Task 4 is a final sweep.

- **Placeholder scan:** No "TBD"/"TODO"/"implement later". Task 3 Step 2 contains a conditional ("if CHANGELOG is auto-generated, skip") with a concrete decision rule and a fallback action — not a placeholder.

- **Type consistency:** No new types or signatures introduced. All function/symbol names referenced (`getSlopCleanerTask`, `isDisciplineAgent`, `augmentAgentWithKarpathy`, `KARPATHY_RULES`, `runAgent`, `findAgent`, `isResultSuccess`, `isResultError`, `getResultSummaryText`, `makeDetails`) exist in the codebase verbatim and are used consistently across tasks.

- **Line-number drift:** This plan uses snapshot line numbers from 2026-05-06. If the working tree changes before execution (e.g., the pending edits to `welcome-ui.ts` or `tests/footer.test.ts` produce unrelated changes that shift line numbers in `index.ts` — they shouldn't, but verify), the executor must use exact-string matching from the code blocks above rather than relying on the line numbers.
