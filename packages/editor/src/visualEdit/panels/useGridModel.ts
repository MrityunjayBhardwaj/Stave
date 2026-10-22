/**
 * useGridModel — model-in-state binding shared by the grid panels (Sequencer,
 * Piano Roll).
 *
 * Both panels parse the chunk's mini-notation into a structured model, edit it,
 * and write the serialized result back over the mini range. The model is held
 * in component state rather than derived per-render so structure the user
 * clears (an emptied lane, a deleted note) survives — its serialized form may
 * omit it, but the editable scaffold stays. The model is reseeded only on
 * EXTERNAL edits, detected by comparing what we'd serialize against the
 * incoming source; the panel's own write-back echoes leave it untouched.
 *
 * `mutate(fn)` runs a pure transform against the latest model (synchronous, so
 * a fast drag reads its own prior edits), then writes the serialized result.
 * A transform whose serialization is inexpressible in the subset (serialize →
 * null) is dropped, leaving the document untouched.
 *
 * VELOCITY (the second write-back range): a panel may also carry a `.gain("…")`
 * mini that runs PARALLEL to the head mini — per-column velocity (#409). When
 * `serializeGain`/`applyGain` are supplied, every `mutate` writes the mini AND
 * the coordinated gain edit (replace an existing string `.gain` arg, insert
 * `.gain("…")` after the expression, or remove our `.gain` when all-neutral) as
 * ONE `commit` — a single undo step. The model is reseeded when EITHER
 * the mini OR the `.gain` changes externally. WHICH BYTES that write changes is
 * not decided here: `gridWriteEdits` (`codeView/notation/gainEdit`, #1887) builds
 * the edit list and this hook hands it to `commit` (#1909).
 *
 * Nor are keep-or-reseed and the write plan: `reconcileGrid` and `gridWritePlan`
 * (`codeView/notation/gridCodec`, #1942) answer both. This hook holds the state,
 * the refs, the gesture and the `commit` call.
 *
 * Built on `useActiveChunk` (the active-editor → chunk layer).
 */
import * as React from 'react'

import type { ChunkInfo } from '../../codeView'
import type { NotationCodec } from '../../codeView'
import { UNREFINED, type ViewScale } from '../../codeView'
import { commit, type WriteSource } from '../../codeView'
import { gridWriteEdits, readChunkGain, reconcileGrid, gridWritePlan } from '../../codeView'
import { useActiveChunk } from './useActiveChunk'

/**
 * The panel's codec (`stepGridCodec` / `pianoRollCodec`, #1942) plus what only the
 * panel knows: its source tag, which chunks are its own, and its view scale.
 */
export interface GridModelOptions<M> extends NotationCodec<M> {
  /** writeback source tag for this panel's edits */
  source: WriteSource
  /** does this chunk belong to this panel? (head function / shape gate) */
  eligible: (chunk: ChunkInfo) => boolean
  /**
   * How finely to DRAW the chunk (#1057). A change here re-parses at the new scale
   * and writes nothing — that is the free zone's whole mechanism. Defaults to the
   * document's own resolution, so a panel that never sets it behaves as before.
   */
  viewScale?: ViewScale
  /**
   * Called after a write-back has actually SPELLED the refinement, so the panel can
   * drop it: the document now says what was drawn (`absorbViewScale`). Not called
   * when the transform declined or the result was inexpressible — nothing was
   * written — and not called when the write was expressible at the document's own
   * resolution, because then the document's spelling did not change and the user's
   * view must stay where they put it (see `collapseToDocument`).
   */
  onViewScaleConsumed?: () => void
}

export interface GridModel<M> {
  model: M | null
  /** the model the document's text reads as right now — `model` may be the edited one */
  read: M | null
  chunk: ChunkInfo | null
  /** transform the model and write the serialized result over the mini range */
  mutate: (fn: (model: M) => M) => void
  /**
   * Write `model` over the mini range UNCONDITIONALLY — no live-model guard, no
   * identity short-circuit (#1453).
   *
   * `mutate` is a transform OF the current model, so it correctly declines when
   * there is no current model and when the transform changed nothing. A gesture's
   * commit-time settle is a different question: the gesture already knows the model
   * it started from, and it is asserting what the document must now hold. Routing
   * that through `mutate` made it silently skippable — a mid-drag frame can leave
   * the document unparseable, which nulls the live model, which made `mutate`
   * return before running the callback that computes the refusal. The gate was
   * disabled by the write it exists to undo.
   */
  settle: (model: M) => void
  /**
   * Replace the whole mini with `mini` as written — not a model's serialization
   * (#1824). For rewrites that change what the grid IS (its length) rather than a
   * cell in it; the model reseeds from the result like any external edit. The
   * caller has already checked the result reads back.
   */
  writeMini: (mini: string) => void
  beginGesture: () => void
  endGesture: () => void
  /**
   * Which pattern is under the panel, for state that belongs to one pattern — a
   * refined view (#1117/#1119). Changes when the cursor moves to another pattern or
   * the text changes for any reason EXCEPT this panel's own write (#1964): every note
   * edit changes the text, and a zoom the user's own click threw away is the bug. Any
   * other change still counts — a scale carried onto text the user typed can refuse
   * to draw it at all (a 64-step pattern at ×8 needs more than 256 columns).
   */
  patternKey: string | null
}

/** Where the pattern starts and what it says — see {@link GridModel.patternKey}. */
const keyOf = (at: number, mini: string | null): string => `${at}:${mini ?? ''}`


