# Current: Subagent render ellipsis fix

Done when:
- [x] Partial single-mode subagent calls no longer render `subagent ...`.
- [x] Completed invalid args render explicit missing labels.
- [x] Collapsed completed results include task preview.
- [x] Collapsed running results prefer `lastActivity` preview.
- [x] Focused tests, TypeScript build, and full test suite pass.

Plan:
- [x] Write executable plan at `docs/engineering-discipline/plans/2026-05-11-subagent-render-ellipsis-fix.md`.
- [x] Execute Task 1: partial args call rendering.
- [x] Execute Task 2: collapsed result task/activity preview.
- [x] Execute Task 3: final verification and regression review.

## Review

Completed.
- `extensions/agentic-harness/render.ts`: added `RenderCallContext`, one-line `previewText`, explicit `starting...` / `receiving task...` / missing-label rendering, and collapsed single-result preview logic preferring `lastActivity` over task.
- `extensions/agentic-harness/index.ts`: forwards Pi render context to the subagent renderer.
- `extensions/agentic-harness/tests/render.test.ts`: added focused coverage for incomplete args, valid args, missing completed args, collapsed task preview, lastActivity priority, and truncation.
- Plan note: corrected the truncation test marker from `end` to `TAIL_MARKER` because `rendering` contains substring `end`.
- Verification: `cd extensions/agentic-harness && npm test -- tests/render.test.ts` — PASS, 25 tests.
- Verification: `cd extensions/agentic-harness && npm run build` — PASS.
- Verification: `cd extensions/agentic-harness && npm test` — PASS, 61 files / 743 tests.

---

# Current: Fix zombie async-run inheritance across pi sessions

Root cause: `restorePersisted` (async-registry.ts:289) blindly loads every
persisted async-run.json under `<cwd>/.pi/agent/runs/` into the in-memory
registry on `session_start`. Records left in non-terminal status (`running` /
`spawning`) by a prior pi process — typical when the parent died before flush —
are restored as if they were live. The final-response guard (index.ts:442)
then blocks the new session until the model takes a wait/interrupt/background
action on a process that no longer exists.

Native subagents are children of pi: parent dies → child dies. They are never
resumable. So the rescue path is dead weight that just creates zombies.

Done when:
- [ ] No async-run record from a prior pi process is loaded into the in-memory
      registry on session start.
- [ ] Disk records left in non-terminal status are normalized to `interrupted`
      (with `completedAt` and `notified=true`) so they don't replay on later
      sessions.
- [ ] Already-terminal records on disk are not rewritten.
- [ ] `cd extensions/agentic-harness && npm run build && npm test` passes.

Plan:
- [x] Add failing tests in `tests/async-registry.test.ts` that exercise the new
      `sweepStalePersisted` behavior (normalize stale, leave terminal alone, no
      in-memory load).
- [x] Add `sweepStalePersisted` to `RunRegistry` and remove `restorePersisted`.
- [x] Replace the call site at `index.ts:2146`.
- [x] Run `npm run build && npm test` and document review.

## Review

Completed.
- `async-registry.ts`: removed `restorePersisted`; added `sweepStalePersisted`
  which only normalizes non-terminal disk records to `interrupted` and never
  loads them into the in-memory map. Extracted shared `writeRecord` helper so
  the sweep path can persist a record without first registering it in memory.
- `index.ts:2146`: `restorePersisted` call replaced with `sweepStalePersisted`.
  `restore()` and `load()` remain for the on-demand path used by
  `waitForCompletion` when the lead model explicitly waits on a known runId.
- TDD: two failing tests added first
  (`sweepStalePersisted normalizes non-terminal disk records and does NOT load
  them in-memory`, `sweepStalePersisted leaves already-terminal records
  untouched`); both pass after implementation.
- Verification: `npm run build` — PASS. `npm test` — PASS, 59 files / 701 tests.
- Existing zombie records under `~/.hermes/.pi/agent/runs/` are already in
  terminal status (`interrupted` / `failed`) so the new sweep path is a no-op
  on them; no manual cleanup needed.

---

# Current: Translate agentic skill docs to English

Done when:
- [x] All Korean-language text under `extensions/agentic-harness/skills` is translated to English.
- [x] Skill names, tool names, paths, Markdown formatting, and YAML frontmatter remain intact.
- [x] A search confirms no Korean characters remain under the skills directory.
- [x] Relevant docs/tests are checked for regressions.

Plan:
- [x] Read the affected skill docs and identify exact Korean text.
- [x] Make minimal translation-only edits in the affected files.
- [x] Verify with Korean-character search and relevant test/build checks.
- [x] Review the diff and document results.

## Review

