/**
 * _1058-locality.spec.ts — THE SPIKE PROBE for #1058.
 *
 * A `.spec.ts`, so vitest's `include` (`*.test.ts`) never collects it: this is a
 * probe, not a gate. Run explicitly with the spike config.
 *
 * The decision rule this answers was committed BEFORE this file existed —
 * `1058-LOCALITY-SPIKE.md`, commit `6901bb8d`. Nothing here may restate it.
 *
 * EVERYTHING IS SHIPPED CODE. Reader `parseStepGrid`, placement op `toggleCell`
 * (the one definition, #1048), writer `serializeStepGrid`, engine `enginePlayed`
 * from the committed oracle. The only new code is `refine()` — a pure rescale of
 * the model AND of the source regions that index it, which is the machinery
 * #1058 would ship. No re-implemented reader, no re-implemented writer, no
 * hand-built expected-output table ([[PV192]]).
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseStepGrid } from '../../../editor/src/codeView/notation/parse'
import { serializeStepGrid } from '../../../editor/src/codeView/notation/serialize'
import { toggleCell } from '../../../editor/src/codeView/notation/place'
import { ungatedToggle } from './ungatedOps'
import { scaleCell, isCellOn } from '../../../editor/src/codeView/notation/model'
import type {
  GridCells,
  StepGridModel,
} from '../../../editor/src/codeView/notation/model'
import type { ParseResult } from '../../../editor/src/codeView/notation/model'
import { enginePlayedCycle, HRES, type Note } from './engineEditOracle'

/**
 * `parseStepGrid` returns a discriminated union, so the model is reached through
 * the `ok` discriminant rather than by reading `.model` off either arm — the
 * refusal arm has no `model`, and reading it there is only invisible because
 * JavaScript hands back `undefined`.
 */
const opened = (r: ParseResult<StepGridModel>): StepGridModel | null => (r.ok ? r.model : null)
const refusalOf = (r: ParseResult<StepGridModel>): string => (r.ok ? '-' : r.reason)

const dir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(dir, 'mini-corpus.json'), 'utf8'),
)
const MINIS = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

/* ── the new machinery: refine the view, and the regions that index it ── */

/**
 * Rescale a region's content by `k`. A rescale is a change of UNITS across a SET
 * of fields ([[P362]]): the column index scales, and so does every length
 * expressed in columns. Each own-column becomes `k` own-columns, the first
 * carrying the notes at `k`x their length and the rest empty.
 */
const refineContent = (c: GridCells, k: number): GridCells =>
  c.flatMap((col) => [
    col.map((n) => ({ token: n.token, duration: n.duration * k })),
    ...Array.from({ length: k - 1 }, () => [] as GridCells[number]),
  ])

/**
 * Show the same pattern at `k`x the resolution WITHOUT rewriting it: the model
 * widens, and the source regions widen with it so the writer's splice path stays
 * alive. `factor` is shared-columns-per-own-column and both sides scale, so it is
 * the one field that does NOT move.
 */
function refine(model: StepGridModel, k: number): StepGridModel | null {
  const src = model.source
  if (!src) return null
  return {
    ...model,
    steps: model.steps * k,
    lanes: model.lanes.map((l) => ({
      ...l,
      cells: Array.from({ length: model.steps * k }, (_, i) =>
        i % k === 0 ? scaleCell(l.cells[i / k] ?? false, k) : false,
      ),
    })),
    ...(model.gains
      ? {
          gains: Array.from({ length: model.steps * k }, (_, i) =>
            i % k === 0 ? (model.gains![i / k] ?? 1) : 1,
          ),
        }
      : {}),
    source: {
      ...src,
      parts: src.parts.map((p) => ({
        ...p,
        div: p.div * k,
        regions: p.regions.map((r) => ({
          ...r,
          from: r.from * k,
          to: r.to * k,
          content: refineContent(r.content, k),
        })),
      })),
    },
  }
}

/* ── absolute source offsets, reconstructed from the regions and CHECKED ── */

interface ElemSpan {
  part: number
  factor: number
  /** own-column range this element covers */
  from: number
  to: number
  /** absolute byte span in the mini */
  a: number
  b: number
}

