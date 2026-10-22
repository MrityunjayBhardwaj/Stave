/**
 * 1117-refined-round-trip.test.ts — what a refined view owes the document when a
 * write comes back through it.
 *
 * #1117 admits two more model families to a refined view, so their writes now reach
 * `collapse*ToDocument` — the ÷k guard that asks "can what I am about to write be
 * said at the document's own resolution?". This gate holds the three properties that
 * question has, and it keeps them APART, because they fail for different reasons and
 * only one of them is currently clean:
 *
 *   CONTENT   the model that comes back plays what the document plays.
 *             MUST be exact. A failure here is music silently changed by how closely
 *             someone was looking — the worst outcome this seam can produce.
 *
 *   ARITHMETIC the model that comes back has the document's own column count.
 *             MUST be exact.
 *
 *   SPELLING  the bytes that come back are the document's own bytes.
 *             CLEAN as of #1121. It was not when this gate was written: the collapse
 *             de-scaled the model's cells but left the SOURCE description at the
 *             refined resolution, so the writer stopped recognising it and fell to
 *             the flat rebuild. 362 grid / 263 roll units came back re-spelled; all
 *             of them now come back byte-identical. The literals below are kept at
 *             their post-fix values for the same reason they were pinned at their
 *             pre-fix ones — a number that must be READ if it ever moves.
 *
 * AND THE CLAUSE THAT MAKES THE THREE ABOVE NON-VACUOUS — an UNEDITED round trip is a
 * weak question, because the writer copies unedited regions through verbatim at every
 * scale, so a collapse that did nothing at all would satisfy it. The fourth property
 * asks the form #1121 actually specifies:
 *
 *   EQUIVALENCE  the same edit, made at the document's resolution and made through a
 *             refined view, produces the same bytes. This is the one that forces the
 *             collapse to be a real inverse: an edit re-emits the region it touched,
 *             and the whole question is whether it re-emits it at the resolution the
 *             document spells or the one the user happened to be looking at.
 *
 * ⚠ THE EDIT IS DELIBERATELY ONE THAT STAYS ON THE DOCUMENT'S GRID — a cell the file
 * already spells, a note starting on a column it already has. An edit that uses a
 * column only the finer view has SHOULD spell the finer grid, and the collapse
 * declining is the correct answer there; mixing the two into one population would
 * make the equivalence unassertable.
 *
 * Shapes are named by the SOURCE STRUCTURE the model carries, not by the function
 * that produced it — `alt-whole` covers both the syntactic whole-cycle alternation
 * and the bar projection, which build the same shape and so write through the same
 * splicer. Naming it after one producer would be a claim the data cannot support.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import {
  collapseStepGridToDocument,
  collapsePianoRollToDocument,
} from '../../../editor/src/codeView/notation/resolution'
import {
  serializeStepGrid,
  serializePianoRoll,
} from '../../../editor/src/codeView/notation/serialize'
import { documentSteps } from '../../../editor/src/codeView/notation/viewResolution'
import { toUniformGrid, toUniformRoll } from '../../../editor/src/codeView/notation/perBar'
import { toggleCell, placeNote } from '../../../editor/src/codeView/notation/place'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import type {
  StepGridModel,
  PianoRollModel,
} from '../../../editor/src/codeView/notation/model'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

/** the refine every unit in the corpus can be asked for */
const K = 2

function shapeOf(m: {
  altSource?: unknown
  leafSource?: unknown
  source?: { prefix?: string }
}): string {
  if (m.leafSource) return 'leaf'
  if (m.altSource) return 'alt-element'
  if (m.source?.prefix?.trimStart().startsWith('<')) return 'alt-whole'
  if (m.source) return 'element'
  return 'bare'
}

