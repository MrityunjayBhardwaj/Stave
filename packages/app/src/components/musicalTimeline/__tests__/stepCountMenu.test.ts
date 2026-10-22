/**
 * #1602 — the step-count chip's options, through the REAL parser, the real stepped
 * reader and the real editor functions. The analyses are hand-built:
 * the rest periods and the preview arithmetic are pinned against the engine in
 * `@stave/editor` (`stepCount.engine.test.ts`); this file owns what the menu does
 * with them — which counts, in what order, and what each label says.
 */
import { describe, it, expect } from 'vitest'
import type { LanePeriod, SongAnalysis } from '@stave/editor'
import { parseStrudel } from '@stave/editor'
import { steppedAutomations } from '@stave/editor'
import { stepCountEdit } from '@stave/editor'
import { previewRepeat, songPeriodOf } from '@stave/editor'
import { sectionLengthOf, stepCountOptions } from '../stepCountMenu'

const deps = { stepCountEdit, previewRepeat, songPeriodOf }
const read = (src: string) => steppedAutomations(parseStrudel(src) as never)
const song = (lanePeriods: LanePeriod[], repeatCycles: number | null): SongAnalysis => ({
  periodCycles: 4,
  horizonCycles: 8,
  displaySpan: { kind: 'loop', cycles: 4 },
  repeatCycles,
  lanePeriods,
  lanes: [],
  sections: [],
})
const optionsFor = (src: string, analysis: SongAnalysis | null, canConfirm = true) => {
  const automations = read(src)
  expect(automations, `no stepped parameter read from ${src}`).toHaveLength(1)
  const laneKey = automations[0].trackId
  return stepCountOptions({ automations, laneKey, analysis, laneCycles: 4, source: src, canConfirm, deps })[0].options
}
const labelOf = (options: ReturnType<typeof optionsFor>, n: number) => options.find((o) => o.steps === n)?.label

describe('stepCountOptions — a loop', () => {
  // Two steps of gain beside a 4-cycle track: the hat lane measures 2, and 1 without
  // the gain, so the song repeats at 4.
  const LOOP = '$: s("<bd sd cp hh>")\n$: s("hh*4").gain("<0.2 0.8>")'
  const lanes = (key: string): LanePeriod[] => [
    { laneKey: 'other', periodCycles: 4, restCycles: 4 },
    { laneKey: key, periodCycles: 2, restCycles: 1 },
  ]
  const loop = () => {
    const key = read(LOOP)[0].trackId
    return optionsFor(LOOP, song(lanes(key), 4))
  }

  it('offers the counts that fit the lane first, then the rest, and never the current count', () => {
    const options = loop()
    expect(options.map((o) => o.steps)).toEqual([1, 4, 8, 12, 16, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15])
    expect(options.map((o) => o.fits)).toEqual([...Array(5).fill(true), ...Array(10).fill(false)])
  })

  it('says what each count does: plays the same, the song\'s new length, or a cut', () => {
    const options = loop()
    expect(labelOf(options, 4)).toBe('4 steps · plays the same')
    expect(labelOf(options, 3)).toBe('3 steps · song repeats every 12 bars (was 4)')
    expect(labelOf(options, 5)).toBe('5 steps · song repeats every 20 bars (was 4)')
    // A cut to one step leaves the song at 4, so only the cut is named.
    expect(labelOf(options, 1)).toBe('1 step · removes written steps')
  })

  it('previews from the lane without the edited steps — a cut that shortens the song', () => {
    // Three steps beside 4 repeat at 12. Cut to two, the song repeats at 4; the lane's
    // own period (3) folded in again would still say 12.
    const THREE = '$: s("<bd sd cp hh>")\n$: s("hh*4").gain("<0.2 0.8 0.5>")'
    const key = read(THREE)[0].trackId
    const analysis = song([{ laneKey: 'other', periodCycles: 4, restCycles: 4 }, { laneKey: key, periodCycles: 3, restCycles: 1 }], 12)
    expect(labelOf(optionsFor(THREE, analysis), 2)).toBe('2 steps · song repeats every 4 bars (was 12) · removes written steps')
  })

  it('says the length is unknown with no analysis, and disables a cut it cannot ask about', () => {
    expect(labelOf(optionsFor(LOOP, null), 3)).toBe('3 steps · song length unknown')
    const key = read(LOOP)[0].trackId
    const options = optionsFor(LOOP, song(lanes(key), 4), false)
    expect(options.filter((o) => o.disabled).map((o) => o.steps)).toEqual([1])
    expect(optionsFor(LOOP, song(lanes(key), 4), true).filter((o) => o.disabled)).toEqual([])
  })
})

describe('stepCountOptions — an arrangement section', () => {
  const SECTIONED = 'const a = s("bd*2").gain("<0.2 0.8>")\n$: arrange([4, a], [4, s("hh")])'

  it('measures counts against the section, and names a count that plays it differently each pass', () => {
    expect(sectionLengthOf(read(SECTIONED)[0])).toBe(4)
    const options = optionsFor(SECTIONED, song([], 8))
    expect(options.map((o) => o.steps).slice(0, 5)).toEqual([1, 4, 8, 12, 16])
    expect(labelOf(options, 3)).toBe('3 steps · this section plays differently each pass')
    expect(labelOf(options, 4)).toBe('4 steps · plays the same')
    // The arrangement's length does not move, so no label talks about the song's.
    expect(options.filter((o) => o.label.includes('song'))).toEqual([])
  })

  it('has no section length for a parameter under none', () => {
    expect(sectionLengthOf(read('$: s("hh*4").gain("<0.2 0.8>")')[0])).toBeNull()
  })
})
