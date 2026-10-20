import { describe, it, expect } from 'vitest'
import { mini } from '@strudel/mini/mini.mjs'
import { detectChunk } from '../../chunkDetect'
import { parseStepGrid } from '../parse'
import { serializeStepGrid } from '../serialize'
import { toggleCell } from '../place'
import { isCellOn, type StepGridModel } from '../model'
import { rhythmChart, RHYTHM_CHART_MAX_BARS, type RhythmChart } from '../rhythmChart'

/**
 * #2120 — the chords drawn on the rhythm line under the cursor.
 *
 * The hits are Strudel's, so the oracle here is Strudel too, asked directly and for two
 * whole periods: what the chart draws in one period has to be what plays in both.
 */

const LINE = '~ x x ~ x ~ x x ~ x ~ x x ~ x ~'
const SONG = `const roll = (n, seed) => irand(n).early(seed * 13.7).segment(1).slow(64)
const vamp = "<Em9 A13>"
const clav = chord(vamp).voicing()
  .struct(roll(3, 3).pick([
    "x ~ x x ~ x ~ x x ~ x ~ ~ x ~ x",
    "${LINE}",
  ]))
  .s("gm_clavinet").clip(0.25).lpf(3000).gain(0.4).mask("<1 1 0 1>")
$: clav`

const parse = (m: string) => parseStepGrid(m)
function model(m: string): StepGridModel {
  const r = parseStepGrid(m)
  if (r.ok) return r.model
  if (r.lookOnly) return r.lookOnly
  throw new Error(`grid declined ${m}: ${r.reason}`)
}
function chart(chords: string | null, rhythm: string, m: StepGridModel | null = model(rhythm)): RhythmChart {
  const r = rhythmChart(chords, rhythm, m, parse)
  if (!r.ok) throw new Error(`no chart: ${r.reason}`)
  return r.chart
}

/** Strudel's own hits, as `column → chord`, over `cycles` cycles */
function strudelHits(chords: string, rhythm: string, cycles: number, colsPerBar: number): Map<number, string> {
  const out = new Map<number, string>()
  const pat = (mini(chords) as any).struct(mini(rhythm))
  for (const h of pat.queryArc(0, cycles)) {
    if (!h.hasOnset()) continue
    out.set(Math.round(h.whole.begin.valueOf() * colsPerBar), String(h.value))
  }
  return out
}

describe('rhythmChart — the chords on a rhythm line (#2120)', () => {
  it('draws the song’s line under the cursor: a strip, a row per chord, Strudel’s hits for two periods', () => {
    const c = detectChunk(SONG, SONG.indexOf(LINE) + 3)!
    const ch = chart(c.structOver!.miniString, c.miniString!)
    expect({ bars: ch.bars, colsPerBar: ch.colsPerBar, rows: ch.rows, lookOnly: ch.lookOnly }).toEqual({
      bars: 2,
      colsPerBar: 16,
      rows: ['Em9', 'A13'],
      lookOnly: null,
    })
    expect(ch.strip).toEqual([
      { value: 'Em9', start: 0, end: 16 },
      { value: 'A13', start: 16, end: 32 },
    ])
    const cols = ch.bars * ch.colsPerBar
    const played = strudelHits('<Em9 A13>', LINE, 2 * ch.bars, ch.colsPerBar)
    for (let col = 0; col < 2 * cols; col++) {
      expect(ch.hits[col % cols], `column ${col}`).toEqual(played.has(col) ? [played.get(col)] : [])
    }
    // and the hits are the line's x's, in each chord's bar
    expect(ch.hits.slice(0, 16).map((h) => (h.length ? 'x' : '~')).join(' ')).toBe(LINE)
    expect(ch.hits.slice(16).every((h) => h.every((v) => v === 'A13'))).toBe(true)
  })

  it('a click in bar 2 writes the line’s own step: the rhythm repeats every bar', () => {
    const ch = chart('<Em9 A13>', LINE)
    expect(ch.rhythmCol(16)).toBe(0)
    const m = model(LINE)
    expect(serializeStepGrid(toggleCell(m, 0, ch.rhythmCol(16), true))).toBe(LINE.replace(/^~/, 'x'))
  })

  it('reads hits the way Strudel does: every step of "t f t t" plays', () => {
    const ch = chart('<Em9 A13>', 't f t t')
    expect(ch.lookOnly).toBeNull()
    expect(ch.hits.map((h) => h.join())).toEqual(['Em9', 'Em9', 'Em9', 'Em9', 'A13', 'A13', 'A13', 'A13'])
    // removing the `f` turns that step into a rest, through the lane it is on
    const m = model('t f t t')
    const lane = m.lanes.findIndex((l) => isCellOn(l.cells[1]))
    expect(m.lanes[lane].sound).toBe('f')
    expect(serializeStepGrid(toggleCell(m, lane, 1, false))).toBe('t ~ t t')
  })

  it('a rhythm the grid can only look at is drawn from Strudel and says so', () => {
    const ch = chart('<Em9 A13>', 'x*1.5 ~')
    expect(ch.lookOnly).toMatch(/none can be changed on its own/)
    expect(ch.hits.filter((h) => h.length).length).toBe(strudelHits('<Em9 A13>', 'x*1.5 ~', 2, ch.colsPerBar).size)
  })

  it('is look only when the line’s grid and what plays disagree', () => {
    // a model that reads a hit on every step, against a rhythm that rests on two
    const ch = chart('<Em9 A13>', 'x ~ x ~', model('x x x x'))
    expect(ch.lookOnly).toMatch(/reads differently/)
    const agrees = chart('<Em9 A13>', 'x ~ x ~', model('x ~ x ~'))
    expect(agrees.lookOnly).toBeNull()
  })

  it('leaves the chords’ rests empty: no strip block, nothing sounding, no hits', () => {
    const ch = chart('<Em9 ~>', 'x x')
    expect(ch.strip).toEqual([{ value: 'Em9', start: 0, end: 2 }])
    expect(ch.sounding.slice(2)).toEqual([[], []])
    expect(ch.hits.slice(2)).toEqual([[], []])
    // and a rest partway through a bar: the step there sounds nothing, so is no one's
    const half = chart('<[Em9 ~] A13>', 'x x')
    expect(half.strip).toEqual([
      { value: 'Em9', start: 0, end: 1 },
      { value: 'A13', start: 2, end: 4 },
    ])
    expect(half.sounding).toEqual([['Em9'], [], ['A13'], ['A13']])
    expect(half.hits).toEqual([['Em9'], [], ['A13'], ['A13']])
  })

  it(`refuses, saying why, when the two come round together past ${RHYTHM_CHART_MAX_BARS} bars`, () => {
    const r = rhythmChart('<Em9 A13 Dm7 G7 Cmaj7>', '<[x ~] [~ x] [x x]>', model('<[x ~] [~ x] [x x]>'), parse)
    expect(r).toEqual({
      ok: false,
      reason:
        'The chords repeat every 5 bars and the rhythm every 3, so together they come round after 15 bars, more than the 12 this grid draws.',
    })
  })

  it('has no chart, and no reason, with no chords or no grid to write through', () => {
    expect(rhythmChart(null, 'x ~', model('x ~'), parse)).toEqual({ ok: false, reason: null })
    expect(rhythmChart('<Em9 A13>', '1 0 1 1', null, parse)).toEqual({ ok: false, reason: null })
  })
})
