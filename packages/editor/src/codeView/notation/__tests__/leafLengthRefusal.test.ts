/**
 * leafLengthRefusal.test.ts — the leaf writer refuses an edit on an axis it cannot read
 * (#1235).
 *
 * `spliceByLeaf` writes a grid edit by replacing each changed note's own bytes, and it
 * used to decide what changed by comparing TOKENS alone. A note's LENGTH has no bytes of
 * its own — it is spelled by what surrounds the token — so a resize was invisible: the
 * writer found no difference, wrote the source back, and reported it as a write. On a
 * model the leaf projection owns that is a length handle that silently stops working; on
 * an OVERLAID model it pre-empts the element writer, which can spell the length, and the
 * user's drag does nothing at all.
 *
 * The corpus half is in `@stave/app` (`op-admissibility`, `placement-admissibility`,
 * `writer-reach`) — 1003 → 1273 handles offered, and 0 swallowed on all three carriers.
 * This is the unit half, on fixtures small enough to read.
 */
import { describe, expect, it } from 'vitest'
import { parseStepGrid, projectStepGridDerived } from '../parse'
import type { LeafSource, StepGridModel } from '../model'
import { cellOn, isCellOn } from '../model'
import { serializeStepGridWithExtent } from '../serialize'
import { resizeCell, toggleCell } from '../place'
import { scaleStepGrid } from '../resolution'

const model = (mini: string): StepGridModel => {
  const r = parseStepGrid(mini)
  if (!r.ok) throw new Error(`${mini} did not open: ${r.gate}`)
  return r.model
}

/** the leaf spans for this mini, however the derived projection carries them */
const spansFor = (mini: string): LeafSource => {
  const d = projectStepGridDerived(mini, { ok: false, reason: 'test' })
  if (!d.ok) throw new Error(`${mini} has no derived projection`)
  const spans = d.model.surgical?.spans() ?? d.model.leafSource
  if (!spans) throw new Error(`${mini} carries no leaf spans`)
  return spans
}

/**
 * The model as production builds it, with the overlay asserted PRESENT.
 *
 * ⚠ THESE FIXTURES USED TO HAND-ATTACH THE OVERLAY, and since #1233 they do not have to:
 * `parseStepGrid` attaches it on the core-opened half, which is where all of these live.
 * Asking production for it means these arms would redden if the attachment were unwired —
 * a hand-built overlay is a second oracle that passes with production's own attach site
 * deleted ([[P519]]).
 */
const overlaidModel = (mini: string): StepGridModel => {
  const m = model(mini)
  if (!m.surgical) throw new Error(`${mini} was not given an overlay by parseStepGrid`)
  return m
}

/** the same model with nothing overlaid — the incumbent's own answer, for the control arms */
const bare = (m: StepGridModel): StepGridModel => {
  const { surgical: _dropped, ...rest } = m
  return rest as StepGridModel
}

/** set one cell's length with no op-level gate in front of it */
const lengthen = (m: StepGridModel, lane: number, col: number, d: number): StepGridModel => ({
  ...m,
  lanes: m.lanes.map((l, i) =>
    i === lane ? { ...l, cells: l.cells.map((c, j) => (j === col ? cellOn(d) : c)) } : l,
  ),
})

