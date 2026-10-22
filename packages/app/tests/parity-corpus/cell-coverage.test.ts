/**
 * cell-coverage.test.ts — the step grid DRAWS a note across the columns it covers
 * (#1056, Resolution Phase 3).
 *
 * WHY THIS GATE EXISTS, and why it is not `cell-duration.test.ts`. That gate asserts the
 * cell carries a length the engine played; this one asserts the panel turns that length
 * into columns. They are different subjects and they failed independently: the length
 * has been read (P4b) and preserved (P4c) since #1010 and was still invisible, because
 * every visual property of a cell derived from `isCellOn` and a sustained column is
 * `false` — `bd _ sd ~` and `bd ~ sd ~` drew an IDENTICAL picture ([[PV245]]).
 *
 * WHAT IS AND IS NOT CIRCULAR HERE — stated because the issue's first wording asked for
 * a comparison that could only agree with itself. Coverage is DERIVED from the cell
 * length, so re-checking a derived path's coverage against the haps it descends from
 * proves nothing. Four arms are real, and they are real in different ways:
 *   - SYNTACTIC path: lengths come from the AST slot span and never touch the engine, so
 *     an engine comparison is fully independent. Covers 3931 of 6207 drawn columns.
 *   - The DISTRIBUTION arithmetic on every path: conservation, disjointness, and the
 *     room rule are properties of `laneCoverage` alone, not of the length it was handed.
 *   - THE WRITER, reached through TEXT: `sustainTokens` answers the same covered-columns
 *     question in its own loop and spells it `_`, so comparing against the serialized
 *     document puts `laneCoverage` on one side of the comparison only. This is the arm
 *     that is non-circular on the DERIVED paths too, and it runs in both directions
 *     across two tests — see each for the direction it can and cannot see.
 *   - RESOLUTION INVARIANCE, on the shipped ×2 op: what the user sees must not change
 *     when the grid is viewed twice as fine.
 * Reported separately rather than pooled into one green.
 *
 * THE CONTROL ARM THE PHASE OWES ([[PV232]] — a control must be reported, not assumed).
 * #1056's "at 1× the layout is identical" is asserted STRUCTURALLY, not sampled: the
 * set of columns that are a coverage HEAD is exactly the set of ON cells, corpus-wide.
 * That is what makes this change additive — it can light columns that were dark and
 * narrow a bar that was full, and it can never move, add or drop a trigger.
 *
 * AND THE GATE MUST BE ABLE TO FIRE ([[P353]]): a degenerate coverage that draws every
 * note as exactly its own full column — which is precisely the pre-#1056 behaviour — is
 * run through the same comparisons and MUST be caught. If it is not, the phase changed
 * nothing.
 *
 * THE k = 2 / k = 4 ARMS the issue asks for run here, on `scaleStepGrid(m, 'double')` —
 * the SHIPPED ×2 op, which doubles the column count and every cell length exactly as a
 * finer view would. They were first reported as blocked on #1055's view multiple; that
 * was one option too many. When #1055 lands, its parameter is a second input to the same
 * comparison, not a reason this one could not be made.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { parseStepGrid, parseStepGridCore, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import { serializeStepGrid, serializeRollGain } from '../../../editor/src/codeView/notation/serialize'
import { scaleStepGrid } from '../../../editor/src/codeView/notation/resolution'
import { setGroupGain } from '../../../editor/src/visualEdit/panels/inspector'
import { isCellOn, laneCoverage, columnCount, columnOverlap, headColumn, tailColumn, sequentialColumnGroups } from '../../../editor/src/codeView/notation/model'
import type { StepCell, StepGridModel } from '../../../editor/src/codeView/notation/model'
import { barRuler, columnAt } from './engineEditOracle'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

/** hap bounds are Fraction→float: a note lasting its column arrives as 0.999…8 too */
const EPS = 1e-9

/**
 * what the ENGINE sounded: per token, the [begin, end) intervals in COLUMNS, measured with
 * the shared `barRuler` — a column is not one width across bars when the model is drawn
 * per bar (#1827), `<c2*2 g2*5 [a g]>` being 2 + 5 + 2. For a uniform model this is exactly
 * the old `cyc × perBar + t × perBar`.
 */
function playedSpans(
  mini: string,
  ruler: { widths: number[]; starts: number[] },
): Map<string, [number, number][]> | null {
  const bars = ruler.widths.length
  let pat: unknown
  try {
    pat = reifyMini(mini)
  } catch {
    return null
  }
  const out = new Map<string, [number, number][]>()
  for (let cyc = 0; cyc < bars; cyc++) {
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
      const token = typeof v === 'string' ? v : Array.isArray(v) ? v.join(':') : null
      if (token === null) continue
      const begin = columnAt(ruler, cyc, h.whole.begin.valueOf())
      const end = columnAt(ruler, cyc, h.whole.end.valueOf())
      out.set(token, [...(out.get(token) ?? []), [begin, end]])
    }
  }
  return out
}

/** the syntactic path names a lane by its SOURCE bytes; the engine hands back members */
const normalizeToken = (token: string): string =>
  token
    .split(':')
    .map((part) => (part !== '' && !Number.isNaN(Number(part)) ? String(Number(part)) : part))
    .join(':')

/**
 * The degenerate reader the control arm runs: every trigger draws exactly its own full
 * column and nothing carries — i.e. what the grid did before this phase.
 */
function flatCoverage(cells: StepCell[]): ({ start: number; extent: number } | undefined)[] {
  return cells.map((c, i) => (isCellOn(c) ? { start: i, extent: 1 } : undefined))
}

interface Unit {
  mini: string
  model: StepGridModel
  spans: Map<string, [number, number][]>
  perBar: number
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
  const spans = playedSpans(mini, ruler)
  if (spans === null) continue
  units.push({
    mini,
    model: r.model,
    spans,
    perBar,
    path: parseStepGridCore(mini).ok ? 'syntactic' : r.model.leafSource ? 'derived+leaf' : 'derived',
  })
}