/** what a grid model PLAYS: every lane's on-columns with their lengths */
function gridContentKey(m: StepGridModel): string {
  return m.lanes
    .map((l) => {
      // Length is part of what a cell PLAYS, so it belongs in the content key — a
      // round trip that kept every onset but changed a note's LENGTH would otherwise
      // pass, and note length is exactly the quantity the refine guard discriminates on.
      const hits = l.cells
        .map((c, i) => (isCellOn(c) ? `${i}:${c.duration}` : null))
        .filter(Boolean)
      return `${l.sound}#${l.part ?? 0}=${hits.join(',')}`
    })
    .sort()
    .join('|')
}

/** what a roll model PLAYS */
function rollContentKey(m: PianoRollModel): string {
  return m.notes
    .map((n) => `${n.pitch}@${n.start}+${n.duration}`)
    .sort()
    .join('|')
}

interface Tally {
  refined: number
  contentChanged: string[]
  wrongSteps: string[]
  nullCollapse: number
  respelled: string[]
  /** units where the same document-grid edit applied at both scales, and its verdict */
  edited: number
  diverged: string[]
  /** the edit was admissible at one scale and refused at the other — an asymmetry, reported */
  editAsymmetric: string[]
  /** the edit stayed on the document's grid, yet the collapse still declined it */
  editDeclined: string[]
  /** units asked the opposite question: an edit that NEEDS the finer spelling */
  finerAsked: number
  /** ...and was wrongly collapsed back to the document's resolution anyway */
  finerAdmitted: string[]
}
const blank = (): Tally => ({
  refined: 0,
  contentChanged: [],
  wrongSteps: [],
  nullCollapse: 0,
  respelled: [],
  edited: 0,
  diverged: [],
  editAsymmetric: [],
  editDeclined: [],
  finerAsked: 0,
  finerAdmitted: [],
})

/**
 * The same edit expressed at two scales. Returns the edited pair, or `null` when this
 * model offers no document-grid edit at all (nothing to compare, and not a failure).
 * `k` is applied to the COLUMN, because a document column `c` is drawn column `c × k`.
 */
type Edit<M> = (model: M, k: number) => M | null

function sweep<
  M extends {
    steps: number
    viewScale?: number
    altSource?: unknown
    leafSource?: unknown
    source?: { prefix?: string }
  },
>(
  parse: (mini: string, k?: number) => { ok: true; model: M } | { ok: false },
  collapse: (m: M) => M | null,
  // the real writers DECLINE by returning null; a declined write is still a
  // comparable answer here, and folding it to `string` would hide one
  serialize: (m: M) => string | null,
  contentKey: (m: M) => string,
  edit: Edit<M>,
  needsFiner?: (m: M, k: number) => boolean | null,
): Map<string, Tally> {
  const byShape = new Map<string, Tally>()
  for (const mini of minis) {
    const base = parse(mini)
    if (!base.ok) continue
    const refined = parse(mini, K)
    if (!refined.ok) continue
    const shape = shapeOf(refined.model)
    const t = byShape.get(shape) ?? blank()
    byShape.set(shape, t)
    t.refined++

    const back = collapse(refined.model)
    if (back === null) {
      t.nullCollapse++
    } else {
      // ARITHMETIC — the collapse must land on the document's own column count
      if (back.steps !== documentSteps(refined.model)) t.wrongSteps.push(mini)
      // CONTENT — and must still play exactly what the document plays
      if (contentKey(back) !== contentKey(base.model)) t.contentChanged.push(mini)
      // SPELLING — the document's own bytes (#1121)
      if (serialize(back) !== serialize(base.model)) t.respelled.push(mini)
    }

    // ...and the opposite question, on the same unit: an edit that NEEDS the finer
    // spelling must be refused, or the guard is admitting everything
    if (needsFiner) {
      const verdict = needsFiner(refined.model, K)
      if (verdict !== null) {
        t.finerAsked++
        if (!verdict) t.finerAdmitted.push(mini)
      }
    }

    // EQUIVALENCE — the same edit, made plainly and made through the refined view
    const editedBase = edit(base.model, 1)
    const editedRefined = edit(refined.model, K)
    if (editedBase === null && editedRefined === null) continue
    if (editedBase === null || editedRefined === null) {
      t.editAsymmetric.push(mini)
      continue
    }
    const editedBack = collapse(editedRefined)
    if (editedBack === null) {
      t.editDeclined.push(mini)
      continue
    }
    t.edited++
    if (serialize(editedBack) !== serialize(editedBase)) t.diverged.push(mini)
  }
  return byShape
}