describe('#1235 — a length the leaf writer cannot spell is a refusal, not a silent no-op', () => {
  const MINI = 'bd ~ sn cp'

  it('OVERLAID: lengthening a note falls through to the splice, which can spell it', () => {
    // the issue's own repro. Without the overlay the splice writes `bd _ sn cp`; with it,
    // the leaf writer used to answer `path: 'leaf'` and hand back `bd ~ sn cp` unchanged.
    const overlaid = overlaidModel(MINI)
    const longer = lengthen(overlaid, 0, 0, 2)

    const got = serializeStepGridWithExtent(longer)
    expect(got.extent.path).toBe('splice')
    expect(got.mini).toBe('bd _ sn cp')
    // and it is the SAME answer the model gives with no overlay at all — the overlay's
    // refusal restores the incumbent exactly, which is the whole safety argument for
    // hoisting this rung ([[PV315]]).
    expect(got.mini).toBe(serializeStepGridWithExtent(lengthen(bare(overlaid), 0, 0, 2)).mini)
  })

  it('CONTROL: the same overlay still answers a DELETE, so the refusal is axis-scoped', () => {
    // Without this arm the test above passes just as well on an overlay that was never
    // attached, or on one the width guard already rejects — "refused" and "never present"
    // read identically from the outside ([[P521]]).
    const overlaid = overlaidModel(MINI)
    const got = serializeStepGridWithExtent(toggleCell(overlaid, 0, 0, false))
    expect(got.extent.path).toBe('leaf')
    expect(got.mini).toBe('~ ~ sn cp')
  })

  it('the panel therefore offers the handle again — it had gone dark on overlaid models', () => {
    // `resizeCell` returns its input when the document would not move, so a swallowed
    // length is not corruption the user can see: it is a handle that stops being drawn.
    // That is what made this defect invisible for as long as it was.
    const overlaid = overlaidModel(MINI)
    expect(resizeCell(overlaid, 0, 0, 2)).not.toBe(overlaid)
  })

  it('OWNED by the leaf projection: the refusal is terminal — null, never the source back', () => {
    // Here there is nothing to fall through to: a re-emit is precisely what would destroy
    // the notation this view was opened to preserve. So the honest answer is "no write",
    // and what must never happen is the source bytes returned as though something changed.
    const owned = model('<[~ ~ sd ~] [~ ~ sd ~] [~ ~ [sd sd sd]@2] ~>')
    expect(owned.leafSource, 'this fixture must open as a leaf-anchored grid').toBeTruthy()
    const at = owned.lanes[0].cells.findIndex(isCellOn)
    const got = serializeStepGridWithExtent(lengthen(owned, 0, at, 3))
    expect(got.extent.path).toBe('leaf')
    expect(got.mini).toBeNull()
  })

  it('RESTRUCTURED onto the overlay’s own width: the coincidence no longer admits it', () => {
    // [[PV319]]. `anchorsDescribe` compares the model's width against the overlay's, and
    // where the spans are overlaid those two are computed by different code from
    // different premises — so their equality is evidence of nothing. `bd ~ bd ~` draws
    // four columns and anchors two; halve it and the two numbers coincide, the guard
    // passes against spans describing a different layout, and the write puts the
    // pre-halved bytes back. The width recorded at ATTACH time is not derived from the
    // spans, so comparing it says what was actually wanted.
    const overlaid = overlaidModel('bd ~ bd ~')
    const m = bare(overlaid)
    expect(spansFor('bd ~ bd ~').cols.length, 'the fixture must anchor a DIFFERENT width').not.toBe(
      m.steps,
    )

    // The coincidence is real on this fixture: four drawn columns, two anchored, and a
    // halve lands the first onto the second. Asserted so the arm cannot pass by asking
    // nothing ([[P521]]).
    expect(m.steps).toBe(2 * spansFor('bd ~ bd ~').cols.length)

    // ⚠ AND THE CLAIM IS EQUIVALENCE, NOT "THE ÷2 GOES THROUGH". That was written here
    // first and it was my assumption rather than the mechanism: with no overlay at all
    // the op ALREADY declines this grid, so what the coincidence bought was a ÷2 that
    // appeared to apply and then wrote the pre-halved bytes back. The overlay must leave
    // the incumbent's answer exactly as it found it, which is the whole safety argument
    // for hoisting this rung ([[PV315]]) — and here that answer is "no".
    const withOverlay = scaleStepGrid(overlaid, 'halve')
    const without = scaleStepGrid(m, 'halve')
    expect(withOverlay === overlaid).toBe(without === m)
    expect(withOverlay.steps).toBe(without.steps)
    expect(serializeStepGridWithExtent(withOverlay).mini).toBe(
      serializeStepGridWithExtent(without).mini,
    )
  })

  it('a DELETE on lengths carrying float error is still written as byte surgery', () => {
    // `clampLane` re-clamps the whole lane on every edit and turns `1.0000000000000018`
    // into exactly `1`, so a raw length comparison reads a delete that touched no length
    // as a resize. This fixture is the corpus unit that cost: comparing raw numbers takes
    // the grid surgery census from 103 to 102, and the shared `cellLengthKey` rounding
    // puts it back.
    const owned = model('<[~ ~ sd ~] [~ ~ sd ~] [~ ~ [sd sd sd]@2] ~>')
    const at = owned.lanes[0].cells.findIndex(isCellOn)
    const got = serializeStepGridWithExtent(toggleCell(owned, 0, at, false))
    expect(got.extent.path).toBe('leaf')
    expect(got.mini).not.toBeNull()
    expect(got.mini).not.toBe('<[~ ~ sd ~] [~ ~ sd ~] [~ ~ [sd sd sd]@2] ~>')
  })
})
