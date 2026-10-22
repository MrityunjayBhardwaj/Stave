/**
 * writeExtent.test.ts — the grid writer reports how much of the document it moved
 * (#1058).
 *
 * The corpus gate for the property lives in `@stave/app`
 * (`1058-refined-placement.test.ts`) because it needs the mini corpus and the
 * engine oracle. This is the unit half: the four paths and the two counts, on
 * fixtures small enough to read.
 *
 * WHY THE COUNTS ARE REPORTED RATHER THAN RECONSTRUCTED — the alternative
 * instrument walks `prefix`/`before`/`raw`/`after`/`suffix` back into absolute
 * byte offsets and reads a diff against them. Measured against this report over
 * 15,200 corpus asks, that walk calls 208 whole-part rebuilds "local" and gets
 * nothing wrong in the other direction, because a rebuilt one-element part and a
 * re-emitted element produce a diff of the same shape (#1137).
 */
import { describe, expect, it } from 'vitest'
import { parseStepGrid } from '../parse'
import { serializeStepGrid, serializeStepGridWithExtent } from '../serialize'
import { toggleCell } from '../place'

const model = (mini: string, scale?: number) => {
  const r = scale === undefined ? parseStepGrid(mini) : parseStepGrid(mini, scale)
  if (!r.ok) throw new Error(`${mini} did not open: ${r.gate}`)
  return r.model
}