/**
 * Where each element's bytes sit in the original mini.
 *
 * Rebuilt by walking the same pieces the writer concatenates, then CHECKED
 * against the mini itself — if the walk reproduces the source exactly, the
 * offsets are right by construction rather than by assertion.
 */
function elemSpans(model: StepGridModel, mini: string): ElemSpan[] | null {
  const src = model.source
  if (!src) return null
  const out: ElemSpan[] = []
  let at = src.prefix.length
  let rebuilt = src.prefix
  for (const p of src.parts) {
    at += p.before.length
    rebuilt += p.before
    for (const r of p.regions) {
      out.push({
        part: p.part,
        factor: p.factor,
        from: r.from,
        to: r.to,
        a: at,
        b: at + r.raw.length,
      })
      at += r.raw.length
      rebuilt += r.raw
    }
    at += p.after.length
    rebuilt += p.after
  }
  rebuilt += src.suffix
  return rebuilt === mini ? out : null
}

/* ── the engine comparison ────────────────────────────────────────── */

const key = (n: Note) =>
  `${Math.round(n.pos * HRES)}|${Math.round(n.dur * HRES)}|${n.atom}`

function multisetDiff(want: Note[], got: Note[]) {
  const counts = new Map<string, number>()
  for (const n of want) counts.set(key(n), (counts.get(key(n)) ?? 0) + 1)
  const added: Note[] = []
  for (const n of got) {
    const k = key(n)
    const c = counts.get(k) ?? 0
    if (c > 0) counts.set(k, c - 1)
    else added.push(n)
  }
  const removed: Note[] = []
  for (const n of want) {
    const k = key(n)
    const c = counts.get(k) ?? 0
    if (c > 0) {
      counts.set(k, c - 1)
      removed.push(n)
    }
  }
  return { added, removed }
}

type PlayVerdict =
  | { ok: true; clamped: boolean }
  | { ok: false; why: string; added: Note[]; removed: Note[] }

/**
 * The edited document must play the original PLUS exactly one row, at the onset
 * the click asked for. The single change allowed to a pre-existing row is the
 * placement clamp — a note that was sounding through the new onset ending exactly
 * at it — and that allowance was written down before the run.
 */
function playsCorrectly(
  original: string,
  edited: string,
  bars: number,
  newPos: number,
): PlayVerdict | null {
  let added: Note[] = []
  let removed: Note[] = []
  for (let b = 0; b < bars; b++) {
    const want = enginePlayedCycle(original, b)
    const got = enginePlayedCycle(edited, b)
    if (want === null || got === null) return null
    const d = multisetDiff(want, got)
    added = added.concat(d.added)
    removed = removed.concat(d.removed)
  }
  const hit = added.filter((n) => Math.abs(n.pos - Math.floor(n.pos) - newPos) < 1e-9)
  if (hit.length !== 1) return { ok: false, why: 'no-single-new-hit-at-target', added, removed }
  if (removed.length === 0 && added.length === 1) return { ok: true, clamped: false }
  // the one allowance: a note of the same atom, starting earlier, shortened to
  // end exactly at the new onset
  if (removed.length === 1 && added.length === 2) {
    const x = removed[0]
    const xs = added.find((n) => n !== hit[0])
    const localStart = x.pos - Math.floor(x.pos)
    if (
      xs &&
      xs.atom === x.atom &&
      Math.abs(xs.pos - x.pos) < 1e-9 &&
      Math.abs(xs.dur - (newPos - localStart)) < 1e-9 &&
      localStart < newPos &&
      localStart + x.dur > newPos
    )
      return { ok: true, clamped: true }
  }
  return { ok: false, why: 'other-rows-moved', added, removed }
}

/**
 * Why did the writer say no? A CLASSIFICATION of the model, not a second oracle:
 * the writer has already given its verdict (`null`) and nothing here overrides it.
 * This only sorts the refusals into shapes so the residual has a mechanism rather
 * than a count.
 */