export function useGridModel<M extends { viewScale?: ViewScale; lookOnly?: unknown }>(
  opts: GridModelOptions<M>,
): GridModel<M> {
  const { chunk, applyEdit, beginGesture, endGesture } = useActiveChunk()
  const [model, setModel] = React.useState<M | null>(null)
  // WHAT THE TEXT READS AS, beside the model kept on screen (#1849). After a write the
  // kept model is the one that was edited, and its `source` still describes the text it
  // was parsed from — so anything drawn from the WRITTEN structure (step lines) has to
  // be read off this instead: `<[~ sd ~ sd] ~>` has no steps in bar 2, while the edited
  // model's source still says `~ sd ~ sd`, repeated.
  const [read, setRead] = React.useState<M | null>(null)
  // Mirror for synchronous reads inside pointer handlers / rapid drags.
  const modelRef = React.useRef<M | null>(null)
  React.useEffect(() => {
    modelRef.current = model
  }, [model])

  // opts is recreated each render; keep the latest in a ref so the reconcile
  // effect can depend on `chunk` alone.
  const optsRef = React.useRef(opts)
  optsRef.current = opts

  // Read off the LIVE opts rather than the ref: this one has to be a real
  // dependency, because changing how finely we draw is precisely a reason to
  // re-parse (#1057) and a ref would swallow it.
  const viewScale = opts.viewScale ?? UNREFINED
  // The scale the retained model was actually built at. Without it a scale change
  // could keep the previous model whenever it happened to serialize back to the
  // source — retaining a ×2 model for a ×1 view, with no error anywhere.
  const modelScaleRef = React.useRef<ViewScale>(UNREFINED)

  // The key this panel's last write will come back as, and the key it is standing in
  // for. An echo of our own write keeps the pattern's key (#1964).
  const ownEchoRef = React.useRef<string | null>(null)
  const patternKeyRef = React.useRef<string | null>(null)
  const patternKey = React.useMemo(() => {
    if (!chunk) return (patternKeyRef.current = null)
    const key = keyOf(chunk.exprRange[0], chunk.miniString)
    if (key !== ownEchoRef.current) patternKeyRef.current = key
    return patternKeyRef.current
  }, [chunk])

  React.useEffect(() => {
    const o = optsRef.current
    if (!chunk || chunk.miniString === null || !o.eligible(chunk)) {
      modelRef.current = null
      setModel(null)
      setRead(null)
      return
    }
    // Keep the in-progress model only when the mini, the `.gain` AND the scale it
    // was drawn at all still match; any external change to either — or any change
    // to how finely we are drawing — reseeds. Decided by `reconcileGrid`.
    const held = reconcileGrid(
      o,
      chunk.miniString,
      readChunkGain(chunk),
      viewScale,
      modelRef.current,
      modelScaleRef.current,
    )
    if (!held) {
      modelRef.current = null
      setModel(null)
      setRead(null)
      return
    }
    setRead(held.read)
    modelScaleRef.current = viewScale
    modelRef.current = held.model
    setModel(held.model)
  }, [chunk, viewScale])

  /**
   * The write half, shared by `mutate` and `settle` — everything from "what
   * resolution should this spell" down to the edit. Holds no opinion about whether
   * the write SHOULD happen; its callers decide that, and they decide it
   * differently (#1453).
   */
  const writeModel = React.useCallback(
    (next: M): void => {
      // THE DOOR IS SHUT WHILE THE HELD MODEL IS LOOK-ONLY (#1975), whatever `next` says
      // about itself. The ops already decline on such a model; this is for a transform
      // that builds its result from scratch and so loses the mark — `next` would then
      // look like an ordinary sourceless model and be rebuilt into the document. Asked of
      // the model the panel is SHOWING, because that is the one the user is looking at.
      if (modelRef.current?.lookOnly) return
      const o = optsRef.current
      // Which resolution this write spells, its bytes, and the model kept on screen:
      // `gridWritePlan` decides all three (#1057, #1942).
      const plan = gridWritePlan(o, next)
      if (plan == null) return // inexpressible — leave the document untouched
      // The refinement is absorbed ONLY when the write actually spelled it, so the
      // panel's scale is dropped only then.
      if (plan.spellsRefinement) modelScaleRef.current = UNREFINED
      modelRef.current = plan.written
      setModel(plan.written)
      if (plan.spellsRefinement) o.onViewScaleConsumed?.()
      applyEdit((fresh, wb) => {
        ownEchoRef.current = keyOf(fresh.exprRange[0], plan.mini)
        // One commit → the mini and its `.gain` are one undo step.
        commit(wb, gridWriteEdits(fresh, plan.mini, plan.gain), o.source)
      })
    },
    [applyEdit],
  )

  const mutate = React.useCallback(
    (fn: (m: M) => M): void => {
      const prev = modelRef.current
      if (prev == null) return
      const next = fn(prev)
      if (next === prev) return
      writeModel(next)
    },
    [writeModel],
  )

  /** See {@link GridModel.settle}. Deliberately skips both of `mutate`'s guards. */
  const settle = React.useCallback((next: M): void => writeModel(next), [writeModel])

  /** See {@link GridModel.writeMini}. One edit, so one undo step. */
  const writeMini = React.useCallback(
    (mini: string): void => {
      if (modelRef.current?.lookOnly) return // same door, the text route (#1975)
      applyEdit((fresh, wb) => {
        commit(wb, gridWriteEdits(fresh, mini, null), optsRef.current.source)
      })
    },
    [applyEdit],
  )

  return { model, read, chunk, mutate, settle, writeMini, beginGesture, endGesture, patternKey }
}
