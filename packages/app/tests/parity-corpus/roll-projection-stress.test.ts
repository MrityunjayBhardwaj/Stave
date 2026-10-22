/**
 * #924 — the every-edit stress gate for the piano-roll behaviour projection, over
 * the real-world corpus. The projection opens melodies the syntactic model refuses
 * by showing what they PLAY; this gate proves the write-back survives real edits on
 * the axis the grid doesn't have and the 71→44 writer-reach gap loses on: DURATION.
 *
 * Unlike the alternation-element gate — which checks only note COUNT — every arm
 * here asserts the full (onset, pitch, duration) multiset round-trips, because a
 * held `@n` can be lost while the count stays the same (the P298 class). Locality is
 * asked of krill (an independent oracle), not of our own regions.
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { parsePianoRoll, parsePianoRollCore } from '../../../editor/src/codeView/notation/parse'
import { serializePianoRoll } from '../../../editor/src/codeView/notation/serialize'
import type { PianoRollModel } from '../../../editor/src/codeView/notation/model'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'))
const krill = require(
  path.resolve(here, '../../../../node_modules/.pnpm/@strudel+mini@1.2.6/node_modules/@strudel/mini/krill-parser.js'),
)
const minis: string[] = corpus.minis.map((o: { mini: string }) => o.mini)

function topSpans(mini: string): [number, number][] {
  try {
    const ast: { arguments_?: { alignment?: string }; source_?: { location_?: { start: { offset: number }; end: { offset: number } } }[] } =
      krill.parse('"' + mini + '"')
    if (ast.arguments_?.alignment !== 'fastcat') return []
    return (ast.source_ ?? [])
      .map((el): [number, number] | null =>
        el.location_ ? [el.location_.start.offset - 1, el.location_.end.offset - 1] : null,
      )
      .filter((s): s is [number, number] => s !== null)
  } catch {
    return []
  }
}

function changedSpan(a: string, b: string): [number, number] | null {
  if (a === b) return null
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  return [p, a.length - s]
}
const touches = (spans: [number, number][], ch: [number, number]) =>
  spans.filter(([a, b]) => ch[0] < b && ch[1] > a).length

// The invariant is HAP-equivalence — what the engine plays — not the column grid:
// `[~ 1@2]` and `[~ ~ 1@4]` encode the same music at different resolutions, so a
// column-integer compare false-flags a faithful re-spelling. Ask the real engine.
const HRES = 720720
const hapSig = (rows: { pos: number; dur: number; pitch: string }[]): string =>
  JSON.stringify(rows.map((r) => [Math.round(r.pos * HRES), Math.round(r.dur * HRES), r.pitch]).sort())

/** what a mini PLAYS in cycle 0 — onset, duration, pitch — via the real engine */
function playedHaps(src: string): string | null {
  let haps: Array<{
    hasOnset?: () => boolean
    whole?: { begin: { valueOf(): number }; end: { valueOf(): number } }
    value: unknown
  }>
  try {
    haps = (reifyMini(src) as { queryArc(a: number, b: number): typeof haps }).queryArc(0, 1)
  } catch {
    return null
  }
  const rows: { pos: number; dur: number; pitch: string }[] = []
  for (const h of haps) {
    if (!(h.hasOnset?.() ?? false) || !h.whole) continue
    const v = h.value
    const pitch = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.toLowerCase() : null
    if (pitch === null) return null
    rows.push({ pos: h.whole.begin.valueOf(), dur: h.whole.end.valueOf() - h.whole.begin.valueOf(), pitch })
  }
  return hapSig(rows)
}

/** the haps an edited model INTENDS to play, from its own note columns */
const modelHaps = (m: PianoRollModel): string =>
  hapSig(
    m.notes.map((n) => ({
      pos: n.start / m.steps,
      dur: n.duration / m.steps,
      pitch: m.numeric ? n.pitch : n.pitch.toLowerCase(),
    })),
  )

/**
 * The single-cycle roll models the flat PROJECTION owns. A pattern the core already
 * parses is the core writer's surface (tested elsewhere) — this gate is only the
 * projection, so skip anything the core accepts, and the alt/bars paths.
 */
