/**
 * resolution-axes.test.ts — THE INSTRUMENT for the resolution-model change (#1054,
 * Phase 1 of #1052). It changes no behaviour. Its whole job is to be able to tell
 * apart two worlds that today's gates cannot.
 *
 * ── WHY AN INSTRUMENT COMES FIRST ─────────────────────────────────────────────
 * Clicking a finer "Slots" target currently changes TWO things at once: the document
 * is re-spelled, and the grid redraws. After Phase 4 (#1057) it must change only the
 * second. A gate that cannot separate those two passes identically in both worlds and
 * therefore certifies nothing — which is the failure this boundary has produced more
 * than once (`can<Op>` predicting the writer, [[PV192]]; each op's A/B comparing an op
 * to ITSELF, [[PK64]]).
 *
 * So this records THREE INDEPENDENT BITS per (surface, unit, preset), and the point of
 * the design is that each comes from a DIFFERENT AUTHORITY:
 *
 *   document?  the WRITER   — `serialize(next)` byte-compared to the source we read
 *   layout?    the READER   — the column structure of the model the panel draws
 *   haps?      the ENGINE   — `queryArc` over the two SOURCE STRINGS
 *
 * Today a lossless refine reads (document ✓, layout ✓, haps ✗).
 * After Phase 4 the same click must read (document ✗, layout ✓, haps ✗).
 *
 * ── THE BIT MOST LIKELY TO BE VACUOUS, AND WHAT STOPS IT ──────────────────────
 * #1054 names it: if the haps bit is computed from the MODEL it silently restates the
 * layout bit under another name, after which the two move together forever and neither
 * can fail alone. `hapsChanged` therefore takes two `string`s and nothing else — there
 * is no model in scope for it to read, so the vacuous version cannot be written by
 * accident. Its independence is then PROVEN rather than argued, by the third control
 * arm below: a source edit that changes what the engine plays while leaving the model's
 * columns identical must move `haps` and NOT `layout`.
 *
 * ── FOUR THINGS THIS RECORDS THAT A SIMPLER SWEEP WOULD AVERAGE AWAY ──────────
 * 1. WHICH REFINE PATH a preset takes. `scaleStepGridTo` preserves note length and
 *    `quantizeStepGridTo` resets it (#1049, and the mechanism found in #1061). Folding
 *    them together makes a moved bit unattributable, so the path is part of the key.
 * 2. A REFUSAL IS ITS OWN OUTCOME. Refine past the cap, or a target that is not a
 *    power-of-2 ratio, returns the model unchanged. Recorded as "nothing changed" that
 *    is indistinguishable from a no-op, and Phase 4's diff becomes unreadable.
 * 3. THE COARSENING EXCLUSION IS COUNTED. #1052 scopes this work to refine only. An
 *    exclusion that is not counted reads afterwards as "we swept everything".
 * 4. BOTH SURFACES SEPARATELY, per #1052's standing rule for every phase.
 *
 * POPULATION: every distinct `mini-corpus.json` unit that opens the surface. Asserted
 * in the assertion itself rather than described in a comment, because a figure in a
 * comment has no gate and drifts ([[P343]] — a denominator that shrinks turns a gate
 * green over less material).
 * SAMPLING DEPTH for the engine: the model's OWN window, `bars` cycles — the same rule
 * `cell-duration.test.ts` states, and for the same reason.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import {
  serializeStepGrid,
  serializePianoRoll,
} from '../../../editor/src/codeView/notation/serialize'
import {
  RESOLUTION_PRESETS,
  scaleStepGridTo,
  scalePianoRollTo,
  quantizeStepGridTo,
  quantizePianoRollTo,
} from '../../../editor/src/codeView/notation/resolution'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import type {
  PianoRollModel,
  StepGridModel,
} from '../../../editor/src/codeView/notation/model'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

/* ── the three readings ─────────────────────────────────────────────────────── */

/**
 * THE ENGINE'S ANSWER. Deliberately takes only source strings: see the header — a
 * model in scope here is how this bit becomes a restatement of `layout`.
 * `bars` is the model's own window, passed in rather than guessed.
 */
