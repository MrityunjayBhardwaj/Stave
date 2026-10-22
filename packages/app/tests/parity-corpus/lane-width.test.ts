/**
 * lane-width.test.ts — what the writer emits must SOUND like the model it was given,
 * including where the model does not sit on whole columns (#1092).
 *
 * THE RULE. `@n` is a relative weight, so a roll's length and a note's position inside it
 * are not always whole numbers of columns. Every place the writer said "leave `w` columns
 * of silence" said it as a run of bare `~`, and a bare `~` is exactly one column. A gap of
 * 1.5 therefore came back as 2, which lengthens the lane; Strudel scales each comma-lane
 * to its own total, so the lanes stop sharing a grid and notes the gesture never touched
 * move. Dragging `c4` in `note("c4@1.5 e4@1.2")` moved `e4` from `[0.5556, 1.0000)` to
 * `[0.6250, 1.0000)`.
 *
 * WHY IT IS COMPARED THROUGH THE ENGINE and not by re-reading the output ([[P301]]): every
 * wrong output this gate exists to catch re-parses perfectly well, and several of them
 * re-parse to lanes with EQUAL sums — `c4@1.5 e4@1.5` came back as two lanes of 3.5 where
 * the pattern is 3. A gate asserting the lanes agree with each other reads green over that.
 * The comparison is against plain arithmetic on the model (`start / steps`), which never
 * goes through the writer.
 *
 * THE POPULATION, stated rather than implied ([[P345]]). The comparison "the whole output
 * sounds like the whole model" is only sound where the model IS the whole mini — a flat
 * top-level token sequence. Nested and multi-bar minis are excluded because there the
 * writer returns a document region whose columns are not `model.steps` wide; they are
 * covered by `round-trip` and `edit-locality`, not here. Of 544 corpus rolls, 94 are flat.
 *
 * AND THE GATE MUST BE ABLE TO FIRE ([[P353]]). ZERO of the 544 corpus rolls carry a
 * fractional note position, so the corpus arm alone is green before this change and after
 * it — it is a REGRESSION FLOOR, not evidence. The evidence is the fixture arm, which runs
 * the same comparison over hand-written input the defect was found on and which fails on
 * every one of them without the fix. Both are reported; neither is allowed to stand for
 * the other.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import { serializePianoRoll } from '../../../editor/src/codeView/notation/serialize'
import type { PianoRollModel } from '../../../editor/src/codeView/notation/model'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

const EPS = 1e-6
const fractional = (x: number): boolean => Math.abs(x - Math.round(x)) > 1e-9

/** a flat top-level token sequence — the shape whose whole mini IS the model */
const FLAT =
  /^[A-Ga-g][#bs]?-?\d?(@[\d.]+)?(\s+([A-Ga-g][#bs]?-?\d?(@[\d.]+)?|~(@[\d.]+)?))*$/

type Sound = { token: string; begin: number; end: number }

function sounded(src: string): Sound[] | null {
  let pat: unknown
  try {
    pat = reifyMini(src)
  } catch {
    return null
  }
  let haps: Array<{
    hasOnset?: () => boolean
    whole?: { begin: { valueOf(): number }; end: { valueOf(): number } }
    value: unknown
  }>
  try {
    haps = (pat as { queryArc(a: number, b: number): typeof haps }).queryArc(0, 1)
  } catch {
    return null
  }
  return haps
    .filter((h) => (h.hasOnset?.() ?? false) && h.whole)
    .map((h) => {
      const v = h.value
      return {
        token: typeof v === 'string' ? v : Array.isArray(v) ? v.join(':') : String(v),
        begin: h.whole!.begin.valueOf(),
        end: h.whole!.end.valueOf(),
      }
    })
}

/** the model's own claim, as plain arithmetic — this side never touches the writer */
const claimed = (m: PianoRollModel): Sound[] =>
  m.notes.map((n) => ({
    token: n.pitch,
    begin: n.start / m.steps,
    end: (n.start + n.duration) / m.steps,
  }))

/**
 * The reader lower-cases a note name (`C` reaches the model as `c`) while the engine hands
 * back the token as written, so the pitch is compared case-insensitively. This gate is
 * about WHEN a note sounds, not how it is spelled; the spelling is `round-trip`'s subject.
 */
const samePitch = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** does `out` sound exactly what `m` says? */
function soundsLike(m: PianoRollModel, out: string): boolean {
  const got = sounded(out)
  if (got === null) return false
  const want = claimed(m)
  if (got.length !== want.length) return false
  const pool = [...got]
  for (const w of want) {
    const i = pool.findIndex(
      (g) =>
        samePitch(g.token, w.token) &&
        Math.abs(g.begin - w.begin) < EPS &&
        Math.abs(g.end - w.end) < EPS,
    )
    if (i < 0) return false
    pool.splice(i, 1)
  }
  return true
}

/**
 * Every gesture the panel can build on one model: move each note to each column, place a
 * new one in each column, resize each note to each length. Returns the models to write.
 */
function gestures(m: PianoRollModel): Array<{ label: string; model: PianoRollModel }> {
  const out: Array<{ label: string; model: PianoRollModel }> = []
  const cols = Math.max(1, Math.floor(m.steps + 1e-9))
  const base = { ...m, leafSource: undefined } as PianoRollModel
  for (const n of m.notes) {
    for (let t = 0; t < cols; t++) {
      const dur = Math.max(1, Math.min(n.duration, m.steps - t))
      out.push({
        label: `move ${n.pitch} ${n.start}->${t}`,
        model: {
          ...base,
          notes: [...m.notes.filter((x) => x !== n), { ...n, start: t, duration: dur }],
        },
      })
    }
    for (let d = 1; d <= cols; d++) {
      out.push({
        label: `resize ${n.pitch} ->${d}`,
        model: {
          ...base,
          notes: m.notes.map((x) => (x === n ? { ...x, duration: d } : x)),
        },
      })
    }
  }
  for (let t = 0; t < cols; t++) {
    out.push({
      label: `place a5@${t}`,
      model: {
        ...base,
        notes: [
          ...m.notes.map((x) =>
            x.start < t && x.start + x.duration > t ? { ...x, duration: t - x.start } : x,
          ),
          { pitch: 'a5', start: t, duration: 1 },
        ],
      },
    })
  }
  // a pure VELOCITY edit — no start and no duration changes at all. It belongs in this
  // list because it reaches the same re-emit, which is what made the defect wider than
  // "moving a note": a gain drag alone retimed the pattern.
  out.push({
    label: 'gain',
    model: { ...base, notes: m.notes.map((n, i) => ({ ...n, gain: i === 0 ? 0.5 : 1 })) },
  })
  return out
}

describe('the roll writer emits what the model says, on whole columns and off them (#1092)', () => {
  /**
   * The fixture arm — the one that can FIRE. Every model here is hand-written and every
   * one of them was corrupted before the fix; the last two are whole-column controls that
   * were correct before it and must stay byte-identical.
   */
  it('FIXTURES — every gesture on a fractionally-placed pattern sounds like its model', () => {
    const FIXTURES = [
      'c4@1.5 e4@1.2', // fractional LENGTH — the issue's own reproduction (2.7 columns)
      'c4@1.5 e4@1.5', // WHOLE length, fractional start: the case the issue's scope missed
      'c4@1.5 e4@1.5 g4', // a fractional gap in the middle of the lane
      'c4@1.5 ~@0.5 e4', // a rest of fractional width
      'c4 ~@0.5 e4', // the same, with whole-column notes either side
      'c4 e4 g4', // CONTROL — nothing fractional anywhere
      'c4@2 ~ e4', // CONTROL — a held note and a whole rest
    ]
    const bad: string[] = []
    let checked = 0
    let declined = 0
    for (const src of FIXTURES) {
      const r = parsePianoRoll(src)
      expect(r.ok, `fixture must parse: ${src}`).toBe(true)
      if (!r.ok) continue
      for (const { label, model } of gestures(r.model)) {
        const out = serializePianoRoll(model)
        if (out === null) {
          declined++
          continue
        }
        checked++
        if (!soundsLike(model, out)) bad.push(`${src} | ${label} => ${out}`)
      }
    }
    for (const b of bad.slice(0, 10)) console.log(`  MISTIMED ${b}`)
    expect(bad).toEqual([])
    // pinned so a fixture silently ceasing to exercise the writer is a failure, not a
    // quieter green ([[P356]] — a figure with no gate rots)
    console.log(`  FIXTURES checked=${checked} declined=${declined}`)
    expect(checked).toBe(107)
    expect(declined).toBe(19)
  })

  /**
   * The corpus arm — a regression FLOOR over real material, reported with the figure that
   * makes its own green honest: nothing in the corpus reaches the defect.
   */
  it('CORPUS — every gesture on every flat roll sounds like its model', () => {
    const flat = minis
      .map((mini) => ({ mini, r: parsePianoRoll(mini) }))
      .filter((x) => x.r.ok && FLAT.test(x.mini) && (x.r.model.bars ?? 1) === 1)
      .map((x) => ({ mini: x.mini, model: (x.r as { model: PianoRollModel }).model }))

    let rolls = 0
    let fractionalRolls = 0
    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      rolls++
      if (
        fractional(r.model.steps) ||
        r.model.notes.some((n) => fractional(n.start) || fractional(n.duration))
      ) {
        fractionalRolls++
      }
    }

    const bad: string[] = []
    let checked = 0
    for (const { mini, model } of flat) {
      if (model.notes.length > 10 || model.steps > 24) continue
      for (const { label, model: g } of gestures(model)) {
        const out = serializePianoRoll(g)
        if (out === null) continue
        checked++
        if (!soundsLike(g, out)) bad.push(`${mini} | ${label} => ${out}`)
      }
    }
    for (const b of bad.slice(0, 10)) console.log(`  MISTIMED ${b}`)
    expect(bad).toEqual([])

    // THE FIGURES THAT MAKE THE GREEN READABLE. The population is 544 rolls, of which 94
    // are flat; the reason this arm cannot fire is the third number, and it is stated so
    // that a corpus refresh which introduces fractional material re-opens the question
    // rather than passing quietly.
    // ⚠ 544 -> 596 at #1242 — the corpus widened 1535 -> 1633 units
    // (98 arrivals, 0 departures): the harvest gained the product's own
    // resolver, so every figure here is over a wider population. Upward only.
    // ⚠ 596 -> 597 at #1310 — the one roll unit the widened writer lets the parser open.
    // `flat.length` and `fractionalRolls` below are unmoved: the arrival is neither flat
    // nor fractional, so the reason this arm cannot fire is exactly what it was.
    // ⚠ 597 -> 598 at #1827 (each bar drawn at its own step count): `<[36 48]*2 [34 46]*3 [41 53]*4 [39 51]*2>` now opens.
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    // ⚠ 601 -> 603 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
    expect(rolls).toBe(603)
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
    expect(flat.length).toBe(98)
    expect(fractionalRolls).toBe(4) // and NONE of the 4 is flat — see the next arm
    expect(checked).toBeGreaterThan(2000)
  })

  it('and the corpus reaches the fixture case through no flat roll of its own', () => {
    const flatAndFractional = minis.filter((mini) => {
      const r = parsePianoRoll(mini)
      if (!r.ok || !FLAT.test(mini)) return false
      return (
        fractional(r.model.steps) ||
        r.model.notes.some((n) => fractional(n.start) || fractional(n.duration))
      )
    })
    expect(flatAndFractional).toEqual([])
  })
})
