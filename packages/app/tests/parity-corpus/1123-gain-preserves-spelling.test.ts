/**
 * 1123-gain-preserves-spelling.test.ts — a velocity drag must not rewrite the file.
 *
 * A gain edit moves no note and changes no timing, so the notation it writes should be
 * the notation that was already there. It was not: both writers rebuilt the whole
 * pattern flat the moment a per-column / per-note `.gain("…")` had to be written, and
 * `bd [hh hh] sn cp` came back `bd _ hh hh sn _ cp _`. 220 grid / 156 roll units.
 *
 * THE GUARD THAT DID IT WAS DELIBERATE, AND ITS REASON WAS REFUTED BY THE ENGINE:
 *
 *   "A per-column `.gain(…)` runs 1:1 against the FLAT column sequence, so a grid
 *    carrying one has to keep emitting that sequence or the velocities land on the
 *    wrong notes."
 *
 * The 1:1 relationship is with the COLUMNS, and a splice preserves those exactly — it
 * changes only how they are spelled. Asked of Strudel rather than of either writer
 * ([[P301]]), over every unit where the two spellings differed: 217 of 220 grid and 127
 * of 156 roll played IDENTICALLY, and in not one of the remainder did any note receive
 * a different gain. The differences were the REBUILD losing content.
 *
 * ── WHAT THIS FILE ASSERTS, AND WHY IT IS THREE CLAUSES ──────────────────────────
 *
 *   SPELLING     a gain-only edit leaves the notation byte-identical. The defect.
 *
 *   ENGINE       what the edited document PLAYS equals what the original document plays
 *                under the same gain. This is the clause that would catch a splice which
 *                preserved the bytes and changed the music — the failure mode a spelling
 *                assertion cannot see, and the one the removed guard claimed to prevent.
 *                It is asked of the engine, so it cannot agree with our writer by
 *                construction.
 *
 *   POPULATION   both counts are pinned. A spelling clause over an empty population is
 *                green and means nothing, and this whole class of defect reached
 *                production behind assertions that could not fail.
 *
 * ⚠ THE REFERENCE IS THE USER'S OWN DOCUMENT, never our own splice of it. Comparing the
 * writer against itself would have reported the guard as harmless: both spellings agree
 * with each other far more often than either agrees with the file.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import {
  serializeStepGrid,
  serializeStepGain,
  serializePianoRoll,
  serializeRollGain,
} from '../../../editor/src/codeView/notation/serialize'
import { setColumnGain, setGroupGain } from '../../../editor/src/visualEdit/panels/inspector'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import type {
  StepGridModel,
  PianoRollModel,
  GainWrite,
} from '../../../editor/src/codeView/notation/model'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

const GAIN = 0.42

interface Hap {
  part: { begin: { valueOf(): number } }
  value: unknown
}

const sortKeys = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))

/** what the ENGINE plays for `notation.gain(gainMini)` — the oracle, not our writer */
function play(notation: string, gainMini: string | null): string[] | null {
  try {
    let pat = reifyMini(notation) as unknown as {
      gain(p: unknown): typeof pat
      queryArc(a: number, b: number): Hap[]
    }
    if (gainMini != null) pat = pat.gain(reifyMini(gainMini) as unknown)
    return pat
      .queryArc(0, 1)
      .map((h) => {
        const v = h.value as Record<string, unknown>
        const onset = Number(h.part.begin.valueOf()).toFixed(6)
        return `${onset}|${typeof v === 'object' && v !== null ? JSON.stringify(sortKeys(v)) : String(v)}`
      })
      .sort()
  } catch {
    return null
  }
}

interface Surface<M> {
  label: string
  parse: (mini: string) => { ok: true; model: M } | { ok: false }
  serialize: (m: M) => string | null
  gain: (m: M) => GainWrite
  /** apply a velocity change to the first thing that has one; same model = nothing to do */
  edit: (m: M) => M
}

