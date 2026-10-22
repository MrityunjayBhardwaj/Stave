/**
 * view-scale-entry.test.ts — the view resolution asked through the PUBLIC ENTRIES (#1116).
 *
 * ── WHY THIS GATE EXISTS, AND WHY THE EXISTING ONES COULD NOT CATCH IT ────────
 * #1055 shipped `ViewScale` into `projectStepGridDerived` / `projectPianoRollDerived`
 * and proved it live by calling those projections directly. That is a correct test of
 * the projections — and it never exercises `parseStepGrid` / `parsePianoRoll`, which
 * try the syntactic CORE first and return it whenever it succeeds. 783 of the 958
 * corpus units that open a grid are core-parsed, and 412 of the 544 that open a roll,
 * including `bd ~ sn ~`, the case the resolution work is named after. So a seam proved
 * live through its own module was unreachable through the entry every caller uses.
 *
 * The lesson generalises past this fix: a gate must enter where callers enter. This
 * file therefore only ever calls `parseStepGrid(mini, k)` / `parsePianoRoll(mini, k)`.
 *
 * ── THE FOUR PROPERTIES ───────────────────────────────────────────────────────
 *   INERT       an explicit `UNREFINED` is indistinguishable from omitting the argument.
 *   LIVE        a scale reaches real units and multiplies the drawn columns by exactly k.
 *   FAITHFUL    a refine is pure MAGNIFICATION — same lanes/notes, every onset at
 *               exactly k× its old column and nothing else moved.
 *   SAME WRITER a refine comes back owned by the same writer, tiling the same source
 *               bytes — because that is WHO will rewrite the user's document.
 *
 * LIVE alone is satisfied by a projection that draws k× the columns and puts the notes
 * anywhere. FAITHFUL says the view still shows the same music. SAME WRITER is the one
 * added after the fact, and it is the one that caught the deepest defect — see below.
 *
 * ── THE TWO DEFECTS THIS FILE'S OWN FIRST VERSION SHIPPED WITH ────────────────
 * Both were in the SAME direction — a correct model discarded, or the right model
 * produced by the wrong path — and neither is visible in a diff:
 *
 *  1. THE SELF-REPORT IS AN OBLIGATION. The entry decides "was this actually refined?"
 *     by reading `model.viewScale`. Only the CORE paths had been taught to set it, so
 *     the element projection — which multiplies `perBar` by the scale and draws
 *     correctly — was refused for saying nothing. 96 of the first version's 198
 *     "honest refusals" were faithful k× models thrown away. Whoever multiplies by the
 *     scale must also record it.
 *
 *  2. ROUTING MUST NOT DEPEND ON THE VIEW. Ownership was decided by asking each layer
 *     AT THE SCALE, which conflates "I do not own this pattern" with "I own it but
 *     cannot draw it finer yet" — both arrive as `ok: false`. So a scale refusal fell
 *     through to the next writer: 20 grid and 17 roll units changed writer on a zoom,
 *     and 36 of the 37 were faithful magnifications that would have shipped in
 *     silence. Ownership is now asked at `UNREFINED`, at both levels of the chain.
 *
 * ── WHAT THIS GATE CAN AND CANNOT SEE, MEASURED RATHER THAN CLAIMED ───────────
 * Re-breaking the routing fix reddens the grid arm with 8 named entries. That is NOT
 * all 20 swaps, and the gap is the honest part: measured under the break, only 6 of
 * the 20 (at ×2) produce a model that DIFFERS at all — the other 14 come back with the
 * same bytes, the same strides and the same content, because the two writers tile
 * those patterns identically. No assertion over the returned model can name them, and
 * saying so is better than quoting 20 as though this file demonstrated it. The fix is
 * justified by the 6 it repairs plus the fact that two separate implementations are
 * free to diverge on the next change; the gate holds the line where the line is
 * visible.
 *
 * ── THE REFUSALS ARE ASSERTED, NOT TOLERATED ──────────────────────────────────
 * Several projections legitimately do not carry a scale: the leaf path anchors each
 * note to its own source span and has no span to subdivide (#1058, and [[PV261]] —
 * it offers no resolution op at all today, so nothing goes dark), while the
 * whole-cycle `<…>` bar expansion and `gridFromAltElements`/`rollFromAltElements`
 * have not been taught it. Those units REFUSE rather than answer a refine request
 * with the document's own layout. The counts are pinned here so that a path silently
 * starting to lie shows up as a number rather than as a passing suite.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseStepGrid,
  parseStepGridCore,
  parsePianoRoll,
  parsePianoRollCore,
} from '../../../editor/src/codeView/notation/parse'
import { documentSteps } from '../../../editor/src/codeView/notation/viewResolution'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import type { StepGridModel, PianoRollModel } from '../../../editor/src/codeView/notation/model'
import { toUniformGrid, toUniformRoll } from '../../../editor/src/codeView/notation/perBar'

/**
 * The document's model in the columns a refine MAGNIFIES. A refined view is one shared
 * column grid; a document whose bars' counts do not nest is drawn per bar at ×1 (#1827),
 * in drawn columns — so "k× the base" is asked of the base's exact shared form, which for
 * those units is the model this file was written against and for every other unit is the
 * model itself.
 */
