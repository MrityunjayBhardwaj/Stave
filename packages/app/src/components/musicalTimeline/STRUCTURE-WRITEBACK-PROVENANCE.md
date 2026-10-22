# Timeline structure → clip write-back: provenance & soundness (#974)

Phase 2 of the collect split (#945) makes `structuralWalk` the source of the Song timeline's
per-lane **structure** maps. Those maps do not just draw pixels — they supply the anchors every
clip gesture writes back into the Strudel source. This document traces that chain end-to-end and
records why the emitted source after a UI mutation is sound.

## The write chain

Every timeline clip gesture — trim / split / delete / move / duplicate — resolves to:

```
detectArrangeAt(code, pos) + armIndex
   → setWeight / splitArm / silenceArm / insertArm / reorderArm   (codeView/arrange/serialize.ts)
   → OffsetEdit[]  →  surgical edit to the source text
```

The two inputs that determine WHAT gets written:

| write input | where it is read | scene field | structuralWalk map |
|---|---|---|---|
| `pos` (→ `detectArrangeAt`) | `FullSongTimeline.tsx:1067,1097` = `lane.arrangeOffset ?? lane.sourceOffset` | `arrangeOffset` / `sourceOffset` | `arrangeByLane` / `sourceByLane` |
| `armIndex` (→ `setWeight(call, i, …)`) | the selected clip's arm | clip (RLE of arm-per-cycle) | `armByCycleByLane` |

Handlers: `MusicalTimeline.tsx` `handleTrimClip:392` / `handleDeleteClip:455` / `handleSplitClip` /
`handleMoveClip:500`, each `detectArrangeAt(snapshot.code, req.sourceOffset)` then the arrange
writer. Scene fields are set in `timelineScene.ts:314-316` from the maps `collectNoteMarks`
(`timelineMarks.ts`) builds via `structuralWalk`.

Note edits (Pattern panel) do **not** take a write offset from here: `onBindLane` only moves the
cursor to `sourceOffset` (`MusicalTimeline.tsx:350`); the panel re-derives its own write span via
acorn `ChunkInfo`. So even the bind path is insulated from these offsets.

## Why the output is sound

1. **The write inputs are byte-identical to the pre-#974 reduction on valid code.**
   `arrangeByLane` / `sourceByLane` / `armByCycleByLane` equal the old inline `collectCycles`
   reduction over the whole corpus — `tests/parity-corpus/timelineMarks.structuralWalk.test.ts`
   (57 tunes, 0 diff). Anchors equal collect — `structuralWalk.test.ts` (43 lanes, 0 mismatch).
   Identical inputs → `detectArrangeAt` / `setWeight` / `splitArm` receive identical arguments →
   identical emitted source.

2. **The emitted source is asserted end-to-end, not inferred.** `full-song-arrange-{trim, split,
   delete, multitrack, nested, clips}.spec.ts` drive the real gesture in the browser and pin the
   written Strudel — e.g. a multitrack split writes exactly
   `arrange([1, s("bd")], [1, s("bd")], [2, s("hh")], [4, s("cp")])`.

## The one real corruption this review caught

P1's `structuralWalk` bucketed a **multi-cycle `arrange` arm** by its arm-local cycle:
`armByCycle` came out `[2,2,2,2,null…]` instead of collect's `[0,0,1,1,2,2,2,2]`. P1 was inert, so
this was latent. The moment `timelineMarks` consumed the walk, a split on such a lane would have
selected the **wrong `armIndex`** → `splitArm` rewriting the wrong arm → silently corrupt Strudel,
with nothing thrown. The corpus has no multi-cycle-arm arrange, so the byte-identical gate could
not see it; the real-app `full-song-arrange-multitrack` e2e did (the split no-op'd). Fixed by
separating the arm-local *selection* cycle from the outer *song* cycle (`structuralWalk.ts`
`outputCycle`), pinned by `tests/parity-corpus/structuralWalk.arrange.test.ts`.

This is the boundary's fatality class (a projection shifting an offset → silent write corruption),
and the browser arm of the two-arm gate is what surfaced it. No other write-affecting field is
ungated; the `arrangeOffset → sourceOffset` fallback only matters for non-arrange lanes, which have
no trimmable clip.