function hapsOf(src: string, bars: number): string | null {
  let pat: unknown
  try {
    pat = reifyMini(src)
  } catch {
    return null
  }
  const out: string[] = []
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
      const token =
        typeof v === 'string'
          ? v
          : Array.isArray(v)
            ? v.join(':')
            : typeof v === 'number'
              ? String(v)
              : null
      if (token === null) continue
      const b = h.whole.begin.valueOf()
      const e = h.whole.end.valueOf()
      // rounded so a Fraction→float tail (0.999…8 for a full column) is not a difference
      out.push(`${token}@${b.toFixed(9)}+${(e - b).toFixed(9)}`)
    }
  }
  return out.sort().join('|')
}

/** did the ENGINE's output change? null when either side will not evaluate. */
function hapsChanged(before: string, after: string, bars: number): boolean | null {
  const a = hapsOf(before, bars)
  const b = hapsOf(after, bars)
  if (a === null || b === null) return null
  return a !== b
}

/** THE READER'S ANSWER for the grid: the columns the panel draws, and what sits in them. */
function gridLayout(m: StepGridModel): string {
  return [
    `steps=${m.steps}`,
    `bars=${m.bars ?? 1}`,
    ...m.lanes.map(
      (lane) =>
        `${lane.sound}#${lane.part ?? 0}:` +
        lane.cells.map((c) => (isCellOn(c) ? c.duration : '.')).join(','),
    ),
  ].join(' ')
}

/** THE READER'S ANSWER for the roll. */
function rollLayout(m: PianoRollModel): string {
  return [
    `steps=${m.steps}`,
    `bars=${m.bars ?? 1}`,
    ...[...m.notes]
      .map((n) => `${n.pitch}@${n.start}+${n.duration}`)
      .sort(),
  ].join(' ')
}

/* ── the sweep ──────────────────────────────────────────────────────────────── */

type Path = 'lossless' | 'quantize'

/** what happened for one (unit, preset, path) ask */
type Outcome =
  /** the op is identity here — the control offers nothing */
  | 'no-offer'
  /** the op applied, but the writer cannot spell the result */
  | 'unwritable'
  /** the op applied, the writer spelled it, and all three bits were read */
  | 'measured'

interface SurfaceReport {
  units: number
  asks: number
  coarsenSkipped: number
  byOutcome: Record<Outcome, number>
  /** `${path} (document,layout,haps)` → count, over `measured` asks only */
  triples: Record<string, number>
  hapsUnevaluable: number
}

interface Surface<M> {
  label: string
  parse: (mini: string) => { ok: boolean; model?: M }
  write: (m: M) => string | null
  layout: (m: M) => string
  lossless: (m: M, target: number) => M
  quantize: (m: M, target: number) => M
  steps: (m: M) => number
  bars: (m: M) => number
}

const GRID: Surface<StepGridModel> = {
  label: 'step grid',
  parse: parseStepGrid,
  write: serializeStepGrid,
  layout: gridLayout,
  lossless: scaleStepGridTo,
  quantize: quantizeStepGridTo,
  steps: (m) => m.steps,
  bars: (m) => Math.max(1, m.bars ?? 1),
}

const ROLL: Surface<PianoRollModel> = {
  label: 'piano roll',
  parse: parsePianoRoll,
  write: serializePianoRoll,
  layout: rollLayout,
  lossless: scalePianoRollTo,
  quantize: quantizePianoRollTo,
  steps: (m) => m.steps,
  bars: (m) => Math.max(1, m.bars ?? 1),
}

/**
 * `mutate` lets a control arm perturb one authority without touching the others —
 * which is how each bit is shown to be able to move ALONE.
 */
interface Breaks<M> {
  /** takes the source the model was read from, so an arm can echo it back */
  write?: (m: M, mini: string) => string | null
  layout?: (m: M) => string
  /** rewrite the AFTER source only, to move the engine without moving the model */
  afterSource?: (src: string) => string
}

