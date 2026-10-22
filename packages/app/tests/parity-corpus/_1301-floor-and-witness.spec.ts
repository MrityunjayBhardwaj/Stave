/**
 * _1301-floor-and-witness.spec.ts — THROWAWAY INSTRUMENT. Of the bytes the shipped
 * writer moves, how many did the ASK force and how many are slack?
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1301-floor-and-witness.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * THE QUESTION (#1300's last open item). The shipped subdivide+place moves p50 0.298
 * of a document >= 40 chars where a delete answered by byte surgery moves 0.036 — about
 * 8x. Every figure in that comparison is measured against NOTHING, so it cannot tell
 * "the notation forced this" from "the writer was lazy". A subdivide genuinely has to
 * spell a group where a delete only has to overwrite one atom, so part of that gap is
 * the ask and not the answer, and no instrument so far can say which part.
 *
 * THE MOVE: never measure a cost against nothing. Two bounds beside every cost, on the
 * same unit, for the same ask.
 *
 *   FLOOR    the bytes of the SOURCE that denote the thing being edited. A correct
 *            answer has to disturb those; it does not have to disturb anything else.
 *            Two nested floors, because they answer different questions:
 *              LEAF   the edited note's own atom span (`LeafAnchor.span`)
 *              REGION the top-level element containing the edited column
 *                     (`SourceRegion.raw`, minus its padding)
 *            LEAF is inside REGION by construction, and C5 checks exactly that.
 *            ⚠ THE NOTE A SUBDIVIDE CREATES HAS NO BYTES, so it has no LEAF of its own
 *            — which is why REGION is the floor that travels across both gestures. But
 *            the ATOM WHOSE SLOT IT SPLITS does have one, and that is a second, tighter
 *            floor for the same ask: placing into the back half of `g3` need only
 *            re-spell `g3` as `[g3 x]`. Both are reported, and they answer different
 *            questions — REGION asks did the writer stay inside the element it had to
 *            touch, ATOM asks did it stay inside the note.
 *
 *   WITNESS  ANOTHER CORRECT ANSWER to the same ask, produced by a different writer.
 *            Where byte surgery can answer, the unit is asked twice: once as shipped
 *            (surgery answers) and once with the overlay stripped, so the element
 *            writer answers. An ACHIEVED bound rather than a derived one — whatever
 *            surgery spent, the ask is answerable in that many bytes, demonstrably.
 *            Same paired-A/B-on-one-tree technique as `_1233-byte-change.spec.ts`,
 *            reused rather than re-invented ([[P546]]: never a stash as a control arm).
 *
 * WHAT IS COMPUTED, all in BEFORE-document byte coordinates:
 *
 *   COST     `changedWidth(before, after)` — copied verbatim from
 *            `_1007-subdivide-locality.spec.ts:58` / `_1007-subdivide-route.spec.ts` /
 *            `_1233-byte-change.spec.ts`, so all four runs stay comparable.
 *   SLACK    bytes of `before` OUTSIDE the floor that did NOT survive the write, head
 *            and tail measured separately against the common prefix and suffix — see
 *            `slackOutside`, and read the refuted first design there before reusing it.
 *
 * SLACK IS WHAT WAS AVOIDABLE AND `COST - SLACK` IS FORCED. A writer that grows `bd`
 * into `[bd bd]` pays a large COST and zero SLACK: every byte it spent was inside the
 * span it had to touch. That is optimal, not lazy, and a byte ratio cannot see the
 * difference — which is the whole reason this file exists.
 *
 * ⚠ WHAT A ZERO LICENSES, and it is less than it looks. Zero SLACK against a floor says
 * the write stayed inside THAT span. It does not say the spelling inside the span is the
 * shortest correct one — a claim of "local", never of "minimal". The two floors narrow
 * that gap without closing it: the ATOM floor is much tighter than the ELEMENT floor,
 * and a zero against it still permits a wasteful spelling of the atom itself.
 *
 * THE FLOOR IS A PROPERTY OF THE ASK AND THE SOURCE, NOT OF THE WRITER'S MODEL — and
 * that is what makes it usable as a control. It is derived ONCE from the document-
 * resolution parse of the mini, then applied unchanged to every arm. `scaleStepGrid`
 * drops `source` (a re-laid grid makes every region a lie), so a floor read off the
 * writer's own model would simply not exist on the arm most in need of measuring.
 *
 * CONTROLS, because a clean reading from a detector never shown to fire is not evidence
 * ([[P610]], [[PK104]] step 6). Each is printed with its rate beside the result:
 *
 *   C1 TILING       the regions must reconstruct the source BYTE-FOR-BYTE
 *                   (`prefix` / `part.before` / `region.raw` / `part.after` / `suffix`).
 *                   If they do not, the offsets are fiction and nothing may be read.
 *   C2 FIRES        asked of ROUTE B, the model rescale that re-derives the whole line.
 *                   EXCESS must be large there or the detector cannot fire at all.
 *   C3 SILENT       asked of the LEAF arm, which replaces exactly the note's own bytes.
 *                   EXCESS must be 0 there or the floor construction is wrong.
 *   C4 NON-VACUOUS  the floor must be a STRICT SUBSET of the document on a real
 *                   sub-population, else every EXCESS is 0 for an uninteresting reason.
 *   C5 ON TARGET    the note's own LEAF span must lie INSIDE the region that contains
 *                   its column. Two independently-derived facts about the same bytes —
 *                   krill's locations on one side, the tiling walk on the other — so a
 *                   column-to-region mapping off by one element is caught by something
 *                   other than itself ([[PV200]]).
 *
 * ⚠ C5's FIRST FORM DID ITS JOB BY FAILING, and the failure was in the metric rather
 * than in the code under it — see `slackOutside` for the refuted design and why a pure
 * insertion made the first slack detector unable to fire. Both halves are kept there.
 *
 * OBSERVED 2026-08-18 on `14f7ea0c`, 1633 minis -> 1021 grid units -> 874 with a
 * reconstructible tiling -> 873 asks of each gesture. Long docs are >= 40 chars, because
 * the ratio is confounded below that (corpus p50 is ~16, where one element IS most of
 * the document).
 *
 *   arm                                        n    cost   slack   slack==0
 *   ROUTE A subdivide+place vs its ELEMENT    873   0.286   0.000   873/873
 *   ROUTE A subdivide+place vs its ATOM       585   0.240   0.086   501/585
 *   ROUTE B model rescale   vs its ELEMENT    873   0.987   0.494   428/873   <- C2
 *   delete by byte surgery  vs its ATOM       604   0.034   0.000   604/604   <- C3
 *   delete by the element writer vs its ATOM  604   0.116   0.031   536/604
 *
 * THE ANSWER TO #1300's LAST ITEM: the shipped 0.298 is NOT reach. Route A left the
 * element it had to touch on ZERO of 873 asks, where the same detector catches route B
 * leaving it on 445. ⚠ READ THAT ZERO AT ITS REAL STRENGTH: on 420 of the 873 the floor
 * IS the whole document (a single top-level element), where a zero is trivially true and
 * says nothing. The load-bearing part is the other 453, counted per leg because the
 * delete's floor and the subdivide's floor are different regions and quoting one for the
 * other is the mechanism-for-property slip this arc keeps finding. The residue over the delete anchor is the ask, not the writer.
 * What IS avoidable sits one level down and is a SPELLING question: on 84 of 585 the
 * write spreads beyond the atom it subdivides, re-spelling the whole element flat at the
 * line's shared division (`[g3 f#3]` -> `[g3 g3 ~ ~ ~ ~ f#3 _ _ _ _ _]`) where a nested
 * `[[g3 g3] f#3]` would touch four bytes. No writer in the tree spells the nested form,
 * so that floor is DERIVED and has no witness — it is what a correct answer could cost.
 *
 * ⚠⚠ THIS FILE ASSUMES THE WRITE IS CORRECT AND CANNOT CHECK IT — the precondition is
 * named here rather than left implicit, because a writer that SWALLOWED the placement
 * would move few bytes and score zero slack, and this instrument would call that optimal.
 * `wrote nothing` is printed per arm and reads 0 everywhere, so no write was a no-op —
 * but "changed something" is not "changed the right thing". Correctness for exactly this
 * route and gesture is established elsewhere, on a superset of this population:
 * `_1052-resolution-truth.spec.ts` poses 934 placements through route A with the engine
 * on both sides and finds 0 notes destroyed. ⚠ That spec is on `chore/1052-resolution-
 * truth` and is not merged, so this cross-reference is a claim about a branch and not
 * about the tree — check it is still true before quoting this file's numbers as a
 * statement about a correct writer.
 *
 * TWO CHOICES IN THE PAIRING, both deliberate and both making the result harder rather
 * than easier to reach:
 *   - THE SAME COORDINATES, not the same rule. The target (lane, column) is chosen once
 *     on the refined view and REPLAYED on the rescaled model, where `_1007-subdivide-
 *     route.spec.ts` re-ran its scan per route. Both arms report 873, so the coordinates
 *     transferred on every ask, and the two roads answer literally the same question.
 *   - NO IDENTITY-BASE PRECONDITION. Route A's own probe requires `serializeStepGrid(m)
 *     === mini` before measuring, because "the document did not change" is meaningless
 *     if the writer never reproduced it. Nothing here compares against a re-serialization
 *     — only before against after — and dropping the precondition can only ADD writes
 *     that re-spell bytes for reasons unrelated to the ask, which inflates slack. So a
 *     zero measured without it is the stronger statement.
 *
 * SCOPE, stated in the artifact rather than in a reply ([[PK104]] step 9). Step grid
 * only; scale factor x2; mini strings, not whole documents; the ask position is
 * SYSTEMATIC — the first empty odd column scanned column-then-lane — and is not a
 * sample of where a user would click. The roll is not measured. Units whose source is
 * an `<...>` alternation (`altSource`) carry no reconstructible tiling and are reported
 * as UNCOVERED rather than modelled from a second guess.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid } from '../../../editor/src/codeView/notation/parse'
import type {
  GridCells,
  NotationSource,
  StepGridModel,
} from '../../../editor/src/codeView/notation/model'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import { toggleCell } from '../../../editor/src/codeView/notation/place'
import {
  scaleStepGrid,
  canDoubleStepGrid,
  collapseStepGridToDocument,
} from '../../../editor/src/codeView/notation/resolution'
import { serializeStepGridWithExtent } from '../../../editor/src/codeView/notation/serialize'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

/**
 * how many bytes actually moved: the range between the common prefix and common suffix.
 * IDENTICAL to `_1007-subdivide-locality.spec.ts:58`, `_1007-subdivide-route.spec.ts`
 * and `_1233-byte-change.spec.ts`, on purpose — a second definition would make the runs
 * incomparable and this one exists to be compared against them.
 */
