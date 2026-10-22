/**
 * THE ROLL'S RESIZE, ASKED WHETHER THE DOCUMENT REOPENS AS WHAT IT WROTE (#1331).
 *
 * `roll-isolation.test.ts` already asks three questions of every resize — did an unnamed
 * note change, did the bytes spell, do the bytes parse. This defect passes all three. The
 * model still holds the sibling voice; the loss happens in serialize → parse, and the
 * bytes parse perfectly. They just come back one note short.
 *
 * So the property here is the fourth question, and it is the one the document actually
 * poses: reopened, does it hold the same notes? Measured at the lengths an ordinary drag
 * asks for (`d±1`), 1,099 of 10,960 asks fail it — stretching one member of a comma-stack
 * re-spells the group as `[g3@4 ~ ~]` and the sibling is gone.
 *
 * ⚠ THE DEFAULT WRITER IS UNCHANGED AND THAT IS ASSERTED, not assumed. `readback` is
 * opt-in because it parses and resize runs per pointermove (#1324 measured p99 549ms when
 * this ran on the hot path). The panel turns it on once, at gesture commit. The control
 * arm below pins the default path's lossy count so a change to the cheap rule cannot hide
 * behind the strict one.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import {
  resizeNote,
  placeNote,
  pasteNote,
  moveNote,
  removeNote,
} from '../../../editor/src/codeView/notation/place'
import { serializePianoRoll } from '../../../editor/src/codeView/notation/serialize'
import { columnOverlap } from '../../../editor/src/codeView/notation/model'
import { pitchToMidi, midiToPitch } from '../../../editor/src/codeView/notation/pitch'
import type { PianoRollModel, RollNote } from '../../../editor/src/codeView/notation/model'

const dir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(dir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

/** measured 2026-08-26 over the corpus, resizing every note by one column either way */
// ⚠ units 595 -> 596 at #1827 (each bar drawn at its own step count): `<[36 48]*2 [34 46]*3 [41 53]*4 [39 51]*2>` now opens. Its
// 18 lengthenings that would overlap the next note are lossy under the cheap rule and
// refused by the strict one (1099 -> 1117 both); no other unit's answer moved.
// ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
// ⚠ 599 -> 601 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
const UNITS = 601
// ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
// ⚠ 11028 -> 11070 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
const ASKS = 11070
/** what the CHEAP rule ships today: writes whose reopen holds different notes (#1331) */
// ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
// ⚠ 1146 -> 1120 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
const LOSSY_UNDER_DEFAULT = 1120
/** of those, the ones the writer cannot express faithfully at all — it declines */
// ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
// ⚠ 1146 -> 1120 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
const READBACK_REFUSALS = 1120
/**
 * of those, the ones a DIFFERENT rung rescues — measured at ZERO, and the zero is the
 * finding.
 *
 * ⚠ A PROBE THAT IGNORED THE WRITER'S OTHER CONSTRAINTS PUT THIS AT 54, and that number
 * was an upper bound rather than a prediction: faithful rungs DO exist for 54 of these
 * asks, and every one of them is skipped by `degradesLocality` before readback is ever
 * consulted. So the ladder rescues nothing here and the readback rule is a pure GATE.
 *
 * Recovering them is a real option and deliberately NOT taken: it means preferring a
 * write that re-authors the whole pattern over one that edits the note's own bytes, to
 * save 0.5% of asks from refusing. That trade belongs to the locality arc (#1327), not to
 * this fix, and pinning the zero is what will make it visible if the guard ever moves.
 */
const READBACK_SAVES = 0

/**
 * Does this model survive the round trip? Deliberately a SECOND, independent statement of
 * the rule the writer now applies — if the writer's own helper were reused here the arm
 * could only ever agree with it, and a regression in that helper would go unseen.
 * ⚠ Multiset, not set: a comma-stack holds the same pitch twice at one start (#1321).
 */
