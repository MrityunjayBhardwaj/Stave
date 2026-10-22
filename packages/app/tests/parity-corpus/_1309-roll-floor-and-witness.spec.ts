/**
 * _1309-roll-floor-and-witness.spec.ts — THROWAWAY INSTRUMENT. The roll's half of
 * `_1301-floor-and-witness.spec.ts`: of the bytes the shipped roll writer moves when
 * subdividing, how many did the ASK force and how many are slack?
 *
 * Run:
 *   npx vitest run --config vitest.sweep.config.ts _1309-roll-floor-and-witness
 *
 * WHY. `_1309-roll-subdivide-route` established that the roll reproduces the grid's
 * route answer — the shipped road moves p50 0.255 of a long document against the model
 * rescale's 0.978, where the grid reads 0.298 against 0.988. But a byte ratio is
 * measured against NOTHING, so it cannot tell "the notation forced this" from "the
 * writer was lazy". The grid settled that with a floor and a witness. This asks the
 * same of the roll, in the same shape, so the two answers are comparable rather than
 * merely both true.
 *
 * NEVER MEASURE A COST AGAINST NOTHING. Two bounds beside every cost, same unit, same ask:
 *
 *   FLOOR    the bytes of the SOURCE that denote the thing being edited. Two nested:
 *              ELEMENT  the top-level region containing the edited column
 *                       (`SourceRegion.raw` minus its padding)
 *              ATOM     the edited note's own span (`RollLeafAnchor.span`)
 *            ATOM is inside ELEMENT by construction, and C5 checks exactly that.
 *            ⚠ THE NOTE A SUBDIVIDE CREATES HAS NO BYTES, so it has no ATOM of its own.
 *            The note whose slot it SPLITS does — placing into the back half of `g3`
 *            need only re-spell `g3` as `[g3 x]` — and that is the tighter floor for
 *            the same ask. Both are reported; they answer different questions.
 *
 *   WITNESS  ANOTHER CORRECT ANSWER to the same ask, by a different writer. Where byte
 *            surgery answers, the unit is asked twice: once as shipped (surgery answers)
 *            and once with the overlay fields stripped, so the element writer answers.
 *            An ACHIEVED bound rather than a derived one, on one tree in one run — never
 *            a stash as a control arm.
 *
 * SLACK IS WHAT WAS AVOIDABLE, `COST - SLACK` IS FORCED. A writer that grows `g3` into
 * `[g3 x]` pays a large COST and zero SLACK: every byte was inside the span it had to
 * touch. That is optimal, not lazy, and a byte ratio cannot see the difference.
 *
 * ⚠ WHAT A ZERO LICENSES is less than it looks: zero slack against a floor says the
 * write stayed inside THAT span, never that the spelling inside it is the shortest
 * correct one. A claim of "local", never of "minimal".
 *
 * ⚠ THE SLACK METRIC IS THE GRID PROBE'S SECOND DESIGN, DELIBERATELY. Its first —
 * measuring the part of the changed WINDOW lying outside the floor — reads 0 for every
 * pure INSERTION, because an insertion consumes no `before` bytes: `ab` -> `aXb` has a
 * zero-width window and nothing can lie outside anything. Placing a note IS an
 * insertion, so that design cannot fire on the case under test. `slackOutside` below is
 * the corrected one — head and tail survival — copied from the arm that survived its
 * own refutation, not from the one that was refuted.
 *
 * POPULATION, and what is excluded and why (measured first, never assumed):
 *   597 rolls open · 485 carry a `.source` tiling · of those 472 are SINGLE-PART.
 *   The 13 multi-part rolls are EXCLUDED and counted. A `RollNote` carries no part
 *   index — unlike a grid lane, which has `part` on it — so for a `,`-stacked roll
 *   there is no non-inventing way to say which part a note belongs to. Excluding 13
 *   and saying so is honest; guessing a part would put the floor on the wrong element
 *   and every slack figure downstream would be fiction.
 *
 * CONTROLS, because a clean reading from a detector never shown to fire is not evidence.
 * Each is printed with its rate beside the result:
 *   C1 TILING       the regions must reconstruct the source BYTE-FOR-BYTE. If they do
 *                   not, the offsets are fiction and nothing may be read.
 *   C2 FIRES        asked of ROUTE B, the model rescale that re-derives the whole line.
 *                   SLACK must be large there or the detector cannot fire at all.
 *   C3 SILENT       asked of the byte-surgery DELETE against the note's own ATOM span.
 *                   SLACK must be 0 there or the floor construction is wrong.
 *   C4 NON-VACUOUS  the floor must be a STRICT SUBSET of the document on a real
 *                   sub-population, else every slack is 0 for an uninteresting reason.
 *   C5 ON TARGET    the note's ATOM span must lie INSIDE the region containing its
 *                   column. Two independently-derived facts about the same bytes —
 *                   krill's locations on one side, the tiling walk on the other — so a
 *                   column-to-region mapping off by one is caught by something other
 *                   than itself.
 *
 * ⚠⚠ C3 FIRED ON ITS FIRST RUN AND THE DEFECT WAS IN THIS PROBE, NOT IN THE WRITER —
 * which is what a control is for, and it is recorded here rather than quietly fixed.
 * The delete gesture identified its target note by `(pitch, start)`. That is NOT a
 * unique key: a `,`-stack can hold the same pitch twice in one group, and the corpus
 * has such a unit — `[0,7,0]`, where pitch `0` appears at start 0 twice. The filter
 * removed BOTH, producing `[~,7,~]`, and the anchor lookup resolved to the first of two
 * different byte spans. So the arm was measuring a two-note delete against a one-note
 * floor, on 1 of 364. Byte surgery was behaving correctly throughout.
 * The fix is identity, not tolerance: the delete target is now the first note whose
 * `(pitch, start)` is unique, `atomOf` REFUSES an ambiguous anchor rather than picking
 * one, and both exclusions are counted and printed (they read 0 — every roll had a
 * uniquely-identifiable note, so nothing was lost). Relaxing C3 to `<= 1` would have
 * been the cheap move and would have unpinned the instrument at exactly the end being
 * read.
 *
 * OBSERVED on this tree, 1633 minis -> 597 rolls -> 485 with a tiling -> 472 single-part.
 * Long docs are >= 40 chars, because the ratio is confounded below that.
 *
 *   arm                                        n    cost   slack   slack==0
 *   ROUTE A subdivide+place vs its ELEMENT    470   0.255   0.000   470/470
 *   ROUTE A subdivide+place vs its ATOM       375   0.254   0.122   271/375
 *   ROUTE B model rescale   vs its ELEMENT    470   0.973   0.494   179/470   <- C2
 *   delete by byte surgery  vs its ATOM       364   0.024   0.000   364/364   <- C3
 *   delete by the element writer vs its ATOM  364   0.072   0.033   284/364
 *
 * THE ANSWER, and it is the grid's: the shipped roll subdivide left the element it had
 * to touch on ZERO of 470 asks, where the same detector catches route B leaving it on
 * 291. ⚠ READ THAT ZERO AT ITS REAL STRENGTH — on 139 of the 470 the floor IS the whole
 * document, where a zero is trivially true; the load-bearing part is the other 331,
 * counted on the SUBDIVIDE leg rather than borrowed from the delete leg. The residue
 * over the delete anchor is the ask, not the writer.
 * What IS avoidable sits one level down and is a SPELLING question, exactly as on the
 * grid: on 104 of 375 the write spreads beyond the atom it subdivides. That is 27.7%
 * against the grid's 84 of 585 (14.4%) — the one place the two surfaces differ in
 * degree rather than agreeing.
 *
 * ⚠⚠ THIS FILE ASSUMES THE WRITE IS CORRECT AND CANNOT CHECK IT. A writer that
 * SWALLOWED the placement would move few bytes and score zero slack, and this
 * instrument would call that optimal. `wrote nothing` is printed per arm for exactly
 * that reason. Correctness for this route and gesture is established elsewhere.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import type {
  PianoRollModel,
  RollNote,
  NotationSource,
} from '../../../editor/src/codeView/notation/model'
import { placeNote } from '../../../editor/src/codeView/notation/place'
import { scalePianoRoll, collapsePianoRollToDocument } from '../../../editor/src/codeView/notation/resolution'
import { serializePianoRollWithExtent } from '../../../editor/src/codeView/notation/serialize'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

/** IDENTICAL to every other probe in this arc, so all runs stay comparable. */
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
 * The head `before[0, f.start)` and tail `before[f.end, len)` are untouchable, so what
 * survives of them is measured directly against the common prefix and suffix. An
 * insertion INSIDE the floor scores 0 (head and tail survive whole); one outside it
 * scores the bytes it displaced.
 *
 * This is the grid probe's corrected design — see this file's header for the refuted
 * first one and why it could not fire on an insertion.
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

