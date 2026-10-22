/**
 * cell-duration.test.ts — the step cell's LENGTH is a length the engine played
 * (#1010 P4b).
 *
 * WHY THIS GATE EXISTS. `StepLane.cells` now carries how long each note sounds, and
 * the three read paths compute it three different ways:
 *
 *   - the syntactic core walks the AST and uses the SLOT'S SPAN in columns
 *   - the two projected paths read `whole.end - whole.begin` from the haps and scale
 *     cycles → columns by `perBar`
 *   - the leaf path takes the anchors' atoms and the played lengths, matched per column
 *
 * "The span is the length" was an INFERENCE when it was written — both quantities came
 * out integral in a sweep, which is not the same as being equal. This asserts it, per
 * cell, over the whole corpus. If a slot's span ever stops being what the pattern
 * plays, the cell would carry a plausible wrong number and the printer (P4c) would
 * spell it faithfully; that is precisely the silent-corruption class this phase exists
 * to close ([[PV239]]), so it gets a gate rather than a comment.
 *
 * WHAT EACH ARM CAN AND CANNOT CATCH — stated because the arms are not equally strong:
 *   - SYNTACTIC path: fully independent. The structural length never touches the
 *     engine, so agreement is real evidence.
 *   - PROJECTED paths: partly circular — cell lengths and the expected lengths both
 *     descend from the same `queryArc`. What it still checks is the cycles→columns
 *     conversion and the column placement, which is where a unit error would live.
 *
 * POPULATION: every `mini-corpus.json` unit that opens a step grid, split by path and
 * printed, so a path emptying out fails instead of quietly shrinking the denominator.
 * SAMPLING DEPTH: the model's OWN window, `bars` cycles (1 when single-cycle) — not a
 * fixed 4 or 16. A grid's cells cover exactly `bars` cycles, so a hap at cycle 5 of a
 * single-bar model is a hap no cell exists for; sampling wider counts lengths the cell
 * never has to carry, which is how the first version of the P4b sweep talked itself
 * into a defect that was not there ([[P359]] for why depth is stated at all, [[P343]]
 * for why the population is).
 * COMPARISON: a cell's length must be ONE OF the lengths the engine played for that
 * sound at that column — a multiset membership, not equality, because a `,`-stack can
 * land the same token twice on one column with two lengths and the cell displays the
 * first. The count of such columns is reported, so the weaker form's scope is visible.
 *
 * CONTROL ARM ([[P353]] — a green from a comparison never shown to fire is not
 * evidence): a degenerate reader that returns 1 for every length is run through the
 * same comparison and MUST be caught, on a named unit and corpus-wide.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { parseStepGrid, parseStepGridCore } from '../../../editor/src/codeView/notation/parse'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import type { StepGridModel } from '../../../editor/src/codeView/notation/model'
import { barRuler, columnAt } from './engineEditOracle'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

/** hap bounds are Fraction→float: a note lasting its column arrives as 0.999…8 too */
const EPS = 1e-9

/**
 * what the ENGINE played: per column index, per token, the lengths in columns — measured
 * with the shared `barRuler`, since a column is not one width across bars when the model
 * is drawn per bar (#1827). Uniform models: the old arithmetic exactly.
 */
function playedLengths(
  mini: string,
  ruler: { widths: number[]; starts: number[] },
): Map<string, number[]> | null {
  const bars = ruler.widths.length
  let pat: unknown
  try {
    pat = reifyMini(mini)
  } catch {
    return null
  }
  const out = new Map<string, number[]>()
  for (let cyc = 0; cyc < bars; cyc++) {
    const perBar = ruler.widths[cyc]
    let haps: Array<{
      hasOnset?: () => boolean
      whole?: { begin: { valueOf(): number }; end: { valueOf(): number } }
      value: unknown
    }>
    try {
      haps = (pat as { queryArc(a: number, b: number): typeof haps }).queryArc(cyc, cyc + 1)
    } catch {
      return null
    }
    for (const h of haps) {
      if (!(h.hasOnset?.() ?? false) || !h.whole) continue
      const v = h.value
      // the token as the reader spells it: a string, or a `:`-variant's ARRAY (#1019)
      const token =
        typeof v === 'string' ? v : Array.isArray(v) ? v.join(':') : typeof v === 'number' ? null : null
      if (token === null) continue
      const col = Math.round(columnAt(ruler, cyc, h.whole.begin.valueOf()))
      const len = (h.whole.end.valueOf() - h.whole.begin.valueOf()) * perBar
      const key = `${col} ${token}`
      out.set(key, [...(out.get(key) ?? []), len])
    }
  }
  return out
}