/**
 * The edit each surface makes, at whichever scale it is handed. Chosen to land on a
 * column the DOCUMENT already spells, so the collapse must admit it — see the header.
 * Returns `null` when this model offers no such edit, or when the writer refuses one
 * (an op returns its input by reference when it cannot apply).
 */
/**
 * ⚠ AN ERASE, AND THE REASON IS THE WHOLE DISTINCTION. `toggleCell` paints a hit
 * lasting exactly the column that was clicked — one DRAWN column, which at a refined
 * view is shorter than any column the document spells. So a PLACEMENT through a
 * refined grid legitimately needs the finer spelling and the collapse declines it;
 * that is #1057's discriminator working, not a defect, and it is asserted below as
 * its own clause rather than left as a comment. Erasing introduces no length, so it
 * is the gesture that belongs in the equivalence population.
 */
const gridEdit: Edit<StepGridModel> = (model, k) => {
  const lane = model.lanes[0]
  if (!lane) return null
  const docSteps = model.steps / k
  let doc = -1
  for (let i = 0; i < docSteps; i++) {
    if (isCellOn(lane.cells[i * k])) {
      doc = i
      break
    }
  }
  if (doc < 0) return null
  const next = toggleCell(model, 0, doc * k, false)
  return next === model ? null : next
}

const rollEdit: Edit<PianoRollModel> = (model, k) => {
  const first = model.notes[0]
  if (!first) return null
  const docSteps = model.steps / k
  const starts = new Set(model.notes.map((n) => n.start))
  let doc = -1
  for (let i = 0; i < docSteps; i++) {
    if (!starts.has(i * k)) {
      doc = i
      break
    }
  }
  if (doc < 0) return null
  // one DOCUMENT column long, which is `k` drawn ones — the same musical length at
  // both scales, so a divergence can only come from how it is spelled
  const next = placeNote(model, first.pitch, doc * k, k)
  return next === model ? null : next
}

/**
 * The other half of the discriminator: a note ONE DRAWN COLUMN long. The document has
 * no spelling for it, so the collapse must decline and the write must spell the finer
 * grid. Asserted so that the guard is pinned from both sides — a collapse that simply
 * admitted everything would pass every clause above and fail this one.
 */
function gridNeedsFiner(model: StepGridModel, k: number): boolean | null {
  if (k === 1) return null
  const lane = model.lanes[0]
  if (!lane) return null
  const docSteps = model.steps / k
  for (let i = 0; i < docSteps; i++) {
    // a drawn column the document cannot address at all: the one after a document column
    const drawn = i * k + 1
    if (drawn >= model.steps || isCellOn(lane.cells[drawn])) continue
    const painted = toggleCell(model, 0, drawn, true)
    if (painted === model) continue
    return collapseStepGridToDocument(painted) === null
  }
  return null
}

