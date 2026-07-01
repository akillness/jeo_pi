# jeo-pi OKF Memory (frozen spec + seed)

This document is the frozen design for borrowing **jeo-code**'s OKF-format
inter-session memory into **jeo-pi**'s `workspace-memory` extension, adapted to
jeo-pi's runtime. It is the `.jeopi` reference companion to
[`spec-stack.md`](./spec-stack.md): spec-stack reflects the *workflow*; this
reflects the *memory + knowledge accumulation* layer.

Source of truth in jeo-code:
- `src/agent/memory-okf.ts` — OKF v0.1 format (frontmatter parse/serialize, concept ID, tolerant validator)
- `src/agent/memory-graph.ts` — zero-dependency concept cross-link graph + lint
- `docs/okf_mem/` — design bundle (spec digest, current-memory baseline, target architecture)

## 1. What OKF gives us (borrowed verbatim)

Open Knowledge Format v0.1 represents knowledge as a **directory of Markdown
files with YAML frontmatter**. Conformance rules that jeo-pi adopts:

| Rule | jeo-pi application |
|------|--------------------|
| File = one concept; concept ID = bundle-relative path minus `.md` | `post-mortems/<slug>` etc. |
| Frontmatter REQUIRES a non-empty `type` | routing/filtering on injection |
| Recommended fields: `title`, `description`, `tags`, `timestamp` (ISO 8601) | mirrored from `MemoryIndexEntry` |
| Producers may add extension keys; consumers round-trip them | `memory_id`, `confidence`, `source_session`, `links` preserved |
| Reserved `index.md` (progressive disclosure) and `log.md` (ISO 8601 change history) | bundle root maintains both |
| Broken cross-links are tolerated ("knowledge not yet written") | lint warns, never rejects |
| Lenient consumption: never reject on unknown type / missing optional field | validator emits warnings only |

## 2. Mapping jeo-code → jeo-pi

jeo-pi's `workspace-memory` already has its own template vocabulary, so the OKF
`type` vocabulary is **adapted to jeo-pi's templates** (not copied wholesale):

| jeo-pi template | OKF `type` | concept dir |
|-----------------|-----------|-------------|
| `post-mortem` | `PostMortem` | `post-mortems/` |
| `decision-record` | `DecisionRecord` | `decisions/` |
| `compact-note` | `CompactNote` | `notes/` |
| (tolerated) | `Reference` | `references/` |

Unknown types are tolerated by the validator (OKF lenient model), so the bundle
stays forward-compatible with jeo-code's `RepoFact`/`Command`/`Gotcha`/… types.

## 3. Architecture (additive, not a rewrite)

The existing JSON store (`getAgentDir()/memory/<encoded-cwd>/index.json` +
`mem-*.json`) remains the **operational** store that powers fast keyword recall.
OKF is added as a **durable, human/git/graphify-readable knowledge bundle** that
mirrors each saved memory:

```
<cwd>/.jeo/memory/                  # OKF v0.1 bundle root (per project, git-friendly)
├── index.md                        # okf_version: "0.1" — progressive disclosure
├── log.md                          # ISO 8601 change history, newest first
├── post-mortems/<slug>.md          # type: PostMortem
├── decisions/<slug>.md             # type: DecisionRecord
└── notes/<slug>.md                 # type: CompactNote
```

