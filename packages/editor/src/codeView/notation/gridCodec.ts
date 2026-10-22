/**
 * The grid panels' code↔view questions, asked of one bundle per grid (#1942).
 *
 * The step grid and the piano roll each used to assemble the same five codec functions
 * by hand, ask the gain serializer directly whether velocity is writable, carry the same
 * "is this Slots target a view or a write" block, and decide keep-or-reseed and the
 * write's bytes inside a React hook. Each of those answers is a question about what the
 * code says or what a model would write, so they live here, beside the codec, and the
 * panels keep only their state and gestures.
 *
 * Every function below is a composition of ops that already existed; none decides
 * anything new. `reconcileGrid` and `gridWritePlan` are `useGridModel`'s two blocks,
 * moved verbatim (#1893 split the hook from the writer; this finishes the split).
 */
import type { ChunkGain, GainWrite, ParseResult, PianoRollModel, StepGridModel } from './model'
import { parsePianoRoll, parseStepGrid, applyRollGain, applyStepGain } from './parse'
import { serializePianoRoll, serializeStepGrid, serializeRollGain, serializeStepGain } from './serialize'
import {
  collapsePianoRollToDocument,
  collapseStepGridToDocument,
  freeZoneScale,
  quantizePianoRollTo,
  quantizeStepGridTo,
  rollResolutionEffect,
  rollSlotState,
  stepResolutionEffect,
  stepSlotState,
  NO_RESOLUTION_EFFECT,
  type GridResolutionEffect,
  type SlotState,
} from './resolution'
import { absorbViewScale, documentSteps, type ViewScale } from './viewResolution'
import { gainUnchanged } from './gainEdit'

/** what a grid model needs to carry for the view-scale machinery */
type Scaled = { steps: number; viewScale?: ViewScale }

/**
 * Reading and writing one grid's notation. The three optional members are a panel's
 * opt-outs, exactly as `useGridModel`'s options have always had them: no gain functions
 * means no velocity; no `collapseToDocument` means every write spells what was drawn.
 */
export interface NotationCodec<M> {
  parse: (mini: string, viewScale: ViewScale) => ParseResult<M>
  /** model → mini, or null when the model can't be expressed in the subset */
  serialize: (model: M) => string | null
  /** read an existing `.gain` (scalar or per-column) onto a freshly-parsed model */
  applyGain?: (model: M, gain: ChunkGain) => M
  /** model → what to do with the `.gain` method (write / clear / skip) */
  serializeGain?: (model: M) => GainWrite
  /**
   * Express a model drawn at a finer view at the DOCUMENT's own resolution, or
   * `null` when the edit really used a column the document does not have (#1057).
   *
   * A write consults this FIRST, so that only a write which NEEDS the finer
   * spelling respells the file. Omitting it restores the previous behaviour —
   * every write spells what was drawn — which is what keeps a caller that never
   * refines behaving exactly as it did.
   */
  collapseToDocument?: (model: M) => M | null
}

/** The resolution ("Slots") control's ops for one grid. */
export interface ResolutionOps<M> {
  slotState: (model: M, target: number, canDrawView?: (scale: ViewScale) => boolean) => SlotState
  /** the op a writing press runs */
  quantizeTo: (model: M, target: number) => M
  /** what that op would cost (#1061, #1933) */
  resolutionEffect: (model: M, target: number) => GridResolutionEffect
}

export interface GridCodec<M> extends Required<NotationCodec<M>>, ResolutionOps<M> {}

export const stepGridCodec: GridCodec<StepGridModel> = {
  parse: parseStepGrid,
  serialize: serializeStepGrid,
  applyGain: applyStepGain,
  serializeGain: serializeStepGain,
  collapseToDocument: collapseStepGridToDocument,
  slotState: stepSlotState,
  quantizeTo: quantizeStepGridTo,
  resolutionEffect: stepResolutionEffect,
}

export const pianoRollCodec: GridCodec<PianoRollModel> = {
  parse: parsePianoRoll,
  serialize: serializePianoRoll,
  applyGain: applyRollGain,
  serializeGain: serializeRollGain,
  collapseToDocument: collapsePianoRollToDocument,
  slotState: rollSlotState,
  quantizeTo: quantizePianoRollTo,
  resolutionEffect: rollResolutionEffect,
}

/**
 * Is velocity offered on this model? Asked of the gain WRITER, never predicted beside it
 * (#1089, #1839): the writer's skips are shape (foreign `.gain`, bars, parts, leaf,
 * unspellable columns), which a gain edit does not move.
 */
export function gainWritable<M>(codec: Pick<NotationCodec<M>, 'serializeGain'>, model: M): boolean {
  return codec.serializeGain ? codec.serializeGain(model).kind !== 'skip' : false
}

/* ── the Slots press: a view change or a write ─────────────────────────────── */