const sharedForm = <M,>(m: M): M =>
  ('lanes' in (m as object) ? toUniformGrid(m as never) : toUniformRoll(m as never)) as M

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

/**
 * WHICH WRITER owns the bytes, AND WHICH BYTES IT OWNS — the leaf splicer, the alt
 * writer or the span writer, plus the exact tiling of source text it will splice.
 *
 * The kind alone is too coarse to be a gate: two different writers can hand back the
 * same shape, so a swap between them reads as no change. Measured on the break — the
 * kind caught 8 of the 20 units that actually swapped. Including the region `raw`
 * strings makes it exact, and it is still a property of the RETURNED MODEL rather
 * than a re-derivation of the routing, which would only ever agree with itself
 * ([[PV192]]).
 *
 * The bytes must be identical, not scaled: a refine changes how many columns the view
 * draws, never which text the writer will replace. Only the column bounds scale.
 */
function writerIdentity(m: Model): string {
  const bars = `/bars=${m.bars ?? 1}`
  if (m.leafSource) return `leaf${bars}`
  if (m.altSource) return `alt${bars}|` + m.altSource.regions.map((r) => r.raw).join('\u0000')
  if (m.source) {
    const parts = m.source.parts
      .map((p) => p.before + p.regions.map((r) => r.raw).join('\u0000') + p.after)
      .join('\u0002')
    return `span${bars}|${m.source.prefix}\u0001${parts}\u0001${m.source.suffix}`
  }
  return `none${bars}`
}

/**
 * The writer's own COLUMN ARITHMETIC — `perBar` and `div`, the numbers it strides
 * regions by. Both are column quantities, so under a k× refine each must be exactly
 * k× what it was. Null where the model carries no such source.
 *
 * This is the half `writerIdentity` cannot see: two different writers can tile the
 * identical source bytes and still disagree about how many columns a region spans —
 * measured on the break, byte-tiling alone names 8 of the 20 units that swap, and
 * adding this names the rest. It is also a faithfulness statement in its own right,
 * since these are the numbers `spliceAltGrid` indexes with.
 */
function writerArithmetic(m: Model): number[] | null {
  if (m.altSource) return [m.altSource.perBar, m.altSource.div]
  if (m.source) return m.source.parts.map((p) => p.div)
  return null
}

/** the ON column indices per lane — the grid's music, independent of column count */
function gridOnsets(m: StepGridModel): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const lane of m.lanes) {
    const cols: number[] = []
    lane.cells.forEach((c, i) => {
      if (isCellOn(c)) cols.push(i)
    })
    out.set(`${lane.sound}#${lane.part ?? 0}`, cols)
  }
  return out
}