const readsBack = (m: PianoRollModel): boolean => {
  const out = serializePianoRoll(m)
  if (out === null) return false
  const back = parsePianoRoll(out)
  if (!back.ok) return false
  if (back.model.steps !== m.steps) return false
  const key = (n: { pitch: string; start: number; duration: number }): string =>
    `${n.pitch}@${n.start}+${n.duration}`
  const meant = m.notes.map(key).sort()
  const got = back.model.notes.map(key).sort()
  return meant.length === got.length && meant.every((s, i) => s === got[i])
}

interface Sweep {
  units: number
  asks: number
  lossyDefault: number
  lossyStrict: number
  refusals: number
  saves: number
  example: string | null
}

function sweep(): Sweep {
  let units = 0
  let asks = 0
  let lossyDefault = 0
  let lossyStrict = 0
  let refusals = 0
  let saves = 0
  let example: string | null = null
  for (const mini of minis) {
    const r = parsePianoRoll(mini)
    if (!r.ok) continue
    const m = r.model
    if (serializePianoRoll(m) !== mini) continue
    if (m.notes.length === 0) continue
    units++
    const baseBytes = serializePianoRoll(m)
    for (const n of m.notes) {
      for (const duration of [n.duration + 1, Math.max(1, n.duration - 1)]) {
        asks++
        const loose = resizeNote(m, n.start, n.pitch, duration)
        const strict = resizeNote(m, n.start, n.pitch, duration, { readback: true })

        // what ships today
        const looseLossy = loose !== m && !readsBack(loose)
        if (looseLossy) {
          lossyDefault++
          if (example === null)
            example = `${mini} — resize ${n.pitch}@${n.start} (d=${n.duration}) to ${duration} wrote ${serializePianoRoll(loose)}`
        }

        // what the strict rule does with the same ask
        if (strict !== m && !readsBack(strict)) lossyStrict++
        if (looseLossy) {
          if (strict === m || serializePianoRoll(strict) === baseBytes) refusals++
          else saves++
        }
      }
    }
  }
  return { units, asks, lossyDefault, lossyStrict, refusals, saves, example }
}

describe('the roll reopens as what it wrote (#1331)', () => {
  const s = sweep()

  it('the sweep actually ran — denominators before verdicts', () => {
    expect(s.units, 'roll units that round-trip and hold a note').toBe(UNITS)
    expect(s.asks, 'resizes posed, one column either way').toBe(ASKS)
  })

  it('⚠ THE INVARIANT: under readback, no resize writes a document that reopens changed', () => {
    expect(
      s.lossyStrict,
      'resizes accepted under readback whose bytes do not reopen intact — must be 0',
    ).toBe(0)
  })

  it('the CONTROL: the cheap rule still ships the defect, so the two rules are distinguishable', () => {
    // Not an endorsement — a control. If this ever reads 0 the strict arm above proves
    // nothing, because both rules would agree everywhere and the invariant would be
    // vacuous. It is the positive half of the pair.
    expect(
      s.lossyDefault,
      `writes whose reopen differs, under the per-frame rule — ${s.example}`,
    ).toBe(LOSSY_UNDER_DEFAULT)
  })

  it('the split between refusing and rescuing is pinned, so a silent shift shows up', () => {
    // Named separately rather than summed: a change that turns saves into refusals is a
    // real regression in the ladder and an aggregate would absorb it.
    expect(s.refusals, 'lossy asks the writer cannot express faithfully — it declines').toBe(
      READBACK_REFUSALS,
    )
    expect(
      s.saves,
      'lossy asks a different rung rescues — 0 today, because every faithful rung degrades locality',
    ).toBe(READBACK_SAVES)
    expect(s.refusals + s.saves).toBe(s.lossyDefault)
  })
})

