/**
 * The writer spells a width it cannot count in whole columns (#1092).
 *
 * WHAT WENT WRONG. `@n` is a relative WEIGHT, so `note("c4@1.5 e4@1.2")` is 2.7 columns
 * long with a note starting at 1.5. Every place the writer needed to say "leave `w`
 * columns of silence here" said it as a run of bare `~`, and a bare `~` is exactly one
 * column — so a gap of 1.5 came back as 2. That is not a rounding error in the output,
 * it is a RETIME of music the gesture never touched: the lane comes back longer than the
 * pattern, Strudel scales each comma-lane to its own total, and the lanes stop sharing a
 * grid. Measured through the engine, dragging `c4` in `note("c4@1.5 e4@1.2")` moved `e4`
 * — untouched — from `[0.5556, 1.0000)` to `[0.6250, 1.0000)`.
 *
 * WHY IT IS TESTED HERE AND NOT ONLY IN THE CORPUS. Nothing real reaches it: 0 of 544
 * corpus roll models carry a fractional note position, so the corpus sweep is green
 * before this change and after it, and 0 of 3759 corpus serializations move. The gate
 * that can FIRE is this one, on the hand-written input the defect was found on —
 * `note("c4@1.5 e4@1.2")` is an ordinary thing to write.
 *
 * THE ARMS BELOW ARE PER TERM, not per rule. Each of the six things this change does is
 * asserted by an arm that reddens when that one thing is reverted; the reach is
 * deliberately not pooled into a single "it works now".
 */
import { describe, it, expect } from 'vitest'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { parsePianoRoll } from '../parse'
import { serializePianoRoll, serializeRollGain } from '../serialize'
import { columnSplit } from '../model'
import type { PianoRollModel } from '../model'

function parse(s: string): PianoRollModel {
  const r = parsePianoRoll(s)
  if (!r.ok) throw new Error(`parse failed: ${r.reason}`)
  return r.model
}

/** where the ENGINE puts each note of `src`, as `[onset, end)` in cycles */
function sounded(src: string): Array<{ token: string; begin: number; end: number }> {
  const pat = reifyMini(src) as { queryArc(a: number, b: number): unknown[] }
  const haps = pat.queryArc(0, 1) as Array<{
    hasOnset?: () => boolean
    whole?: { begin: { valueOf(): number }; end: { valueOf(): number } }
    value: unknown
  }>
  return haps
    .filter((h) => (h.hasOnset?.() ?? false) && h.whole)
    .map((h) => ({
      token: String(h.value),
      begin: h.whole!.begin.valueOf(),
      end: h.whole!.end.valueOf(),
    }))
}

/** the model's own claim about where a note sounds — plain arithmetic, not the writer */
function intended(m: PianoRollModel): Array<{ token: string; begin: number; end: number }> {
  return m.notes.map((n) => ({
    token: n.pitch,
    begin: n.start / m.steps,
    end: (n.start + n.duration) / m.steps,
  }))
}

const byOnset = (a: { begin: number; token: string }, b: { begin: number; token: string }): number =>
  a.begin - b.begin || a.token.localeCompare(b.token)

/**
 * The whole invariant in one comparison, and the only one that matters: whatever the
 * writer emits must SOUND like the model it was given. Compared through the engine
 * rather than by re-reading our own output ([[P301]]) — every wrong output in this
 * file re-parses perfectly well.
 */
function expectSoundsLikeModel(m: PianoRollModel, out: string | null): void {
  expect(out).not.toBeNull()
  const got = sounded(out!).sort(byOnset)
  const want = intended(m).sort(byOnset)
  expect(got.length).toBe(want.length)
  got.forEach((g, i) => {
    expect(g.token).toBe(want[i].token)
    expect(g.begin).toBeCloseTo(want[i].begin, 9)
    expect(g.end).toBeCloseTo(want[i].end, 9)
  })
}

/** move one note, exactly as the panel's drag builds the model */
function move(m: PianoRollModel, pitch: string, from: number, to: number): PianoRollModel {
  const n = m.notes.find((x) => x.pitch === pitch && x.start === from)
  if (!n) throw new Error(`no ${pitch} at ${from}`)
  return {
    ...m,
    leafSource: undefined,
    notes: [
      ...m.notes.filter((x) => x !== n),
      { ...n, start: to, duration: Math.max(1, Math.min(n.duration, m.steps - to)) },
    ],
  }
}