function declineCause(
  refined: StepGridModel,
  spans: ElemSpan[],
  lane: number,
  col: number,
): string {
  const bars = refined.bars ?? 1
  const l = refined.lanes[lane]
  const part = l.part ?? 0
  const sp = spans.filter((s) => s.part === part)
  const own = col / (sp[0]?.factor ?? 1)
  const el = Number.isInteger(own) ? sp.find((s) => own >= s.from && own < s.to) : undefined
  if (!el) return 'column-not-in-this-part (factor>1)'

  // A note in ANOTHER lane sounding THROUGH the clicked column. The grid has no
  // notation for "cp stops halfway and bd starts" as two lanes of one column —
  // `[_,bd]` is a chord containing a token that means nothing there. `toggleCell`
  // clamps the lane it edits, and only that lane, so the model reaching the writer
  // says two things at once and the writer rightly declines.
  for (const ln of refined.lanes) {
    if ((ln.part ?? 0) !== part) continue
    if (ln === l) continue
    for (let i = 0; i < ln.cells.length; i++) {
      const c = ln.cells[i]
      if (!isCellOn(c)) continue
      if (i < col && i + c.duration > col) return 'covered-by-ANOTHER-lane-sustain'
    }
  }
  // the same thing within the clicked lane, which `clampLane` should already have
  // resolved — here to prove it does
  for (let i = 0; i < l.cells.length; i++) {
    const c = l.cells[i]
    if (!isCellOn(c)) continue
    if (i < col && i + c.duration > col) return 'covered-by-OWN-lane-sustain (clamp missed)'
  }

  // a note whose sound reaches past the element that wrote it: its `_` would have
  // to land in bytes this element does not own
  let crosses = false
  let fractional = false
  for (const ln of refined.lanes) {
    if ((ln.part ?? 0) !== part) continue
    for (let i = 0; i < ln.cells.length; i++) {
      const c = ln.cells[i]
      if (!isCellOn(c)) continue
      const o = i / (sp[0]?.factor ?? 1)
      if (!Number.isInteger(o)) continue
      const d = c.duration / (sp[0]?.factor ?? 1)
      if (Math.abs(d - Math.round(d)) > 1e-6) fractional = true
      const owner = sp.find((s) => o >= s.from && o < s.to)
      if (owner && o + d > owner.to + 1e-6) {
        crosses = true
        if (owner === el) return 'sustain-crosses-THIS-element'
      }
    }
  }
  if (fractional) return 'fractional-length'
  if (crosses) return 'sustain-crosses-another-element'
  if (bars > 1) return `multi-bar (bars=${bars})`
  if (refined.source!.parts.length > 1) return 'multi-part'
  if (refined.gains) return 'has-gains'
  return 'unclassified'
}

/**
 * HYPOTHESIS ARM — not shipped code, and labelled so it can never be quoted as if
 * it were. `toggleCell` clamps the lane it edits, and only that lane: "a new onset
 * takes the room an earlier note was sounding through". The grid's notation
 * constraint is per COLUMN, though — one token per column, `_` for a sustain — so a
 * note sustaining in ANY lane blocks the column, not just one in the clicked lane.
 *
 * This arm asks what the acceptance rate would be if the clamp spanned the column
 * instead of the lane. It measures the size of a possible fix; it does not make one.
 */
function clampAcrossLanes(model: StepGridModel, col: number, part: number): StepGridModel {
  return {
    ...model,
    lanes: model.lanes.map((ln) =>
      (ln.part ?? 0) !== part
        ? ln
        : {
            ...ln,
            cells: ln.cells.map((c, i) =>
              isCellOn(c) && i < col && i + c.duration > col
                ? { ...c, duration: col - i }
                : c,
            ),
          },
    ),
  }
}

/* ── the sweep ────────────────────────────────────────────────────── */

interface Tally {
  [k: string]: number
}
const bump = (t: Tally, k: string, n = 1) => (t[k] = (t[k] ?? 0) + n)