function changedWidth(before: string, after: string): number {
  if (before === after) return 0
  let p = 0
  while (p < before.length && p < after.length && before[p] === after[p]) p++
  let s = 0
  while (
    s < before.length - p &&
    s < after.length - p &&
    before[before.length - 1 - s] === after[after.length - 1 - s]
  )
    s++
  return Math.max(before.length - p - s, after.length - p - s)
}

interface Span {
  start: number
  end: number
}

/**
 * THE SLACK: how many bytes of `before` OUTSIDE the floor failed to survive the write.
 *
 * ⚠ THIS IS THE SECOND DESIGN, AND THE FIRST WAS REFUTED BY ITS OWN CONTROL — both
 * halves kept rather than the wrong one quietly swapped. The first took the changed
 * WINDOW `[commonPrefix, len - commonSuffix)` and measured the part of it lying outside
 * the floor. That reads 0 for every PURE INSERTION, because an insertion consumes no
 * `before` bytes at all: `ab` -> `aXb` has prefix 1 and suffix 1, so its window is the
 * zero-width point `[1,1)` and NOTHING can lie outside anything. The run said slack 0 on
 * 873 of 873 while simultaneously reporting that the window missed the floor on 308 —
 * two numbers that cannot both be facts, and the reason the second was printed at all is
 * that it was put there as a control. A slack detector that cannot see an insertion is
 * exactly the clean-reading-from-a-detector-that-cannot-fire this file is built to avoid.
 *
 * The honest question does not mention windows: **did every byte the ask did not force
 * survive, in place?** The head `before[0, f.start)` and the tail `before[f.end, len)`
 * are untouchable, so what survives of them is measured directly against the common
 * prefix and suffix, and whatever did not survive is the slack. An insertion inside the
 * floor now scores 0 because the head and tail both survive whole; an insertion outside
 * it scores the bytes it displaced.
 */
