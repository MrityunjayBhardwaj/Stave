import { describe, it, expect } from 'vitest'
import { parsePianoRoll } from '../parse'
import { serializePianoRoll, serializePianoRollWithExtent } from '../serialize'
import type { PianoRollModel, RollNote } from '../model'

function roll(s: string, k?: number): PianoRollModel {
  const r = parsePianoRoll(s, k)
  if (!r.ok) throw new Error(`parse failed: ${s}`)
  return r.model
}

/**
 * One member of a chord subdivided while its siblings hold — the model the placement
 * gesture produces once it stops shortening notes nobody asked it to shorten (#1310).
 *
 * Built by hand rather than through `placeNote`, and that is the point: today's op
 * shortens every note crossing the column, so it CANNOT produce this model. That is
 * exactly why the writer rung under test is unreachable until the placement half lands.
 */
function splitOneMember(model: PianoRollModel, pitch: string, at: number): PianoRollModel {
  const notes: RollNote[] = model.notes.map((n) =>
    n.pitch === pitch && n.start === 0 ? { ...n, duration: at } : n,
  )
  notes.push({ pitch, start: at, duration: 1 })
  return { ...model, notes }
}

/**
 * Where a voice sits as a FRACTION of the pattern. Column counts are not comparable
 * across a rewrite — a subdivided document legitimately reports more columns for the
 * same music — so the invariant "an untouched voice keeps its timing" has to be asked
 * in cycle-relative terms or it reads as a violation every time the grid refines.
 */
function onsetRatios(mini: string, pitch: string): number[] {
  const m = roll(mini)
  return m.notes.filter((n) => n.pitch === pitch).map((n) => n.start / m.steps)
}

const DOC = '[c,g,a,e4]@2 [c,g,a,e4]'

describe('region-local parallel lanes (#1310)', () => {
  it('spells a subdivided chord member without disturbing its siblings or its neighbour', () => {
    const { mini, extent } = serializePianoRollWithExtent(splitOneMember(roll(DOC, 2), 'c', 1))

    // the lanes live INSIDE the region's own bracket...
    expect(mini).toBe('[c c ~ ~, [g,a,e4]@4]@2 [c,g,a,e4]')
    // ...so this is a splice, not the whole-document rebuild it used to fall through to
    expect(extent.path).toBe('splice')
    // and the element the gesture never touched keeps its own bytes
    expect(mini?.endsWith('[c,g,a,e4]')).toBe(true)
  })

  it('preserves the region’s weight, so the neighbour keeps its timing', () => {
    const { mini } = serializePianoRollWithExtent(splitOneMember(roll(DOC, 2), 'c', 1))
    // the region owned 2 of the document's 3 steps and comes back as 2, never more:
    // a heavier region re-divides the cycle and moves music the edit never reached
    expect(mini).toContain(']@2 ')
    // asked of the music rather than of the spelling: the second chord still begins
    // two thirds of the way through the cycle, as it did before the edit
    expect(onsetRatios(mini as string, 'a')).toEqual(onsetRatios(DOC, 'a'))
  })

  it('round-trips: what it writes, it can read back', () => {
    const { mini } = serializePianoRollWithExtent(splitOneMember(roll(DOC, 2), 'c', 1))
    expect(serializePianoRoll(roll(mini as string))).toBe(mini)
  })

  it('leaves every region it already answered exactly as it was', () => {
    // the rung declines below two lanes, so nothing that re-emits today changes shape
    for (const doc of [DOC, 'c4 e4 g4 b4', 'c4,g4', '[c4 c4],g4', 'c4@2 e4']) {
      expect(serializePianoRoll(roll(doc))).toBe(doc)
    }
  })

  it('declines a region it cannot tile, rather than handing one back heavier', () => {
    // a fractional width has no whole number of steps, so the lanes form declines and the
    // caller's rebuild — which CAN spell a fractional width — answers instead
    const frac = '[c,g]@1.5 e4@0.5'
    const { mini, extent } = serializePianoRollWithExtent(splitOneMember(roll(frac, 2), 'c', 1))
    expect(extent.path).toBe('rebuild')
    // declining must not cost the untouched voice its place in the cycle
    expect(onsetRatios(mini as string, 'e4')).toEqual(onsetRatios(frac, 'e4'))
  })
})