/* ── placement and paste take the same rule (#1333) ──────────────────────────────────
 *
 * Swept after resize, because all five roll writers pass through `ifRollSpellable` and
 * only resize had ever been asked the harder question. Place turned out to be the worse
 * offender AND the more visible one: the note it loses is usually the one the click just
 * created, after re-spelling the pattern around it for nothing.
 *
 * ⚠ THIS PARAGRAPH USED TO SAY MOVE AND DELETE WERE CLEAN AT 0 AND IT WAS WRONG (#1340).
 * It read: "0 lost notes across 21,307 and 5,480 asks respectively. Gating them would buy
 * nothing and cost a parse per gesture." Both writers do lose notes, and the reason the
 * claim survived is that it was a COMMENT — nothing asserted it, so nothing could fail,
 * and the instrument behind it was not kept, so it was never re-checked. Every POSITIVE
 * figure this arc produced is pinned (1,861 · 1,099 · 4,376 · 87) because those fired.
 * The one negative carrying a closure argument was not.
 *
 * Both are now gated at the cadence their gesture allows and the numbers are ASSERTED
 * below, the zeros included, so the negative stays checkable instead of decaying back
 * into a sentence.
 */

/**
 * measured 2026-08-26; placements over the cells the panel's resolver would offer.
 *
 * ⚠ THESE COUNT EVERY WRITE THAT DOES NOT REOPEN INTACT, grid rescales included, exactly
 * as the resize pin above does (1,099 = 58 + 1,037 + 4). #1333's table splits the three
 * causes out — place 1,071 that do not parse + 3,291 that lose notes + 14 rescales — so
 * the issue's 4,362 and this 4,376 are the same measurement reported at different cuts.
 * Stated because the difference is exactly the rescales and would otherwise read as drift.
 */
// ⚠ 35601 -> 35675 and lossy 4376 -> 4306 at #1827 (each bar drawn at its own step count): the arrival's own cells, and
// `<c2*2 g2*5 [a g]>` / `<0 [0 1] 0 [0 1 0]>` drawn per bar — no half-cells left to
// place a note the document cannot keep, so 70 fewer lossy placements.
// ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
// ⚠ 35699 -> 35769 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
const PLACE_ASKS = 35769
const PLACE_LOSSY_UNDER_DEFAULT = 4306
/** pastes over a cell that already holds a note — the case placement does not cover */
// ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
// ⚠ 5514 -> 5535 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
const PASTE_ASKS = 5535
/** 3 that do not parse + 83 that lose notes + 1 rescale */
// ⚠ 87 -> 88 at #1849: one more paste the REJECTED cheap rule would ship lossy — the control arm, so it only has to stay above zero; the shipped rule refuses it.
// ⚠ 88 -> 85 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
const PASTE_LOSSY_UNDER_DEFAULT = 85

/** verbatim from PianoRollGrid.tsx — the resolver the panel gates placement on */
function overlapAt(model: PianoRollModel, midi: number, step: number): RollNote | undefined {
  for (const n of model.notes) {
    if (pitchToMidi(n.pitch) !== midi) continue
    if (columnOverlap(n.start, n.start + n.duration, step)) return n
  }
  return undefined
}
const tokenForRow = (numeric: boolean, midi: number): string =>
  numeric ? String(midi) : midiToPitch(midi)

interface OpSweep {
  placeAsks: number
  placeLoose: number
  placeStrict: number
  pasteAsks: number
  pasteLoose: number
  pasteStrict: number
  placeExample: string | null
}

function sweepPlaceAndPaste(): OpSweep {
  const o: OpSweep = {
    placeAsks: 0, placeLoose: 0, placeStrict: 0,
    pasteAsks: 0, pasteLoose: 0, pasteStrict: 0, placeExample: null,
  }
  for (const mini of minis) {
    const r = parsePianoRoll(mini)
    if (!r.ok) continue
    const m = r.model
    if (serializePianoRoll(m) !== mini) continue
    if (m.notes.length === 0) continue
    const numeric = !!m.numeric
    const clip = m.notes[0].duration

    for (const n of m.notes) {
      o.pasteAsks++
      const loose = pasteNote(m, n.pitch, n.start, clip)
      if (loose !== m && !readsBack(loose)) o.pasteLoose++
      const strict = pasteNote(m, n.pitch, n.start, clip, { readback: true })
      if (strict !== m && !readsBack(strict)) o.pasteStrict++
    }

    const rows = [...new Set(m.notes.map((n) => pitchToMidi(n.pitch)))].filter(
      (x): x is number => x !== null,
    )
    for (const midi of rows)
      for (let step = 0; step < m.steps; step++) {
        if (overlapAt(m, midi, step)) continue
        o.placeAsks++
        const token = tokenForRow(numeric, midi)
        const loose = placeNote(m, token, step, 1)
        if (loose !== m && !readsBack(loose)) {
          o.placeLoose++
          if (o.placeExample === null)
            o.placeExample = `${mini} — click ${token}@${step} wrote ${serializePianoRoll(loose)}`
        }
        const strict = placeNote(m, token, step, 1, { readback: true })
        if (strict !== m && !readsBack(strict)) o.placeStrict++
      }
  }
  return o
}

