/**
 * _1256-chord-vocab.spec.ts — does `chordLanes` accept NOTE names?
 *
 * Found while sizing invariant 3's third term: the kind census bucketed
 * `["c5","f5","a5"]` and `["a4"]` as chord charts. Those are note names. If the
 * chord grammar reads them as chords, the routing rule that exists to stop a
 * melody being drawn as a drum grid can do exactly that.
 *
 * This asks the vocabulary directly and then asks whether the PRODUCTION path
 * can reach it — a vocabulary fact is not a defect until a route carries it.
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1256-chord-vocab.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 */
// ⚠ `@tonaljs/chord` is a dependency of @stave/editor, NOT of @stave/app — a
// direct import here fails to resolve. The grammar is reached through
// `isChordSymbol`, which is the function production actually calls anyway.
import { describe, it, expect } from 'vitest'
import { isChordSymbol, chordLanes } from '../../../editor/src/codeView/surface/chordLanes'
import { routeSurface } from '../../../editor/src/codeView/surface/surfaceRoute'
import { parsePianoRoll, parseStepGrid } from '../../../editor/src/codeView/notation/parse'

// Every pitch-class × every octave a real tune uses, in the two spellings the
// corpus actually contains.
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
const ACCIDENTALS = ['', '#', 'b']
const OCTAVES = ['', '0', '1', '2', '3', '4', '5', '6', '7', '8']

describe('#1256 — the chord vocabulary against note names', () => {
  it('which note spellings the chord grammar accepts', () => {
    const accepted: string[] = []
    const rejected: string[] = []
    for (const l of LETTERS) {
      for (const a of ACCIDENTALS) {
        for (const o of OCTAVES) {
          const tok = `${l}${a}${o}`
          ;(isChordSymbol(tok) ? accepted : rejected).push(tok)
        }
      }
    }
    console.log(`\n  note-shaped tokens tested : ${accepted.length + rejected.length}`)
    console.log(`  read as a CHORD           : ${accepted.length}`)
    console.log(`  rejected                  : ${rejected.length}`)

    // Which OCTAVE digits are the carriers — the shape of the collision.
    const byOctave = new Map<string, string[]>()
    for (const tok of accepted) {
      const oct = /\d$/.test(tok) ? tok.slice(-1) : '(none)'
      byOctave.set(oct, [...(byOctave.get(oct) ?? []), tok])
    }
    console.log(`\n  — accepted by trailing digit —`)
    for (const [k, v] of [...byOctave.entries()].sort()) {
      console.log(`  digit ${k.padEnd(6)} ${String(v.length).padStart(3)}  e.g. ${v.slice(0, 8).join(' ')}`)
      if (v.length <= 3) continue
    }
    // Named cases, so the collision's SHAPE is on the record rather than only
    // its size.
    console.log(`\n  — named cases —`)
    for (const tok of ['c4', 'c5', 'a4', 'a5', 'c3', 'c6', 'c7', 'c', 'cb', 'Gsus', 'Em11']) {
      console.log(`  ${tok.padEnd(6)} isChordSymbol=${isChordSymbol(tok)}`)
    }
  })

  it('whether a lane set of note names reads as a chord chart', () => {
    const cases: string[][] = [
      ['c5', 'f5', 'a5'],
      ['a4'],
      ['c4', 'e4', 'g4'],
      ['c3', 'e3', 'g3'],
      ['Gsus', 'G7', 'Em7', 'D7'],
      ['bd', 'sd', 'hh'],
    ]
    for (const lanes of cases) {
      console.log(`  chordLanes(${JSON.stringify(lanes)}) = ${chordLanes(lanes)}`)
    }
    // The chart case must still answer true — otherwise this probe is measuring
    // a broken import rather than a vocabulary overlap.
    expect(chordLanes(['Gsus', 'G7', 'Em7', 'D7'])).toBe(true)
    expect(chordLanes(['bd', 'sd', 'hh'])).toBe(false)
  })

  it('CAN THE PRODUCTION ROUTE REACH IT — a melodic head whose roll declines', () => {
    // `rollUnlessChordChart` fires only when the roll declines on `wrong-surface`.
    // So the question is whether any note-name melody does that. Probe the
    // shapes the corpus contains: a stray non-pitch token beside real pitches is
    // what made the roll say wrong-surface in the #1243 measurement.
    const probes = [
      'c4 e4 g4',
      'c5 f5 a5 f5',
      'c4 e4 p1 g4',
      'a3:0.7 c4 e4',
      'c4 e4 g4 p7',
      '<Gsus G7 Em7 D7>',
    ]
    for (const mini of probes) {
      const roll = parsePianoRoll(mini)
      const grid = parseStepGrid(mini)
      const routed = routeSurface('note', mini)
      const lanes = grid.ok ? grid.model.lanes.map((l) => l.sound) : []
      console.log(
        `\n  ${JSON.stringify(mini)}` +
          `\n     roll ok=${roll.ok} gate=${roll.ok ? '-' : ((roll as { gate?: string }).gate ?? '?')}` +
          `\n     grid ok=${grid.ok} lanes=${JSON.stringify(lanes)} chordLanes=${chordLanes(lanes)}` +
          `\n     routeSurface('note', …) = ${routed}`,
      )
    }
  })
})
