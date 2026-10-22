/**
 * Square-bracket chord parsing (#508).
 *
 * Mini-notation `[a,b,c]` (comma) is a CHORD — parallel notes each spanning the
 * full cycle — distinct from `[a b c]` (spaces), a sequence. Before the fix the
 * `[...]` parser ignored top-level commas, so a chord parsed identically to a
 * sequence and the structural IR arpeggiated it. The audio path (real Strudel)
 * was always correct; this guards the structural IR + its round-trip.
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { toStrudel } from '../toStrudel'
import type { PatternIR } from '../PatternIR'

// A chord (`[a,b,c]`, comma) vs a sequence (`[a b c]`, spaces) is a STRUCTURAL
// distinction in the parsed IR — a `Stack` of parallel voices vs a `Seq` of
// staggered ones — not a behavioural one. Onset TIMING (begin/end) now comes
// from Strudel's own eval; this guards the structural IR the parser builds (its
// stated subject) directly on the IR, plus the round-trip. The audio path (real
// Strudel) was always correct.
const bodyOf = (ir: PatternIR): PatternIR => (ir.tag === 'Track' ? ir.body : ir)
const kidsOf = (n: PatternIR): PatternIR[] =>
  n.tag === 'Stack' ? n.tracks : n.tag === 'Seq' ? n.children : []
/** A Play leaf's voice value — sample name if present, else its note token. */
const voiceOf = (n: PatternIR): unknown =>
  n.tag === 'Play' ? (n.params.s ?? n.note) : undefined

describe('square-bracket chords (#508)', () => {
  it('`[a,b,c]` is a chord: a parallel Stack of full-cycle notes', () => {
    const body = bodyOf(parseStrudel('note("[c2,e2,g2]")'))
    expect(body.tag).toBe('Stack')
    expect(kidsOf(body).map((k) => k.tag)).toEqual(['Play', 'Play', 'Play'])
    expect(kidsOf(body).map(voiceOf)).toEqual(['c2', 'e2', 'g2'])
  })

  it('`[a b c]` stays a sequence: a Seq of staggered voices (unchanged)', () => {
    const body = bodyOf(parseStrudel('note("[c2 e2 g2]")'))
    expect(body.tag).toBe('Seq')
    expect(kidsOf(body).map((k) => k.tag)).toEqual(['Play', 'Play', 'Play'])
    expect(kidsOf(body).map(voiceOf)).toEqual(['c2', 'e2', 'g2'])
  })

  it('mixed `[a b, c]` = a stack of one sub-sequence and one full-cycle note', () => {
    const body = bodyOf(parseStrudel('note("[c2 e2, g2]")'))
    expect(body.tag).toBe('Stack')
    const [sub, note] = kidsOf(body)
    // First voice is the `c2 e2` sub-sequence; second is the standalone g2.
    expect(sub.tag).toBe('Seq')
    expect(kidsOf(sub).map(voiceOf)).toEqual(['c2', 'e2'])
    expect(note.tag).toBe('Play')
    expect(voiceOf(note)).toBe('g2')
  })

  it('a chord alternates per cycle inside `<...>`', () => {
    // Outer `<…>` is a Cycle; each arm is a chord Stack.
    const body = bodyOf(parseStrudel('note("<[c2,e2,g2] [d2,f2,a2]>")'))
    expect(body.tag).toBe('Cycle')
    if (body.tag !== 'Cycle') return
    const first = body.items[0]
    expect(first.tag).toBe('Stack')
    expect(kidsOf(first).map(voiceOf)).toEqual(['c2', 'e2', 'g2'])
  })

  it('sample chords stack too: `[bd,hh]`', () => {
    const body = bodyOf(parseStrudel('s("[bd,hh]")'))
    expect(body.tag).toBe('Stack')
    expect(kidsOf(body).map(voiceOf)).toEqual(['bd', 'hh'])
  })

  it('round-trips faithfully back to mini-notation', () => {
    for (const code of [
      'note("[c2,e2,g2]")',
      'note("<[c2,e2,g2] [d2,f2,a2]>")',
    ]) {
      // toStrudel is byte-faithful for these; re-parse must be a fixpoint either way.
      expect(toStrudel(parseStrudel(code))).toBe(code)
    }
  })

  it('mixed note+sample stack is NOT collapsed to one mini wrapper', () => {
    // A note token inside `s("…")` would play as a sample — fall back to stack().
    const ir = parseStrudel('stack(s("bd sd"), note("c4 e4"))')
    expect(toStrudel(ir)).toContain('stack(')
  })
})