function sweep(asksPerUnit: number) {
  const pop: Tally = {}
  const ask: Tally = {}
  const declineShapes = new Map<string, number>()
  const corrupt: string[] = []
  const declineSamples: string[] = []
  const nonLocal: string[] = []
  const corruptUnits = new Set<string>()
  const nonLocalUnits = new Set<string>()

  for (const mini of MINIS) {
    let res
    try {
      res = parseStepGrid(mini)
    } catch {
      bump(pop, 'reader-threw')
      continue
    }
    const m = opened(res)
    if (!m) {
      bump(pop, 'no-grid-view')
      continue
    }
    if (m.leafSource) {
      bump(pop, 'excluded:leaf-path')
      continue
    }
    if (m.altSource) {
      bump(pop, 'excluded:alt-path')
      continue
    }
    if (!m.source) {
      bump(pop, 'excluded:no-source')
      continue
    }
    if (serializeStepGrid(m) !== mini) {
      bump(pop, 'excluded:no-identity-base')
      continue
    }
    const refined = refine(m, 2)
    if (!refined) {
      bump(pop, 'excluded:refine-null')
      continue
    }
    // Spans come from the REFINED model, not the parsed one. `refine` leaves every
    // byte (`prefix`/`before`/`raw`/`after`/`suffix`) alone and scales only the
    // column ranges, so the walk still reproduces the original mini — while the
    // `from`/`to` it reports are in the SAME column space as the click. Taking them
    // from the unrefined model compares a refined column against an unrefined range
    // and mis-attributes every click to the next element along.
    const spans = elemSpans(refined, mini)
    if (!spans) {
      bump(pop, 'excluded:span-walk-mismatch')
      continue
    }
    bump(pop, 'IN-POPULATION')

    const bars = m.bars ?? 1
    // every newly-created column, every lane — sampled deterministically so the
    // cap is a stated depth rather than a silent truncation
    const cand: Array<{ lane: number; col: number }> = []
    for (let lane = 0; lane < refined.lanes.length; lane++)
      for (let col = 1; col < refined.steps; col += 2) cand.push({ lane, col })
    const step = Math.max(1, Math.floor(cand.length / asksPerUnit))
    const picked = cand.filter((_, i) => i % step === 0).slice(0, asksPerUnit)
    if (picked.length < cand.length) bump(pop, 'units-sampled')

    for (const { lane, col } of picked) {
      bump(ask, 'asks')
      // ASK THE OP FOR ITS OWN VERDICT, never the writer for one (#1073). Since
      // #1071 `toggleCell` answers "could not apply" by returning its INPUT by
      // reference — and the input is the user's current model, which serializes
      // perfectly well. Inferring acceptance from a non-null serialize therefore
      // counts every refusal as an acceptance, which is not a skew but the loss of
      // the distinction: measured unmodified on this tree, every cell of this sweep
      // read 100.0% regardless of what the code did, and the refused clicks went on
      // to reach the playback oracle as edits and fail it — 9,082 CORRUPT asks at
      // ALL depth against the 86 the committed artifact reports.
      //
      // `op(x) !== x` is the signal the `notation/` family defines and the one every
      // `can*` is derived from, so this cannot drift away from the op again.
      const next = toggleCell(refined, lane, col, true)
      const edited = next === refined ? null : serializeStepGrid(next)
      // HYPOTHESIS ARM, measured on every ask so the two are directly comparable.
      // It asks what a clamp ACROSS the part would have made spellable, so it is
      // built on the UNGATED toggle rather than the shipped one: the shipped op
      // refuses exactly the placements this arm exists to rescue, and
      // `clampAcrossLanes` cannot decline, so composing on the gated op would clamp
      // an UNMODIFIED model, serialize it fine and score the rescue it never
      // performed ([[P379]] — composing a decline-capable op with one that cannot
      // moves the verdict onto the caller).
      {
        const alt = serializeStepGrid(
          clampAcrossLanes(
            ungatedToggle(refined, lane, col, true),
            col,
            refined.lanes[lane].part ?? 0,
          ),
        )
        if (alt === null) bump(ask, 'ALT:declined')
        else {
          bump(ask, 'ALT:accepted')
          const ap = playsCorrectly(mini, alt, bars, (col % (refined.steps / bars)) / (refined.steps / bars))
          if (ap === null) bump(ask, 'ALT:no-engine-probe')
          else if (!ap.ok) bump(ask, 'ALT:play-differs')
          else bump(ask, 'ALT:plays')
          const l3 = refined.lanes[lane]
          const sp3 = spans.filter((s) => s.part === (l3.part ?? 0))
          const own3 = col / (sp3[0]?.factor ?? 1)
          const el3 = Number.isInteger(own3)
            ? sp3.find((s) => own3 >= s.from && own3 < s.to)
            : undefined
          if (el3) {
            const t3 = mini.length - el3.b
            if (
              alt.slice(0, el3.a) === mini.slice(0, el3.a) &&
              (t3 === 0 || alt.slice(alt.length - t3) === mini.slice(el3.b))
            )
              bump(ask, 'ALT:LOCAL')
            else bump(ask, 'ALT:NON-LOCAL')
          }
        }
      }

      if (edited === null) {
        bump(ask, 'declined')
        const cause = declineCause(refined, spans, lane, col)
        declineShapes.set(cause, (declineShapes.get(cause) ?? 0) + 1)
        if (cause === 'unclassified' && declineSamples.length < 15) {
          const l2 = refined.lanes[lane]
          const sp2 = spans.filter((s) => s.part === (l2.part ?? 0))
          const el2 = sp2.find((s) => col >= s.from && col < s.to)
          declineSamples.push(
            `${JSON.stringify(mini)}  lane ${lane} (${l2.sound}) col ${col}/${refined.steps}  element=${JSON.stringify(el2 ? mini.slice(el2.a, el2.b) : '?')} [${el2?.from},${el2?.to})  div=${refined.source!.parts[0].div}  cellsOn=${l2.cells.map((c, i) => (isCellOn(c) ? `${i}:${c.duration}` : null)).filter(Boolean).join(',')}`,
          )
        }
        continue
      }
      bump(ask, 'accepted')

      // P2 — it plays
      const newPos = (col % (refined.steps / bars)) / (refined.steps / bars)
      const play = playsCorrectly(mini, edited, bars, newPos)
      if (play === null) {
        bump(ask, 'no-engine-probe')
      } else if (!play.ok) {
        bump(ask, 'CORRUPT')
        // BASE ARM: does the SAME unit corrupt under a plain toggle with no refine
        // at all? If it does, the corruption belongs to the shipped write path and
        // subdivision-on-placement did not introduce it ([[PK64]]).
        // Ask the SHIPPED resolution, no refine at all: does a plain placement
        // anywhere in this lane corrupt too? Every empty column is tried, so a
        // "no probe" verdict means the unit offers no plain placement at all
        // rather than that one particular column was awkward.
        let baseVerdict = 'no-base-probe'
        for (let bc = 0; bc < m.steps; bc++) {
          if (isCellOn(m.lanes[lane]?.cells[bc])) continue
          const bn = toggleCell(m, lane, bc, true)
          const b0 = bn === m ? null : serializeStepGrid(bn)
          if (b0 === null) {
            if (baseVerdict === 'no-base-probe') baseVerdict = 'base-declines'
            continue
          }
          const bp = playsCorrectly(mini, b0, bars, (bc % (m.steps / bars)) / (m.steps / bars))
          if (bp === null) continue
          if (!bp.ok) {
            baseVerdict = 'base-CORRUPT'
            break
          }
          baseVerdict = 'base-CLEAN'
        }
        bump(ask, `CORRUPT:${baseVerdict}`)
        corruptUnits.add(mini)
        if (corrupt.length < 12)
          corrupt.push(
            `--- ${play.why} / ${baseVerdict}\n    IN : ${JSON.stringify(mini)}\n    OUT: ${JSON.stringify(edited)}\n    lane ${lane} col ${col}  +${JSON.stringify(play.added)} -${JSON.stringify(play.removed)}`,
          )
        continue
      } else {
        bump(ask, 'plays')
        if (play.clamped) bump(ask, 'plays:via-clamp')
      }

      // P3 — it is local. Denominator = accepted (and, where the engine could
      // speak, playing) asks; reported both ways below.
      const l = refined.lanes[lane]
      const partIdx = l.part ?? 0
      const sp = spans.filter((s) => s.part === partIdx)
      const own = col / (sp[0]?.factor ?? 1)
      const el = Number.isInteger(own) ? sp.find((s) => own >= s.from && own < s.to) : undefined
      if (!el) {
        bump(ask, 'no-element-for-column')
        continue
      }
      const tail = mini.length - el.b
      const prefixOk = edited.slice(0, el.a) === mini.slice(0, el.a)
      const suffixOk = tail === 0 || edited.slice(edited.length - tail) === mini.slice(el.b)
      if (prefixOk && suffixOk) {
        bump(ask, 'LOCAL')
        if (play?.ok) bump(ask, 'LOCAL:and-plays')
      } else {
        bump(ask, 'NON-LOCAL')
        nonLocalUnits.add(mini)
        if (nonLocal.length < 12)
          nonLocal.push(
            `${mini}  [lane ${lane} col ${col}] -> ${edited}   (element bytes [${el.a},${el.b}) = "${mini.slice(el.a, el.b)}"; prefixOk=${prefixOk} suffixOk=${suffixOk})`,
          )
      }
    }
  }
  return { pop, ask, declineShapes, corrupt, nonLocal, declineSamples, corruptUnits, nonLocalUnits }
}

