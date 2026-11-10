/**
 * The roll's playing cell is the note Strudel plays, over the corpus (#2295).
 *
 * The roll still draws on its own columns in both grid modes (its tree rebuild is #2533), and
 * its playing cell, playhead and Snap read those columns, never the grid mode. So the question
 * stage 5 asked of the roll is whether those columns tell the truth about time: at every onset
 * Strudel plays, is the cell `cycleToStep` lights the cell of a note that starts there?
 *
 * Measured 2026-11-10: 603 melodies, 5,560 onsets, 0 missed. Shifting the lit cell by one
 * column misses all 5,560, so the check can fail.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parsePianoRoll } from '../../../codeView'
import { columnCount } from '../../../codeView/notation/model'
import { miniPattern } from '../../../codeView/strudelMini/pattern'
import { cycleToStep, stepToCycle } from '../usePlayingStep'

const corpus: { minis: { mini: string }[] } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../../app/tests/parity-corpus/mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

/** every editable roll's onsets, and those whose lit cell is not a note starting there */
function sweep(shift = 0): { melodies: number; onsets: number; missed: string[] } {
  const t = { melodies: 0, onsets: 0, missed: [] as string[] }
  for (const mini of minis) {
    const r = parsePianoRoll(mini)
    if (!r.ok || r.model.lookOnly) continue
    const m = r.model
    t.melodies++
    const bars = m.bars ?? 1
    const cols = columnCount(m)
    const p = miniPattern(mini)
    for (let c = 0; c < bars; c++) {
      for (const h of p.hits(c)) {
        const begin = h.begin.valueOf()
        // a hit that began in the cycle before is counted there
        if (begin < c - 1e-9) continue
        t.onsets++
        const lit = (cycleToStep(begin + 1e-9, m.steps, bars, cols, m.barSteps) ?? -1) + shift
        const here = m.notes.filter((n) => Math.abs(stepToCycle(n.start, m.steps, bars, m.barSteps) - begin) < 1e-6)
        if (!here.some((n) => Math.floor(n.start + 1e-9) === lit)) t.missed.push(`${JSON.stringify(mini)} at ${begin.toFixed(4)}: cell ${lit}`)
      }
    }
  }
  return t
}

describe('the roll lights the note that plays (#2295)', () => {
  it('every onset Strudel plays, on every editable roll in the corpus', () => {
    const t = sweep()
    expect(t.missed.slice(0, 5)).toEqual([])
    // PINNED: a change here is a change in what the roll opens, and is read before it is moved
    expect({ melodies: t.melodies, onsets: t.onsets }).toEqual({ melodies: 603, onsets: 5560 })
  }, 120_000)

  it('can go red: one column off misses every onset', () => {
    const t = sweep(1)
    expect(t.missed.length).toBe(t.onsets)
  }, 120_000)
})