function sweep<M>(s: Surface<M>, breaks: Breaks<M> = {}): SurfaceReport {
  const write = breaks.write ?? ((m: M) => s.write(m))
  const layout = breaks.layout ?? s.layout
  const rep: SurfaceReport = {
    units: 0,
    asks: 0,
    coarsenSkipped: 0,
    byOutcome: { 'no-offer': 0, unwritable: 0, measured: 0 },
    triples: {},
    hapsUnevaluable: 0,
  }

  for (const mini of minis) {
    const r = s.parse(mini)
    if (!r.ok || !r.model) continue
    const model = r.model
    rep.units++
    const before = layout(model)
    const bars = s.bars(model)

    for (const target of RESOLUTION_PRESETS) {
      // SCOPE: refine only. #1052 leaves coarsening untouched on both surfaces, and the
      // count is reported so this exclusion can never read as full coverage later.
      if (target <= s.steps(model)) {
        rep.coarsenSkipped++
        continue
      }
      for (const p of ['lossless', 'quantize'] as Path[]) {
        rep.asks++
        const next = p === 'lossless' ? s.lossless(model, target) : s.quantize(model, target)
        if (next === model) {
          rep.byOutcome['no-offer']++
          continue
        }
        const after = write(next, mini)
        if (after === null) {
          rep.byOutcome.unwritable++
          continue
        }
        const documentBit = after !== mini
        const layoutBit = layout(next) !== before
        const hapsBit = hapsChanged(mini, breaks.afterSource ? breaks.afterSource(after) : after, bars)
        if (hapsBit === null) {
          rep.hapsUnevaluable++
          continue
        }
        rep.byOutcome.measured++
        const key = `${p} (${documentBit ? 'doc' : '---'},${layoutBit ? 'layout' : '------'},${hapsBit ? 'haps' : '----'})`
        rep.triples[key] = (rep.triples[key] ?? 0) + 1
      }
    }
  }
  return rep
}

function print(rep: SurfaceReport, label: string): void {
  console.log(
    [
      `\n===== RESOLUTION AXES: ${label} =====`,
      `  units opening this surface        ${rep.units}`,
      `  refine asks (preset × path)       ${rep.asks}`,
      `  coarsen asks SKIPPED (scope)      ${rep.coarsenSkipped}`,
      `  no-offer                          ${rep.byOutcome['no-offer']}`,
      `  unwritable                        ${rep.byOutcome.unwritable}`,
      `  measured                          ${rep.byOutcome.measured}`,
      `  haps unevaluable                  ${rep.hapsUnevaluable}`,
      `  triples (over measured asks):`,
      ...Object.entries(rep.triples)
        .sort()
        .map(([k, v]) => `     ${k.padEnd(38)} ${v}`),
    ].join('\n'),
  )
}

/* ── today's answers, pinned ────────────────────────────────────────────────── */