/** null = a faithful k× magnification; else the first way it is not */
function gridMoved(base: StepGridModel, got: StepGridModel, k: number): string | null {
  const b = gridOnsets(base)
  const g = gridOnsets(got)
  if (g.size !== b.size) return `lane count ${g.size} !== ${b.size}`
  for (const [lane, cols] of b) {
    const x = g.get(lane)
    if (!x) return `lane ${lane} missing`
    if (x.length !== cols.length) return `lane ${lane} onsets ${x.length} !== ${cols.length}`
    if (x.some((c, i) => c !== cols[i] * k)) return `lane ${lane} moved`
  }
  return null
}

/** the roll's music is pitch + start + DURATION, and all three scale together */
function rollMoved(base: PianoRollModel, got: PianoRollModel, k: number): string | null {
  if (got.notes.length !== base.notes.length) {
    return `note count ${got.notes.length} !== ${base.notes.length}`
  }
  const key = (n: { pitch: string; start: number; duration: number }, f: number) =>
    `${n.pitch}@${n.start * f}+${n.duration * f}`
  const b = base.notes.map((n) => key(n, k)).sort()
  const g = got.notes.map((n) => key(n, 1)).sort()
  for (let i = 0; i < b.length; i++) if (b[i] !== g[i]) return `note ${g[i]} !== ${b[i]}`
  return null
}

/**
 * The fields BOTH surfaces' models share that this file reads. Written out rather
 * than imported as a union so the sweep stays generic over the two — and so tsc,
 * which vitest does not run, checks the writer helpers against it.
 */
type Model = {
  steps: number
  viewScale?: number
  bars?: number
  leafSource?: unknown
  altSource?: { regions: { raw: string }[]; perBar: number; div: number }
  source?: {
    prefix: string
    suffix: string
    parts: { before: string; after: string; div: number; regions: { raw: string }[] }[]
  }
}
type Parse<M> = (m: string, k?: number) => { ok: true; model: M } | { ok: false; reason: string }

/**
 * One sweep, run for each surface. Returns the honoured/refused counts per scale plus
 * every named violation, so a failure says WHICH pattern rather than only how many.
 */
function sweep<M extends Model>(
  parse: Parse<M>,
  moved: (base: M, got: M, k: number) => string | null,
) {
  const honoured = new Map<number, number>()
  const refused = new Map<number, number>()
  const violations: string[] = []
  const name = (m: string) => JSON.stringify(m.length > 48 ? m.slice(0, 48) + '…' : m)

  for (const mini of minis) {
    const parsed = parse(mini)
    if (!parsed.ok) continue
    const base = { ok: true as const, model: sharedForm(parsed.model) }
    for (const k of [2, 4]) {
      const r = parse(mini, k)
      if (!r.ok) {
        refused.set(k, (refused.get(k) ?? 0) + 1)
        continue
      }
      honoured.set(k, (honoured.get(k) ?? 0) + 1)
      // LIVE — exactly k× the drawn columns, and the document's own width recoverable
      if (r.model.steps !== base.model.steps * k) {
        violations.push(`${name(mini)} @k=${k}: steps ${r.model.steps} !== ${base.model.steps}*${k}`)
        continue
      }
      if (documentSteps(r.model) !== base.model.steps) {
        violations.push(`${name(mini)} @k=${k}: documentSteps ${documentSteps(r.model)}`)
        continue
      }
      // SAME WRITER — a zoom must not hand the document to a different writer, and
      // the writer it stays with must stride the refined view by exactly k× its own
      // numbers. Two clauses because neither implies the other: the bytes say WHO,
      // the arithmetic says the same WHO has not quietly changed its mind.
      const was = writerIdentity(base.model)
      const is = writerIdentity(r.model)
      if (was !== is) {
        violations.push(`${name(mini)} @k=${k}: writer ${was} → ${is}`)
        continue
      }
      const wasN = writerArithmetic(base.model)
      const isN = writerArithmetic(r.model)
      if (JSON.stringify(wasN?.map((n) => n * k)) !== JSON.stringify(isN)) {
        violations.push(`${name(mini)} @k=${k}: writer strides ${wasN}*${k} → ${isN}`)
        continue
      }
      // FAITHFUL — pure magnification
      const why = moved(base.model, r.model, k)
      if (why) violations.push(`${name(mini)} @k=${k}: ${why}`)
    }
  }
  return { honoured, refused, violations }
}

