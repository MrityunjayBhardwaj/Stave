/**
 * _1163-ask-space.spec.ts — PROBE (inert). IS THE ROLL'S PLACEMENT PROBE ASKING ABOUT THE
 * SURFACE THE PANEL ACTUALLY DRAWS?
 *
 * `viewPlacesNotes` answers one question for the roll — "is every placement on this surface
 * refused?" — and the panel greys every empty cell when the answer is no. So the answer is
 * only as good as the ask-space it sweeps, and #1163 is the claim that the ask-space is not
 * the surface. Four ways it can differ, and this probe measures each one SEPARATELY before
 * measuring them together, because a combined figure cannot say which axis carries it:
 *
 *   ROWS   the panel draws midi ints across `rollContentRange` (content ±2, floored at an
 *          octave, and then only grown by the sticky range). The probe walks the model's
 *          own pitch STRINGS plus one row at `min − 1`.
 *   COLS   the panel draws `columnCount(model)` columns (#1087). The probe walks
 *          `model.steps`, which is the pattern's LENGTH and need not be a whole number.
 *   HELD   the panel treats a cell as held when a note OVERLAPS it (#1074) — a click there
 *          is a delete or a drag. The probe skips only cells where a note STARTS, so it
 *          asks the writer about cells the user cannot place into.
 *   SPELL  the panel spells every row with `tokenForRow`. The probe spells its content rows
 *          with the raw `n.pitch` it read, and only the extra row with `tokenForRow`'s rule.
 *
 * ROWS and SPELL are not separable — asking about a midi row forces the panel's spelling —
 * so they move together here and are reported as one axis.
 *
 * ⚠ NOTHING BELOW IS ASSERTED. This is an observation, and per this project's own rule an
 * observation probe must never be wired into a gate: it would be a green arm that cannot
 * fail. The arm for whatever this finds belongs in `placement-admissibility.test.ts`.
 *
 * ⚠ IT IMPORTS `rollContentRange` RATHER THAN RE-IMPLEMENTING IT. That is the whole point
 * of #1163 — a fifth copy of the padding rule measured against the other four would be the
 * defect, not the measurement.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import {
  columnCount,
  columnOverlap,
  rollContentRange,
} from '../../../editor/src/codeView/notation/model'
import { midiToPitch, pitchToMidi } from '../../../editor/src/codeView/notation/pitch'
import { canPlaceNote, viewPlacesNotes } from '../../../editor/src/codeView/notation/place'
import type { PianoRollModel } from '../../../editor/src/codeView/notation/model'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'))
const minis: string[] = [
  ...new Set((corpus.minis as { mini: string }[]).map((o) => o.mini.trim()).filter((m) => m !== '')),
]

type Path = 'leaf' | 'alt' | 'element'
const pathOf = (m: { leafSource?: unknown; altSource?: unknown }): Path =>
  m.leafSource ? 'leaf' : m.altSource ? 'alt' : 'element'

/** the panel's own row spelling — `tokenForRow` in `PianoRollGrid.tsx` */
const tokenForRow = (numeric: boolean, midi: number): string =>
  numeric ? String(midi) : midiToPitch(midi)

interface Axes {
  /** rows come from `rollContentRange` (and therefore carry the panel's spelling) */
  rows: boolean
  /**
   * the MINIMAL row change: keep the one-extra-row probe, but take that row from
   * `rollContentRange` — the lowest row the panel draws — instead of the hand-picked
   * `min − 1`. Same cost, no assumption. Ignored when `rows` is on.
   */
  rowFromRange?: boolean
  /** columns come from `columnCount`, not `model.steps` */
  cols: boolean
  /** a cell is held when a note OVERLAPS it, not only when one starts there */
  held: boolean
}

/**
 * `viewPlacesNotes`'s roll branch, re-stated so each axis can be switched on alone.
 *
 * ⚠ WITH EVERY AXIS OFF THIS IS THE **PRE-#1163** FUNCTION, not the shipped one — the
 * fix landed `rowFromRange`, so that variant is what ships now. The distinction matters
 * because the control below would read 0 either way: the answers are invariant across
 * all four axes, which is the finding, so an equality against the wrong version stays
 * green and quietly stops meaning anything. The control is therefore stated against the
 * variant that IS shipped, and the axes-off column is kept as the historical baseline
 * these deltas are measured from.
 */
function placesNotes(model: PianoRollModel, ax: Axes): { answer: boolean; asks: number } {
  let asked = 0
  let accepted = false
  const cols = ax.cols ? columnCount(model) : model.steps

  const cells: { token: string; midi: number | null }[] = []
  if (ax.rows) {
    const { lo, hi } = rollContentRange(model)
    for (let midi = lo; midi <= hi; midi++)
      cells.push({ token: tokenForRow(!!model.numeric, midi), midi })
  } else {
    const pitches = new Set(model.notes.map((n) => n.pitch))
    const midis = [...pitches].map(pitchToMidi).filter((m): m is number => m !== null)
    if (midis.length > 0) {
      const below = ax.rowFromRange ? rollContentRange(model).lo : Math.min(...midis) - 1
      pitches.add(tokenForRow(!!model.numeric, below))
    }
    for (const token of pitches) cells.push({ token, midi: pitchToMidi(token) })
  }

  for (const { token, midi } of cells)
    for (let step = 0; step < cols; step++) {
      const held = ax.held
        ? model.notes.some(
            (n) =>
              midi !== null &&
              pitchToMidi(n.pitch) === midi &&
              columnOverlap(n.start, n.start + n.duration, step) !== null,
          )
        : model.notes.some((n) => n.pitch === token && n.start === step)
      if (held) continue
      asked++
      if (!accepted && canPlaceNote(model, token, step, 1)) accepted = true
    }
  return { answer: accepted || asked === 0, asks: asked }
}

