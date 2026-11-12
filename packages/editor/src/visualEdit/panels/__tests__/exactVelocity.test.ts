/**
 * Velocity per step over the corpus (#2468): every hit of every pattern the Exact grid opens.
 *
 * First drag: no `.gain` yet, so a new one mirrors the steps. Second drag, on the pattern's next
 * hit: the `.gain` the first drag wrote is now an existing string, edited in place. Every write
 * `stepGainEdit` accepts has already been played by Strudel (the hit at its new level, or the
 * answer is `gain-not-heard`); this also checks the hits the drag was NOT on keep their level,
 * except copies of the same written text.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stepGainEdit, type StepGainRefusal } from '../../../codeView/stepGain'
import { miniPattern, soundGainHits } from '../../../codeView/strudelMini/pattern'
import type { ChunkGain } from '../../../codeView/notation/model'
import { exactGridOf, playsNumbers } from '../exactGrid'

const corpus: { minis: { mini: string }[] } = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../../../app/tests/parity-corpus/mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]
const none: ChunkGain = { mini: null, numeric: null, foreign: false }
const str = (mini: string): ChunkGain => ({ mini, numeric: null, foreign: false })

/** each hit's level over the loop, and where in the gain string it was written */
function levels(mini: string, gain: string, bars: number): Map<string, { level: number; at: string }> {
  const out = new Map<string, { level: number; at: string }>()
  for (let c = 0; c < bars; c++) {
    for (const h of soundGainHits(mini, gain, c)) {
      out.set(`${h.begin.valueOf().toFixed(9)}|${JSON.stringify(h.sound)}`, { level: Number(h.gain), at: h.gainAt.map((l) => l.start).sort().join(',') })
    }
  }
  return out
}

/** where each level of the gain string starts playing, as `place@time`: one entry per playing of it */
function levelStarts(gain: string, bars: number): Set<string> {
  const out = new Set<string>()
  for (let c = 0; c < bars; c++) {
    for (const h of miniPattern(gain).hits(c)) for (const l of h.locations) out.add(`${l.start}@${h.begin.valueOf().toFixed(9)}`)
  }
  return out
}

/** hits per pattern asked: enough to reach every kind of step, few enough for a run of minutes */
const PER_PATTERN = 24

function sweep(edit = stepGainEdit, limit = Infinity) {
  const t = { patterns: 0, hits: 0, capped: 0, copies: 0, copiesWithNoPlace: 0, copySamples: [] as string[], first: { ok: 0, no: {} as Partial<Record<StepGainRefusal, number>> }, second: { asked: 0, ok: 0, no: {} as Partial<Record<StepGainRefusal, number>> }, othersMoved: [] as string[] }
  for (const mini of minis) {
    if (t.patterns >= limit) break
    const x = exactGridOf(mini)
    if (!x.ok || playsNumbers(x.trees)) continue
    t.patterns++
    const all = [...new Map(x.rows.flatMap((r) => r.hits).filter((h) => h.begin < x.bars).map((h) => [h.begin.toFixed(9), { begin: h.begin, end: h.end }])).values()].sort((a, b) => a.begin - b.begin)
    if (all.length > PER_PATTERN) t.capped++
    const hits = all.slice(0, PER_PATTERN)
    hits.forEach((hit, i) => {
      t.hits++
      const r = edit(mini, none, x.bars, hit, 0.5)
      if (!r.ok) {
        t.first.no[r.why] = (t.first.no[r.why] ?? 0) + 1
        return
      }
      t.first.ok++
      // the hits not dragged keep level 1, unless they take their level from the same written
      // text as the dragged hit (a copy: a repeated group plays one text in several places)
      const lv = levels(mini, r.gain, x.bars)
      const mine = [...lv].find(([k]) => Math.abs(Number(k.split('|')[0]) - hit.begin) < 1e-9)?.[1].at
      const moved = [...lv].filter(([k, v]) => v.level !== 1 && Math.abs(Number(k.split('|')[0]) - hit.begin) > 1e-9)
      const starts = levelStarts(r.gain, x.bars)
      for (const [k, v] of moved) {
        // a copy is ANOTHER PLAYING of the dragged level: the hit starts where that level starts
        // again. A hit starting inside the dragged level's own span is not a copy, it is covered.
        const isCopy = v.at === mine && v.at.split(',').some((p) => starts.has(`${p}@${k.split('|')[0]}`))
        if (!isCopy) t.othersMoved.push(`${JSON.stringify(mini)} @${hit.begin} moved ${k} → ${JSON.stringify(r.gain)}`)
        else {
          t.copies++
          if (v.at === '') t.copiesWithNoPlace++
          if (t.copySamples.length < 6) t.copySamples.push(`${JSON.stringify(mini)} @${hit.begin} also ${k} (at ${v.at}) → ${JSON.stringify(r.gain)}`)
        }
      }
      // the next hit, on the string the first drag wrote
      const next = hits[i + 1]
      if (!next) return
      t.second.asked++
      const s = edit(mini, str(r.gain), x.bars, next, 0.75)
      if (s.ok) t.second.ok++
      else t.second.no[s.why] = (t.second.no[s.why] ?? 0) + 1
    })
  }
  return t
}

/** measured 2026-11-08 on this corpus (the run prints them); a change here is a change in what a drag does */
const PINNED = {
  patterns: 1179,
  hits: 6905,
  capped: 74,
  first: { ok: 5684, no: { 'no-gain-for-this-pattern': 1038, 'gain-step-not-the-hit': 102, 'step-is-replicated': 22, 'step-is-generated': 59 } },
  second: { asked: 4684, ok: 4679, no: { 'gain-step-not-the-hit': 4, 'step-is-replicated': 1 } },
}

describe('velocity per step over the corpus (#2468)', () => {
  it('counts what a drag writes and why it refuses, and no drag moves a hit it is not on', () => {
    const t = sweep()
    process.stderr.write(`\nVELOCITY ${JSON.stringify({ ...t, copySamples: undefined }, null, 1)}\n`)
    expect(t.othersMoved.slice(0, 20)).toEqual([])
    expect(t.copiesWithNoPlace).toBe(0)
    expect({ patterns: t.patterns, hits: t.hits, capped: t.capped, first: t.first, second: t.second }).toEqual(PINNED)
  }, 1_800_000)

  it('can go red: a level written on the NEXT hit instead of the dragged one is seen', () => {
    const wrongHit: typeof stepGainEdit = (mini, gain, bars, hit, level) => {
      const x = exactGridOf(mini)
      const next = x.ok ? x.rows.flatMap((r) => r.hits).filter((h) => h.begin > hit.begin + 1e-9 && h.begin < bars).sort((a, b) => a.begin - b.begin)[0] : undefined
      return next ? stepGainEdit(mini, gain, bars, { begin: next.begin, end: next.end }, level) : stepGainEdit(mini, gain, bars, hit, level)
    }
    expect(sweep(wrongHit, 150).othersMoved.length).toBeGreaterThan(0)
  }, 900_000)
})