function slackOutside(before: string, after: string, f: Span): number {
  let p = 0
  while (p < before.length && p < after.length && before[p] === after[p]) p++
  let s = 0
  while (
    s < before.length - p &&
    s < after.length - p &&
    before[before.length - 1 - s] === after[after.length - 1 - s]
  )
    s++
  const headLost = Math.max(0, f.start - p)
  const tailLost = Math.max(0, before.length - f.end - s)
  return headLost + tailLost
}
const contains = (outer: Span, inner: Span) => inner.start >= outer.start && inner.end <= outer.end

/**
 * Byte offsets for every top-level element, by walking the tiling the writer itself
 * emits (`serialize.ts:461` `out = src.prefix`, `:680` `out += written.body + p.after`,
 * `:683` `return out + src.suffix`). Returns what the walk reconstructs so C1 can
 * compare it against the source and refuse the run if the model is wrong.
 */
interface RegionSpan extends Span {
  part: number
  from: number
  to: number
  /** the span with its own padding trimmed off — the tighter, more honest floor */
  core: Span
}
function regionSpans(src: NotationSource<GridCells>): {
  spans: RegionSpan[]
  rebuilt: string
  factors: Map<number, number>
} {
  const spans: RegionSpan[] = []
  const factors = new Map<number, number>()
  let out = src.prefix
  for (const p of src.parts) {
    factors.set(p.part, p.factor)
    out += p.before
    for (const r of p.regions) {
      const start = out.length
      const end = start + r.raw.length
      spans.push({
        start,
        end,
        part: p.part,
        from: r.from,
        to: r.to,
        core: { start: start + r.leading.length, end: end - r.trailing.length },
      })
      out += r.raw
    }
    out += p.after
  }
  return { spans, rebuilt: out + src.suffix, factors }
}