Completed.
- Updated `extensions/agentic-harness/skills/agentic-brainstorming/SKILL.md` trigger examples from Korean to English.
- Translated the remaining Korean prose/table text in `extensions/agentic-harness/skills/agentic-clarification/SKILL.md`.
- Verification: Python Hangul scan under `extensions/agentic-harness/skills` — PASS, no Korean Hangul characters found.
- Verification: `cd extensions/agentic-harness && npm test -- skill-docs` — PASS, 6 tests.
- Verification: `cd extensions/agentic-harness && npm run build` — PASS.

---

# Docs: progress tracker improvement note

- [x] Locate README / changelog docs for agentic-harness
- [x] Add concise note about structured progress tracker improvements
- [x] Verify wording and file diff

## Review

Updated:
- `CHANGELOG.md` — added Unreleased improvement note for structured progress tracking, live task transitions, session replay, and serialized same-run mutations.
- `README.md` — updated Highlights progress tracker bullet.
- `extensions/agentic-harness/README.md` — added feature bullet for structured progress tracking.

Verification:
- Reviewed `git diff` for the three docs files.
- Grep confirmed the new wording appears in each target file.

---

# Current: Async subagent final-response hard guard

Done when:
- [x] Pending non-background async subagent runs cannot be silently bypassed by a final assistant response.
- [x] The guard lists active run IDs and tells the model to `wait`, inspect `status`, `interrupt`, or explicitly mark runs as background before finalizing.
- [x] Completed async results remain retrievable through `action:"wait"` / status paths already present.
- [x] Focused tests cover registry dependency updates and message-end guard behavior.
- [x] `cd extensions/agentic-harness && npm run build && npm test` passes.

Plan:
- [x] Inspect existing async registry, subagent tool schema/actions, and extension message lifecycle hooks.
- [x] Add the minimal registry support needed to mark a run as background / non-blocking.
- [x] Extend `subagent` action handling and prompt guidelines with an explicit release/mark-background option.
- [x] Add a `message_end` hard guard that replaces premature final assistant text while active non-background async runs exist, and queues a follow-up instruction for the model to choose an action.
- [x] Add focused tests for the new behavior.
- [x] Run build/tests and document review results.

## Review

Completed.
- Added `action:"mark-background"` to the subagent run-management contract so the lead model can explicitly release an async run from final-response blocking.
- Added final-response guard logic that blocks assistant stop messages while active non-background async runs are still spawning/running, lists run IDs, and queues a follow-up instruction to choose wait/status/interrupt/mark-background.
- Added active async guard context before agent starts, stronger async start/status messaging, and focused coverage for registry dependency updates and message-end guard behavior.
- Verification: `cd extensions/agentic-harness && npm run build` — PASS.
- Verification: `cd extensions/agentic-harness && npm test` — PASS, 59 files / 691 tests.

---

# Current: Commit and Push to main

- [x] Confirm repository, branch, remote, and working tree
- [x] Run verification before commit
- [x] Commit all requested changes
- [x] Integrate commit onto `main`
- [x] Push `main` to remote
- [x] Verify remote status and summarize

## Review

Completed.
- Repository: `/Users/roach/.pi/agent/git/github.com/tmdgusya/pi-engineering-discipline-extension`
- Remote: `origin https://github.com/tmdgusya/roach-pi.git`
- Verification: `cd extensions/agentic-harness && npm run build && npm test` — PASS, 59 files / 682 tests
- Commit: `290a420 feat: add structured harness state tools`
- Integration: fast-forwarded local `main` from `edd10fe` to `290a420`
- Push: `origin/main` updated to `290a420`


---

# Current: Structured Harness Resume/Task Loading Fix

Done when:
- [x] Active plan selection prefers milestone `planFile`, then latest plan for the milestone.
- [x] Runtime structured task updates avoid unsafe first-plan fallback for ambiguous multi-plan states.
- [x] Harness progress/session restore preserves `{ runId, rootDir }`, hydrates replayed state, and can switch runs.
- [x] Milestone render includes linked plan/task progress summaries.
- [x] Skill docs no longer describe markdown checkboxes/`state.md` as canonical progress or recovery state.
- [x] Focused harness tests pass.

## Review

Implemented structured harness resume/task display fixes. Focused verification passed: `cd extensions/agentic-harness && mkdir -p node_modules/.tmp && TMPDIR=$PWD/node_modules/.tmp npm exec -- vitest run tests/harness-state.test.ts tests/harness-runtime-progress.test.ts tests/harness-render.test.ts tests/harness-progress.test.ts tests/session-replay.test.ts tests/harness-tools.test.ts tests/skill-docs.test.ts tests/parser-isolation.test.ts tests/footer.test.ts tests/e2e-structured-workflow.test.ts tests/plan-progress.test.ts` and `TMPDIR=$PWD/node_modules/.tmp npm exec -- vitest run tests/extension.test.ts`.

Note: `npm test` currently fails in this checkout because extension-local dependencies such as `turndown`/`turndown-plugin-gfm` and local `vitest` binary are not installed; focused tests were run through `npm exec -- vitest`.