interface RegionSpan extends Span {
  part: number
  from: number
  to: number
  /** the span with its own padding trimmed off — the tighter, more honest floor */
  core: Span
}

/**
 * Byte offsets for every top-level element, by walking the tiling the writer itself
 * emits. Returns what the walk reconstructs so C1 can compare it against the source
 * and refuse the run if the model is wrong.
 *
 * `NotationSource<C>` is generic over the payload, so this walk is the grid probe's
 * unchanged — only the type parameter differs (`RollNote[]` rather than `GridCells`).
 */
function regionSpans(src: NotationSource<RollNote[]>): {
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

/** The element that MUST change: the region covering the document column the ask lands in. */
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
  ratios: number[]
  longRatios: number[]
  excessRatios: number[]
  longExcessRatios: number[]
  longForcedRatios: number[]
  abs: number[]
  excessAbs: number[]
  /** slack / cost — measured per unit, because medians do not add */
  slackShare: number[]
  longSlackShare: number[]
  zeroExcess: number
  onTarget: number
  /** the writer returned the document unchanged — an EMPTY window, not a missed floor */
  identical: number
  /** a non-empty window that misses the floor entirely */
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
const med = (r: number[]) =>
  r.length === 0 ? NaN : [...r].sort((a, b) => a - b)[Math.floor(r.length / 2)]

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
    `  ${label.padEnd(34)} n=${String(a.n).padStart(4)}` +
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

describe('#1309 — is the shipped ROLL subdivide cost forced by the ask, or slack in the writer?', () => {
  it('measures every write against a floor, and against a witness where one exists', () => {
    // ---- denominators, printed before any treatment column is read ----
    let opens = 0
    let withSource = 0
    let singlePart = 0
    let multiPartExcluded = 0
    let tilingOk = 0
    let tilingBad = 0
    let anchorSrcIsMini = 0
    let atomSpanFound = 0
    let atomInsideRegion = 0
    let atomOutsideRegion = 0
    let subPosed = 0
    let witnessed = 0
    // C4: is the floor ever a strict subset of the document?
    let floorIsWholeDoc = 0
    let floorIsStrictSubset = 0
    // (pitch, start) is NOT a unique key: a `,`-stack can hold the same pitch twice in
    // one group (`[0,7,0]`). Counted and excluded rather than silently conflated.
    let ambiguousDeleteSkipped = 0
    let ambiguousAtomSkipped = 0
    // C4 is counted PER LEG. The delete's floor and the subdivide's floor are
    // different regions on the same unit, and quoting one for the other is exactly
    // the mechanism-for-property slip this arc keeps finding.
    let subFloorWholeDoc = 0
    let subFloorStrictSubset = 0

    const subAElement = arm()
    const subAAtom = arm()
    const subBElement = arm()
    const delSurgery = arm() // byte surgery — the witness itself
    const delSurgeryAtom = arm()
    const delElement = arm() // the same ask, overlay stripped
    const delElementAtom = arm()

    const achieved: number[] = []
    // C3 violations are NAMED, never merely counted — a control that fires on 1 of 364
    // is either a real writer behaviour or a floor artifact, and only the unit can say.
    const c3Violations: string[] = []
    const exampleForced: string[] = []
    const exampleSlack: string[] = []

    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok) continue
      const m: PianoRollModel = r.model
      opens++

      const src = m.source
      if (src === undefined) continue
      withSource++
      const { spans, rebuilt, factors } = regionSpans(src)
      if (rebuilt === mini) tilingOk++
      else {
        tilingBad++
        continue // C1: if the tiling is fiction, every offset below is fiction
      }
      if (src.parts.length !== 1) {
        multiPartExcluded++
        continue // a RollNote carries no part index — see the header
      }
      singlePart++
      const part = src.parts[0].part

      // the anchors, if this view carries byte spans at all
      const ls = m.leafSource ?? m.surgical?.spans()
      const anchorsUsable = ls !== undefined && ls.src === mini
      if (anchorsUsable) anchorSrcIsMini++
      const atomOf = (pitch: string, start: number): Span | null => {
        if (!anchorsUsable) return null
        const hits = ls.anchors.filter((x) => x.pitch === pitch && x.start === start)
        if (hits.length === 0) return null
        // two anchors with the same (pitch, start) are two DIFFERENT byte spans, and
        // picking either would attribute the write to the wrong one. Refuse.
        if (hits.length > 1) {
          ambiguousAtomSkipped++
          return null
        }
        return hits[0].span
      }
      /** the note's identity is unique in the model — else no single-note gesture is expressible */
      const isUnique = (n: RollNote): boolean =>
        m.notes.filter((x) => x.pitch === n.pitch && x.start === n.start).length === 1

      // ================= WITNESS LEG: delete one note, two writers =================
      const deleteTarget = m.notes.find(isUnique)
      if (deleteTarget === undefined && m.notes.length > 0) ambiguousDeleteSkipped++
      if (deleteTarget !== undefined) {
        const target = deleteTarget
        const fr = floorRegion(spans, factors, part, target.start)
        if (fr !== null) {
          // C4: does the floor ever exclude anything?
          if (fr.core.start === 0 && fr.core.end === mini.length) floorIsWholeDoc++
          else floorIsStrictSubset++

          const tight = atomOf(target.pitch, target.start)
          if (tight !== null) {
            atomSpanFound++
            // C5: two independently-derived facts about the same bytes
            if (contains(fr.core, tight)) atomInsideRegion++
            else atomOutsideRegion++
          }

          const without: PianoRollModel = {
            ...m,
            notes: m.notes.filter(
              (n) => !(n.pitch === target.pitch && n.start === target.start),
            ),
          }
          const shipped = serializePianoRollWithExtent(without)
          // the SAME model with both surgery fields removed IS the element writer for
          // this unit — same corpus, same session, same tree
          const { surgical: _s, leafSource: _l, ...bare } = without
          const stripped = serializePianoRollWithExtent(bare as PianoRollModel)

          if (shipped.mini !== null && shipped.extent.path === 'leaf') {
            record(delSurgery, mini, shipped.mini, fr.core)
            if (tight !== null) {
              record(delSurgeryAtom, mini, shipped.mini, tight)
              const ex = slackOutside(mini, shipped.mini, tight)
              if (ex > 0 && mini !== shipped.mini)
                c3Violations.push(
                  `slack=${ex}  atom=[${tight.start},${tight.end}) ${JSON.stringify(mini.slice(tight.start, tight.end))}` +
                    `\n            note   ${JSON.stringify(target.pitch)} @${target.start} dur ${target.duration}` +
                    `\n            before ${JSON.stringify(mini)}` +
                    `\n            after  ${JSON.stringify(shipped.mini)}` +
                    `\n            notes sharing that start: ${m.notes.filter((n) => n.start === target.start).length}`,
                )
            }
            if (stripped.mini !== null) {
              witnessed++
              record(delElement, mini, stripped.mini, fr.core)
              if (tight !== null) record(delElementAtom, mini, stripped.mini, tight)
              achieved.push(
                changedWidth(mini, stripped.mini) - changedWidth(mini, shipped.mini),
              )
            }
          }
        }
      }

      // ============ SUBJECT LEG: subdivide, then split an existing note's slot ============
      // Doubling maps document column i -> refined 2i, so the ODD column 2i+1 is the
      // back half of the note starting at i — "adding structure with no leaf", and the
      // document column the floor is taken at is exactly i.
      const fineParse = parsePianoRoll(mini, 2)
      if (!fineParse.ok) continue
      const fine = fineParse.model
      const wide = scalePianoRoll(m, 'double')
      // THE GUARD: a wrong literal falls to the halve branch and reads as a dead zero.
      const wideDoubled = wide !== m && wide.steps === m.steps * 2

      let chosen: RollNote | null = null
      let refinedCol = -1
      for (const n of m.notes) {
        const col = n.start * 2 + 1
        if (col >= fine.steps) continue
        if (fine.notes.some((x) => x.pitch === n.pitch && x.start === col)) continue
        if (placeNote(fine, n.pitch, col, 1) !== fine) {
          chosen = n
          refinedCol = col
          break
        }
      }
      if (chosen === null) continue

      const fr = floorRegion(spans, factors, part, chosen.start)
      if (fr === null) continue
      subPosed++
      if (fr.core.start === 0 && fr.core.end === mini.length) subFloorWholeDoc++
      else subFloorStrictSubset++
      const tight = isUnique(chosen) ? atomOf(chosen.pitch, chosen.start) : null

      // ---- ROUTE A: the shipped road ----
      const placedA = placeNote(fine, chosen.pitch, refinedCol, 1)
      const atDoc = collapsePianoRollToDocument(placedA)
      const outA = serializePianoRollWithExtent(atDoc ?? placedA)
      if (outA.mini !== null) {
        record(subAElement, mini, outA.mini, fr.core)
        if (tight !== null) {
          record(subAAtom, mini, outA.mini, tight)
          const ex = slackOutside(mini, outA.mini, tight)
          const bucket = ex > 0 ? exampleSlack : exampleForced
          if (bucket.length < 3 && mini.length >= 40)
            bucket.push(`${JSON.stringify(mini)}\n            -> ${JSON.stringify(outA.mini)}`)
        }
      }

      // ---- ROUTE B: the model rescale — C2's firing arm ----
      if (wideDoubled) {
        const placedB = placeNote(wide, chosen.pitch, refinedCol, 1)
        if (placedB !== wide) {
          const outB = serializePianoRollWithExtent(placedB)
          if (outB.mini !== null) record(subBElement, mini, outB.mini, fr.core)
        }
      }
    }

    console.log(`\n===== #1309: is the ROLL's subdivide cost FORCED, or slack? =====`)
    console.log(`  corpus minis                      ${minis.length}`)
    console.log(`  rolls opening                     ${opens}`)
    console.log(`  ...carrying a .source tiling      ${withSource}`)
    console.log(`  C1  tiling rebuilds byte-exact    ${tilingOk} ok / ${tilingBad} MISMATCH`)
    console.log(`  ...single-part (measured)         ${singlePart}`)
    console.log(`  ...multi-part (EXCLUDED, stated)  ${multiPartExcluded}`)
    console.log(`  ...whose anchors describe it      ${anchorSrcIsMini}`)
    console.log(`  subdivide asks posed              ${subPosed}`)
    console.log(`  deletes with a WITNESS            ${witnessed}`)
    console.log(`  ambiguous (pitch,start) — delete skipped ${ambiguousDeleteSkipped} · atom floor refused ${ambiguousAtomSkipped}`)
    console.log(`  -- CONTROLS --`)
    console.log(
      `  C4  DELETE leg    floor is the WHOLE document on ${floorIsWholeDoc}, a strict subset on ${floorIsStrictSubset}`,
    )
    console.log(
      `  C4  SUBDIVIDE leg floor is the WHOLE document on ${subFloorWholeDoc}, a strict subset on ${subFloorStrictSubset}` +
        `   <- the load-bearing half of route A's zero`,
    )
    console.log(
      `  C5  atom span found ${atomSpanFound} · INSIDE its region ${atomInsideRegion} · outside ${atomOutsideRegion}`,
    )
    console.log(`  -- the arms --`)
    show('SUB route A vs its ELEMENT', subAElement)
    show('SUB route A vs its ATOM', subAAtom)
    show('SUB route B vs its ELEMENT  <- C2', subBElement)
    show('DEL by surgery vs its ATOM  <- C3', delSurgeryAtom)
    show('DEL by surgery vs its ELEMENT', delSurgery)
    show('DEL by element writer vs its ATOM', delElementAtom)
    show('DEL by element writer vs ELEMENT', delElement)
    if (c3Violations.length > 0) {
      console.log(`\n  -- C3 VIOLATIONS (${c3Violations.length}), named --`)
      for (const v of c3Violations) console.log(`     ${v}`)
    }
    if (achieved.length > 0)
      console.log(
        `\n  WITNESS GAP (element writer bytes - surgery bytes), n=${achieved.length}` +
          `  p50=${med(achieved)}  min=${Math.min(...achieved)}  max=${Math.max(...achieved)}`,
      )

    console.log(`\n  -- FORCED (slack 0 against the atom), long docs --`)
    for (const e of exampleForced) console.log(`     ${e}`)
    console.log(`  -- SLACK (spread beyond the atom), long docs --`)
    for (const e of exampleSlack) console.log(`     ${e}`)

    // ---- C1: the tiling is the ground every offset stands on ----
    expect(tilingBad, 'C1 — the region walk does not reconstruct the source').toBe(0)
    expect(tilingOk, 'C1 never ran').toBeGreaterThan(0)

    // ---- the legs must be non-empty, else every column below is vacuous ----
    expect(subPosed, 'no subdivide ask was posed').toBeGreaterThan(0)
    expect(witnessed, 'no delete had a witness').toBeGreaterThan(0)

    // ---- C4: a floor equal to the whole document makes a zero trivially true ----
    expect(floorIsStrictSubset, 'C4 — the delete floor is never a strict subset').toBeGreaterThan(0)
    expect(subFloorStrictSubset, 'C4 — the subdivide floor is never a strict subset').toBeGreaterThan(0)

    // ---- C5: the atom must live inside the element said to contain it ----
    expect(atomSpanFound, 'C5 never ran — no atom spans found').toBeGreaterThan(0)
    expect(atomOutsideRegion, 'C5 — an atom span fell OUTSIDE its own region').toBe(0)

    // ---- C2 must FIRE and C3 must be SILENT. A detector that cannot do both is not one. ----
    expect(subBElement.n, 'C2 never ran').toBeGreaterThan(0)
    expect(subBElement.disjoint, 'C2 did not fire — route B never left its element').toBeGreaterThan(0)
    expect(delSurgeryAtom.n, 'C3 never ran').toBeGreaterThan(0)
    expect(delSurgeryAtom.disjoint, 'C3 — byte surgery left the note it replaced').toBe(0)
  })
})