/**
 * The element that MUST change: the region covering the document column the ask lands
 * in, in the lane's own part. A part read at `factor` shared columns per own column
 * puts model column `c` at own column `floor(c / factor)` (`serialize.ts:504`,
 * `partColumns(lanes, steps, p.factor)`).
 */
function floorRegion(
  spans: RegionSpan[],
  factors: Map<number, number>,
  part: number,
  docCol: number,
): RegionSpan | null {
  const f = factors.get(part)
  if (f === undefined || f <= 0) return null
  const own = Math.floor(docCol / f)
  return spans.find((s) => s.part === part && own >= s.from && own < s.to) ?? null
}

interface Arm {
  /** cost/doc — the ratio every other probe in this arc reports */
  ratios: number[]
  longRatios: number[]
  /** slack/doc, on the same units, so the two decompose the same denominator */
  excessRatios: number[]
  longExcessRatios: number[]
  /** forced = (cost - excess)/doc */
  longForcedRatios: number[]
  abs: number[]
  excessAbs: number[]
  /** slack / cost — the share of the write that was avoidable. Medians do not add,
   *  so this is measured per unit rather than divided out of two p50s afterwards. */
  slackShare: number[]
  longSlackShare: number[]
  zeroExcess: number
  onTarget: number
  /** the writer returned the document unchanged — an EMPTY window, not a missed floor */
  identical: number
  /** a non-empty window that misses the floor entirely — the real C5 failure */
  disjoint: number
  n: number
}
const arm = (): Arm => ({
  ratios: [],
  longRatios: [],
  excessRatios: [],
  longExcessRatios: [],
  longForcedRatios: [],
  abs: [],
  excessAbs: [],
  slackShare: [],
  longSlackShare: [],
  zeroExcess: 0,
  onTarget: 0,
  identical: 0,
  disjoint: 0,
  n: 0,
})
const med = (r: number[]) => (r.length === 0 ? NaN : [...r].sort((a, b) => a - b)[Math.floor(r.length / 2)])

function record(a: Arm, before: string, after: string, fl: Span) {
  const cost = changedWidth(before, after)
  const ex = slackOutside(before, after, fl)
  const len = Math.max(before.length, after.length)
  a.n++
  a.abs.push(cost)
  a.excessAbs.push(ex)
  a.ratios.push(cost / len)
  a.excessRatios.push(ex / len)
  if (cost > 0) {
    a.slackShare.push(ex / cost)
    if (before.length >= 40) a.longSlackShare.push(ex / cost)
  }
  if (ex === 0) a.zeroExcess++
  if (before === after) a.identical++
  else if (ex === 0) a.onTarget++
  else a.disjoint++
  if (before.length >= 40) {
    a.longRatios.push(cost / len)
    a.longExcessRatios.push(ex / len)
    a.longForcedRatios.push((cost - ex) / len)
  }
}