/**
 * What pressing a Slots target does (#1057, #1942). A free-zone target changes only how
 * finely the panel DRAWS, at `scale`; anything else is a write the panel runs as
 * `quantizeTo` on its latest model. `none`: a free-zone target with no scale to draw it
 * at, which does nothing.
 *
 * The verdict is the same `slotState` call that renders the button, so the control and
 * the click cannot disagree.
 */
export type SlotPress = { kind: 'view'; scale: ViewScale } | { kind: 'write' } | { kind: 'none' }

export function slotPress<M extends Scaled>(
  ops: Pick<ResolutionOps<M>, 'slotState'>,
  model: M,
  target: number,
  canDrawView?: (scale: ViewScale) => boolean,
): SlotPress {
  if (ops.slotState(model, target, canDrawView) !== 'view') return { kind: 'write' }
  const scale = freeZoneScale(documentSteps(model), target)
  return scale === null ? { kind: 'none' } : { kind: 'view', scale }
}

/**
 * What the press would cost, for the control's copy. Asked of the op the press runs; a
 * free-zone target never reaches the op and costs nothing, because looking closer costs
 * nothing.
 */
export function slotPressCost<M extends Scaled>(
  ops: Pick<ResolutionOps<M>, 'slotState' | 'resolutionEffect'>,
  model: M,
  target: number,
  canDrawView?: (scale: ViewScale) => boolean,
): GridResolutionEffect {
  return ops.slotState(model, target, canDrawView) !== 'view' ? ops.resolutionEffect(model, target) : NO_RESOLUTION_EFFECT
}

/* ── keep-or-reseed, and the write plan (`useGridModel`'s two decisions) ───── */

/**
 * What the panel holds after the document says `mini` (with `chunkGain`) at `viewScale`.
 *
 * `read` is what the text reads as right now (#1849). `model` is what the panel keeps on
 * screen: the in-progress `prev`, when what it would WRITE is still exactly what the
 * document says, its `.gain` still matches and it was drawn at this scale; otherwise the
 * fresh parse. `null` when the mini doesn't parse — unless the refusal carries a
 * look-only view, which is then both.
 *
 * Compared the way the write asks it: a refined model serializes to the drawn spelling,
 * not the document's bytes, so comparing it directly would call every refined model
 * "changed" and reseed on every frame of a velocity drag (#1057).
 */
export function reconcileGrid<M>(
  codec: NotationCodec<M>,
  mini: string,
  chunkGain: ChunkGain,
  viewScale: ViewScale,
  prev: M | null,
  prevScale: ViewScale,
): { read: M; model: M } | null {
  const parsed = codec.parse(mini, viewScale)
  if (!parsed.ok) {
    // A pattern that can be shown but not edited (#1975): the panel holds what it
    // plays. Never the in-progress `prev` — a look-only model has no edits to keep.
    return parsed.lookOnly ? { read: parsed.lookOnly, model: parsed.lookOnly } : null
  }
  const fresh = codec.applyGain ? codec.applyGain(parsed.model, chunkGain) : parsed.model
  const asWritten = prev == null ? null : (codec.collapseToDocument?.(prev) ?? prev)
  const sameMini = asWritten != null && codec.serialize(asWritten) === mini
  // The gain is compared AS WRITTEN too (#1950): `gridWritePlan` spells it from the same
  // collapsed model as the mini, so comparing the refined model's gain would call every
  // velocity write made while refined "changed" and reseed on its own echo.
  const sameGain =
    asWritten == null || !codec.serializeGain ? true : gainUnchanged(codec.serializeGain(asWritten), chunkGain)
  const sameScale = prevScale === viewScale
  return { read: parsed.model, model: prev && sameMini && sameGain && sameScale ? prev : fresh }
}

/**
 * Which bytes writing `next` puts in the document, or `null` when it is inexpressible
 * (leave the document untouched).
 *
 * Only an edit that used a column the document does not have needs the finer spelling;
 * a velocity drag does not, and respelling for it rewrites the file to record how
 * closely someone was looking (#1057). So the write is spelled at the document's own
 * resolution whenever `collapseToDocument` can, and the refinement is absorbed into the
 * kept model (`written`) only when the write actually spelled it.
 *
 * ⚠ `gain` is computed from the SAME model as `mini` (`toWrite`). They were once read
 * separately, and the gain mini was widened to the drawn column count while the notation
 * was not — two ranges disagreeing about the document's resolution.
 */
export function gridWritePlan<M extends { viewScale?: ViewScale }>(
  codec: NotationCodec<M>,
  next: M,
): { mini: string; gain: GainWrite | null; written: M; spellsRefinement: boolean } | null {
  const atDocument = codec.collapseToDocument ? codec.collapseToDocument(next) : null
  const spellsRefinement = atDocument === null
  const toWrite = atDocument ?? next
  const mini = codec.serialize(toWrite)
  if (mini == null) return null
  return {
    mini,
    gain: codec.serializeGain ? codec.serializeGain(toWrite) : null,
    written: spellsRefinement ? absorbViewScale(next) : next,
    spellsRefinement,
  }
}