describe('columnSplit — the one rule for "how many whole columns is this?"', () => {
  it('splits a fractional width into whole columns and a remainder', () => {
    expect(columnSplit(2.5)).toEqual({ whole: 2, remainder: 0.5 })
    expect(columnSplit(0.5)).toEqual({ whole: 0, remainder: 0.5 })
  })

  it('a whole width has NO remainder — this is what keeps integer patterns byte-identical', () => {
    expect(columnSplit(3)).toEqual({ whole: 3, remainder: 0 })
    expect(columnSplit(0)).toEqual({ whole: 0, remainder: 0 })
  })

  /**
   * A float sliver is not a column and not a remainder either ([[P390]]). Both of these
   * arrive from the reader's division and both mean "exactly one column".
   */
  it('a sliver either side of a whole number reads as that whole number', () => {
    expect(columnSplit(0.9999999999999998)).toEqual({ whole: 1, remainder: 0 })
    expect(columnSplit(1.0000000000000002)).toEqual({ whole: 1, remainder: 0 })
  })

  it('a negative width is not a gap — the caller has an overlap, not silence to spell', () => {
    expect(columnSplit(-0.5).whole).toBeLessThan(0)
  })
})

describe('the note lane pads with a WEIGHTED rest where a whole one will not fit (#1092)', () => {
  /** the issue's own reproduction: a pattern 2.7 columns long */
  it('a drag on a fractional-LENGTH pattern leaves the untouched note where it sounded', () => {
    const m = parse('c4@1.5 e4@1.2')
    expect(m.steps).toBeCloseTo(2.7, 9)
    const moved = move(m, 'c4', 0, 1)
    const out = serializePianoRoll(moved)
    expectSoundsLikeModel(moved, out)

    // and say it in the terms the issue did: `e4` is where it always was
    const was = sounded('c4@1.5 e4@1.2').find((h) => h.token === 'e4')!
    const now = sounded(out!).find((h) => h.token === 'e4')!
    expect(now.begin).toBeCloseTo(was.begin, 9)
    expect(now.end).toBeCloseTo(was.end, 9)
  })

  /**
   * The issue scoped this to patterns "whose length is not a whole number of columns".
   * That is too narrow and this arm is why: `c4@1.5 e4@1.5` is exactly 3 columns long,
   * and it was corrupted the same way, because the note STARTS at 1.5. The two lanes even
   * came out with EQUAL sums (3.5 and 3.5) — so a gate asserting only that the lanes
   * agree with each other would have read green over it.
   */
  it('a pattern of WHOLE length is reached too, when a note starts mid-column', () => {
    const m = parse('c4@1.5 e4@1.5')
    expect(m.steps).toBe(3)
    expectSoundsLikeModel(move(m, 'c4', 0, 1), serializePianoRoll(move(m, 'c4', 0, 1)))
  })

  it('a fractional gap in the middle of a lane is spelled, not rounded up', () => {
    const m = parse('c4@1.5 e4@1.5 g4')
    expectSoundsLikeModel(move(m, 'c4', 0, 1), serializePianoRoll(move(m, 'c4', 0, 1)))
  })

  /**
   * The TRAILING pad, which is a separate term from the leading one and fails on its own.
   * Here the moved note lands last, so nothing follows it to be pushed out of place —
   * only the lane's own total is wrong, and that is enough to retime its neighbour lane.
   */
  it('the pad after the last note is weighted too', () => {
    const m = parse('c4@1.5 e4@1.5')
    const moved = move(m, 'e4', 1.5, 2)
    expectSoundsLikeModel(moved, serializePianoRoll(moved))
  })

  it('a placement into a fractional pattern keeps every other note in place', () => {
    const m = parse('c4@1.5 e4@1.2')
    const placed: PianoRollModel = {
      ...m,
      leafSource: undefined,
      notes: [
        ...m.notes.map((n) => (n.pitch === 'c4' ? { ...n, duration: 1 } : n)),
        { pitch: 'g4', start: 1, duration: 1 },
      ],
    }
    expectSoundsLikeModel(placed, serializePianoRoll(placed))
  })

  /** the control: nothing about a whole-column pattern may change */
  it('CONTROL — an all-integer pattern serializes exactly as it always did', () => {
    expect(serializePianoRoll(parse('c4 e4 g4'))).toBe('c4 e4 g4')
    expect(serializePianoRoll(parse('c4@2 ~ e4'))).toBe('c4@2 ~ e4')
    const m = parse('c4 e4 g4')
    const moved = move(m, 'c4', 0, 1)
    expect(serializePianoRoll(moved)).not.toContain('@')
  })
})

describe('a weight is spelled as the user would write it, not as the float that reached it', () => {
  /**
   * `1.2` survives the reader as `1.2000000000000002`. Re-emitting that verbatim writes
   * arithmetic noise into the user's document — text nobody typed — even though it
   * re-parses and plays the same.
   */
  it('a duration does not carry float noise into the source', () => {
    const m = parse('c4@1.5 e4@1.2')
    const e4 = m.notes.find((n) => n.pitch === 'e4')!
    expect(e4.duration).not.toBe(1.2) // the model field stays EXACT — see below
    const touched: PianoRollModel = {
      ...m,
      leafSource: undefined,
      notes: m.notes.map((n) => ({ ...n, gain: n.pitch === 'c4' ? 0.5 : 1 })),
    }
    expect(serializePianoRoll(touched)).toBe('c4@1.5 e4@1.2')
  })

  /**
   * And the rounding is at the point of EMISSION only. The panel positions notes from
   * `duration`, so the field itself must stay exact ([[P391]]: the consumer that writes
   * to the document gets its own derived question, the model field does not move).
   */
  it('the MODEL field is left alone — only the token is rounded', () => {
    const m = parse('c4@1.5 e4@1.2')
    expect(m.notes.find((n) => n.pitch === 'e4')!.duration).toBeGreaterThan(1.2)
  })
})