interface Mismatch {
  mini: string
  col: number
  sound: string
  got: number
  played: number[]
}

/**
 * The syntactic path names a lane by its SOURCE TEXT — `LinnDrum_hh:0:.3` — while the
 * engine hands back the parsed members, so the same note is `…:0:0.3` here. Both are
 * right for their own job (the writer has to put the user's own bytes back), so the
 * comparison normalizes the numeric members of a `:`-variant rather than pretending one
 * spelling is canonical. An INSTRUMENT concession, and the only one: it changes which
 * lengths get looked up, never what a length is.
 */
const normalizeToken = (token: string): string =>
  token
    .split(':')
    .map((part) => (part !== '' && !Number.isNaN(Number(part)) ? String(Number(part)) : part))
    .join(':')

/** compare every ON cell's length against the played multiset for its column+sound */
function check(
  model: StepGridModel,
  played: Map<string, number[]>,
  /** the control arm replaces every cell length with this */
  degenerate?: number,
): Mismatch[] {
  const bad: Mismatch[] = []
  for (const lane of model.lanes) {
    lane.cells.forEach((cell, col) => {
      if (!isCellOn(cell)) return
      const want =
        played.get(`${col} ${lane.sound}`) ??
        played.get(`${col} ${normalizeToken(lane.sound)}`) ??
        []
      const got = degenerate ?? cell.duration
      if (!want.some((w) => Math.abs(w - got) < EPS)) {
        bad.push({ mini: '', col, sound: lane.sound, got, played: want })
      }
    })
  }
  return bad
}

interface Unit {
  mini: string
  model: StepGridModel
  played: Map<string, number[]>
  path: 'syntactic' | 'derived' | 'derived+leaf'
}

const units: Unit[] = []
for (const mini of minis) {
  const r = parseStepGrid(mini)
  if (!r.ok) continue
  const bars = Math.max(1, r.model.bars ?? 1)
  const perBar = r.model.steps / bars
  const ruler = barRuler(r.model)
  if (ruler === null) continue
  const played = playedLengths(mini, ruler)
  if (played === null) continue
  units.push({
    mini,
    model: r.model,
    played,
    path: parseStepGridCore(mini).ok
      ? 'syntactic'
      : r.model.leafSource
        ? 'derived+leaf'
        : 'derived',
  })
}