describe('the grid writer reports what it moved', () => {
  it('an unedited round trip re-emits NOTHING — every region is copied verbatim', () => {
    // the baseline the whole splice path exists for, stated as a number rather
    // than as "the string came back the same"
    //
    // ⚠ ASKED OF THE SPLICE PATH EXPLICITLY SINCE #1233. The shipped model now carries the
    // surgical overlay on this core-opened pattern and surgery answers first, so reading the
    // extent off `parseStepGrid`'s own model would quietly stop exercising the counts this
    // arm exists for. Stripping the overlay keeps that coverage; the arm below records what
    // the shipped path answers instead, so neither fact is lost to the other.
    const m = model('bd ~ sn cp')
    const { surgical: _overlay, ...spliceOnly } = m
    const { mini, extent } = serializeStepGridWithExtent(spliceOnly as typeof m)
    expect(mini).toBe('bd ~ sn cp')
    expect(extent).toEqual({ path: 'splice', regions: 4, regionsReemitted: 0, rebuiltParts: [] })
  })

  it('…and the SHIPPED model answers that same round trip with surgery (#1233)', () => {
    // Not a restatement of the arm above. That one now strips the overlay, so on its own it
    // would read `splice` whether or not the core attachment exists — this is what pins that
    // the overlay REACHES an ordinary core-opened pattern. Unwire the attachment and this
    // reddens while the arm above stays green, which is the whole reason both are here.
    const m = model('bd ~ sn cp')
    expect(m.surgical, 'the core-opened attachment is not reaching this pattern').toBeTruthy()
    const { mini, extent } = serializeStepGridWithExtent(m)
    expect(mini).toBe('bd ~ sn cp')
    expect(extent).toEqual({ path: 'leaf' })
  })

  it('a hit on a refined column re-emits ONE region of four', () => {
    const m = model('bd ~ sn ~', 2)
    expect(m.steps).toBe(8)
    const { mini, extent } = serializeStepGridWithExtent(toggleCell(m, 0, 1, true))
    // the element under the cursor subdivides; the other three come back as the
    // user's own bytes
    expect(mini).toBe('[bd bd] ~ sn ~')
    expect(extent).toEqual({ path: 'splice', regions: 4, regionsReemitted: 1, rebuiltParts: [] })
  })

  it('one of one is reported as one of ONE — locality is vacuous there', () => {
    // `hh*8` is a single element owning the whole cycle, so any edit re-emits the
    // entire pattern while satisfying "only one region moved". Reporting the
    // denominator is what makes that visible to a caller (#994).
    const m = model('hh*8', 2)
    const { extent } = serializeStepGridWithExtent(toggleCell(m, 0, 1, true))
    expect(extent).toEqual({ path: 'splice', regions: 1, regionsReemitted: 1, rebuiltParts: [] })
  })

  it('a leaf-anchored grid says which path answered, and offers no counts', () => {
    // byte surgery at each note's own span — there are no regions to count, and a
    // zero would read as "moved nothing", so the shape does not allow one
    const m = model('bd [~ [hh ~]] sn ~')
    expect(m.leafSource).toBeDefined()
    expect(serializeStepGridWithExtent(m).extent).toEqual({ path: 'leaf' })
  })

  it('`serializeStepGrid` is the same write, projected', () => {
    // not a tautology by construction alone: it is what stops a future caller
    // from getting an extent that describes a different write than it received
    for (const [mini, scale] of [
      ['bd ~ sn cp', undefined],
      ['bd ~ sn ~', 2],
      ['hh*8', 2],
      ['bd [~ [hh ~]] sn ~', undefined],
      ['bd sd cp hh oh cp, cr hh bd', 2],
    ] as [string, number | undefined][]) {
      const m = model(mini, scale)
      const edited = toggleCell(m, 0, 1, true)
      expect(serializeStepGrid(edited), mini).toBe(serializeStepGridWithExtent(edited).mini)
    }
  })

  it('a hit finer than a comma-part SUBDIVIDES one element instead of voiding the part', () => {
    // #1137's worked example, asserted as BYTES rather than as a branch count —
    // locality is a claim about the user's document, so the document is what should
    // have to be right. This arm used to pin the opposite (`rebuiltParts: [3]`,
    // `regionsReemitted: 0`): the whole `,`-part was re-derived and came back as
    // `cr _ hh cr bd _`, rewriting two elements the user never went near.
    //
    // The part cannot hold a hit at this column at its own width, so it is READ at the
    // finest width its elements still describe and only the element under the hit is
    // re-spelled — as a group, which is what keeps its neighbours' timing.
    for (const [scale, want] of [
      [undefined, 'bd sd cp hh oh cp, [cr cr] hh bd'],
      // refining supplies more columns, never a different mechanism (#1116)
      [2, 'bd sd cp hh oh cp, [cr cr ~ ~] hh bd'],
    ] as [number | undefined, string][]) {
      const m = model('bd sd cp hh oh cp, cr hh bd', scale)
      const lane = m.lanes.findIndex((l) => (l.part ?? 0) === 1)
      expect(lane).toBeGreaterThan(-1)
      const { mini, extent } = serializeStepGridWithExtent(toggleCell(m, lane, 1, true))
      // `hh bd` and the entire first part are the user's own bytes, copied through
      expect(mini, `scale=${scale}`).toBe(want)
      expect(extent.path).toBe('splice')
      if (extent.path !== 'splice') return
      expect(extent.rebuiltParts, `scale=${scale} parts rebuilt`).toEqual([])
      expect(extent.regionsReemitted, `scale=${scale} regions re-emitted`).toBe(1)
    }
  })

  it('the whole-part rebuild REMAINS, and where it answers the part holds ONE element', () => {
    // The fallback #1137 kept, and the reason neither fix could simply delete the
    // rebuild: a placement the user could make before must not start refusing.
    //
    // ⚠ THIS ARM USED TO NAME A DIFFERENT UNIT, ON A PREMISE THAT WAS NEVER MEASURED
    // (#1151). It pinned `bd sd oh hh hh [oh hh oh], hh ht bd` at `rebuiltParts: [3]`,
    // described as "the finer read has no spelling". Traced at every refusal site, the
    // real cause was that the width search committed to the coarsest divisor admitting
    // the hit's POSITION without checking that the resulting LENGTHS were spellable —
    // the placed note came out a third of a column long, which every writer here
    // refuses. A finer width spells it, so that unit now splices locally at EVERY
    // column and could no longer reach this path at all.
    //
    // What still reaches it is a part holding ONE region. There the first admitting
    // width refuses the same way, a finer one would spell it, and it is deliberately
    // not tried: re-emitting the single element yields the rebuild's own columns with a
    // `[…]` around them, so the retry would buy brackets and no locality. The rebuild
    // IS the local answer when the part is one element, which is why this is the shape
    // the residual converged on.
    const m = model('c2, eb3 g3 [bb3 c4]')
    const { mini, extent } = serializeStepGridWithExtent(toggleCell(m, 0, 2, true))
    // it still WRITES — the point of the fallback is that reach is not lost. Before
    // the fallback existed this refused, and the op refuses whatever the writer cannot
    // spell, so the user simply could not place the hit.
    expect(mini).toBe('c2 _ c2 ~ ~ ~, eb3 g3 [bb3 c4]')
    expect(extent.path).toBe('splice')
    if (extent.path !== 'splice') return
    // ONE element, reported by the writer — the discriminator between "a part was
    // flattened" and "the one element the user touched was rewritten"
    expect(extent.rebuiltParts).toEqual([1])
    // ⚠ COLUMN 2, NOT 1, AND THAT IS THE FIXTURE'S WHOLE POINT. At column 1 this very
    // unit splices, because the first width it is read at spells that hit. A fixture
    // that merely named a "hard" unit would pass while measuring the fixed path.
    const one = serializeStepGridWithExtent(toggleCell(m, 0, 1, true))
    expect(one.mini).toBe('[c2 c2 ~ ~ ~ ~], eb3 g3 [bb3 c4]')
    expect(one.extent.path === 'splice' && one.extent.rebuiltParts).toEqual([])
  })

  it('a comma-part whose hit needs a FINER width than its first is spliced, not rebuilt', () => {
    // #1151's worked example, asserted as BYTES. `partColumns` accepts a width when
    // every atom falls on it and says nothing about durations, which it divides by the
    // same factor — so the coarsest admitting width gave this hit a length of a third
    // of a column and the writer refused, voiding the part. The widths are now tried in
    // turn, and the first that can SPELL the hit answers.
    //
    // The neighbours are the assertion: `ht` and `bd` are the user's own bytes and come
    // back untouched, where the rebuild returned the whole part as flat columns.
    for (const [scale, want] of [
      [undefined, 'bd sd oh hh hh [oh hh oh], [hh _ hh ~ ~ ~] ht bd'],
      // refining supplies more columns, never a different mechanism (#1116)
      [2, 'bd sd oh hh hh [oh hh oh], [hh _ _ hh ~ ~ ~ ~ ~ ~ ~ ~] ht bd'],
    ] as [number | undefined, string][]) {
      const m = model('bd sd oh hh hh [oh hh oh], hh ht bd', scale)
      const lane = m.lanes.findIndex((l) => (l.part ?? 0) === 1)
      expect(lane).toBeGreaterThan(-1)
      const col = scale === undefined ? 2 : 3
      const { mini, extent } = serializeStepGridWithExtent(toggleCell(m, lane, col, true))
      expect(mini, `scale=${scale}`).toBe(want)
      expect(extent.path).toBe('splice')
      if (extent.path !== 'splice') return
      expect(extent.rebuiltParts, `scale=${scale} parts rebuilt`).toEqual([])
      expect(extent.regionsReemitted, `scale=${scale} regions re-emitted`).toBe(1)
    }
  })
})