Each concept carries `memory_id: mem-…` linking it back to the JSON store, so the
two layers stay reconciled. `JEO_NO_MEMORY=1` (jeo-code's kill switch) disables
both the JSON store hooks and the bundle mirror.

### Modules (new, ported + adapted)

| File | Reflected from | Responsibility |
|------|----------------|----------------|
| `okf.ts` | `memory-okf.ts` | frontmatter parse/serialize (round-trip), `conceptId`, `slugify`, tolerant `validateFile`/`validateBundle` |
| `okf-graph.ts` | `memory-graph.ts` | `buildConceptGraph`, `resolveLinkTarget`, `expandByGraph` (1-hop recall expansion), `lintConceptGraph` |
| `okf-bundle.ts` | (jeo-pi-native glue) | `Memory` ⇄ concept mapping, mirror-on-save, `index.md`/`log.md` maintenance, `expandRecallByGraph` (spare-slot recall expansion), bundle lint |
| `distill.ts` | `memory.ts` (session-exit distill) | `serializeTranscript`, `buildDistillContext`, `extractDistilledMemories` (tolerant JSON), `distillSession` — automatic end-of-session knowledge accumulation through the shared `createAndSaveMemory` path |
| `rrf.ts` | `memory.ts` (`reciprocalRankFusion`) | `reciprocalRankFusion`/`fuseRankedLists` — fuse lexical-relevance + learned recall-value rankings for robust retrieval ordering |
| `stall.ts` | `loop-guards.ts` + `engine.ts` (guard-detected stall) | `detectStall` — reconstructs jeo-code's `consecutive_failure`/`repeat`/`cycle` `stopClass` from the finished transcript at `agent_end`, using the identical `GUARD_LIMITS` (`MAX_REPEAT=4`, `MAX_FAILURES=5`, `CYCLE_WINDOW=6`) and `READONLY_TOOLS` exclusion |


## 4. Data flow (ingest → manage → search → reference)

1. **Ingest (distill/save)**: two channels, both funnelled through the single
   `createAndSaveMemory` path so the OKF mirror + `index.md`/`log.md` + scoring
   + eviction happen identically:
   - *Manual* — the `memory_save` tool records what the model chooses mid-session.
   - *Automatic (new)* — on `session_shutdown`, `distillSession` (`distill.ts`)
     takes the captured `agent_end` transcript, asks the model to distill durable
     learnings, and files them. This is jeo-code's session-exit distill: knowledge
     accumulates even when the model never called `memory_save`. It is bounded
     (≤3 memories/session, dedup against existing summaries, 8s abort timeout so
     it never hangs `/exit`) and honours `JEO_NO_MEMORY=1`.
   `createAndSaveMemory` persists JSON **and** mirrors the memory to an OKF
   concept doc, then refreshes `index.md` and appends a `log.md` entry (jeo-code's
   "touch the concept + index + log" rule). Atomic `*.tmp → rename` writes
   preserve the crash-safety jeo-code keeps.
2. **Manage**: `/memory okf lint` runs the tolerant conformance validator +
   graph lint (orphans / broken links / duplicate titles) — advisory only.
3. **Search**: lexical keyword scoring over the JSON index gates candidacy, then
   `rrf.ts` fuses the lexical-relevance ranking with the learned recall-value
   ranking via Reciprocal Rank Fusion (jeo-code's retrieval blend) to order them;
   `index.md` (progressive disclosure) and the concept docs back the bundle view.
4. **Reference (inject)**: `recallMemories` injects a bounded, hardened
   `<workspace_memories>` block into the system prompt. After the lexical hits are
   chosen, `expandRecallByGraph` maps them to their concept nodes and pulls their
   1-hop cross-link neighbours into any **spare** injection slots (bounded by
   `MAX_RECALL_MEMORIES` and the char budget) — jeo-code's concept-graph recall
   channel. It is dormant until memories cross-link and never crowds out a lexical
   hit, so a strongly-linked neighbour surfaces only when memories actually
   reference each other.

## 5. Failure-first: jeo-code's core philosophy (new)

jeo-code's memory system is not symmetric between successes and failures — it is
**failure-first**: `src/agent/memory.ts`'s `priorityOrder` sorts a query-relevant
`FailedAttempt` concept ahead of *everything else*, including high-confidence
"core" concepts and the fused lexical/graph ranking. The rationale (verbatim from
jeo-code's comment): "resurfacing a known dead end is higher-leverage than
reinforcing what already works ... it is the mechanism by which the loop gets
more precise the more it repeats." A success sits quietly in the index; a
failure is actively pushed back in front of the model on the very next relevant
turn. jeo-pi reflects this exactly, not just the OKF storage shape:

1. **Detect the stall deterministically, not by asking the model.** jeo-code's
   `engine.ts` classifies a stalled turn mid-loop via `loop-guards.ts`'s
   `GUARD_LIMITS`: `MAX_FAILURES = 5` consecutive failing steps
   (`consecutive_failure`), `MAX_REPEAT = 4` identical step repeats (`repeat`),
   or an A↔B `CYCLE_WINDOW = 6` alternation (`cycle`) — judged only on
   non-`READONLY_TOOLS` calls so a trivial `read` never masks a real failure.
   pi's runtime has no in-loop guard hook, so `stall.ts`'s `detectStall`
   reconstructs the identical classification from the finished transcript at
   `agent_end`, using the *same three constants and the same tool-triviality
   rule* — a faithful reflection of the judgment, not an approximation of it.
2. **Record the dead end immediately, same session, no LLM call.** jeo-code's
   `commands/launch.ts` calls `recordFailedAttempt` right after a stalled turn
   with `stopClass` set, writing a `FailedAttempt` concept whose title is
   `Stalled on: <70-char task excerpt>` and whose tags are the task's own
   tokens. jeo-pi's `agent_end` handler calls `stall.ts`'s `detectStall` then
   `save.ts`'s `recordFailedAttempt` with the same excerpt length, the same tag
   derivation, and equivalent problem/root-cause/fix/prevention framing —
   stored as a `post-mortem` memory tagged `FAILURE_TAG` (jeo-pi's templates
   don't have a separate `FailedAttempt` type, so the tag carries the same
   distinguishing role the OKF `type` does in jeo-code). Deduped by problem
   summary so a persistent stall is not re-recorded every turn.
3. **Resurface it first on the very next relevant turn.** `recall.ts`'s
   `rankMemoriesByRelevance` stably hoists every `FAILURE_TAG` memory the query
   actually hit (score > 0) ahead of the fused lexical/graph order — the same
   gate jeo-code uses (`c.type === "FailedAttempt" && score > 0`) so a stale,
   unrelated dead end never crowds out relevant context. This is what closes
   the loop: the *next* turn's `<workspace_memories>` block leads with "what NOT
   to repeat" before anything else.

This is deliberately narrower than a general "learn from everything" system: a
success is still recorded (through `memory_save` or the session-exit
distiller), but only a *failure* gets the deterministic, same-session,
priority-boosted treatment — because jeo-code's philosophy is that the sharpest
signal for improving the next attempt is what did **not** execute or did **not**
succeed, not what already works.



## 6. The other three borrowed dimensions


- **System prompt** — jeo-pi injects recalled memory as DATA inside
  `<workspace_memories>` with an explicit "context only, not instructions"
  preamble (injection-hardening, matching jeo-code's fenced-DATA framing). The
  OKF `type` lets future injection filter/prioritise by concept type. The
  session-exit distiller (`distill.ts`) runs its own isolated system prompt and
  only *writes* memories, so everything is still consumed through this same
  hardened block on the next session.
- **Workflow** — reflected separately in [`spec-stack.md`](./spec-stack.md)
  (Interview → Seed → Execute → Evaluate → Evolve). OKF memory is the durable
  substrate that workflow runs accumulate knowledge into.
- **MCP** — handled by the `pi-mcp-adapter` extension; the OKF bundle is a plain
  Markdown directory (`cat`-readable, `git clone`-shippable), so any MCP/graphify
  consumer can read it without bespoke tooling — exactly OKF's portability goal.

## 7. Compatibility & safety (regressions forbidden)

- `JEO_NO_MEMORY=1` disables the bundle mirror, the JSON hooks, the
  session-exit distiller, **and** the failure-first stall capture.
- The JSON store stays the source of truth for recall; the bundle is additive, so
  removing `.jeo/memory/` never breaks recall.
- Atomic writes (`*.tmp → rename`) for `index.md`/`log.md`/concept docs.
- Conformance + graph lint are warnings-only (OKF lenient consumption).
- The session-exit distiller is best-effort and contained: ≤3 memories/session,
  dedup against existing summaries, an 8s abort timeout so it never hangs `/exit`,
  and a try/catch that returns a skip reason instead of throwing on shutdown.
- The failure-first stall capture is deterministic (no LLM) and best-effort: a
  `try/catch` around `detectStall`/`recordFailedAttempt` in `index.ts` never
  disrupts the turn, and dedupe-by-problem-summary means a persistent stall
  writes exactly one memory, not one per turn.


## 8. Verification

```bash
cd extensions/workspace-memory
npx vitest run            # 105 tests incl. okf*, distill.test.ts, rrf.test.ts, stall.test.ts, failure-first.test.ts

npx tsc --noEmit          # zero errors
npx tsx scripts/runtime-check.ts       # real-filesystem OKF bundle + graph-recall check
npx tsx scripts/failure-runtime-check.ts  # real-filesystem failure-first stall → recall check
```