function show(label: string, a: Arm) {
  console.log(
    `  ${label.padEnd(30)} n=${String(a.n).padStart(4)}` +
      `  cost p50=${med(a.ratios).toFixed(3)}` +
      `  SLACK p50=${med(a.excessRatios).toFixed(3)}` +
      `  slack==0 on ${String(a.zeroExcess).padStart(4)}/${String(a.n).padStart(4)}` +
      `  | LONG(>=40) n=${String(a.longRatios.length).padStart(3)}` +
      ` cost=${med(a.longRatios).toFixed(3)} · forced ${med(a.longForcedRatios).toFixed(3)}` +
      ` · slack ${med(a.longExcessRatios).toFixed(3)}   (independent medians — they do not add)`,
  )
  console.log(
    `       SLACK SHARE (slack/cost, per unit) p50=${med(a.slackShare).toFixed(3)}` +
      `  on long docs ${med(a.longSlackShare).toFixed(3)}`,
  )
  console.log(
    `       bytes: cost p50=${String(med(a.abs)).padStart(4)}  slack p50=${String(med(a.excessAbs)).padStart(4)}` +
      `  · confined to the floor ${a.onTarget}/${a.n}  ·  wrote nothing ${a.identical}  ·  LEFT it ${a.disjoint}`,
  )
}

