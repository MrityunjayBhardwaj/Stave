/**
 * #1617 reach probe — across the archive, how many songs report a length that does not
 * contain a whole repeat of what the engine plays?
 *
 * Population: every archive document (558, deduped by sha256 of the code) whose IR carries
 * a REPEATING signal (`signalDimensionsOf(ir).periods` non-empty). Nothing else can be
 * affected: the defect is a swept track never getting a period of its own.
 *
 * Per candidate:
 *  APP     the song length `measureSongLength` would report (`songLength.ts:208`): the
 *          whole-song repeat when there is one, else the display span when it is a loop,
 *          else unknown — from the PRODUCTION `analyzeSong` over the per-track patterns
 *          (`evalSongTracks`), with `signals` and `hasUnheardTrack` as the app passes them.
 *  ENGINE  the smallest p ≤ 128 at which every one of 256 cycles equals the cycle p ahead,
 *          keys built from trackId, onset offset, s, gain and every param, numbers rounded
 *          to 1e-6 so float noise cannot fake a difference.
 * AFFECTED: APP is a number, ENGINE is a number, and APP is not a whole multiple of ENGINE —
 * a bounce of the reported length stops partway through what the song plays.
 *
 * Run: ./node_modules/.bin/vitest run --config vitest.probe.config.ts src/ir/__tests__/_1617-reach.test.ts
 */
import { describe, it, expect } from 'vitest'
import type { IREvent } from '../IREvent'
import { analyzeSong, signalDimensionsOf } from '../songAnalysis'
import { parseStrudel } from '../parseStrudel'
import { normalizeStrudelHap } from '../../engine/NormalizedHap'
import { evalSongTracks, hasCorpusArchive, loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'

/* eslint-disable @typescript-eslint/no-explicit-any */
const WINDOW = 256
const r6 = (x: unknown) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x)

function collectorFor(tracks: readonly { trackId: string; pattern: any }[]) {
  return (start: number, end: number): IREvent[] => {
    const out: IREvent[] = []
    for (const t of tracks) {
      for (const hap of t.pattern.queryArc(start, end)) {
        if (!(hap.hasOnset?.() ?? true)) continue
        const ev = normalizeStrudelHap(hap, t.trackId)
        if (Math.floor(ev.begin) >= start && Math.floor(ev.begin) < end) out.push(ev)
      }
    }
    return out
  }
}

function engineRepeat(collect: (a: number, b: number) => IREvent[]): number | null {
  const keys: string[] = []
  for (let c = 0; c < WINDOW; c++) {
    keys.push(collect(c, c + 1).map((e) => {
      const params = Object.fromEntries(Object.entries((e as any).params ?? {}).sort().map(([k, v]) => [k, r6(v)]))
      return JSON.stringify([e.trackId, Math.round((e.begin - c) * 1e6), e.s, r6(e.gain), r6((e as any).note), params])
    }).sort().join('|'))
  }
  if (keys.every((k) => k === '')) return null
  for (let p = 1; p <= WINDOW / 2; p++) {
    let ok = true
    for (let c = 0; c + p < WINDOW; c++) if (keys[c] !== keys[c + p]) { ok = false; break }
    if (ok) return p
  }
  return null
}

describe('#1617 reach probe', () => {
  it.skipIf(!hasCorpusArchive())('archive', async () => {
    const corpus = await loadEveryCorpusDocument()
    let parsedFail = 0
    let evalFail = 0
    let analyzeFail = 0
    const rows: { name: string; app: number | null; engine: number | null; repeat: number | null; span: string }[] = []
    let candidates = 0
    for (const { name, code } of corpus) {
      let signals
      try {
        signals = signalDimensionsOf(parseStrudel(code) as never)
      } catch {
        parsedFail++
        continue
      }
      if (signals.periods.length === 0) continue
      candidates++
      const r = await evalSongTracks(code)
      if (!r.ok || r.tracks.length === 0) { evalFail++; continue }
      const collect = collectorFor(r.tracks)
      const declared = r.tracks.map((t) => t.trackId)
      const heard = new Set<string>()
      const hasUnheardTrack = () => declared.some((id) => !heard.has(id))
      try {
        const a = await analyzeSong(null, {
          yieldFn: async () => {},
          collectFn: (s, e) => {
            const evs = collect(s, e)
            for (const ev of evs) if (ev.trackId !== undefined) heard.add(ev.trackId)
            return evs
          },
          hasUnheardTrack,
          signals,
        })
        const app = a.displaySpan.kind === 'loop' ? (a.repeatCycles ?? a.displaySpan.cycles) : null
        rows.push({ name, app, engine: engineRepeat(collect), repeat: a.repeatCycles, span: `${a.displaySpan.kind}:${a.displaySpan.cycles}` })
      } catch {
        analyzeFail++
      }
    }
    const affected = rows.filter((x) => x.app !== null && x.engine !== null && x.app % x.engine !== 0)
    const agree = rows.filter((x) => x.app !== null && x.engine !== null && x.app % x.engine === 0)
    const appUnknown = rows.filter((x) => x.app === null)
    const engineNone = rows.filter((x) => x.engine === null)
    console.log('R documents', corpus.length, 'parseFail', parsedFail, 'candidates (a repeating signal)', candidates, 'evalFail', evalFail, 'analyzeFail', analyzeFail, 'measured', rows.length)
    console.log('R affected (app length not a whole multiple of engine repeat)', affected.length, JSON.stringify(affected.slice(0, 12)))
    console.log('R agree', agree.length, '| app unknown', appUnknown.length, '| engine no repeat within 256', engineNone.length)
    console.log('R repeatNull-but-engine-repeats', rows.filter((x) => x.repeat === null && x.engine !== null).length)
    expect(corpus.length).toBe(558)
  }, 3_600_000)
})