describe('#1054 — document, layout and haps are three separate readings', () => {
  const grid = sweep(GRID)
  const roll = sweep(ROLL)

  it('step grid: the refine axes, pinned', () => {
    print(grid, 'step grid')
    // POPULATION AND OUTCOMES, pinned as literals rather than described — #1054 asks for
    // the axes to live in the assertion, because a figure in a comment has no gate.
    expect({
      units: grid.units,
      asks: grid.asks,
      coarsenSkipped: grid.coarsenSkipped,
      ...grid.byOutcome,
      hapsUnevaluable: grid.hapsUnevaluable,
    // ⚠ MOVED at #1242 — the corpus widened 1535 -> 1633 units (98 arrivals, 0
    // departures). `unwritable` and `hapsUnevaluable` stay at ZERO, which is the
    // half that matters: 248 new asks, none of them unwritable.
    // ⚠ MOVED at #1827 (each bar drawn at its own step count): +1 unit
    // (`<~ ~ bd*3 bd*4 …>` now opens), +6 asks, +2 coarsen skips, +6 no-offer. `measured`
    // is UNMOVED and `unwritable` / `hapsUnevaluable` stay ZERO — a multi-bar grid is
    // never offered a refine, so everything it brings is `no-offer`.
    // ⚠ MOVED at #1849: +3 units (the grids it opens), +16 asks, 13 `no-offer` become
    // `measured` — `unwritable` and `hapsUnevaluable` stay ZERO.
    }).toEqual({
      // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
      units: 1018,
      asks: 7614,
      coarsenSkipped: 1283,
      // ⚠ no-offer 1064 -> 1074 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
      'no-offer': 1074,
      unwritable: 0,
      // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
      // ⚠ measured 6550 -> 6540 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
      measured: 6540,
      hapsUnevaluable: 0,
    })
    // TODAY'S ANSWER. Every grid refine that reaches the writer rewrites the document —
    // there is no `---` key here. Phase 4 (#1057) turns the `doc` half of all four keys
    // into `---` while leaving the `layout` and haps halves exactly as they stand.
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633). All four keys rise and NO NEW KEY
    // appears — the widening added asks to the axes that already existed rather
    // than reaching a combination the taxonomy had never seen.
    expect(grid.triples).toEqual({
      // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
      // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
      // ⚠ 2869 -> 2864 at #1974 (a hit is anchored on the note that wrote it): the grids `[c eb g <f bb>](3,8,<0 1>)` and `{c [f g] d# d}%2` go element -> leaf writer, and a leaf-written view is offered no finer — store probes/timing-facts-1974/anchor-move.
      'lossless (doc,layout,----)': 2864,
      'lossless (doc,layout,haps)': 230,
      // ⚠ MOVED at #1849's `<…>` half (a whole-`<…>` `,`-part reads with its own bars and the shorter parts repeat: 2 grids leave the leaf reading, 1 opens that was refused).
      // ⚠ 109 -> 104 at #1974 (a hit is anchored on the note that wrote it): the grids `[c eb g <f bb>](3,8,<0 1>)` and `{c [f g] d# d}%2` go element -> leaf writer, and a leaf-written view is offered no finer — store probes/timing-facts-1974/anchor-move.
      'quantize (doc,layout,----)': 104,
      'quantize (doc,layout,haps)': 3342,
    })
  })

  it('piano roll: the refine axes, pinned — and 83 asks are ALREADY document-neutral', () => {
    print(roll, 'piano roll')
    expect({
      units: roll.units,
      asks: roll.asks,
      coarsenSkipped: roll.coarsenSkipped,
      ...roll.byOutcome,
      hapsUnevaluable: roll.hapsUnevaluable,
    // ⚠ MOVED at #1242 (corpus 1535 -> 1633); `unwritable` stays ZERO across +304 asks.
    // ⚠ MOVED at #1310 (region-local parallel lanes): one more roll unit opens because
    // `parse.ts` asks the writer whether a view is safe, so a wider writer admits one
    // more document — +1 unit, +2 asks, +4 coarsen skips, +2 no-offer. `unwritable`
    // stays ZERO, which is the arm that matters: the widening added asks, not failures.
    // ⚠ MOVED at #1827 (each bar drawn at its own step count): +1 unit
    // (`<[36 48]*2 [34 46]*3 [41 53]*4 [39 51]*2>` now opens), +10 asks, all `no-offer`
    // (819 below) — `measured` UNMOVED at 2961, `unwritable` still ZERO.
    // ⚠ MOVED at #1849: +3 units, +20 asks, and 107 `no-offer` become `measured` — the rolls
    // it moves off the leaf reading can now be refined. `unwritable` stays ZERO.
    }).toEqual({
      // ⚠ units 601 -> 603 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
      units: 603,
      // ⚠ asks 3800 -> 3812 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
      asks: 3812,
      // ⚠ coarsenSkipped 1105 -> 1109 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
      coarsenSkipped: 1109,
      // ⚠ MOVED at #1312 (per-bar lanes + the region ladder): six asks move from `no-offer`
      // to `measured`, 815 -> 809 and 2955 -> 2961. They are the same six — the writer now
      // has an answer where it previously had none — so `units` and `asks` do not move at
      // all. `unwritable` stays ZERO, which is the arm that matters: the widening turned
      // silence into measurements, not into failures.
      // ⚠ no-offer 712 -> 724 at #1974 (a hit is anchored on the note that wrote it): two rolls open on the leaf writer, two grids go element -> leaf, sixteen open views gain a byte-local write — store probes/timing-facts-1974/anchor-move.
      'no-offer': 724,
      unwritable: 0,
      measured: 3088,
      hapsUnevaluable: 0,
    })
    // A FINDING, not a prediction — this key was written expecting `[]` and the corpus
    // refused it. `lossless (---,layout,----)` is Phase 4's TARGET READING, and 83 roll
    // asks already produce it today.
    //
    // They are multi-bar `<…>` alternations: `<0 2 5 3>` refined to 8/16/32/64 changes
    // `model.steps` — so the layout grows — while the writer's span surgery re-emits the
    // identical bytes, because the alternation's spelling does not depend on the column
    // count. The engine is untouched, so the whole gesture is already view-only.
    //
    // Worth carrying into #1057: on this population the refine is also NOT PERSISTED —
    // re-reading the document gives the original column count back. Today that reads as
    // a control that works and then forgets; after Phase 4 it is simply correct. So the
    // roll needs less work than the grid here, and these 83 are the units where the two
    // worlds are already indistinguishable — which makes them a poor place to look for
    // Phase 4 regressions, and a good place to look for what the target feels like.
    // ⚠ MOVED at #1312, and it is the SAME SIX ASKS the arm above records leaving
    // `no-offer` for `measured` — they land 3 in `lossless (doc,layout,----)` and 3 in
    // `quantize (doc,layout,haps)`, which is what makes these two arms one fact rather
    // than two coincidences. The two triples that carry no document reading are unmoved,
    // as they must be: this widening changed what the WRITER can say, so only asks with a
    // document axis could move at all.
    expect(roll.triples).toEqual({
      'lossless (---,layout,----)': 92,
      // ⚠ MOVED at #1849 (a `,`-part the flat reading refused is now read as it is alone: 4 grids + 18 rolls leave the leaf reading, 3 + 3 open that were refused).
      'lossless (doc,layout,----)': 1230,
      'lossless (doc,layout,haps)': 92,
      'quantize (doc,layout,----)': 5,
      'quantize (doc,layout,haps)': 1669,
    })
  })

  it('a lossless refine is audibly silent — it moves the document and the layout, never the haps', () => {
    // The canonical case from #1052: `bd ~ sn ~` asked for 16 slots. The user sees a
    // finer grid; the engine must play exactly what it played before.
    const r = parseStepGrid('bd ~ sn ~')
    // narrow on the `ok` discriminant rather than casting — `ParseResult` carries no
    // `model` on the refusal arm, and a cast here type-checks while hiding that
    if (!r.ok) throw new Error('the canonical unit must open a step grid')
    const model = r.model
    const next = scaleStepGridTo(model, 16)
    expect(next, 'the canonical unit must actually refine to 16').not.toBe(model)
    const after = serializeStepGrid(next)
    expect(after).not.toBeNull()
    expect(after, 'today a refine RE-SPELLS the document — this is the line Phase 4 deletes').not.toBe(
      'bd ~ sn ~',
    )
    expect(gridLayout(next), 'a refine must change what is drawn').not.toBe(gridLayout(model))
    expect(
      hapsChanged('bd ~ sn ~', after as string, 1),
      'a lossless refine must not change one note the engine plays',
    ).toBe(false)
  })

  /* ── each bit proven able to move ALONE ──────────────────────────────────── */

  it('CONTROL: the DOCUMENT bit can go red on its own', () => {
    // A writer that echoes back the source it was read from. The document bit must
    // collapse to zero while the layout bit is untouched — if `doc` were being inferred
    // from the layout, this arm could not move one without the other.
    //
    // NOTE the first version of this arm returned one FIXED string, which does not
    // collapse the bit — it pins it TRUE for every unit that is not that string, and it
    // reported 6268. A break must produce the value the bit is supposed to read as
    // "unchanged", not merely a different value ([[P353]] — an arm that cannot reach the
    // zero it asserts is not a control).
    const broken = sweep(GRID, { write: (_m, mini) => mini })
    const docMoved = Object.entries(broken.triples)
      .filter(([k]) => k.includes('doc,'))
      .reduce((a, [, v]) => a + v, 0)
    const layoutMoved = Object.entries(broken.triples)
      .filter(([k]) => k.includes(',layout,'))
      .reduce((a, [, v]) => a + v, 0)
    expect(broken.byOutcome.measured, 'the broken arm must still measure something').toBeGreaterThan(0)
    expect(docMoved, 'a writer that echoes one fixed string cannot be reported as rewriting').toBe(0)
    expect(layoutMoved, 'and the layout bit must be unaffected by the writer').toBeGreaterThan(0)
  })

  it('CONTROL: the LAYOUT bit can go red on its own', () => {
    // A reader whose column structure never changes. The layout bit must collapse while
    // the document bit keeps moving.
    const broken = sweep(GRID, { layout: () => 'CONSTANT' })
    const layoutMoved = Object.entries(broken.triples)
      .filter(([k]) => k.includes(',layout,'))
      .reduce((a, [, v]) => a + v, 0)
    const docMoved = Object.entries(broken.triples)
      .filter(([k]) => k.includes('doc,'))
      .reduce((a, [, v]) => a + v, 0)
    expect(broken.byOutcome.measured, 'the broken arm must still measure something').toBeGreaterThan(0)
    expect(layoutMoved, 'a constant layout cannot be reported as changing').toBe(0)
    expect(docMoved, 'and the document bit must be unaffected by the reader').toBeGreaterThan(0)
  })

  it('CONTROL: the HAPS bit moves when the ENGINE changes and the MODEL does not', () => {
    // THE ARM #1054 ASKS FOR BY NAME, and the reason the haps bit is not the layout bit
    // wearing a different hat. The perturbation is applied to the AFTER SOURCE only; the
    // model is never re-read from it, so the layout reading is byte-identical to the
    // unbroken sweep while the engine plays something else.
    //
    // THE PERTURBATION HAD TO BE CHOSEN, NOT GUESSED. The first version wrapped the
    // source as `[src]*2`, and 60 non-silent asks did not move — all of them multi-bar
    // `<…>` alternations, where refining `< a b c d >` to 8 yields `< a _ b _ c _ d _ >`
    // and the `*2` EXACTLY UNDOES the refinement. A perturbation that is the inverse of
    // the operation under test proves nothing about independence.
    //
    // A stack cannot have that problem: it leaves every original hap where it was and
    // adds seven more, so the reading is longer than the original by construction and
    // differs for silent and sounding units alike. No resolution change can cancel it.
    const base = sweep(GRID)
    const broken = sweep(GRID, { afterSource: (src) => `[${src}, bd*7]` })

    const hapsSilent = (r: SurfaceReport): number =>
      Object.entries(r.triples)
        .filter(([k]) => k.includes(',----)'))
        .reduce((a, [, v]) => a + v, 0)

    expect(base.byOutcome.measured, 'the base arm must measure something').toBeGreaterThan(200)
    expect(
      hapsSilent(base),
      'today a lossless refine is audibly silent on many units — that is the whole premise',
    ).toBeGreaterThan(0)
    // ZERO, with no residue to excuse. Because the perturbation only ever ADDS haps, a
    // rest-only unit moves too — so there is no degenerate class to carve out, and a
    // weaker `toBeLessThan` cannot hide a real unit that failed to move.
    expect(
      hapsSilent(broken),
      'adding seven onsets to every after-source must leave no ask reading haps-unchanged',
    ).toBe(0)

    // …and the layout reading must be IDENTICAL across the two arms. If the haps bit were
    // derived from the model, perturbing the engine alone could not leave this untouched.
    const layoutOf = (r: SurfaceReport): number =>
      Object.entries(r.triples)
        .filter(([k]) => k.includes(',layout,'))
        .reduce((a, [, v]) => a + v, 0)
    expect(
      layoutOf(broken),
      'the engine perturbation must not disturb the layout reading — that is what independence MEANS',
    ).toBe(layoutOf(base))
  })
})