describe('#1116 the view scale, through the public entries', () => {
  it('is INERT at the document resolution, and the populations are asserted not described', () => {
    const grids = minis.filter((m) => parseStepGrid(m).ok)
    const rolls = minis.filter((m) => parsePianoRoll(m).ok)

    // The denominators are pinned, so a gate cannot quietly go green over less material.
    // ⚠ 973 -> 1013 at #1242 — the corpus widened 1535 -> 1633 units
    // (98 arrivals, 0 departures): the harvest gained the product's own
    // resolver, so every figure here is over a wider population. Upward only.
    // …and the split that motivates this file: the core answers for most of them.
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
    // Folded into one array assertion so all four denominators report in a single
    // run — `expect` aborts at its first failure, and a population change moves
    // every one of these at once.
    expect([
      grids.length,
      rolls.length,
      grids.filter((m) => parseStepGridCore(m).ok).length,
      rolls.filter((m) => parsePianoRollCore(m).ok).length,
      // ⚠ roll 596 -> 597 at #1310: the widened writer lets the parser open one more
      // roll document. The grid figures are untouched — this is the roll writer alone.
      // ⚠ grid 1013 -> 1014, roll 597 -> 598 at #1827 (each bar drawn at its own step count) — the two units that now open, and
      // both are refused a refine (multi-bar views are drawn per bar only at ×1).
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
    // ⚠ rolls 601 -> 603 at #1974 (a hit is anchored on the note that wrote it) — store probes/timing-facts-1974/anchor-move.
    ]).toEqual([1018, 603, 823, 474])

    expect(
      grids.filter((m) => JSON.stringify(parseStepGrid(m, 1)) !== JSON.stringify(parseStepGrid(m))),
    ).toEqual([])
    expect(
      rolls.filter(
        (m) => JSON.stringify(parsePianoRoll(m, 1)) !== JSON.stringify(parsePianoRoll(m)),
      ),
    ).toEqual([])
  })

  // ── #1117 moved these, by exactly the population it names ──────────────────
  // Teaching the four bar-expanding projections the scale took the grid from
  // 836/122 to 869/89 and the roll from 451/93 to 490/54: +33 grid (23 alt-element
  // expansions + 10 whole-cycle bar projections) and +39 roll (22 + 17), attributed
  // per path by `_1116-refusal-attribution.spec.ts`. The refusals that REMAIN are
  // the leaf-anchored path, which has no span to subdivide and is out of scope by
  // decision.
  //
  // #1120 then closed the non-unit-note-length class this comment used to defer,
  // taking the grid from 869/89 to 876/82: a held note reaching across a `[…]` group
  // had no spelling, so the writer declined and the view was refused with it. Seven
  // units, six of them reachable through the Slots control. `violations` stayed empty
  // throughout — every one of the seven is a pure magnification by the same writer,
  // which is the property this file exists to hold and the reason a bare count moving
  // is safe to accept here.
  it('grid: LIVE, FAITHFUL and SAME-WRITER wherever honoured; REFUSES everywhere else', () => {
    const { honoured, refused, violations } = sweep(parseStepGrid, gridMoved)
    expect(violations).toEqual([])
    // ⚠ 890 -> 927 at #1242 — the corpus widened 1535 -> 1633 units
    // (98 arrivals, 0 departures): the harvest gained the product's own
    // resolver, so every figure here is over a wider population. Upward only.
    // Folded into one array assertion so both scales report in a single run.
    // Each pair sums to `grids.length` = 1013, and NOTHING crosses the ceiling
    // between ×2 and ×4 on this surface — which is the roll's story, not the
    // grid's, and stays visible only because the two scales are pinned apart.
    expect([honoured.get(2), refused.get(2), honoured.get(4), refused.get(4)]).toEqual([
      // ⚠ refused 86 -> 87 at both scales at #1827 (each bar drawn at its own step count): the newly opened drum grid, as `view-resolution`.
      // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
      // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
      // ⚠ 937/81 -> 935/83 at both scales at #1974 (a hit is anchored on the note that wrote it) — store probes/timing-facts-1974/anchor-move: the two grids that became leaf-written are refused a finer view (`no-finer-view`).
      935, 83, 935, 83,
    ])
  })

  it('roll: LIVE, FAITHFUL and SAME-WRITER wherever honoured; REFUSES everywhere else', () => {
    const { honoured, refused, violations } = sweep(parsePianoRoll, rollMoved)
    expect(violations).toEqual([])
    // ⚠ 490 -> 540 at #1242 — the corpus widened 1535 -> 1633 units
    // (98 arrivals, 0 departures): the harvest gained the product's own
    // resolver, so every figure here is over a wider population. Upward only.
    // one long pattern crosses the VIEW ceiling at ×4 and not at ×2 — the ceiling
    // doing exactly its job, so the two scales are pinned separately rather than
    // averaged into one number that would hide it. Still exactly ONE after the
    // widening: 540/56 at ×2 against 539/57 at ×4, each pair summing to
    // `rolls.length` = 596.
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
    // Folded into one array assertion so both scales report in a single run.
    // ⚠ MOVED at #1310 (region-local parallel lanes). +1 unit opens and 2 units move
    // off the leaf projection, so honoured rises and refused falls at both scales:
    // 543/54 at ×2 against 542/55 at ×4. Each pair still sums to `rolls.length` = 597,
    // and the ×2/×4 gap is still exactly ONE — the VIEW ceiling doing its job, which is
    // the property this pin is really guarding.
    expect([honoured.get(2), refused.get(2), honoured.get(4), refused.get(4)]).toEqual([
      // ⚠ refused +1 at both scales at #1827 (each bar drawn at its own step count): the newly opened roll, as `view-resolution`.
      // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
      // ⚠ refused +2 at both scales at #1974 (a hit is anchored on the note that wrote it) — store probes/timing-facts-1974/anchor-move: the two rolls that newly open are leaf-written, so they are refused a finer view.
      564, 39, 563, 40,
    ])
  })

  it('magnifies the case the resolution work is named after, on both surfaces', () => {
    // #1052's canonical example, core-parsed — the one a derived-only seam could not reach
    expect(parseStepGridCore('bd ~ sn ~').ok).toBe(true)
    for (const [k, cols] of [
      [1, 4],
      [2, 8],
      [4, 16],
      [8, 32],
    ]) {
      const r = parseStepGrid('bd ~ sn ~', k)
      expect(r.ok).toBe(true)
      expect((r as { model: StepGridModel }).model.steps).toBe(cols)
    }

    expect(parsePianoRollCore('c3 ~ e3 ~').ok).toBe(true)
    for (const [k, cols] of [
      [1, 4],
      [2, 8],
      [4, 16],
      [8, 32],
    ]) {
      const r = parsePianoRoll('c3 ~ e3 ~', k)
      expect(r.ok).toBe(true)
      const m = (r as { model: PianoRollModel }).model
      expect(m.steps).toBe(cols)
      // a roll note's LENGTH is measured in columns, so it magnifies with them
      expect(m.notes.map((n) => [n.start, n.duration])).toEqual([
        [0, cols / 4],
        [cols / 2, cols / 4],
      ])
    }
  })
})