const OFF: Axes = { rows: false, cols: false, held: false }

describe('#1163 — the roll probe ask-space vs the panel surface', () => {
  it('measures each divergence axis alone, then all three together', () => {
    const models: { mini: string; m: PianoRollModel; p: Path }[] = []
    for (const mini of minis) {
      let r
      try {
        r = parsePianoRoll(mini)
      } catch {
        continue
      }
      if (!r.ok) continue
      models.push({ mini, m: r.model, p: pathOf(r.model) })
    }

    // CONTROL: the re-statement of the SHIPPED gesture (`rowFromRange`, post-#1163) must
    // equal the real function on every unit. If it does not, nothing below is about the
    // product. Reported alongside the pre-fix variant so a drift in either is visible —
    // they agree today, and saying so is the point, not an omission.
    let restatementDisagrees = 0
    let preFixDisagrees = 0
    const drift: string[] = []
    for (const { mini, m } of models) {
      const real = viewPlacesNotes(m)
      if (placesNotes(m, { ...OFF, rowFromRange: true }).answer !== real) {
        restatementDisagrees++
        if (drift.length < 5) drift.push(JSON.stringify(mini))
      }
      if (placesNotes(m, OFF).answer !== real) preFixDisagrees++
    }

    const variants: [string, Axes][] = [
      ['rowFromRange (the minimal fix)', { ...OFF, rowFromRange: true }],
      ['rows (+spelling)', { ...OFF, rows: true }],
      ['cols', { ...OFF, cols: true }],
      ['held', { ...OFF, held: true }],
      ['ALL THREE', { rows: true, cols: true, held: true }],
    ]

    const lines: string[] = []
    lines.push(`roll units parsed: ${models.length}`)
    lines.push(
      `  by path: ` +
        (['leaf', 'alt', 'element'] as Path[])
          .map((p) => `${p} ${models.filter((x) => x.p === p).length}`)
          .join(' / '),
    )
    lines.push(
      `RESTATEMENT CONTROL — units where the shipped restatement (rowFromRange) ≠ the real ` +
        `function: ${restatementDisagrees}; where the PRE-FIX restatement ≠ it: ${preFixDisagrees}`,
    )
    if (drift.length) lines.push(`  drifted on: ${drift.join(', ')}`)

    const base = models.map(({ m }) => placesNotes(m, OFF))
    lines.push(`baseline asks (axes off): ${base.reduce((a, b) => a + b.asks, 0)}`)
    lines.push(
      `baseline "places nothing": ${base.filter((b) => !b.answer).length} of ${models.length}`,
    )

    for (const [name, ax] of variants) {
      let flippedToNo = 0
      let flippedToYes = 0
      let asks = 0
      const examples: string[] = []
      models.forEach(({ mini, m, p }, i) => {
        const got = placesNotes(m, ax)
        asks += got.asks
        if (got.answer === base[i].answer) return
        if (got.answer) flippedToYes++
        else flippedToNo++
        if (examples.length < 6)
          examples.push(`${p} ${JSON.stringify(mini)} ${base[i].answer} → ${got.answer}`)
      })
      lines.push('')
      lines.push(`AXIS ${name}: asks ${asks} (baseline ${base.reduce((a, b) => a + b.asks, 0)})`)
      lines.push(`  answer flipped: →places ${flippedToYes} / →places-nothing ${flippedToNo}`)
      for (const e of examples) lines.push(`    ${e}`)
    }

    // COST, on the same terms `place.ts` already states it in: per view, over the corpus,
    // and split by path — because the view that pays the whole scan is the one that
    // refuses everything, and on the roll that is a leaf view.
    const timed = (ax: Axes, only?: Path): number[] => {
      const out: number[] = []
      for (const { m, p } of models) {
        if (only && p !== only) continue
        const t = performance.now()
        placesNotes(m, ax)
        out.push(performance.now() - t)
      }
      return out.sort((a, b) => a - b)
    }
    const q = (xs: number[], p: number): string => xs[Math.floor(xs.length * p)].toFixed(3)
    const ALL: Axes = { rows: true, cols: true, held: true }
    lines.push('')
    for (const [name, ax] of [
      ['shipped', OFF],
      ['ALL THREE', ALL],
    ] as [string, Axes][]) {
      const all = timed(ax)
      const leaf = timed(ax, 'leaf')
      lines.push(
        `COST ${name}: all p50 ${q(all, 0.5)}ms / p99 ${q(all, 0.99)}ms / worst ${all[all.length - 1].toFixed(3)}ms` +
          ` — leaf only p50 ${q(leaf, 0.5)}ms / p99 ${q(leaf, 0.99)}ms / worst ${leaf[leaf.length - 1].toFixed(3)}ms`,
      )
    }

    // WHY THE `columnCount` AXIS IS ANSWER-NEUTRAL — asked rather than concluded from the
    // break that stayed green. If the note-tail term never binds on this corpus, then
    // `columnCount === model.steps` everywhere and the axis is defensive here, not
    // curative; that is a fact about the corpus, not about the guard ([[PV283]]).
    const tailBinds = models.filter(
      ({ m }) => columnCount(m) !== columnCount({ steps: m.steps, notes: [] }),
    ).length
    const colsDiffer = models.filter(({ m }) => columnCount(m) !== m.steps).length
    lines.push('')
    lines.push(
      `columnCount: note-tail term binds on ${tailBinds} of ${models.length} rolls; ` +
        `columnCount ≠ steps on ${colsDiffer}`,
    )

    console.log(lines.join('\n'))
  })
})