describe('placement and paste reopen as what they wrote (#1333)', () => {
  const o = sweepPlaceAndPaste()

  it('the sweep actually ran — denominators before verdicts', () => {
    expect(o.placeAsks, 'placements the resolver would offer').toBe(PLACE_ASKS)
    expect(o.pasteAsks, 'pastes over an existing note').toBe(PASTE_ASKS)
  })

  it('⚠ THE INVARIANT: no PLACEMENT is accepted that the document reopens changed', () => {
    expect(o.placeStrict, 'placements accepted under readback that do not reopen intact').toBe(0)
  })

  it('⚠ THE INVARIANT: no PASTE is accepted that the document reopens changed', () => {
    // Split from placement for the same reason the controls are: paste COMPOSES
    // `placeNote`, so a break in the shared acceptance point fails placement first and
    // this assertion would never execute — leaving paste looking checked when it was not.
    expect(o.pasteStrict, 'pastes accepted under readback that do not reopen intact').toBe(0)
  })

  // ⚠ ONE CONTROL PER `it`, deliberately. These were written as two assertions in one
  // block and the first failed, so the second NEVER RAN — and the run still reported the
  // other blocks as passed, which reads as "paste was checked". A pin that never executed
  // is not a pin.
  it('the CONTROL: the cheap rule still ships the PLACE defect, so the rules differ', () => {
    expect(
      o.placeLoose,
      `placements whose reopen differs, under the spellable-only rule — ${o.placeExample}`,
    ).toBe(PLACE_LOSSY_UNDER_DEFAULT)
  })

  it('the CONTROL: the cheap rule still ships the PASTE defect, so the rules differ', () => {
    expect(o.pasteLoose, 'pastes whose reopen differs, under the spellable-only rule').toBe(
      PASTE_LOSSY_UNDER_DEFAULT,
    )
  })
})


/* ── move and delete take the same rule (#1340) ───────────────────────────────────────
 *
 * Swept last, and only because the sentence certifying them could not fail. Delete's
 * denominator here reproduces the retracted comment's exactly (5,480); its numerator does
 * not. Move's differs because this population is built from the gestures the PANEL can
 * make — `tokenForRow`'s vocabulary and the overlap resolver — and the original
 * instrument no longer exists to reconcile against. A first pass that enumerated pitches
 * directly reported 4,398 move losses, nearly all of them drops the panel cannot offer.
 */

/** measured 2026-08-26 on `33c6c166`, one delete per note */
// ⚠ 5480 -> 5502 at #1827 (each bar drawn at its own step count): the arrival's 22 notes.
// ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
// ⚠ 5514 -> 5535 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
const DELETE_ASKS = 5535
/** what the CHEAP rule ships: deletes whose reopen holds different notes */
const DELETE_LOSSY_UNDER_DEFAULT = 5
/** measured 2026-08-26, each note dragged one column either way and one semitone either way */
// ⚠ 20587 -> 20671 at #1827 (each bar drawn at its own step count): the arrival's moves.
// ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
// ⚠ 20704 -> 20784 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
const MOVE_ASKS = 20784
/** what the CHEAP rule ships: moves whose reopen holds different notes */
const MOVE_LOSSY_UNDER_DEFAULT = 14

interface PlainSweep {
  units: number
  asks: number
  lossyDefault: number
  lossyStrict: number
  refusals: number
  saves: number
}

