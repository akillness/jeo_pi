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

## 5. The other three borrowed dimensions

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

## 6. Compatibility & safety (regressions forbidden)

- `JEO_NO_MEMORY=1` disables the bundle mirror, the JSON hooks, **and** the
  session-exit distiller.
- The JSON store stays the source of truth for recall; the bundle is additive, so
  removing `.jeo/memory/` never breaks recall.
- Atomic writes (`*.tmp → rename`) for `index.md`/`log.md`/concept docs.
- Conformance + graph lint are warnings-only (OKF lenient consumption).
- The session-exit distiller is best-effort and contained: ≤3 memories/session,
  dedup against existing summaries, an 8s abort timeout so it never hangs `/exit`,
  and a try/catch that returns a skip reason instead of throwing on shutdown.

## 7. Verification

```bash
cd extensions/workspace-memory
npx vitest run            # 81 tests incl. okf*, distill.test.ts, rrf.test.ts
npx tsc --noEmit          # zero errors
```
```