describe('the gain lane pads on the SAME grid as the notes it annotates', () => {
  /**
   * The two minis run 1:1 against each other. If the notes lane says `~@0.5` where the
   * gain lane says `~`, the volumes land on different columns from the notes — so this
   * rule could not be fixed on one side only.
   */
  it('a fractional gap is weighted in the gain mini as well', () => {
    const m = parse('c4@1.5 ~@0.5 e4')
    const withGain: PianoRollModel = {
      ...m,
      leafSource: undefined,
      notes: m.notes.map((n, i) => ({ ...n, gain: i === 0 ? 0.5 : 1 })),
    }
    const notes = serializePianoRoll(withGain)
    const gain = serializeRollGain(withGain)
    expect(gain.kind).toBe('write')
    const gainMini = gain.kind === 'write' ? gain.value : ''
    // the two sequences must describe the same column layout: same token count, and the
    // rests in the same places
    const shape = (s: string): string => s.split(/\s+/).map((t) => (t.startsWith('~') ? t : 'x')).join(' ')
    expect(shape(gainMini)).toBe(shape(notes!))
    expect(gainMini).toContain('~@0.5')
  })

  it('CONTROL — an integer pattern`s gain mini is unchanged', () => {
    const m = parse('c4@2 ~ e4')
    const withGain: PianoRollModel = {
      ...m,
      leafSource: undefined,
      notes: m.notes.map((n, i) => ({ ...n, gain: i === 0 ? 0.5 : 1 })),
    }
    const gain = serializeRollGain(withGain)
    expect(gain.kind === 'write' && gain.value).toBe('0.5@2 ~ 1')
  })
})

/**
 * The gap helper's other answer. A NEGATIVE width is not silence to spell — it means the
 * caller handed it two notes that overlap — and it is the ONE caller that does not pack
 * its notes first that depends on the refusal: `spliceRoll`'s rebuild passes a part's
 * notes through as they are, and its "if its notes now overlap, that isn't a lane" comment
 * is discharged entirely by this null. Clamping the gap to nothing instead would emit the
 * overlapping notes side by side as if they were consecutive.
 */
describe('a negative gap is refused, so an overlap reaches the lane writer that can hold it', () => {
  it('stretching a note over its neighbour lays them across comma-lanes, losing neither', () => {
    const m = parse('c4 e4 g4')
    const stretched: PianoRollModel = {
      ...m,
      leafSource: undefined,
      notes: m.notes.map((n) => (n.pitch === 'c4' ? { ...n, duration: 2 } : n)),
    }
    const out = serializePianoRoll(stretched)
    expect(out).not.toBeNull()
    expect(out).toContain(',') // the overlap became parallel lanes, not a flat sequence
    expectSoundsLikeModel(stretched, out)
  })
})

describe('the region writer declines a span it cannot tile (#1092)', () => {
  /**
   * `spliceRoll` re-emits ONE edited element in its own span, walking whole steps. A
   * region 1.5 columns wide cannot be walked that way — it comes back one step too heavy
   * and shifts everything after it. Its own contract already said "or not at all"; this
   * makes it true. The cost is nothing: the caller rebuilds the part as a flat lane,
   * which CAN spell a fractional width, so the edit still lands.
   */
  it('an edit inside a fractional-width element still writes, via the flat lane', () => {
    const m = parse('c4@1.5 ~@0.5 e4')
    // shorten c4 to one column — its region stays 1.5 columns wide
    const shortened: PianoRollModel = {
      ...m,
      leafSource: undefined,
      notes: m.notes.map((n) => (n.pitch === 'c4' ? { ...n, duration: 1 } : n)),
    }
    expectSoundsLikeModel(shortened, serializePianoRoll(shortened))
    expect(serializePianoRoll(shortened)).toBe('c4 ~ e4')
  })

  it('CONTROL — a whole-width element is still re-emitted in place, bytes around it kept', () => {
    const m = parse('c4@2 ~ e4')
    const shortened: PianoRollModel = {
      ...m,
      leafSource: undefined,
      notes: m.notes.map((n) => (n.pitch === 'c4' ? { ...n, duration: 1 } : n)),
    }
    expect(serializePianoRoll(shortened)).toBe('c4 ~ ~ e4')
  })
})
