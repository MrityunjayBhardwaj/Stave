/**
 * The chord chart drawn on a rhythm line (#2120).
 *
 * A track written `chord(vamp).voicing().struct("x ~ x x …")` plays its chords on the
 * rhythm's hits. With the cursor in the rhythm line, the Pattern tab draws both: a strip
 * naming the chord in each bar, and a row per chord lit on the hits it plays. A click
 * toggles that step of the rhythm line, through the step-grid writer.
 *
 * WHAT IS ASKED OF STRUDEL, AND WHAT IS NOT. Which steps are hits, and which chord each
 * hit plays, is `mini(chords).struct(mini(rhythm))` (`structHits`); which chord is
 * sounding over a column is the chords' own pieces (`miniPieces`). Nothing here decides
 * either. The only arithmetic is placing those times on the grid's columns, and a hit
 * that lands between two columns refuses the chart rather than being rounded onto one.
 *
 * WHAT A CLICK WRITES. The rhythm line, through its own step-grid model: chart column
 * `c` is the line's column `c mod steps`, because a rhythm repeats over its own bars. The
 * chart is editable only when that model and Strudel agree on every column a chord
 * sounds over. Where they disagree (`"1 0 1 1"`: the grid reads `0` as a hit, Strudel
 * as a rest) the chart is still drawn from Strudel and says it is look only.
 *
 * The strings drawn are the ones written. A call on the chords before `.struct` that
 * moves time (`.fast(2)`) is not applied, as on every other grid in the tab.
 *
 * This module is pure.
 */
import { miniPieces, structHits } from '../strudelMini/pattern'
import type { ParseResult, StepGridModel } from './model'
import { isCellOn } from './model'
import { PROJECTION_PERIOD_BOUNDS } from './parse'
import { lcmOf } from './perBar'

/** the most bars the chart draws: the step grid's own limit */
export const RHYTHM_CHART_MAX_BARS = PROJECTION_PERIOD_BOUNDS.leaf.grid

export interface RhythmChart {
  bars: number
  /** columns in one bar: the rhythm line's own */
  colsPerBar: number
  /** the chords in the order they first sound, one row each */
  rows: string[]
  /** the strip: each chord and the columns it sounds over, `end` exclusive */
  strip: Array<{ value: string; start: number; end: number }>
  /** per column, the chords sounding at its start */
  sounding: string[][]
  /** per column, the chords hit there */
  hits: string[][]
  /** the rhythm line's column a chart column is written through */
  rhythmCol: (col: number) => number
  /** null when a click can write the line; otherwise why not, in the user's words */
  lookOnly: string | null
}

export type RhythmChartResult =
  | { ok: true; chart: RhythmChart }
  /** no chart: `reason` says why when it is worth saying, null when the plain grid is the answer */
  | { ok: false; reason: string | null }

const NONE: RhythmChartResult = { ok: false, reason: null }

/** a value as the chart names it */
const nameOf = (v: unknown): string => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))

/** within a float's reach of a whole number */
const whole = (x: number): number | null => {
  const r = Math.round(x)
  return Math.abs(x - r) < 1e-9 ? r : null
}

/**
 * The chart for the rhythm `rhythm` (read as `model`) timing the chords `chords`, or
 * why there is none. `parse` reads the chords' own length in bars, with the same parser
 * that opens the chord chart today.
 */
export function rhythmChart(
  chords: string | null,
  rhythm: string,
  model: StepGridModel | null,
  parse: (mini: string) => ParseResult<StepGridModel>,
): RhythmChartResult {
  if (chords === null || model === null) return NONE
  // a rhythm whose bars have different column counts has no one column width to share
  if (model.barSteps) return NONE
  const rhythmBars = model.bars ?? 1
  const colsPerBar = model.steps / rhythmBars
  if (!Number.isInteger(colsPerBar) || colsPerBar < 1) return NONE
  const chordsRead = parse(chords)
  if (!chordsRead.ok) return NONE
  const chordBars = chordsRead.model.bars ?? 1
  const bars = lcmOf([rhythmBars, chordBars])
  if (bars > RHYTHM_CHART_MAX_BARS) {
    return {
      ok: false,
      reason:
        `The chords repeat every ${chordBars} bar${chordBars === 1 ? '' : 's'} and the rhythm every ${rhythmBars}, ` +
        `so together they come round after ${bars} bars, more than the ${RHYTHM_CHART_MAX_BARS} this grid draws.`,
    }
  }

  const cols = bars * colsPerBar
  const sounding: string[][] = Array.from({ length: cols }, () => [])
  const hits: string[][] = Array.from({ length: cols }, () => [])
  try {
    for (let b = 0; b < bars; b++) {
      for (const p of miniPieces(chords, b)) {
        const value = nameOf(p.value)
        const from = (p.begin.valueOf() - b) * colsPerBar
        const to = (p.end.valueOf() - b) * colsPerBar
        // every column whose start the piece covers
        for (let c = Math.ceil(from - 1e-9); c < to - 1e-9; c++) {
          const at = b * colsPerBar + c
          if (!sounding[at].includes(value)) sounding[at].push(value)
        }
      }
      for (const h of structHits(chords, rhythm, b)) {
        const c = whole((h.begin.valueOf() - b) * colsPerBar)
        if (c === null) {
          return { ok: false, reason: 'This rhythm plays between the grid’s steps, so the chords can’t be drawn on it.' }
        }
        hits[b * colsPerBar + c].push(nameOf(h.value))
      }
    }
  } catch {
    return NONE
  }

  const rows: string[] = []
  const strip: RhythmChart['strip'] = []
  for (let c = 0; c < cols; c++) {
    for (const v of sounding[c]) if (!rows.includes(v)) rows.push(v)
    const label = sounding[c].join(' · ')
    const last = strip[strip.length - 1]
    // a new strip block where the chord changes, and at every chord onset in a bar line
    if (last && last.value === label && c % colsPerBar !== 0) last.end = c + 1
    else if (label !== '') strip.push({ value: label, start: c, end: c + 1 })
  }
  for (const h of hits) for (const v of h) if (!rows.includes(v)) rows.push(v)

  const rhythmCol = (col: number): number => col % model.steps
  // the line's model and Strudel must agree wherever a chord sounds, or a click on what
  // is drawn would write a different step from the one it shows
  const disagrees = sounding.some((s, c) => {
    if (s.length === 0) return false
    const on = model.lanes.some((l) => isCellOn(l.cells[rhythmCol(c)]))
    return on !== hits[c].length > 0
  })
  const lookOnly = model.lookOnly
    ? model.lookOnly.reason
    : disagrees
      ? 'this rhythm’s steps are written in a way the grid reads differently from how they play'
      : null
  return { ok: true, chart: { bars, colsPerBar, rows, strip, sounding, hits, rhythmCol, lookOnly } }
}