describe('the step cell carries a length the engine actually played', () => {
  it('every ON cell, every path, over the model’s own cycle window', () => {
    const bad: Mismatch[] = []
    const byPath = new Map<string, number>()
    let cells = 0
    for (const u of units) {
      byPath.set(u.path, (byPath.get(u.path) ?? 0) + 1)
      for (const lane of u.model.lanes) cells += lane.cells.filter(isCellOn).length
      bad.push(...check(u.model, u.played).map((m) => ({ ...m, mini: u.mini })))
    }
    console.log(
      `\n===== CELL DURATION vs ENGINE =====\n` +
        `  units      ${units.length}  (${[...byPath].map(([k, v]) => `${k} ${v}`).join(', ')})\n` +
        `  ON cells   ${cells}\n` +
        `  mismatches ${bad.length}`,
    )
    for (const m of bad.slice(0, 25)) {
      console.log(
        `  MISMATCH ${JSON.stringify(m.mini).slice(0, 76)} col=${m.col} ${m.sound} ` +
          `cell=${Number(m.got.toFixed(5))} played=[${m.played.map((x) => Number(x.toFixed(5))).join(',')}]`,
      )
    }
    expect(
      bad.slice(0, 8),
      'a cell whose length the pattern never played is a length the printer would spell',
    ).toEqual([])
    // POPULATION, pinned. A path that stopped projecting would otherwise shrink the
    // denominator and this gate would go green over less material — the failure mode
    // that put an unstated population restriction into four shipped figures at this
    // boundary before it was named ([[P343]]).
    //
    // RE-BASED at #1010 P4c (968 → 958, split 783/113/72 → 783/93/82, cells 4763 → 4718),
    // and the mechanism is exactly what the pin exists to make visible: this population
    // is gated on `parseStepGrid(...).ok`, and the PARSER asks the WRITER before it
    // offers a view at all (`parse.ts:1638` — "the writer must reproduce the user's
    // bytes"; also `leafViewUsable`). Once the printer preserves lengths, a view whose
    // edits it cannot honour stops being offered. Attributed unit by unit against the
    // base writer (`_p4c-pin-attribution.spec.ts`), and it is two disjoint moves, not a
    // diffuse drift:
    //   - 10 units `derived → ABSENT` — `[hh ~]!16`, `amen:1/4`, `breaks:2/2`, … each
    //     carrying a length the column resolution cannot spell. These are the SAME 10
    //     that take the projected-view count from 185 to 175; a view that mis-writes is
    //     worse than no view, so losing them is the phase working, not leaking.
    //   - 10 units `derived → derived+leaf` — `[bd sd, hh hh hh]`, `bd/2 sd`, … falling
    //     back to the leaf-anchored projection, which is a gain in fidelity and no loss
    //     of population; that is why `derived` drops 20 while the total drops only 10.
    // Syntactic is UNMOVED at 783, which is the control inside the split: the core path
    // never consults the writer, so a printer change must not touch it.
    //
    // 958 → 973 (#1066): fifteen units the onset snap grid used to refuse. It could not
    // express a thirty-second, so a rational position was rounded into an irrational one
    // and rejected by the very MAX_STEPS test it should have passed. These arrive on the
    // DERIVED paths — syntactic stays 783, which is the same control working twice: the
    // core never snaps, so a snapping change must not touch it either.
    // ⚠ 973 -> 1013 at #1242 — the corpus widened 1535 -> 1633 units
    // (98 arrivals, 0 departures): the harvest gained the product's own
    // resolver, so every figure here is over a wider population. Upward only.
    // ⚠ 1013 -> 1014 at #1827 (each bar drawn at its own step count): `<~ ~ bd*3 bd*4 bd*3 bd*4 bd*4 bd*4>` now opens.
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
    expect(units.length).toBe(1018)
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
    // Folded so the whole split reports in one run: the three paths must sum to
    // `units`, and asserting them apart means a population change reports the
    // first one that moved and hides the rest.
    expect({
      syntactic: byPath.get('syntactic'),
      derived: byPath.get('derived'),
      'derived+leaf': byPath.get('derived+leaf'),
      cells,
      // ⚠ syntactic 812 -> 813, cells 5685 -> 5707 at #1827 (each bar drawn at its own step count): the newly opened drum grid's 22 hits.
      // ⚠ syntactic 813 -> 820, derived+leaf 86 -> 82, cells 5707 -> 5739 at #1849: the stacks it opens on the core, every ON cell still agreeing with the engine.
    // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
    // ⚠ MOVED at #1974 (hits are anchored on their written note): two grids the element writer could only rewrite whole,
    // `[c eb g <f bb>](3,8,<0 1>)` and `{c [f g] d# d}%2`, are leaf-written now. Same cells, a different path.
    }).toEqual({ syntactic: 823, derived: 113, 'derived+leaf': 82, cells: 5749 })
  })

  it('CONTROL: a reader that returns 1 for every length is caught', () => {
    // corpus-wide — the ~206 units carrying a length that is not 1 must all fail
    const caught = units.filter((u) => check(u.model, u.played, 1).length > 0)
    expect(caught.length).toBeGreaterThan(150)

    // and on a named unit, so the control cannot pass by accident of aggregation:
    // `bd [sd sd sd]` gives `bd` three columns of six, and 1 is not that
    const r = parseStepGrid('bd [sd sd sd]')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const played = playedLengths('bd [sd sd sd]', barRuler(r.model)!)!
    expect(check(r.model, played)).toEqual([])
    expect(check(r.model, played, 1).map((m) => m.sound)).toEqual(['bd'])
  })

  it('reports the columns where one sound played two different lengths', () => {
    // the multiset comparison above is weaker than equality exactly here, so the
    // scope of that weakness is measured rather than assumed (#1034's population)
    let cols = 0
    const hit: string[] = []
    for (const u of units) {
      let any = false
      for (const lens of u.played.values()) {
        if (lens.length > 1 && lens.some((l) => Math.abs(l - lens[0]) > EPS)) {
          cols++
          any = true
        }
      }
      if (any) hit.push(u.mini)
    }
    console.log(`  columns with 2+ distinct lengths for one sound: ${cols} in ${hit.length} units`)
    // 1 unit, and NOT the 5 the #1034 sweep reports for the same phenomenon: that one
    // samples 16 cycles, this one samples each model's own `bars` window. Two different
    // populations, so two different counts — the numbers are not in conflict, and
    // neither may be quoted for the other's question.
    expect(hit.length).toBe(1)
    expect(cols).toBe(1)
  })
})