function sweepDelete(): PlainSweep {
  let units = 0, asks = 0, lossyDefault = 0, lossyStrict = 0, refusals = 0, saves = 0
  for (const mini of minis) {
    const r = parsePianoRoll(mini)
    if (!r.ok) continue
    const m = r.model
    if (serializePianoRoll(m) !== mini) continue
    if (m.notes.length === 0) continue
    units++
    for (const n of m.notes) {
      asks++
      const loose = removeNote(m, n.start, n.pitch)
      const strict = removeNote(m, n.start, n.pitch, { readback: true })
      const looseLossy = loose !== m && !readsBack(loose)
      if (looseLossy) lossyDefault++
      if (strict !== m && !readsBack(strict)) lossyStrict++
      if (looseLossy) {
        if (strict === m) refusals++
        else saves++
      }
    }
  }
  return { units, asks, lossyDefault, lossyStrict, refusals, saves }
}

function sweepMove(): PlainSweep {
  let units = 0, asks = 0, lossyDefault = 0, lossyStrict = 0, refusals = 0, saves = 0
  for (const mini of minis) {
    const r = parsePianoRoll(mini)
    if (!r.ok) continue
    const m = r.model
    if (serializePianoRoll(m) !== mini) continue
    if (m.notes.length === 0) continue
    units++
    for (const n of m.notes) {
      const midi = pitchToMidi(n.pitch)
      const targets: [string, number][] = []
      for (const ds of [-1, 1]) {
        const st = n.start + ds
        if (st >= 0 && st < m.steps) targets.push([n.pitch, st])
      }
      if (midi != null) {
        for (const dp of [-1, 1]) targets.push([tokenForRow(!!m.numeric, midi + dp), n.start])
      }
      for (const [tp, ts] of targets) {
        asks++
        const loose = moveNote(m, n.pitch, n.start, tp, ts)
        const strict = moveNote(m, n.pitch, n.start, tp, ts, { readback: true })
        const looseLossy = loose !== m && !readsBack(loose)
        if (looseLossy) lossyDefault++
        if (strict !== m && !readsBack(strict)) lossyStrict++
        if (looseLossy) {
          if (strict === m) refusals++
          else saves++
        }
      }
    }
  }
  return { units, asks, lossyDefault, lossyStrict, refusals, saves }
}

describe('delete and move reopen as what they wrote (#1340)', () => {
  const d = sweepDelete()
  const mv = sweepMove()

  it('the delete sweep actually ran — denominators before verdicts', () => {
    expect(d.asks, 'deletes asked').toBe(DELETE_ASKS)
  })

  it('the move sweep actually ran — denominators before verdicts', () => {
    expect(mv.asks, 'moves asked').toBe(MOVE_ASKS)
  })

  it('⚠ THE INVARIANT: no DELETE is accepted that the document reopens changed', () => {
    expect(d.lossyStrict, 'deletes accepted under readback that do not reopen intact').toBe(0)
  })

  it('⚠ THE INVARIANT: no MOVE is accepted that the document reopens changed', () => {
    expect(mv.lossyStrict, 'moves accepted under readback that do not reopen intact').toBe(0)
  })

  it('the CONTROL: the cheap rule still ships the DELETE defect, so the rules differ', () => {
    expect(d.lossyDefault, 'deletes the spelling rule accepts and the document loses').toBe(
      DELETE_LOSSY_UNDER_DEFAULT,
    )
  })

  it('the CONTROL: the cheap rule still ships the MOVE defect, so the rules differ', () => {
    expect(mv.lossyDefault, 'moves the spelling rule accepts and the document loses').toBe(
      MOVE_LOSSY_UNDER_DEFAULT,
    )
  })

  it('delete is a pure GATE — no rung rescues a refused delete', () => {
    expect(d.saves, 'deletes rescued by a different spelling').toBe(0)
  })

  it('move is a pure GATE — no rung rescues a refused move', () => {
    expect(mv.saves, 'moves rescued by a different spelling').toBe(0)
  })
})