describe('the step grid draws a note across the columns it covers (#1056)', () => {
  it('CONTROL — at 1× every trigger is still exactly one head: no note moves, appears or vanishes', () => {
    // The phase's own "the layout is identical" claim, asserted structurally over the
    // whole corpus rather than eyeballed on a fixture. A head is `cov.start === c`, and
    // it must coincide with `isCellOn` cell for cell.
    let heads = 0
    let cells = 0
    const bad: string[] = []
    for (const u of units) {
      for (const lane of u.model.lanes) {
        const cov = laneCoverage(lane.cells, u.model.steps)
        lane.cells.forEach((cell, c) => {
          const isHead = cov[c] !== undefined && cov[c]!.start === c
          if (isCellOn(cell)) cells++
          if (isHead) heads++
          if (isHead !== isCellOn(cell)) {
            bad.push(`${u.mini} lane=${lane.sound} col=${c} head=${isHead} on=${isCellOn(cell)}`)
          }
        })
      }
    }
    console.log(
      `\n===== #1056 COVERAGE =====\n` +
        `  units   ${units.length}\n` +
        `  ON cells ${cells}   heads ${heads}`,
    )
    expect(bad.slice(0, 8), 'a coverage head must be exactly a trigger — the trigger layout is untouched').toEqual([])
    expect(heads).toBe(cells)
  })

  it('the drawing is CONSERVATIVE and DISJOINT — every note draws the time it has, once', () => {
    // Properties of `laneCoverage` alone, so they hold on every read path: the extents a
    // note contributes sum to the time it actually occupies (its length, or the room it
    // has when the next hit or the grid end cuts it short), and no column is drawn twice.
    const bad: string[] = []
    let carried = 0 // columns lit that are NOT the trigger's own — the phase's new pixels
    let partial = 0 // columns drawn narrower than full — the sub-column case
    for (const u of units) {
      const steps = u.model.steps
      for (const lane of u.model.lanes) {
        const cov = laneCoverage(lane.cells, steps)
        const perNote = new Map<number, number>()
        cov.forEach((cv, c) => {
          if (!cv) return
          if (cv.start !== c) carried++
          if (Math.abs(cv.extent - 1) > EPS) partial++
          if (cv.extent < 0 || cv.extent > 1 + EPS) bad.push(`${u.mini} col=${c} extent=${cv.extent}`)
          perNote.set(cv.start, (perNote.get(cv.start) ?? 0) + cv.extent)
        })
        for (const [start, drawn] of perNote) {
          const cell = lane.cells[start]
          if (!isCellOn(cell)) {
            bad.push(`${u.mini} col=${start} coverage with no trigger`)
            continue
          }
          // the room rule, read the way `clampLane` enforces it
          let next = start + 1
          while (next < lane.cells.length && !isCellOn(lane.cells[next])) next++
          const room = Math.min(next, steps) - start
          const want = Math.max(0, Math.min(cell.duration, room))
          if (Math.abs(drawn - want) > 1e-6) {
            bad.push(`${u.mini} lane=${lane.sound} col=${start} drawn=${drawn} want=${want}`)
          }
        }
      }
    }
    console.log(`  carried columns ${carried}   partial columns ${partial}`)
    expect(bad.slice(0, 8), 'a note must draw exactly the time it occupies, and no column twice').toEqual([])
    // The phase is only real if it changed the picture, so the size of the change is
    // PINNED rather than asserted non-zero: a regression that quietly reverts to
    // one-box-per-trigger fails here instead of going green over nothing ([[P353]]).
    //
    // 1853 columns are lit that were dark before, and 12 are drawn narrower than a full
    // column (8 heads — genuinely sub-column notes — and 4 tails of a fractional length).
    // Both figures moved once during this phase, from 1550/73, when the float-sliver rule
    // below was added; the 61 removed are the same 61 in each, which is what says they
    // were one cause and not a drift.
    //
    // 1489 → 1853 (#1066): the onset snap grid could not express a thirty-second, so
    // every document needing one was refused outright and contributed no columns at all.
    // Widening the grid admits them, and each arrives with its full carry. `partial` is
    // UNMOVED at 12, which is the control that says this is new population rather than
    // existing notes being redrawn: a redraw would have moved both.
    // ⚠ 1853 -> 2080 at #1242 — the corpus widened 1535 -> 1633 units
    // (98 arrivals, 0 departures): the harvest gained the product's own
    // resolver, so every figure here is over a wider population. Upward only.
    // ⚠ 2080 -> 2059 at #1827 (each bar drawn at its own step count), counted, not
    // inferred: `<c2*2 g2*5 [a g]>` drew 30 columns, where each c2, a and g carried 4
    // columns past its own and each g2 1 (8 + 5 + 8 = 21). Drawn per bar as 2 + 5 + 2
    // cells, every note is exactly its own cell and carries none. The grid unit that
    // newly opens (`<~ ~ bd*3 bd*4 …>`) is all one-cell hits and adds none. `partial` is
    // unmoved.
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    expect(carried).toBe(2141)
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
    expect(partial).toBe(15)
  })

  it('SYNTACTIC path — every column the grid lights, the engine was sounding that voice', () => {
    // The independent arm: on this path the length comes from the AST slot span and the
    // engine is never consulted, so agreement is evidence rather than restatement. The
    // derived paths are reported alongside but carry the circularity noted in the header.
    const bad: string[] = []
    const checked = new Map<string, number>()
    for (const u of units) {
      for (const lane of u.model.lanes) {
        const cov = laneCoverage(lane.cells, u.model.steps)
        const spans = u.spans.get(lane.sound) ?? u.spans.get(normalizeToken(lane.sound)) ?? []
        cov.forEach((cv, c) => {
          if (!cv) return
          checked.set(u.path, (checked.get(u.path) ?? 0) + 1)
          if (u.path !== 'syntactic') return
          // the drawn slice of this column, in column units
          const from = c
          const to = c + cv.extent
          const sounded = spans.some(([b, e]) => b <= from + EPS && to <= e + EPS)
          if (!sounded) {
            bad.push(
              `${JSON.stringify(u.mini).slice(0, 60)} ${lane.sound} col=${c} ` +
                `drawn=[${from},${to.toFixed(4)}] played=[${spans.map(([b, e]) => `${b}-${e}`).join(' ')}]`,
            )
          }
        })
      }
    }
    console.log(`  columns checked by path: ${[...checked].map(([k, v]) => `${k} ${v}`).join(', ')}`)
    for (const b of bad.slice(0, 10)) console.log(`  UNSOUNDED ${b}`)
    expect(bad.slice(0, 8), 'the grid lit a column the pattern was not sounding that voice through').toEqual([])
  })

  it('CONTROL — a reader that draws every note as one full column is caught', () => {
    // The pre-#1056 behaviour, run through the same conservation comparison. If this
    // passes, the gate above cannot distinguish the new drawing from the old one.
    let caught = 0
    for (const u of units) {
      const steps = u.model.steps
      let any = false
      for (const lane of u.model.lanes) {
        const cov = flatCoverage(lane.cells)
        const perNote = new Map<number, number>()
        cov.forEach((cv, c) => {
          if (cv) perNote.set(cv.start, (perNote.get(cv.start) ?? 0) + cv.extent)
        })
        for (const [start, drawn] of perNote) {
          const cell = lane.cells[start]
          if (!isCellOn(cell)) continue
          let next = start + 1
          while (next < lane.cells.length && !isCellOn(lane.cells[next])) next++
          const room = Math.min(next, steps) - start
          const want = Math.max(0, Math.min(cell.duration, room))
          if (Math.abs(drawn - want) > 1e-6) any = true
        }
      }
      if (any) caught++
    }
    console.log(`  degenerate (one-box-per-trigger) reader caught on ${caught} units`)
    expect(caught, 'the old drawing must fail the new gate, or the gate is not testing the change').toBeGreaterThan(0)

    // and on a NAMED unit, so the control cannot pass by accident of aggregation:
    // `bd [sd sd sd]` gives `bd` three of six columns — one box is not that.
    const r = parseStepGrid('bd [sd sd sd]')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const bd = r.model.lanes.find((l) => l.sound === 'bd')!
    const cov = laneCoverage(bd.cells, r.model.steps)
    expect(cov.filter((c) => c !== undefined).length).toBe(3)
    expect(cov[0]).toEqual({ start: 0, extent: 1 })
    expect(cov[1]).toEqual({ start: 0, extent: 1 })
    expect(cov[2]).toEqual({ start: 0, extent: 1 })
    expect(flatCoverage(bd.cells).filter((c) => c !== undefined).length).toBe(1)
  })

  it('the sub-column case draws a PARTIAL column, which is the one thing the roll never needs', () => {
    // The roll's `@n` is integral by construction, so a fractional extent is grid-only —
    // the axis this phase adds that could not be borrowed from the sibling surface.
    //
    // FIXTURE TAKEN FROM THE CORPUS, NOT FROM A COMMENT. The obvious candidate is
    // `[hh ~]!16`, quoted for exactly this property in `cell-duration.test.ts` — but the
    // same comment lists it among the units P4c STOPPED offering a grid view for, so it
    // no longer parses and the assertion would have been vacuous. Resolve a
    // cross-reference against its own source ([[P382]]).
    const r = parseStepGrid('<bd - - -> *2')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const lane = r.model.lanes[0]
    const cov = laneCoverage(lane.cells, r.model.steps)
    expect(cov[0]?.extent).toBeCloseTo(0.5, 9)
    expect(cov[0]?.start).toBe(0)
  })

  it('k = 2 and k = 4 — the drawing is resolution-generic, on the SHIPPED ×2 op', () => {
    // #1056 asks for these arms and they were first reported as blocked on #1055's view
    // multiple. That was one option too many: `scaleStepGrid(model, 'double')` already
    // ships, already doubles both the column count and every cell length, and is exactly
    // the input a k = 2 view would hand the renderer. Measuring at a shipped op is also
    // the only honest way to do it — a figure taken at a constant nothing ships at
    // describes a build that does not exist ([[PK67]]).
    //
    // THE PROPERTY: doubling the resolution must not change what the user sees. Each
    // note draws twice the columns of half the width, so its TOTAL drawn time is
    // invariant in cycles and exactly doubles in columns, and every head lands on twice
    // its old index. A renderer that lit "the note's column" rather than the note's TIME
    // would keep a total of 1 across the doubling and fail here.
    let doubled = 0
    let quadrupled = 0
    let skipped = 0
    const bad: string[] = []

    const drawn = (m: StepGridModel): Map<string, { total: number; heads: number[] }> => {
      const out = new Map<string, { total: number; heads: number[] }>()
      m.lanes.forEach((lane, li) => {
        const cov = laneCoverage(lane.cells, m.steps)
        let total = 0
        const heads: number[] = []
        cov.forEach((cv, c) => {
          if (!cv) return
          total += cv.extent
          if (cv.start === c) heads.push(c)
        })
        out.set(`${li}:${lane.sound}`, { total, heads })
      })
      return out
    }

    for (const u of units) {
      const x1 = u.model
      const x2 = scaleStepGrid(x1, 'double')
      // POPULATION, NAMED: `scaleStepGrid` returns the model unchanged when the writer
      // cannot spell the result, so this arm asks only about grids that really can be
      // viewed at 2× today. Counted rather than filtered away in silence ([[P345]]).
      if (x2 === x1) {
        skipped++
        continue
      }
      doubled++
      const a = drawn(x1)
      const b = drawn(x2)
      for (const [key, one] of a) {
        const two = b.get(key)
        if (!two) {
          bad.push(`${u.mini} ${key} lane vanished at 2x`)
          continue
        }
        if (Math.abs(two.total - one.total * 2) > 1e-6) {
          bad.push(`${u.mini} ${key} total ${one.total} -> ${two.total} (want ${one.total * 2})`)
        }
        const want = one.heads.map((h) => h * 2)
        if (JSON.stringify(two.heads) !== JSON.stringify(want)) {
          bad.push(`${u.mini} ${key} heads ${JSON.stringify(two.heads)} want ${JSON.stringify(want)}`)
        }
      }

      const x4 = scaleStepGrid(x2, 'double')
      if (x4 === x2) continue
      quadrupled++
      const c4 = drawn(x4)
      for (const [key, one] of a) {
        const four = c4.get(key)
        if (!four) continue
        if (Math.abs(four.total - one.total * 4) > 1e-6) {
          bad.push(`${u.mini} ${key} total@4x ${one.total} -> ${four.total}`)
        }
      }
    }
    console.log(`  k=2 on ${doubled} units, k=4 on ${quadrupled}, not viewable at 2x ${skipped}`)
    for (const b of bad.slice(0, 8)) console.log(`  DRIFT ${b}`)
    expect(bad.slice(0, 8), 'the drawn time must be invariant under a resolution change').toEqual([])
    expect(doubled).toBeGreaterThan(0)
    expect(quadrupled).toBeGreaterThan(0)
  })

  it('THE WRITER AGREES — the carried columns are the ones the document spells `_`', () => {
    // THE ARM THAT IS NOT CIRCULAR, and it took two tries to get there. The comparison
    // must reach a source that `laneCoverage` had no hand in, so it reads the SERIALIZED
    // TEXT and takes the `_` positions straight out of it. `_` is the printer's own
    // answer to the same question, computed in its own loop (`sustainTokens`, which
    // builds a `covered[]` array from `Math.round(n.duration)`), and #1056 named exactly
    // this as the point: "the sustain already has a spelling in the writer, so the visual
    // has a document counterpart to stay honest against."
    //
    // THE FIRST VERSION OF THIS ARM WAS A TAUTOLOGY AND IS RECORDED AS ONE. It round-
    // tripped the model and compared the picture before against the picture after — but
    // built BOTH pictures with `laneCoverage`, so breaking the coverage rule broke both
    // sides identically and the arm stayed green while four others went red. A gate whose
    // two sides share the code under test cannot fail ([[P381]]/[[P370]]); it was caught
    // by running the red-test and noticing which arms did NOT fire, which is the only
    // reason it is not still sitting here reading green.
    //
    // SUSTAIN IS A PER-COLUMN FACT, NOT A PER-LANE ONE — and getting that wrong is what
    // made the first population useless. Restricting to single-lane models left 357 units
    // containing ZERO `_` between them, because `bd _ sd ~` is TWO lanes sharing one token
    // sequence: the thing being compared had been defined out of the population, and the
    // arm read green over 357 units of nothing. Measured before being believed.
    //
    // POPULATION, BOUNDED AND NAMED: models whose serialization is one flat token sequence
    // of exactly `steps` tokens — any number of lanes, since a column's token is shared.
    // Excluded are stacked parts and nested groups, which spell a column across several
    // tokens; inferring which token is which column would mean re-implementing the reader,
    // a second oracle and exactly what this arm exists to avoid. Sizes printed, including
    // how many sustains the population actually contains, so a repeat of the vacuous
    // version fails loudly instead of reading green.
    let compared = 0
    let outOfShape = 0
    let declined = 0
    let sustains = 0
    const bad: string[] = []
    for (const u of units) {
      const m = u.model
      const text = serializeStepGrid(m)
      if (text === null) {
        declined++
        continue
      }
      // FLATNESS HAS TO BE CHECKED ON THE SYNTAX, NOT THE TOKEN COUNT. Splitting on
      // whitespace and counting was not enough: `[a4,c#4,e4],[~ f#6 e6]` happens to yield
      // `steps` pieces, and the pieces are fragments like `e6]` rather than columns. Any
      // grouping, stacking or operator character means a column is not one token here.
      const tokens = text.trim().split(/\s+/)
      if (/[[\]{}<>,*!@/]/.test(text) || tokens.length !== m.steps) {
        outOfShape++
        continue
      }
      compared++
      // a column is carried if ANY lane's note is sounding through it
      const covs = m.lanes.map((lane) => laneCoverage(lane.cells, m.steps))
      const spelledSustain = tokens.map((t) => t === '_')
      sustains += spelledSustain.filter(Boolean).length
      for (let c = 0; c < m.steps; c++) {
        const drewCarried = covs.some((cov) => cov[c] !== undefined && cov[c]!.start !== c)
        if (drewCarried !== spelledSustain[c]) {
          bad.push(
            `${JSON.stringify(u.mini).slice(0, 50)} col=${c} drew=${drewCarried ? 'carried' : 'not'} ` +
              `document=${JSON.stringify(tokens[c])}`,
          )
        }
      }
    }
    console.log(
      `  writer agreement: compared ${compared} units (${sustains} sustain tokens), ` +
        `not one flat sequence ${outOfShape}, writer declined ${declined}`,
    )
    for (const b of bad.slice(0, 6)) console.log(`  DISAGREE ${b}`)
    expect(bad.slice(0, 6), 'a column the grid draws as carried must be a column the file spells `_`').toEqual([])
    expect(compared).toBeGreaterThan(0)
    // WHAT THIS ARM CANNOT CATCH, measured rather than left to the reader. The flat
    // population contains ZERO `_`: every carried column in this corpus lives in a mini
    // whose serialization is grouped or stacked, and those are excluded above because a
    // column is not one token in them. So at corpus scale this proves only that the grid
    // never draws a carry the document does not have — the over-draw direction. Failing
    // to draw one it DOES have is the other half, and is covered by the fixture arm
    // below, on minis that actually carry a sustain. Pinned so that if the corpus ever
    // gains flat sustain material this comment stops being true out loud.
    expect(sustains, 'if this is no longer 0, widen the assertion — the arm just got stronger').toBe(0)
  })

  it('THE WRITER AGREES, the other direction — a `_` in the document is a carried column', () => {
    // The half the corpus arm structurally cannot reach. These minis DO carry a sustain,
    // and each is checked against the writer's own spelling of it: the drawn carry set
    // must be exactly the `_` positions in the serialized text. `laneCoverage` is on one
    // side of this comparison only — the other side is `sustainTokens`' independent
    // `covered[]` loop, reached through text.
    const cases: Array<[string, string[]]> = [
      // mini, expected per-lane picture (# head, = carried, - empty)
      ['bd _ sd ~', ['bd:#=--', 'sd:--#-']],
      ['bd _ _ sd', ['bd:#==-', 'sd:---#']],
      ['hh hh bd _', ['hh:##--', 'bd:--#=']],
    ]
    for (const [mini, want] of cases) {
      const r = parseStepGrid(mini)
      expect(r.ok, `${mini} should open a grid`).toBe(true)
      if (!r.ok) continue
      const m = r.model
      const got = m.lanes.map((lane) => {
        const cov = laneCoverage(lane.cells, m.steps)
        return `${lane.sound}:${lane.cells.map((_, c) => (!cov[c] ? '-' : cov[c]!.start === c ? '#' : '=')).join('')}`
      })
      expect(got, `${mini} drawn`).toEqual(want)

      // and the document says the same thing, in its own vocabulary
      const text = serializeStepGrid(m)
      expect(text, `${mini} must round-trip`).not.toBeNull()
      const tokens = text!.trim().split(/\s+/)
      expect(tokens.length).toBe(m.steps)
      const spelled = tokens.map((t) => t === '_')
      for (let c = 0; c < m.steps; c++) {
        const drew = m.lanes.some((lane) => {
          const cov = laneCoverage(lane.cells, m.steps)
          return cov[c] !== undefined && cov[c]!.start !== c
        })
        expect(drew, `${mini} col=${c} — drawn carry vs document ${JSON.stringify(tokens[c])}`).toBe(spelled[c])
      }
    }
  })

  it('THE ROLL — already draws length, so this phase is a no-op there; measured, not assumed', () => {
    // #1056 warns that "a change that buys the grid something and the roll nothing has
    // happened repeatedly here, and the reverse would be more surprising still". This is
    // the reverse case, so it gets a number rather than a reading of the code.
    //
    // The roll's cell is drawn from `noteAt(model, midi, step)`, which covers
    // `start <= step < start + duration` and dims a non-head with `opacity 0.7` — the
    // vocabulary the grid has just adopted. Two things could still make it a non-no-op:
    // a note whose coverage the roll's integer walk gets wrong, or a FRACTIONAL duration
    // it has no way to draw. Both are counted.
    let notes = 0
    let integral = 0
    let invisible = 0 // drawn in NO column at all
    let misdrawn = 0 // drawn, but not for the time it sounds (either way)
    let rolls = 0
    const affected = new Set<string>()
    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      rolls++
      for (const n of r.model.notes) {
        notes++
        // What the roll ACTUALLY lights, asked of the SHIPPED rule rather than a copy of
        // it. The first version of this arm re-implemented the panel's integer predicate
        // inline — a second oracle ([[PV192]]), which happened to agree only because the
        // panel was also wrong. Now both ask `columnOverlap`.
        let lit = 0
        for (let s = 0; s < r.model.steps; s++) {
          const ov = columnOverlap(n.start, n.start + n.duration, s)
          if (ov) lit += ov.extent
        }
        // …against the time the note actually occupies. This side is plain arithmetic on
        // `start`/`duration` and does not go through the rule, so the comparison is a
        // conservation check and not a restatement.
        const want = Math.max(0, Math.min(n.duration, r.model.steps - n.start))
        if (Math.abs(lit - want) < 1e-6) {
          integral++
          continue
        }
        affected.add(mini)
        if (lit === 0) invisible++
        else misdrawn++
      }
    }
    console.log(
      `  ROLL: ${rolls} models, ${notes} notes — exact ${integral}, ` +
        `invisible ${invisible}, misdrawn ${misdrawn}, in ${affected.size} minis`,
    )
    // NO-OP CONFIRMED FOR THE COVERAGE WALK, REFUTED FOR FRACTIONS, AND NOW FIXED (#1074).
    //
    // #1056 predicted this phase would be a no-op on the roll and asked for it to be
    // measured rather than inferred, precisely because "the reverse would be more
    // surprising still". Half the prediction held — the roll already covered
    // `start <= step < start + duration` and already dimmed a non-head, so 4825 of 4842
    // notes needed nothing. The other half did not: `RollNote.duration` is documented as
    // counting whole `@n` steps and the corpus disagreed on 17 notes across 4 minis, all
    // through one mechanism — an INTEGER step tested against the half-open span:
    //   - 7 were drawn in NO column at all. `f4` at start 0.5 for 0.5 spans `[0.5, 1.0)`,
    //     which contains no integer, so the note sounded and was simply not there.
    //   - 10 were drawn for the wrong length in BOTH directions: `[b3,e4,g4]@0.75` got a
    //     whole column for three quarters of one, and `c#2` at 13.5 for 2.5 columns got
    //     two. Not a rounding convention — the absence of a partial column, which is
    //     exactly what the grid gained in #1056.
    // The split was hand-derived as 9/8 and measured at 7/10; the two that moved are long
    // fractional notes, which read as "overdrawn" until the direction is checked.
    //
    // Both surfaces now ask ONE rule, `columnOverlap`, and the roll supplies the `offset`
    // the grid never needs because only a roll note carries a fractional start. The whole
    // population is exact.
    expect(integral + invisible + misdrawn).toBe(notes)
    // ⚠ 4842 -> 5433 at #1242 — the corpus widened 1535 -> 1633 units
    // (98 arrivals, 0 departures): the harvest gained the product's own
    // resolver, so every figure here is over a wider population. Upward only.
    // ⚠ 5433 -> 5505 at #1310 (region-local parallel lanes): `parse.ts` uses the writer
    // as an admissibility oracle, so a writer that can spell more opens one more roll
    // unit — `[-7 2,<4 5 6>]*8` — and it brings its own 72 notes. Population, not
    // drawing: every zero below is unmoved.
    // ⚠ 5505 -> 5527 at #1827: the one roll unit that newly opens per bar,
    // `<[36 48]*2 [34 46]*3 [41 53]*4 [39 51]*2>`, brings its own 22 notes (4+6+8+4).
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    // ⚠ MOVED at #1974 (hits are anchored on their written note, not the first place Strudel lists): two rolls the leaf writer can now anchor open, `<0 0 0 <2 2 2 3>>*<8 [4 16]>` (18 notes) and `<0 4 2>*[<3 2>/32]` (3) — store probes/timing-facts-1974.
    expect(integral).toBe(5560)
    expect(invisible).toBe(0)
    expect(misdrawn).toBe(0)
    expect(affected.size).toBe(0)
  })

  it('THE CLOSED FORMS ARE THE INTERVAL RULE — `headColumn`/`tailColumn` vs `columnOverlap`', () => {
    // #1085. `columnOverlap`'s comment claimed to be "the single place that decides" where
    // a note stops; the roll hand-rolled the same threshold twice as bare `1e-9` literals
    // for the same question, so there were three literals and one rule. They now read one
    // constant — but co-location is not agreement, and the panel calls the CLOSED FORMS
    // (per cell, in the render loop) while every drawing claim in this file is made about
    // the interval rule. This arm is what makes those the same statement.
    //
    // Asked over the note's own natural span rather than the panel's `steps` window, so
    // the claim is about the RULE and not about where the panel stops looking. How many
    // notes reach past that window is reported separately rather than hidden by it.
    let notes = 0
    let checked = 0
    let silent = 0 // no column at all: a sliver shorter than the threshold
    let headBad = 0
    let tailBad = 0
    let pastWindow = 0
    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      for (const n of r.model.notes) {
        notes++
        const end = n.start + n.duration
        const lit: number[] = []
        for (let c = Math.floor(n.start) - 1; c <= Math.ceil(end) + 1; c++) {
          if (columnOverlap(n.start, end, c)) lit.push(c)
        }
        if (lit.length === 0) {
          silent++
          continue
        }
        checked++
        if (headColumn(n) !== lit[0]) headBad++
        if (tailColumn(n) !== lit[lit.length - 1]) tailBad++
        if (tailColumn(n) >= r.model.steps) pastWindow++
      }
    }
    console.log(
      `  CLOSED FORMS: ${notes} notes — checked ${checked}, sub-threshold ${silent}, ` +
        `head mismatches ${headBad}, tail mismatches ${tailBad}, tail past the panel window ${pastWindow}`,
    )
    // The population must be non-empty and must be the whole of it ([[P345]]) — an
    // equivalence asserted over nothing reads green forever.
    // ⚠ 4842 -> 5433 at #1242 — the corpus widened 1535 -> 1633 units
    // (98 arrivals, 0 departures): the harvest gained the product's own
    // resolver, so every figure here is over a wider population. Upward only.
    // ⚠ 5433 -> 5505 at #1310 (region-local parallel lanes): `parse.ts` uses the writer
    // as an admissibility oracle, so a writer that can spell more opens one more roll
    // unit — `[-7 2,<4 5 6>]*8` — and it brings its own 72 notes. Population, not
    // drawing: every zero below is unmoved.
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    expect(notes).toBe(5560) // +22 at #1827, +12 at #1849, +21 at #1974 — see `integral` above
    expect(silent).toBe(0)
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
    // ⚠ 5433 -> 5505 at #1310 (region-local parallel lanes): `parse.ts` uses the writer
    // as an admissibility oracle, so a writer that can spell more opens one more roll
    // unit — `[-7 2,<4 5 6>]*8` — and it brings its own 72 notes. Population, not
    // drawing: every zero below is unmoved.
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    expect(checked).toBe(5560) // +22 at #1827, +12 at #1849, +21 at #1974 — see `integral` above
    expect(headBad).toBe(0)
    expect(tailBad).toBe(0)
  })

  it('EVERY NOTE HAS A COLUMN TO BE DRAWN IN — the count the panel renders with (#1087)', () => {
    // The consequence, asked AS the consequence. Not "is `steps` a whole number?" —
    // `note("c4@0.2 e4@0.2 g4@0.2 b4@0.2 c5@0.2")` sums to `0.9999999999999998`, which
    // passes any integrality tolerance a reasonable person writes and still floors to
    // ZERO columns. So this asks `Array.from` itself, the operation that loses the unit.
    //
    // The first probe written for #1087 asked the integrality question and reported 0
    // corpus hits — a worthless zero, because it would have cleared the very fixture
    // already watched rendering nothing. Hence the CONTROL arm below: a zero is believed
    // only when fixtures known to trip the defect are run through the same probe in the
    // same run.
    const uncovered: string[] = []
    let models = 0
    let fractional = 0
    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      models++
      if (!Number.isInteger(r.model.steps)) fractional++
      const drawn = Array.from({ length: columnCount(r.model) }).length
      for (const n of r.model.notes) {
        if (tailColumn(n) >= drawn) {
          uncovered.push(`${mini} :: note at ${n.start}+${n.duration} needs col ${tailColumn(n)}`)
          break
        }
      }
    }
    // THE CONTROL — the same probe, over hand-written fixtures. It must FLAG the ones
    // that trip the defect and CLEAR the ones whose weights sum to a whole number,
    // measured against the count the panel used to render with (`model.steps`).
    const OLD = (m: { steps: number }): number => Array.from({ length: m.steps }).length
    const trips: string[] = []
    const clears: string[] = []
    for (const mini of [
      'c4@0.2 e4@0.2 g4@0.2 b4@0.2 c5@0.2', // 0.9999999999999998 → drew 0 columns
      'c4@1.5 e4 g4@0.2', // 2.7 → drew 2, third note drawn nowhere
      'c4@0.5 e4', // 1.5 → drew 1, a column short
      'c4@1.5 e4@1.2', // 2.7, and the writer is LIVE on this one
      'c4 e4 g4 b4 c5', // control: no weights
      'c4@2.5 e4@1.5', // control: fractional weights, whole-numbered sum
    ]) {
      const r = parsePianoRoll(mini)
      expect(r.ok, `the roll should open the fixture ${mini}`).toBe(true)
      if (!r.ok) continue
      const short = r.model.notes.some((n) => tailColumn(n) >= OLD(r.model))
      ;(short ? trips : clears).push(mini)
      // …and under the shipped count, none of them is short
      for (const n of r.model.notes) {
        expect(tailColumn(n), `${mini} still loses a note`).toBeLessThan(columnCount(r.model))
      }
    }
    console.log(
      `  COLUMN COVER: ${models} roll models, ${fractional} of fractional length, ` +
        `${uncovered.length} losing a note. CONTROL: ${trips.length} fixtures tripped ` +
        `the old count, ${clears.length} cleared it.`,
    )
    // The corpus zero is REAL, not a dead probe — 4 of the 6 fixtures trip, 2 clear.
    expect(trips.length).toBe(4)
    expect(clears.length).toBe(2)
    // …so the corpus figure means what it says: this notation is reachable by hand and
    // no real Bakery material writes it today. That sets the severity, not the validity.
    // ⚠ 544 -> 596 at #1242 — the corpus widened 1535 -> 1633 units
    // (98 arrivals, 0 departures): the harvest gained the product's own
    // resolver, so every figure here is over a wider population. Upward only.
    // ⚠ 596 -> 597 at #1310 — the one roll unit the widened writer lets the parser open.
    // ⚠ 597 -> 598 at #1827 — the one roll unit that newly opens per bar.
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    // ⚠ MOVED at #1974 (hits are anchored on their written note, not the first place Strudel lists): two rolls the leaf writer can now anchor open, `<0 0 0 <2 2 2 3>>*<8 [4 16]>` (18 notes) and `<0 4 2>*[<3 2>/32]` (3) — store probes/timing-facts-1974.
    expect(models).toBe(603)
    expect(fractional).toBe(0)
    expect(uncovered).toEqual([])
  })

  it('THE VELOCITY LANE — a column splits only where its groups are sequential (#1086)', () => {
    // #1086 was filed as a one-line fix (swap `n.start === col` for a head test). Measured,
    // that gains ZERO slots and only changes which group owns 3 columns in one mini, so it
    // is not what shipped. What ships splits a column into one bar per group where those
    // groups do not overlap in time — which is where a group can be invisible today.
    //
    // ASKED THROUGH THE SHIPPED RULE. `sequentialColumnGroups` is the function the panel
    // renders from; re-stating `length > 1 && sequential` here would be a second oracle
    // that agrees by construction.
    //
    // POPULATION: the lane only renders when the gain is in scope, so that restriction is
    // applied here rather than left implicit in a number that does not mention it.
    let models = 0
    let cols = 0
    let splitCols = 0
    let barsAdded = 0
    let groups = 0
    let represented = 0
    const splitMinis = new Set<string>()
    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      const m = r.model
      if (m.gainForeign || !(m.bars == null || m.bars === m.steps)) continue
      models++
      const starts = [...new Set(m.notes.map((n) => n.start))]
      groups += starts.length
      const owned = new Set<number>()
      for (let col = 0; col < m.steps; col++) {
        cols++
        // the SHIPPED single-bar rule, unchanged by this phase
        const covering =
          m.notes.find((n) => n.start === col) ??
          m.notes.find((n) => n.start < col && col < n.start + n.duration)
        const split = sequentialColumnGroups(m.notes, col)
        if (!split) {
          // an unsplit column must draw exactly what it drew before: the covering group
          if (covering) owned.add(covering.start)
          continue
        }
        splitCols++
        splitMinis.add(mini)
        barsAdded += split.length - 1
        for (const g of split) owned.add(g.start)
      }
      for (const s of starts) if (owned.has(s)) represented++
    }
    console.log(
      `  VELOCITY LANE: ${models} gain-in-scope models, ${cols} columns — split ${splitCols} ` +
        `over ${splitMinis.size} minis, +${barsAdded} bars; groups ${represented}/${groups} represented`,
    )
    // The population, pinned so the figures below cannot be read over a shrinking corpus.
    // ⚠ 424 -> 464 at #1242 — the corpus widened 1535 -> 1633 units
    // (98 arrivals, 0 departures): the harvest gained the product's own
    // resolver, so every figure here is over a wider population. Upward only.
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    // ⚠ MOVED at #1974: one of the two rolls it newly opens (`<0 4 2>*[<3 2>/32]`, one bar) is in this scope.
    expect(models).toBe(468)
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    // ⚠ MOVED at #1974: the three columns of `<0 4 2>*[<3 2>/32]`, the one-bar roll that newly opens.
    expect(cols).toBe(4492)
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
    // THE REACH. Before this, 2503 of 2508 groups owned a bar; the 5 that did not all
    // began mid-column and all sat in a column another group headed. Every one is now
    // drawn — measured 5/5, which is why this phase is worth its 8 columns.
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
    // Folded so both report in one run, and so the EQUALITY between them is the
    // thing on the page: every group the wider corpus adds owns a bar too, which
    // is the reach claim holding over material it was not measured on.
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    // ⚠ MOVED at #1974: the three one-note columns of `<0 4 2>*[<3 2>/32]`.
    expect([groups, represented]).toEqual([2761, 2761])
    // THE BOUND. Only the sequential columns split; the 129 polyphonic ones are #1088.
    //
    // THREE minis, not two — and the difference is the point rather than a typo. TWO minis
    // hold a group that had no bar at all; THREE hold a column that splits. The third has
    // a sequential column whose groups were both already represented elsewhere, so it
    // gains legibility and no reach. Quoting the reach population for the split count is
    // exactly the substitution that has to be watched here.
    expect(splitCols).toBe(8)
    expect(splitMinis.size).toBe(3)
  })

  it('THE VELOCITY LANE — a drag is offered only where the writer accepts it (#1089)', () => {
    // Prove-before-offer, on the lane. `gainInScope` answers whether the lane should
    // RENDER; the panel was using it for whether a drag could WRITE, and the two had
    // drifted apart. This arm asks the shipped predicate — `serializeRollGain(model)`,
    // the real writer — and reports the population it takes the gesture away from, so
    // "we gated it" cannot be read without knowing how much it gates.
    //
    // Asked of the CURRENT model, and the arm below is what licenses that: a gain edit
    // does not move a note, so the writer's answer is the same before and after one.
    let inScope = 0
    let skips = 0
    let writable = 0
    let inertCols = 0
    let liveCols = 0
    let predicateDiffers = 0
    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      const m = r.model
      if (m.gainForeign || !(m.bars == null || m.bars === m.steps)) continue
      inScope++
      const declines = serializeRollGain(m).kind === 'skip'
      declines ? skips++ : writable++
      for (let col = 0; col < columnCount(m); col++) {
        const covering =
          m.notes.find((n) => n.start === col) ??
          m.notes.find((n) => n.start < col && col < n.start + n.duration)
        if (!covering) continue
        declines ? inertCols++ : liveCols++
        // the same question asked of the model the drag would actually produce
        const after = setGroupGain(m, covering.start, 0.5)
        if ((serializeRollGain(after).kind === 'skip') !== declines) predicateDiffers++
      }
    }
    console.log(
      `  VELOCITY WRITABILITY: ${inScope} in-scope models — ${writable} the writer accepts, ` +
        `${skips} it declines. Columns with a note: ${liveCols} keep the drag, ` +
        `${inertCols} lose an affordance that never worked. ` +
        `Predicate differs after a drag: ${predicateDiffers}.`,
    )
    // ⚠ 424 -> 464 at #1242 — the corpus widened 1535 -> 1633 units
    // (98 arrivals, 0 departures): the harvest gained the product's own
    // resolver, so every figure here is over a wider population. Upward only.
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    // ⚠ MOVED at #1974 with `models` above: the same one-bar roll.
    expect(inScope).toBe(468)
    // THE REACH, and it is the point of the fix: 305 columns across 33 patterns offered a
    // `ns-resize` cursor and a pointer handler for a write that was always declined.
    // ⚠ 33 -> 30 at #1849: FEWER declined — three rolls that were leaf-read (the gain writer declined them) now open on the core, whose gain it writes.
    // ⚠ 30 -> 31 at #1974: that same roll is leaf-read, and the gain writer declines a leaf-read roll — so its drag is not offered.
    expect(skips).toBe(31)
    // ⚠ 305 -> 313 at #1849: the declined set changes members (three rolls leave it for the core,
    // the rolls it opens bring their own columns) — each one a drag correctly WITHHELD.
    // ⚠ 313 -> 316 at #1974: that roll's three columns — leaf-read, so its drag is declined and not offered.
    expect(inertCols).toBe(316)
    // …and the population it must NOT touch — every column whose drag really writes.
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
    // ⚠ 431 -> 437 at #1849: +3 in scope and three fewer declined — six more rolls whose velocity drag writes.
    expect(writable).toBe(437)
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633 units, 98 arrivals / 0 departures).
    // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
    expect(liveCols).toBe(3445)
    // THE LICENCE for asking the current model instead of the post-drag one.
    expect(predicateDiffers).toBe(0)
  })

  it('THE VELOCITY LANE — a split is additive: no bar dropped, no two bars overlapping', () => {
    // Its own test, because an assertion that runs after a failing one is not evidence.
    // Folded into the arm above, these two never executed under the red-test that would
    // have exercised them: the split-count assertion failed first and took the run with
    // it, so they were carried as claims nobody had shown could fire.
    let overlapping = 0 // two bars in one column colliding — the reason #1088 is deferred
    let dropped = 0 // a split that loses the group the column already showed
    let checked = 0
    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      const m = r.model
      if (m.gainForeign || !(m.bars == null || m.bars === m.steps)) continue
      for (let col = 0; col < m.steps; col++) {
        const split = sequentialColumnGroups(m.notes, col)
        if (!split) continue
        checked++
        const covering =
          m.notes.find((n) => n.start === col) ??
          m.notes.find((n) => n.start < col && col < n.start + n.duration)
        if (covering && !split.some((g) => g.start === covering.start)) dropped++
        const sorted = [...split].sort((a, b) => a.offset - b.offset)
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i].offset < sorted[i - 1].offset + sorted[i - 1].extent - 1e-9) overlapping++
        }
      }
    }
    console.log(`  VELOCITY LANE SAFETY: ${checked} split columns — overlapping ${overlapping}, dropped ${dropped}`)
    // The population must be non-empty or both zeros below are vacuous.
    expect(checked).toBeGreaterThan(0)
    expect(overlapping).toBe(0)
    expect(dropped).toBe(0)
  })

  it('THE VELOCITY LANE — what the split is NOT yet: a visible difference (recorded bound)', () => {
    // The uncomfortable half of this phase, written down so that "8 columns split" is
    // never read as "8 columns look different". Two bars of EQUAL height and colour laid
    // side by side are indistinguishable from the one full-width bar they replace — so a
    // split is perceptible exactly when its groups differ in gain, and corpus-wide they
    // never do. The panel now draws the distinction; the material has no distinction to
    // draw yet. That is the same trap the note-length work hit ([[PV245]]): a model can
    // carry an axis, and the geometry can render it, and the user can still see nothing.
    //
    // Shipping it anyway is deliberate. Before the split, a group beginning mid-column had
    // no bar and the column showed its NEIGHBOUR's gain — so setting that group's velocity
    // was not merely invisible, it was misreported. The split is what makes the difference
    // showable the moment there is one.
    //
    // THIS IS A RECORDED BOUND, NOT A DESIRED PROPERTY. If `differing` ever goes above
    // zero that is an improvement, and the number below should be re-argued and updated
    // deliberately rather than silently bumped.
    let split = 0
    let differing = 0
    let inWritablePattern = 0
    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      const m = r.model
      if (m.gainForeign || !(m.bars == null || m.bars === m.steps)) continue
      const writable = serializeRollGain(m).kind !== 'skip'
      for (let col = 0; col < m.steps; col++) {
        const groups = sequentialColumnGroups(m.notes, col)
        if (!groups) continue
        split++
        if (writable) inWritablePattern++
        const gains = groups.map((g) => m.notes.find((n) => n.start === g.start)?.gain ?? 1)
        if (new Set(gains).size > 1) differing++
      }
    }
    console.log(
      `  VELOCITY LANE PERCEPTIBILITY: ${split} split columns — groups differing in gain ` +
        `${differing}, in a pattern whose gain is writable ${inWritablePattern}`,
    )
    expect(split).toBe(8)
    // Not one split column currently shows a difference…
    expect(differing).toBe(0)
    // …and only 3 of the 8 sit in a pattern where the user could create one at all. The
    // other 5 are blocked by the gain writer skipping fractional-start patterns (#1089),
    // which is why the split bars are drawn without a drag affordance.
    expect(inWritablePattern).toBe(3)
  })

  it('a note that fills its column exactly does not claim the next one (float slivers)', () => {
    // The defect this file caught before it shipped. `1.0000000000000004` is what "one
    // column" arrives as after Fraction→float, and the first draft carried it into the
    // next column at an extent of 4e-16 — an invisible bar in a column the pattern never
    // sounds through, on real corpus material.
    const sliver: StepCell[] = [{ duration: 1.0000000000000004 }, false, false, false]
    const cov = laneCoverage(sliver, 4)
    expect(cov[0]).toEqual({ start: 0, extent: 1 })
    expect(cov[1], 'a 4e-16 remainder is not a column').toBeUndefined()

    // and the threshold is nowhere near a REAL sub-column value — the smallest the
    // corpus carries is 0.5, nine orders of magnitude away.
    const real = laneCoverage([{ duration: 1.5 }, false], 2)
    expect(real[1]?.extent).toBeCloseTo(0.5, 9)
  })
})