/* ── P0: the issue's own load-bearing claim ──────────────────────── */

describe('#1058 spike', () => {
  it('P0 — the precondition', () => {
    for (const s of [
      'bd [~ bd bd _ bd _ _ _] sn ~',
      '[~ bd bd _ bd _ _ _]',
      'bd [~ bd bd _ bd ~ ~ ~] sn ~',
      'bd [~ bd bd ~ bd _ _ _] sn ~',
      'bd [~ bd bd ~ bd ~ ~ ~] sn ~',
      'bd [~ bd bd _] sn ~',
      'bd [~ hh] sn ~',
      'bd ~ sn ~',
      'bd [~ [hh ~]] sn ~',
      'bd sd, hh*4',
    ]) {
      const r = parseStepGrid(s)
      const m = opened(r)
      const back = m ? serializeStepGrid(m) : null
      console.log(
        `P0  ${JSON.stringify(s).padEnd(34)} reason=${refusalOf(r)} opens=${!!m} steps=${m?.steps ?? '-'} bars=${m?.bars ?? 1} path=${m?.leafSource ? 'leaf' : m?.altSource ? 'alt' : m?.source ? 'source' : 'none'} roundTrip=${back === s} back=${JSON.stringify(back)}`,
      )
    }
  })

  it('the sweep', () => {
    // Sampling DEPTH is stated, not chosen: the same sweep at four depths, the
    // last of them the complete enumeration ([[P359]] — two shallow samples agree
    // with each other). `A` is depth-sensitive and says so.
    for (const cap of [2, 4, 8, Number.MAX_SAFE_INTEGER]) {
      const { pop, ask, declineShapes, corrupt, nonLocal, declineSamples, corruptUnits, nonLocalUnits } = sweep(cap)
      const acc = ask['accepted'] ?? 0
      const A = (ask['asks'] ?? 0) ? acc / ask['asks'] : 0
      const L = acc ? (ask['LOCAL'] ?? 0) / acc : 0
      console.log(`\n===== #1058 SWEEP  (asks/unit cap = ${cap === Number.MAX_SAFE_INTEGER ? "ALL" : cap}) =====`)
      console.log(`corpus minis (deduped): ${MINIS.length}`)
      console.log('population:', JSON.stringify(pop, null, 0))
      console.log('asks:', JSON.stringify(ask, null, 0))
      console.log(`A (accepted / asks)          = ${(A * 100).toFixed(1)}%`)
      console.log(`L (local / accepted)         = ${(L * 100).toFixed(1)}%`)
      console.log(`CORRUPT                      = ${ask['CORRUPT'] ?? 0} asks over ${corruptUnits.size} DISTINCT units`)
      console.log(`NON-LOCAL                    = ${ask['NON-LOCAL'] ?? 0} asks over ${nonLocalUnits.size} DISTINCT units`)
      if (cap === Number.MAX_SAFE_INTEGER) {
        console.log(
          '\ndecline shapes:',
          [...declineShapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
        )
        if (declineSamples.length) console.log('\nUNCLASSIFIED DECLINE samples:\n  ' + declineSamples.join('\n  '))
        if (corrupt.length) console.log('\nCORRUPT samples:\n' + corrupt.join('\n'))
        if (nonLocal.length) console.log('\nNON-LOCAL samples:\n' + nonLocal.join('\n'))
      }
    }
  })

  it('BASE ARM — the shipped resolution, no refine anywhere', () => {
    // The same population and the same op, asked WITHOUT subdivision: every empty
    // cell of every lane, placed at the resolution the document already has. This
    // is what attributes the acceptance rate — a decline rate that is already this
    // high here belongs to the shipped placement path, not to subdivision.
    const t: Tally = {}
    for (const mini of MINIS) {
      let m: StepGridModel | null
      try {
        m = opened(parseStepGrid(mini))
      } catch {
        continue
      }
      if (!m || m.leafSource || m.altSource || !m.source) continue
      if (serializeStepGrid(m) !== mini) continue
      const mm: StepGridModel = m
      bump(t, 'units')
      for (let lane = 0; lane < mm.lanes.length; lane++)
        for (let col = 0; col < mm.steps; col++) {
          if (isCellOn(mm.lanes[lane].cells[col])) continue
          bump(t, 'asks')
          const nx = toggleCell(mm, lane, col, true)
          const out = nx === mm ? null : serializeStepGrid(nx)
          if (out === null) {
            bump(t, 'declined')
            const covered = mm.lanes.some(
              (ln, i) =>
                i !== lane &&
                (ln.part ?? 0) === (mm.lanes[lane].part ?? 0) &&
                ln.cells.some((c, j) => isCellOn(c) && j < col && j + c.duration > col),
            )
            bump(t, covered ? 'declined:covered-by-ANOTHER-lane' : 'declined:other')
          } else bump(t, 'accepted')
        }
    }
    console.log('\n===== BASE ARM (shipped resolution, no refine) =====')
    console.log(JSON.stringify(t))
    console.log(
      `A_base (accepted / asks) = ${(((t['accepted'] ?? 0) / (t['asks'] ?? 1)) * 100).toFixed(1)}%`,
    )
  })

  it('nesting depth under repeated clicks', () => {
    const depth = (s: string) => {
      let d = 0
      let max = 0
      for (const ch of s) {
        if (ch === '[') max = Math.max(max, ++d)
        else if (ch === ']') d--
      }
      return max
    }
    for (const start of ['bd ~ sn ~', 'bd sn', 'bd ~ ~ ~ sn ~ ~ ~']) {
      let cur = start
      const line: string[] = []
      for (let n = 1; n <= 6; n++) {
        const m = opened(parseStepGrid(cur))
        if (!m || !m.source) {
          line.push(
            `n=${n}: LEFT THE SPLICE PATH — opens=${!!m} steps=${m?.steps ?? '-'} path=${m?.leafSource ? 'leaf' : m?.altSource ? 'alt' : m ? 'model-without-source' : 'refused'}`,
          )
          break
        }
        const r = refine(m, 2)
        if (!r) break
        // click on the LAST new column of element 1 — the same element every time,
        // which is the worst case the issue names
        const perBar = r.steps / (m.bars ?? 1)
        const col = Math.min(r.steps - 1, Math.floor(perBar / 4) | 1)
        const next = toggleCell(r, 0, col, true)
        const out = next === r ? null : serializeStepGrid(next)
        if (out === null) {
          line.push(`n=${n}: DECLINED`)
          break
        }
        line.push(`n=${n}: depth=${depth(out)} steps=${r.steps} "${out}"`)
        cur = out
      }
      console.log(`\nNESTING "${start}"\n  ` + line.join('\n  '))
    }
  })
})