function sweep<M>(s: Surface<M>): { asked: number; respelled: string[]; played: string[] } {
  const respelled: string[] = []
  const played: string[] = []
  let asked = 0
  for (const mini of minis) {
    const p = s.parse(mini)
    if (!p.ok) continue
    const before = s.serialize(p.model)
    if (before == null) continue
    const gained = s.edit(p.model)
    if (gained === p.model) continue
    const after = s.serialize(gained)
    if (after == null) continue
    asked++

    // SPELLING — a gain edit moves no note, so the notation must not move either
    if (after !== before) respelled.push(mini)

    // ENGINE — and what it plays must still be what the document plays
    const g = s.gain(gained)
    const gainMini = g.kind === 'write' && g.quoted ? g.value : null
    if (gainMini == null) continue
    const ref = play(mini, gainMini)
    const got = play(after, gainMini)
    if (ref == null || got == null) continue
    if (JSON.stringify(ref) !== JSON.stringify(got)) played.push(mini)
  }
  return { asked, respelled, played }
}

const gridSurface: Surface<StepGridModel> = {
  label: 'grid',
  parse: parseStepGrid as never,
  serialize: serializeStepGrid,
  gain: serializeStepGain,
  edit: (m) => {
    const col = m.lanes[0]?.cells.findIndex((c) => isCellOn(c)) ?? -1
    return col < 0 ? m : setColumnGain(m, col, GAIN)
  },
}

const rollSurface: Surface<PianoRollModel> = {
  label: 'roll',
  parse: parsePianoRoll as never,
  serialize: serializePianoRoll,
  gain: serializeRollGain,
  edit: (m) => (m.notes[0] ? setGroupGain(m, m.notes[0].start, GAIN) : m),
}

/* ── pinned populations, measured on THIS tree ──────────────────────────────
 * Pinned so the clauses above cannot go quietly vacuous: a spelling assertion over
 * zero units is green and says nothing, which is how this class reached production.
 *
 * ⚠ ROLL 540 → 541 AT #1233, AND IT IS A GAIN RATHER THAN DRIFT. Attaching the surgical
 * overlay on the core-opened path made one more roll unit's velocity drag writable at all.
 * Identified per unit rather than inferred from the delta — with the overlay that unit
 * reports `ASKED:same` (the write round-trips and the notation does not move, which is this
 * file's whole property), and with the overlay stripped `serializePianoRoll` returns null,
 * so it never entered the population at all. The mini is the four-line
 * `<[b4, g#4, e4, c#4]> …` stack. `respelled` and `play-changed` stayed at 0 on both
 * surfaces, so nothing was traded for it.
 */
// ⚠ 972/541 -> 1012/593 at #1242 — the corpus widened 1535 -> 1633 units.
// ⚠ roll 593 -> 594 at #1310 (region-local parallel lanes): `parse.ts` uses the writer
// as an admissibility oracle, so the widened writer lets one more roll unit into the
// population — `[-7 2,<4 5 6>]*8`. The grid is untouched. `respelled` and `play-changed`
// stay at 0 on both surfaces, which is this file's actual property: the arrival brought
// asks, not a notation move.
// ⚠ 1012/594 -> 1013/595 at #1827 (each bar drawn at its own step count): the two units
// that used to exceed 64 shared columns now open per bar — `<~ ~ bd*3 bd*4 …>` on the
// grid and `<[36 48]*2 [34 46]*3 [41 53]*4 [39 51]*2>` on the roll. Population, not
// notation: `respelled` and `play-changed` stay at 0.
// ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
// ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
// ⚠ roll 598 -> 600 at #1974 (a hit is anchored on the note that wrote it) — store probes/timing-facts-1974/anchor-move: the two rolls that open on the leaf writer.
const ASKED = { grid: 1017, roll: 600 }

describe('#1123 — a velocity drag leaves the notation alone', () => {
  it('grid', () => {
    const r = sweep(gridSurface)
    console.log(`GRID asked=${r.asked} respelled=${r.respelled.length} play-changed=${r.played.length}`)
    expect(r.asked, 'the population must not go empty').toBe(ASKED.grid)
    expect(r.respelled.slice(0, 5), 'a gain edit re-spelled the notation').toEqual([])
    expect(r.played.slice(0, 5), 'a gain edit changed what the document plays').toEqual([])
  })

  it('roll', () => {
    const r = sweep(rollSurface)
    console.log(`ROLL asked=${r.asked} respelled=${r.respelled.length} play-changed=${r.played.length}`)
    expect(r.asked, 'the population must not go empty').toBe(ASKED.roll)
    expect(r.respelled.slice(0, 5), 'a gain edit re-spelled the notation').toEqual([])
    expect(r.played.slice(0, 5), 'a gain edit changed what the document plays').toEqual([])
  })
})
