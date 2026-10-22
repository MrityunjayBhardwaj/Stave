# collect.ts split — consumer audit (Phase 0, #972)

`collect.ts` does two jobs: it derives lane **structure** (anchors from source spans) and it
computes **behaviour** (onsets, by re-implementing Strudel's RNG / euclid / weighting). The
split (#945) keeps the first as a resilient `structuralWalk` and moves the second to `queryArc`.
This is the map of who depends on which job — the gate for Phase 0.

## The structural fields (what haps lack)

Every `IREvent` carries three anchors that haps do **not**, all sourced from source-span
structure, never from timing:

| field | meaning | set at |
|---|---|---|
| `dollarPos` | source pos of the enclosing `$:` Track (label anchor) | `collect.ts:486` (outer-wins) |
| `leafIndex` | sequential index of each voice-defining `stack(...)` arm | `collect.ts:651` |
| `armIndex` | active `Arrange` arm (clip) for the cycle | `collect.ts:745` |

## Consumers of `collectCycles` (the behaviour producer)

| # | site | reads | classification | migration |
|---|---|---|---|---|
| 1 | `app/…/timelineMarks.ts:133` | anchors (`dollarPos`/`leafIndex`/`armIndex`) + source/arrange/label offsets; **plus** pre-eval mark fallback | **BOTH** | anchors → `structuralWalk`; marks → `queryArc` (already the path when haps present, `:87/217`) |
| 2 | `app/…/FullSongTimeline.tsx:284` | **only** `armIndex` (is any event an arrange arm → `bareSong`) | **STRUCTURE** | `structuralWalk` |
| 3 | `app/…/StrudelEditorClient.tsx:149` | full `IREvent[]` for `publishIRSnapshot` (IR-inspector + pre-eval seed) | **BEHAVIOUR** | `queryArc`-backed events; the inspector is a debug surface, low fidelity bar |
| 4 | `editor/…/songAnalysis.ts:298` | onset density → natural/display span | **BEHAVIOUR** | **already injectable** (`opts.collectFn`) → pass a `queryArc`-backed fn; easiest first migration |
| — | `editor/…/ir/index.ts:5,13` | public re-export | API | keep the symbol until consumers 1–4 are migrated |

## Reading

- Only consumer 2 is structure-only → it moves to `structuralWalk` in Phase 1 with zero risk.
- Consumer 1 is the hard one: it needs both, and it is where the join (haps → lanes by span
  containment) already partly lives. Phase 1 gives it a structural source; Phase 2 gives it the
  hap source.
- Consumers 3 and 4 are behaviour → they wait for Phase 2's `queryArc` producer. Consumer 4 is
  injectable, so it is the first behaviour migration and needs no call-site edit.

## Seam

`structuralWalk(ir, nCycles) → LaneSkeleton[]` — see `structuralWalk.ts`. Anchors only, no onset
computation, per-node resilient (a bad sub-node degrades that lane, never the whole walk). Phase
1 (#973) implements it and proves its anchors byte-identical to `collect`'s over the 57-tune
corpus.