describe('#1301 — is the shipped subdivide cost forced by the ask, or slack in the writer?', () => {
  it('measures every write against a floor, and against a witness where one exists', () => {
    // denominators first, per [[P606]] — a treatment column means nothing until these
    // are non-zero, and a dead gesture is ABSENT from a table rather than zero in it
    let units = 0
    let tilingOk = 0
    let tilingBad = 0
    let uncoveredAlt = 0
    let noSource = 0
    let strictSubset = 0 // C4, delete leg
    let strictSubsetSub = 0 // C4, subject leg — counted separately, see below
    let floorMissing = 0
    let posedSub = 0
    let posedDel = 0
    let witnessed = 0
    let leafSpanFound = 0
    let leafInsideRegion = 0 // C5
    let leafOutsideRegion = 0
    let leafSrcIsMini = 0

    // the SUBJECT: subdivide + place, both roads, same ask, same floor
    const subA = arm()
    const subB = arm()
    // …and route A against the TIGHT floor: the atom the placement subdivides
    const subATight = arm()
    let subTightFound = 0
    let subTightMissing = 0
    // the WITNESS leg: one delete, two correct answers
    const delLeaf = arm() // byte surgery — the witness itself
    const delElement = arm() // the same ask with the overlay stripped
    // the SAME two answers scored against the TIGHT floor — the note's own atom span
    const delLeafTight = arm()
    const delElementTight = arm()
    // …and the achieved differential between them, per unit
    const achieved: number[] = []
    const exampleSlack: string[] = []
    const exampleForced: string[] = []

    // CALIBRATION, before anything below may be read ([[PK103]] step 7). The witness is
    // byte surgery, and `writer-reach.test.ts` already gates how many deletes it answers
    // over this corpus — `FLOOR_SURGICAL`. Counted here over EVERY grid unit, with the
    // same target rule, it must reproduce that figure exactly. If it does not, this
    // instrument is not looking at the population the floor is asserted on, and the
    // witness leg means nothing. Note the witness leg itself runs on the smaller
    // tiling-reconstructible subset, which is why the anchor is taken separately.
    let leafAnsweredEverywhere = 0
    for (const mini of minis) {
      const r = parseStepGrid(mini)
      if (!r.ok) continue
      const m = r.model as StepGridModel
      let hit = false
      for (let col = 0; col < m.steps && !hit; col++)
        for (let lane = 0; lane < m.lanes.length && !hit; lane++) {
          if (!isCellOn(m.lanes[lane].cells[col])) continue
          hit = true
          const next = toggleCell(m, lane, col, false)
          if (next === m) break
          const { mini: out, extent } = serializeStepGridWithExtent(next)
          if (out !== null && extent.path === 'leaf') leafAnsweredEverywhere++
        }
    }

    for (const mini of minis) {
      const r = parseStepGrid(mini)
      if (!r.ok) continue
      const m = r.model as StepGridModel
      units++

      // ---- the floor's own precondition: a reconstructible source tiling (C1) ----
      if (m.source === undefined) {
        if (m.altSource !== undefined) uncoveredAlt++
        else noSource++
        continue
      }
      const { spans, rebuilt, factors } = regionSpans(m.source)
      if (rebuilt !== mini) {
        tilingBad++
        continue
      }
      tilingOk++

      // ---- WITNESS LEG: one delete, answered twice on one tree ----
      let done = false
      for (let col = 0; col < m.steps && !done; col++)
        for (let lane = 0; lane < m.lanes.length && !done; lane++) {
          if (!isCellOn(m.lanes[lane].cells[col])) continue
          done = true
          const next = toggleCell(m, lane, col, false)
          if (next === m) break // the panel refuses the gesture
          const fr = floorRegion(spans, factors, m.lanes[lane].part ?? 0, col)
          if (fr === null) {
            floorMissing++
            break
          }
          if (fr.core.end - fr.core.start < mini.length) strictSubset++
          posedDel++

          // THE TIGHT FLOOR, and C5's independent authority. The leaf anchors come from
          // krill's own locations; the region spans come from the tiling walk above.
          // Two independently-derived facts about the same bytes, so their agreement is
          // evidence — a column-to-region mapping off by one element puts the note's own
          // span OUTSIDE the element that supposedly contains it, and nothing else in
          // this run would notice ([[PV200]]: never two authorities that agree the day
          // they are written).
          const ls = m.leafSource ?? m.surgical?.spans()
          let tight: Span | null = null
          if (ls !== undefined && ls.src === mini) {
            leafSrcIsMini++
            const anchor = ls.cols[col]?.find((x) => x.atom === m.lanes[lane].sound)
            if (anchor !== undefined) {
              leafSpanFound++
              tight = anchor.span
              if (contains(fr.core, tight)) leafInsideRegion++
              else leafOutsideRegion++
            }
          }

          const shipped = serializeStepGridWithExtent(next)
          // the SAME model with both surgery fields removed IS the element writer for
          // this unit — same corpus, same session, same tree ([[P546]])
          const { surgical: _s, leafSource: _l, ...bare } = next
          const stripped = serializeStepGridWithExtent(bare as StepGridModel)
          if (shipped.mini !== null && shipped.extent.path === 'leaf') {
            record(delLeaf, mini, shipped.mini, fr.core)
            if (tight !== null) record(delLeafTight, mini, shipped.mini, tight)
            if (stripped.mini !== null) {
              witnessed++
              record(delElement, mini, stripped.mini, fr.core)
              if (tight !== null) record(delElementTight, mini, stripped.mini, tight)
              achieved.push(changedWidth(mini, stripped.mini) - changedWidth(mini, shipped.mini))
            }
          }
        }

      // ---- SUBJECT LEG: subdivide, then place into a slot the source never indexed ----
      // doubling maps document column i -> refined 2i, so an ODD refined column is
      // precisely the epic's "adding structure with no leaf", and its document column
      // — the one the floor is taken at — is floor(c / 2).
      if (!canDoubleStepGrid(m)) continue
      const fineParse = parseStepGrid(mini, 2)
      if (!fineParse.ok) continue
      const fine = fineParse.model as StepGridModel
      const wide = scaleStepGrid(m, 'double')
      // THE GUARD, because this is where a gesture was lost before ([[P606]]):
      // `scaleStepGrid` takes `'double' | 'halve'` and vitest does not typecheck, so a
      // wrong literal falls to the halve branch and reads as a dead zero.
      if (wide === m || wide.steps !== m.steps * 2) continue

      let target: { col: number; lane: number } | null = null
      for (let col = 1; col < fine.steps && target === null; col += 2)
        for (let lane = 0; lane < fine.lanes.length && target === null; lane++)
          if (!isCellOn(fine.lanes[lane].cells[col])) {
            const t = toggleCell(fine, lane, col, true)
            if (t !== fine) target = { col, lane }
          }
      if (target === null) continue
      const fr = floorRegion(
        spans,
        factors,
        fine.lanes[target.lane].part ?? 0,
        Math.floor(target.col / 2),
      )
      if (fr === null) {
        floorMissing++
        continue
      }
      posedSub++
      // ⚠ C4 IS COUNTED PER LEG. The delete's floor and the subdivide's floor are two
      // different regions, and quoting one leg's non-vacuity for the other is exactly
      // the mechanism-for-property slip this arc keeps finding. Where the floor IS the
      // whole document (a single-element source) a zero slack is trivially true, so the
      // headline is only as strong as this count.
      if (fr.core.end - fr.core.start < mini.length) strictSubsetSub++

      // THE TIGHT FLOOR FOR A SUBDIVIDE, and it is a DERIVED bound rather than an
      // achieved one — say so wherever it is quoted. The created note has no bytes, but
      // the ATOM whose slot it splits does: placing into the second half of `g3` need
      // only re-spell `g3` as `[g3 x]`, which touches nothing else in the element. So
      // bytes outside that atom are avoidable IN PRINCIPLE. No writer in the tree
      // produces that nested spelling, so unlike the delete's tight floor this one has
      // NO WITNESS — it is what a correct answer could cost, not what one did cost.
      const lsSub = m.leafSource ?? m.surgical?.spans()
      const dcol = Math.floor(target.col / 2)
      let subTight: Span | null = null
      if (lsSub !== undefined && lsSub.src === mini) {
        const cell = m.lanes[target.lane]?.cells[dcol]
        const sound = m.lanes[target.lane]?.sound
        const anchor = cell !== false && cell !== undefined
          ? lsSub.cols[dcol]?.find((x) => x.atom === sound)
          : undefined
        if (anchor !== undefined) subTight = anchor.span
      }
      if (subTight !== null) subTightFound++
      else subTightMissing++

      // ROUTE A — the shipped road: a refined VIEW, then the ÷k guard (#1300)
      const placedA = toggleCell(fine, target.lane, target.col, true)
      const atDoc = collapseStepGridToDocument(placedA)
      const outA = serializeStepGridWithExtent(atDoc ?? placedA)
      if (outA.mini !== null) {
        record(subA, mini, outA.mini, fr.core)
        if (subTight !== null) record(subATight, mini, outA.mini, subTight)
        // ⚠ ONLY where the atom was located. Bucketing a unit with no tight floor as
        // "no slack" would print a zero that means "never asked" ([[P606]]).
        const ex = subTight === null ? -1 : slackOutside(mini, outA.mini, subTight)
        if (mini.length >= 40 && subTight !== null) {
          const bucket = ex > 0 ? exampleSlack : exampleForced
          if (bucket.length < 3)
            bucket.push(
              `     element ${JSON.stringify(mini.slice(fr.core.start, fr.core.end))}` +
                `  ·  atom ${subTight === null ? '(none)' : JSON.stringify(mini.slice(subTight.start, subTight.end))}` +
                `  ·  slack vs the atom ${ex}B\n     before ${JSON.stringify(mini)}\n     after  ${JSON.stringify(outA.mini)}`,
            )
        }
      }

      // ROUTE B — the model rescale, and the control that proves the detector fires
      if (target.col < wide.steps && target.lane < wide.lanes.length) {
        const placedB = toggleCell(wide, target.lane, target.col, true)
        if (placedB !== wide) {
          const outB = serializeStepGridWithExtent(placedB)
          if (outB.mini !== null) record(subB, mini, outB.mini, fr.core)
        }
      }
    }

    console.log(`\n===== #1301 floor and witness: forced or slack? =====`)
    console.log(`  corpus minis                  ${minis.length}`)
    console.log(`  units opening a step grid     ${units}`)
    console.log(`  ...with a tiling that RECONSTRUCTS the source   ${tilingOk}   <- C1`)
    console.log(`     tiling MISMATCH (unusable) ${tilingBad}`)
    console.log(`     alternation source, UNCOVERED by design      ${uncoveredAlt}`)
    console.log(`     no source at all           ${noSource}`)
    console.log(`  floor could not be located    ${floorMissing}`)
    console.log(`  deletes posed                 ${posedDel}   (floor a STRICT subset of the doc on ${strictSubset}   <- C4)`)
    console.log(
      `  subdivide+place posed         ${posedSub}   <- denominator; a dead gesture is 0` +
        `  (floor a STRICT subset of the doc on ${strictSubsetSub}   <- C4, this leg's own)`,
    )
    console.log(`  deletes with BOTH answers     ${witnessed}   <- the witness population`)
    console.log(`  leaf-answered deletes over ALL units  ${leafAnsweredEverywhere}   <- must be writer-reach's gated 685`)
    console.log(
      `  leaf spans read in mini coords ${leafSrcIsMini}, note's own span located ${leafSpanFound}` +
        `, INSIDE its region ${leafInsideRegion}, outside ${leafOutsideRegion}   <- C5`,
    )

    console.log(`\n  -- THE SUBJECT: subdivide + place, the ask with no witness --`)
    show('ROUTE A (shipped)', subA)
    show('ROUTE B (model rescale)  C2', subB)
    console.log(
      `  -- and route A against the TIGHT floor: the atom being subdivided` +
        ` (located on ${subTightFound}, absent on ${subTightMissing} — a rest or no leaf) --`,
    )
    console.log(`     ⚠ DERIVED, NOT ACHIEVED: no writer in the tree spells the nested form, so this floor has no witness.`)
    show('ROUTE A vs the atom', subATight)

    console.log(`\n  -- THE WITNESS LEG: one delete, two correct answers, one tree --`)
    show('delete by byte surgery C3', delLeaf)
    show('delete by the element writer', delElement)
    console.log(`  -- the same two answers against the TIGHT floor: the note's own atom span --`)
    show('delete by byte surgery', delLeafTight)
    show('delete by the element writer', delElementTight)
    console.log(
      `  ACHIEVED differential (element - surgery, same ask): p50 ${med(achieved)} bytes` +
        `  ·  element costs MORE on ${achieved.filter((v) => v > 0).length}/${achieved.length}` +
        `, the same on ${achieved.filter((v) => v === 0).length}`,
    )

    console.log(`\n  -- ROUTE A, long docs, SLACK vs the ATOM (inside the element, outside the note) --`)
    exampleSlack.forEach((s) => console.log(s))
    console.log(`\n  -- ROUTE A, long docs, NO SLACK even against the atom --`)
    exampleForced.forEach((s) => console.log(s))

    // ---- CALIBRATION + CONTROLS. Nothing above may be read if these do not hold. ----
    expect(
      leafAnsweredEverywhere,
      "the witness population is not writer-reach's — FLOOR_SURGICAL is asserted at 685",
    ).toBe(685)
    // C1 — the tiling is the floor's whole basis
    expect(tilingOk, 'no unit reconstructed — the region walk does not model the source').toBeGreaterThan(500)
    expect(tilingBad, 'the region walk failed to reproduce the source on some unit').toBe(0)
    // the gestures must actually have happened
    expect(posedSub, 'the subdivide gesture was never posed — check the ResolutionDir literal').toBeGreaterThan(100)
    expect(witnessed, 'no delete had two answers — the witness leg is empty').toBeGreaterThan(100)
    // C4 — a floor equal to the whole document makes every excess trivially 0
    expect(strictSubset, 'delete: the floor is never a strict subset — slack is 0 for an uninteresting reason').toBeGreaterThan(100)
    expect(strictSubsetSub, 'subdivide: the floor is never a strict subset — slack is 0 for an uninteresting reason').toBeGreaterThan(100)
    // C5 — the floor must be located where krill says the note's own bytes are
    expect(leafSpanFound, 'no note span was located — C5 never ran').toBeGreaterThan(100)
    expect(leafOutsideRegion, "a note's own span fell outside the element containing its column — the column-to-region mapping is wrong").toBe(0)
    // C3 — surgery replaces exactly the note's own bytes, so its slack must be 0
    expect(delLeaf.zeroExcess, 'byte surgery moved bytes outside the forced element — the floor is wrong').toBe(delLeaf.n)
    // C2 — and the detector must be able to fire at all
    expect(subB.excessAbs.filter((v) => v > 0).length, 'route B shows no slack — the detector cannot fire').toBeGreaterThan(100)
    expect(subATight.n, 'the tight floor was never located on the subdivide ask').toBeGreaterThan(100)
  })
})