function pinned(byShape: Map<string, Tally>, pins: Record<string, [number, number, number]>) {
  // ⚠ THE PIN TABLE MUST COVER WHAT WAS OBSERVED, not the other way round. A table
  // keyed by shapes that no longer appear would assert nothing at all and still pass
  // — the loop below would simply never compare anything. Checking the shape SETS
  // against each other is what makes every assertion under it reachable.
  expect(new Set(Object.keys(pins)), 'the pinned shapes and the observed shapes must agree').toEqual(
    new Set(byShape.keys()),
  )
  // ONE comparison over the WHOLE table, not three per shape. `expect` aborts a
  // test at its first failure, so a per-shape loop reports only the first cell
  // that moved — and a population change (#1242) moves most of them at once,
  // turning one measurement into one round of the gate per cell. Folded, a
  // single run prints the entire observed table against the entire pinned one.
  const observed: Record<string, [number, number, number]> = {}
  for (const shape of Object.keys(pins)) {
    const t = byShape.get(shape)!
    observed[shape] = [t.refined, t.edited, t.nullCollapse]
  }
  expect(
    observed,
    `[units drawing a ×${K} view, units the equivalence arm compared, writes that spell the finer grid]`,
  ).toEqual(pins)
}

/** the four properties, asserted the same way for both surfaces */
function assertClean(byShape: Map<string, Tally>, label: string) {
  for (const [shape, t] of [...byShape].sort()) {
    console.log(
      `${label} ${shape.padEnd(12)} refined=${String(t.refined).padStart(4)} ` +
        `null=${t.nullCollapse} re-spelled=${t.respelled.length} ` +
        `content-changed=${t.contentChanged.length} wrong-steps=${t.wrongSteps.length} | ` +
        `edited=${String(t.edited).padStart(4)} diverged=${t.diverged.length} ` +
        `asym=${t.editAsymmetric.length} edit-declined=${t.editDeclined.length}` +
        (t.finerAsked ? ` | needs-finer=${t.finerAsked} wrongly-collapsed=${t.finerAdmitted.length}` : ''),
    )
    expect(t.contentChanged, `${shape}: the round trip changed what plays`).toEqual([])
    expect(t.wrongSteps, `${shape}: the round trip landed on the wrong width`).toEqual([])
    expect(t.respelled, `${shape}: the round trip re-spelled the document (#1121)`).toEqual([])
    expect(
      t.diverged,
      `${shape}: the same edit spelled differently through a refined view (#1121)`,
    ).toEqual([])
    expect(
      t.finerAdmitted,
      `${shape}: an edit that needs the finer spelling was collapsed away`,
    ).toEqual([])
  }
}

/**
 * The DOCUMENT's model, in the columns a refined view is measured against.
 *
 * A refined view is always one shared column grid. A document whose bars' step counts do
 * not nest is drawn per bar at ×1 (#1827) — `<c2*2 g2*5 [a g]>` as 2 + 5 + 2 cells — and
 * a per-bar model's columns are drawn columns, so comparing it cell for cell with a
 * collapsed refined view compares two different rulers (the sweep reported both such
 * units as "changed what plays" while every hap was identical). `toUniform*` is the
 * exact map back to the shared grid, which for these units is the model this file was
 * written against; every other unit comes back untouched.
 */
function shared<M>(parse: (mini: string, k?: number) => { ok: true; model: M } | { ok: false }, toShared: (m: M) => M) {
  return (mini: string, k?: number) => {
    const r = parse(mini, k)
    return r.ok && k === undefined ? { ok: true as const, model: toShared(r.model) } : r
  }
}

describe('#1117 — coming back from a refined view', () => {
  it('grid: content, width and spelling survive, and an edit spells the same either way', () => {
    const byShape = sweep<StepGridModel>(
      shared(parseStepGrid as never, toUniformGrid),
      collapseStepGridToDocument,
      serializeStepGrid,
      gridContentKey,
      gridEdit,
      gridNeedsFiner,
    )
    assertClean(byShape, 'GRID')
    pinned(byShape, GRID_PINS)
  })

  it('roll: content, width and spelling survive, and an edit spells the same either way', () => {
    const byShape = sweep<PianoRollModel>(
      shared(parsePianoRoll as never, toUniformRoll),
      collapsePianoRollToDocument,
      serializePianoRoll,
      rollContentKey,
      rollEdit,
    )
    assertClean(byShape, 'ROLL')
    pinned(byShape, ROLL_PINS)
  })
})