function flatRoll(mini: string) {
  if (parsePianoRollCore(mini).ok) return null // core's, not the projection's
  const r = parsePianoRoll(mini)
  if (!r.ok || r.model.altSource || r.model.bars || !r.model.source) return null
  return r.model
}

describe('#924 — piano-roll projection writeback holds under every edit', () => {
  it('pitch-drag every note — onset+pitch+duration all survive, ≤1 element touched', () => {
    let edits = 0
    const bad: string[] = []
    for (const mini of minis) {
      const model = flatRoll(mini)
      if (!model) continue
      const spans = topSpans(mini.trim())
      const marker = model.numeric ? '11' : 'g9'
      for (let i = 0; i < model.notes.length; i++) {
        if (model.notes[i].pitch === marker) continue
        const edited = { ...model, notes: model.notes.map((n, j) => (j === i ? { ...n, pitch: marker } : n)) }
        const out = serializePianoRoll(edited)
        edits++
        if (out === null) continue // declined = safe no-op
        if (playedHaps(out) !== modelHaps(edited)) {
          if (bad.length < 8) bad.push(`LOSS ${JSON.stringify(mini.trim())} #${i} -> ${JSON.stringify(out)}`)
          continue
        }
        const ch = changedSpan(mini.trim(), out)
        if (ch && spans.length && touches(spans, ch) > 1 && bad.length < 8) {
          bad.push(`LOCAL ${JSON.stringify(mini.trim())} #${i} -> ${JSON.stringify(out)}`)
        }
      }
    }
    expect(edits, 'the sweep must exercise projected roll edits').toBeGreaterThan(50)
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('delete every note — surviving notes keep onset+pitch+duration, ≤1 element touched', () => {
    let edits = 0
    const bad: string[] = []
    for (const mini of minis) {
      const model = flatRoll(mini)
      if (!model) continue
      const spans = topSpans(mini.trim())
      for (let i = 0; i < model.notes.length; i++) {
        const edited = { ...model, notes: model.notes.filter((_, j) => j !== i) }
        const out = serializePianoRoll(edited)
        edits++
        if (out === null) continue
        if (playedHaps(out) !== modelHaps(edited)) {
          if (bad.length < 8) bad.push(`LOSS ${JSON.stringify(mini.trim())} #${i} -> ${JSON.stringify(out)}`)
          continue
        }
        const ch = changedSpan(mini.trim(), out)
        if (ch && spans.length && touches(spans, ch) > 1 && bad.length < 8) {
          bad.push(`LOCAL ${JSON.stringify(mini.trim())} #${i} -> ${JSON.stringify(out)}`)
        }
      }
    }
    expect(edits, 'the sweep must exercise projected roll deletes').toBeGreaterThan(50)
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('resize every note into free space — the new duration round-trips (the 71→44 axis)', () => {
    let edits = 0
    const bad: string[] = []
    for (const mini of minis) {
      const model = flatRoll(mini)
      if (!model) continue
      for (let i = 0; i < model.notes.length; i++) {
        const n = model.notes[i]
        const to = n.start + n.duration // the column just past the note
        // only extend into genuinely free space — no note covers `to`, and it fits
        if (to >= model.steps) continue
        if (model.notes.some((m) => m.start <= to && to < m.start + m.duration)) continue
        const edited = { ...model, notes: model.notes.map((m, j) => (j === i ? { ...m, duration: m.duration + 1 } : m)) }
        const out = serializePianoRoll(edited)
        edits++
        if (out === null) continue // declined = safe no-op
        if (playedHaps(out) !== modelHaps(edited)) {
          if (bad.length < 8) bad.push(`DUR ${JSON.stringify(mini.trim())} #${i} -> ${JSON.stringify(out)}`)
        }
      }
    }
    expect(edits, 'the sweep must exercise projected roll resizes').toBeGreaterThan(20)
    expect(bad, bad.join('\n')).toEqual([])
  })
})