/* ── pinned populations, re-measured on THIS tree (never inherited) ──────────
 *
 * shape → [units drawing a ×2 view, of those the EQUIVALENCE arm compared,
 *          of those whose collapse declines so the write spells the finer grid]
 *
 * The middle column is what keeps the equivalence assertion honest: `diverged` being
 * empty means nothing if nothing was compared, and the population that reaches the
 * comparison is exactly the one an edit is admissible on at BOTH scales.
 *
 * `leaf` is absent by construction: a leaf-anchored model anchors each note to its own
 * source span and so refuses a refine outright, which means it never reaches this
 * sweep. Its absence is asserted by the shape-set equality above, not assumed.
 *
 * The `element` rows are the control: they are the family this change does not touch,
 * and they measured identically on `c12b8d0d` with these projections taught the scale
 * and without. They are pinned here so that if a future change to the collapse moves
 * them, it cannot be mistaken for a cost of the alternation work.
 *
 * ⚠ THE ELEMENT ROW MOVED, AND THE PIN IS WHY WE KNOW (#1120). Teaching the writer to
 * spell a held note across a `[…]` boundary took the grid's element path from 736/735
 * to 743/742 — seven units that used to refuse a finer view now draw one, and six of
 * those are reachable through the Slots control. The alternation rows and every roll
 * row are unchanged, so the move is attributable to that one writer change and nothing
 * else. Every correctness counter on the row stayed at zero: nothing was re-spelled,
 * no content changed, no width was wrong, and no collapse diverged.
 */
const GRID_PINS: Record<string, [number, number, number]> = {
  // ⚠ 61 -> 59 at #1974 (a hit is anchored on the note that wrote it) — store probes/timing-facts-1974/anchor-move: `[c eb g <f bb>](3,8,<0 1>)` and `{c [f g] d# d}%2` are leaf-written now, and a leaf-written view is not offered one step finer.
  'alt-element': [59, 59, 0],
  'alt-whole': [85, 85, 0],
  // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
  // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
  // ⚠ 788 -> 790 at #1849's bar-by-bar edits: two more units' edits are now written at both scales and compared (more compared, nothing re-spelled, no divergence). Not traced unit by unit.
  element: [791, 790, 0],
}
const ROLL_PINS: Record<string, [number, number, number]> = {
  // ⚠ MOVED at #1310 (region-local parallel lanes). The two units that stopped needing
  // the leaf projection land in `alt-element` (56 -> 58) and the one unit the parser
  // newly opens lands in `alt-whole` (105 -> 106). The `alt-element` residual goes
  // 0 -> 1: one of the arrivals is a placement admissible at one scale and refused at
  // the other, which is the FIRST of the three residual causes this file already
  // records below — an arrival carrying a known category, not a new one.
  // ⚠ MOVED at #1312: 39 -> 40 compared, and the residual 1 -> 0. The unit that used to
  // sit in the residual is a placement admissible at one scale and refused at the other —
  // it is now admissible at BOTH, so it leaves the residue by being answered rather than
  // by being excluded. `alt-whole` and `element` are untouched.
  'alt-element': [58, 40, 0],
  'alt-whole': [106, 54, 2],
  // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
  element: [400, 149, 2],
}
/*
 * WHY THE ROLL COMPARES FEWER UNITS THAN THE GRID (201 of 490, against 868 of 869).
 * The roll's gesture places a note, so it needs a document column with no note
 * starting on it; a densely-written roll offers none and drops out of the population.
 * The grid's is an erase, which needs only one hit to remove — every roll unit that
 * drops out does so for a stated reason, not a silent one.
 *
 * The residual three are recorded rather than smoothed over: 2 units where the
 * placement is admissible at one scale and refused at the other (`placeNote` resolves
 * overlaps against the neighbouring note, and a 1-column note has different
 * neighbours at each scale), and 1 where the collapse declines an edit that did stay
 * on the document's grid. None of the three is a spelling divergence.
 */
