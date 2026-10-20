/**
 * edit-locality.test.ts — an edit must change only what it edits.
 *
 * THE LAW (the design doc's invariant B, "round-trip fidelity"): for any
 * modeled edit on a view, the document diff must be CONFINED TO THE EDITED
 * SPAN. Everything the user wrote elsewhere — their `*2`, their `!3`, their
 * groups, their spacing — is none of the edit's business and must survive it
 * byte-identically.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `round-trip.test.ts`. That file measures
 * the UNEDITED open→write path: `serialize(parse(mini)) === mini`. It is
 * necessary and it is not sufficient — it can be satisfied completely without
 * fixing anything a user can see. An implementation that stores the source text
 * and returns it whenever the model is untouched scores a perfect round-trip
 * and still destroys the line on the first click, because the destruction
 * happens on the EDITED path, which that file never exercises. The two files
 * are the two halves of one property, and this is the half with the bug in it.
 *
 * WHAT AN EDIT ACTUALLY DOES TODAY (observed, `bd hh*2 sd cp`, one cell nudged
 * in the `bd` region — nowhere near the `hh*2`):
 *
 *     bd hh*2 sd cp   ->   bd bd hh hh sd ~ cp ~
 *
 * The `*2` is collateral. `useGridModel.mutate` writes `serialize(model)` over
 * the WHOLE mini range, and the model is a flat boolean grid that never knew
 * the `*2` existed, so every edit rewrites every element.
 *
 * THE ORACLE. The element boundaries come from krill — Strudel's own parser,
 * the same authority `parse.ts` consumes — and never from a second scanner
 * written here. A check is only worth the independence of its reference: a
 * hand-written table of expected outputs would encode the same beliefs as the
 * code it checks, and could not disagree with it.
 *
 * THE PROBE. For each mini the grid opens, flip the LAST column and assert the
 * source PREFIX (everything before the last top-level element) is untouched.
 * The last column belongs to the last element — columns run in time order and
 * so do elements — so every byte before it is, by the law, none of the edit's
 * business.
 *
 * `,`-stacks are covered by editing a lane of the LAST part, which makes the
 * prefix an entire neighbouring VOICE. That case is here because the first
 * version of this file skipped stacks — krill reports a stack as one top-level
 * node rather than a sequence, so they fell out of the probe silently — and a
 * real bug lived in exactly that hole: painting a cell into `bd sd, hh*4`
 * destroyed the `hh*4` next door. A gate that does not cover a shape is not
 * evidence about that shape, and its green says nothing.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as krillParse } from '@strudel/mini/krill-parser.js'

// Deep source path, not the `@stave/editor` barrel (same convention as
// round-trip.test.ts:57 — the barrel drags gifenc/CJS into the ESM resolver).
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import {
  serializeStepGrid,
  serializePianoRoll,
} from '../../../editor/src/codeView/notation/serialize'
import { resizeRoll } from '../../../editor/src/codeView/notation/resize'
// The PRODUCTION cell toggle — what a click on a cell actually does. Modelling
// the edit here instead would be a second oracle for what an edit *is*, and it
// could not catch a change in the edit: it would quietly keep testing the old
// one (#1048).
import { toggleCell } from '../../../editor/src/codeView/notation/place'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
import { enginePlayedCycle } from './engineEditOracle'
import { truePeriod } from './enginePeriod'
import type {
  PianoRollModel,
  RollNote,
} from '../../../editor/src/codeView/notation/model'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)

interface KEl {
  location_?: { start?: { offset?: number }; end?: { offset?: number } }
}
interface KPat {
  type_?: string
  arguments_?: { alignment?: string }
  source_?: unknown
}

/**
 * What this probe edits, and the byte offset everything before which must
 * survive it. Offsets are into the QUOTED string krill was handed, so they carry
 * a +1.
 *
 *   - `element` — the LAST top-level element of a flat sequence, or the last BAR
 *     of a whole-string `<…>` alternation. `end` bounds it, so the caller can
 *     ask what that one element produces by parsing it alone.
 *   - `part` — the LAST `,`-part. Everything before it is another part's, which
 *     is the sharpest version of this law: parts are independent voices and an
 *     edit to one has no business touching another. (krill puts no `location_`
 *     on child patterns, only on their elements — so the boundary comes from the
 *     last part's first element, still the authority's answer and not a
 *     comma-scanner of ours.)
 */
type Target =
  | { kind: 'element'; start: number; end: number; part: 0 }
  | { kind: 'part'; start: number; part: number }

/** `<a b c>` → the fastcat of bars inside it, or null if that isn't this shape */
function alternationBars(root: KPat): KEl[] | null {
  const children = root.source_
  if (!Array.isArray(children) || children.length !== 1) return null
  const inner = (children[0] as { source_?: KPat })?.source_
  if (inner?.type_ !== 'pattern' || inner.arguments_?.alignment !== 'polymeter_slowcat') return null
  const seq = inner.source_
  if (!Array.isArray(seq) || seq.length !== 1) return null
  const els = (seq[0] as KPat)?.source_
  return Array.isArray(els) && els.length > 1 ? (els as KEl[]) : null
}

const span = (el: KEl): { start: number; end: number } | null => {
  const s = el?.location_?.start?.offset
  const e = el?.location_?.end?.offset
  return typeof s === 'number' && typeof e === 'number' ? { start: s - 1, end: e - 1 } : null
}

/**
 * Returns null when there is nothing to prove — a lone element with no
 * neighbour to preserve.
 */
function lastElement(src: string): Target | null {
  let ast: KPat
  try {
    ast = krillParse('"' + src + '"') as KPat
  } catch {
    return null
  }
  if (ast?.type_ !== 'pattern') return null
  const align = ast.arguments_?.alignment
  const children = ast.source_
  if (!Array.isArray(children)) return null

  if (align === 'fastcat') {
    // A whole-string `<…>` is ONE top-level element, so the flat arm below sees
    // nothing to preserve and would drop every multi-bar pattern in the corpus.
    // Its bars are elements like any other, one level down, and they tile the
    // text inside the brackets — so the law applies there unchanged.
    const bars = alternationBars(ast)
    if (bars) {
      const s = span(bars[bars.length - 1])
      return s ? { kind: 'element', start: s.start, end: s.end, part: 0 } : null
    }
    if (children.length < 2) return null
    const s = span(children[children.length - 1] as KEl)
    return s ? { kind: 'element', start: s.start, end: s.end, part: 0 } : null
  }
  if (align === 'stack') {
    if (children.length < 2) return null
    const lastPart = children[children.length - 1] as KPat
    const els = lastPart?.source_
    if (!Array.isArray(els) || els.length === 0) return null
    const s = span(els[0] as KEl)
    return s ? { kind: 'part', start: s.start, part: children.length - 1 } : null
  }
  return null
}

interface Violation {
  mini: string
  out: string
  prefix: string
}

/**
 * Flip the last column of a lane in the last element's own part, and see what
 * happened to everything written before it.
 */
function probe(mini: string): Violation | null {
  const src = mini.trim()
  const target = lastElement(src)
  if (target === null) return null
  const r = parseStepGrid(src)
  if (!r.ok) return null
  const model = r.model
  const laneIndex = model.lanes.findIndex((l) => (l.part ?? 0) === target.part)
  const lane = model.lanes[laneIndex]
  if (!lane || model.steps < 1) return null
  const last = model.steps - 1
  const edited = toggleCell(model, laneIndex, last, !isCellOn(lane.cells[last]))
  let out: string | null
  try {
    out = serializeStepGrid(edited)
  } catch {
    return null
  }
  if (out === null) return null
  const prefix = src.slice(0, target.start)
  return out.startsWith(prefix) ? null : { mini: src, out, prefix }
}

/* ── the roll ──────────────────────────────────────────────────── */

/**
 * The Piano Roll's own edit: drag a note to a new pitch. Mirrors
 * `PianoRollGrid.tsx`'s pointer-up — `[...baseNotes, { pitch, start, duration }]`
 * — including that it builds a FRESH note rather than mutating one, which is
 * why the writer cannot identify notes by index and this probe cannot either.
 *
 * A drag is the right gesture here where the grid uses a cell flip: it touches
 * nothing but its own note. `placeNote` would have been the closer analogue and
 * is the wrong tool — it trims an earlier note that sustains across the target,
 * which changes an earlier element LEGITIMATELY, and a probe that called it
 * would report those as violations.
 */
function dragPitch(m: PianoRollModel, note: RollNote, pitch: string): PianoRollModel {
  return {
    ...m,
    notes: [
      ...m.notes.filter((n) => n !== note),
      { pitch, start: note.start, duration: note.duration },
    ],
  }
}

/** a pitch in the model's own convention (#469) that isn't already at `start` */
function freshPitch(m: PianoRollModel, start: number): string | null {
  const at = m.notes.filter((n) => n.start === start).map((n) => n.pitch)
  const cands = m.numeric ? ['0', '1', '2', '3', '4'] : ['c4', 'd4', 'e4', 'f4', 'g4']
  return cands.find((p) => !at.includes(p)) ?? null
}

/**
 * Why a roll mini isn't probed. Named rather than counted: an applicability
 * filter is a silent scope reduction, and the shape it drops is exactly where a
 * bug hides — so these get PRINTED, because `applicable: N` invites nobody to
 * ask "N of what?".
 */
const REJECTS = [
  'roll does not open it',
  'no neighbour to preserve (a lone element)',
  'the last element/bar sounds no note (a rest — the drag would land elsewhere)',
  'last part has no note identifiable in the model',
  'no fresh pitch available',
  'serializer returned null',
] as const
type Reject = (typeof REJECTS)[number]

/**
 * Drag one note inside the last element (flat) or the last part (a `,`-stack),
 * and see what happened to everything written before it.
 *
 * WHICH NOTE, and why it is sound to call it "the last element's":
 *   - element — the note with the greatest START. Elements own disjoint column
 *     ranges in time order, so if the last element sounds anything at all, the
 *     latest-starting note in the whole model is one of its own. Whether it
 *     sounds anything is answered by parsing that ONE element's bytes (krill
 *     gave us its span) and asking if it yields a note — never by our column
 *     accounting, which is the code under test.
 *
 *     "The note AT the last column" was the first cut and it was wrong: `c4*2 e4`
 *     is four columns, and `e4` starts at 2 and sustains to 4. It dropped 55
 *     minis for having no note at their last column, which is not a fact about
 *     them — it is `div` arithmetic leaking into the probe.
 *   - part — parse the last part's own source text (the slice from its first
 *     element) and map its notes onto the shared grid by the ratio of the two
 *     step counts. Arithmetic, not a second grammar.
 */
function rollProbe(mini: string): Violation | Reject | null {
  const src = mini.trim()
  const target = lastElement(src)
  if (target === null) return 'no neighbour to preserve (a lone element)'
  const r = parsePianoRoll(src)
  if (!r.ok) return 'roll does not open it'
  const model = r.model
  if (model.steps < 1 || model.notes.length === 0) return 'roll does not open it'

  let note: RollNote | undefined
  if (target.kind === 'element') {
    // does the last element/bar sound anything? ask its own bytes
    const tail = parsePianoRoll(src.slice(target.start, target.end).trim())
    if (!tail.ok || tail.model.notes.length === 0) {
      return 'the last element/bar sounds no note (a rest — the drag would land elsewhere)'
    }
    const latest = Math.max(...model.notes.map((n) => n.start))
    note = model.notes.find((n) => n.start === latest)
  } else {
    // the last part, standing alone — its notes in its OWN column space
    const tail = parsePianoRoll(src.slice(target.start).trim())
    if (!tail.ok || tail.model.steps < 1 || tail.model.notes.length === 0) {
      return 'last part has no note identifiable in the model'
    }
    const factor = model.steps / tail.model.steps
    if (!Number.isInteger(factor)) return 'last part has no note identifiable in the model'
    for (const n of tail.model.notes) {
      const found = model.notes.find((x) => x.pitch === n.pitch && x.start === n.start * factor)
      if (found) {
        note = found
        break
      }
    }
    if (!note) return 'last part has no note identifiable in the model'
  }
  if (!note) return 'last part has no note identifiable in the model'

  const pitch = freshPitch(model, note.start)
  if (pitch === null) return 'no fresh pitch available'
  let out: string | null
  try {
    out = serializePianoRoll(dragPitch(model, note, pitch))
  } catch {
    return 'serializer returned null'
  }
  if (out === null) return 'serializer returned null'
  const prefix = src.slice(0, target.start)
  return out.startsWith(prefix) ? null : { mini: src, out, prefix }
}

const isReject = (x: Violation | Reject | null): x is Reject =>
  typeof x === 'string' && (REJECTS as readonly string[]).includes(x)

const rollOutcomes = corpus.minis.map(({ mini }) => rollProbe(mini))
const rollRows = rollOutcomes.filter((v): v is Violation => v !== null && !isReject(v))

/**
 * What the filter THREW AWAY, itemised. The count of what a sweep accepted is
 * the one line anybody reads and the one that cannot confess anything: this
 * probe's ancestor reported `applicable: 248` while silently dropping all 63
 * `,`-stacks, and the bug it was written for was living in that hole.
 */
const rollRejects = REJECTS.map((r) => ({
  reason: r,
  n: rollOutcomes.filter((x) => x === r).length,
})).filter((x) => x.n > 0)

const rows = corpus.minis
  .map(({ mini }) => probe(mini))
  .filter((v): v is Violation => v !== null)

const applicable = corpus.minis.filter(({ mini }) => {
  const src = mini.trim()
  const t = lastElement(src)
  if (t === null) return false
  const r = parseStepGrid(src)
  return r.ok && r.model.lanes.some((l) => (l.part ?? 0) === t.part) && r.model.steps > 0
}).length

/* ── the roll ──────────────────────────────────────────────────── */

describe('edit locality — an edit must not touch what it did not edit', () => {
  /**
   * THE LAW. Not a snapshot: a snapshot of violations would pin the damage as
   * acceptable, and this property has no legitimate residual. Everything before
   * the edited element is the user's, and an edit that rewrites it is a bug on
   * every row.
   */
  it('grid: editing the last column leaves every earlier element byte-identical', () => {
    const report = rows
      .slice(0, 12)
      .map((v) => `  ${JSON.stringify(v.mini)}\n     ->   ${JSON.stringify(v.out)}\n     kept?  ${JSON.stringify(v.prefix)}`)
      .join('\n')
    expect(
      rows.length,
      `${rows.length} of ${applicable} real minis lose notation OUTSIDE the edited element.\n${report}`,
    ).toBe(0)
  })

  /**
   * The design doc's own falsifier, spelled out: "`bd!3 sd` survives an edit
   * byte-identically outside the edited span." Kept as a named case next to the
   * corpus sweep because a sweep tells you HOW MANY and a case tells you WHAT.
   */
  it('grid: `bd!3 sd` keeps its `!3` when the edit lands on the `sd`', () => {
    const r = parseStepGrid('bd!3 sd')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // lane 0 is `bd`; column 3 is the `sd` step — turn `bd` on there
    const edited = toggleCell(r.model, 0, 3, true)
    expect(serializeStepGrid(edited) ?? '<null>').toBe('bd!3 [bd,sd]')
  })

  /**
   * A `,`-part is an independent voice, and painting into one means nothing
   * whatsoever for the voice beside it.
   *
   * `bd sd` is two columns against `hh*4`'s four, so the grid shows four and
   * column 1 is off `bd sd`'s own grid.
   *
   * ⚠ THIS DOCBLOCK USED TO CLAIM THE PART "MUST BE REWRITTEN" at that point, and
   * #1137 refuted it. The part is now READ at the finest width its own elements
   * still describe, so only the element under the hit is re-spelled and everything
   * else in the part is copied through. The old expectation was `bd bd sd _`: the
   * whole part re-derived, with `sd _` being the printer re-deriving a length it
   * had to reconstruct. `sd` is now the user's own byte, untouched — which is what
   * this FILE is about, so the case was arguing against its own thesis.
   */
  it('grid: painting into one `,`-part rewrites neither its neighbour nor its own siblings', () => {
    const r = parseStepGrid('bd sd, hh*4')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const edited = toggleCell(r.model, 0, 1, true) // lane 0 = bd (part 0)
    // `[bd bd]` — the `bd` element subdivides to hold the new hit, keeping its one
    // step's worth of the cycle so `sd` still sounds for the other half. `sd` and
    // `hh*4` are both copied verbatim.
    expect(serializeStepGrid(edited) ?? '<null>').toBe('[bd bd] sd, hh*4')
  })

  /**
   * THE LEAF WRITER'S PROOF (#986). The leaf-anchored projection opens patterns
   * whose notation no re-emit can spell (`<c2 eb2 f2 g2>*2`, a slow-repeat, a
   * `,`-stack of nested groups). Its whole claim is that an edit is a byte
   * replacement at ONE note's own span and every other byte is copied — so here
   * the assertion is literal: the output differs from the source only inside the
   * edited leaf, and nothing about the grammar (brackets, `*`, `<>`, `@`) is
   * touched. This IS the adapter/printer boundary made a test.
   */
  it('leaf: clearing one note edits only that note`s bytes (nested-group source)', () => {
    // an alternation of CHORDS — the region projection can't spell this, so it
    // reaches the leaf writer. Clearing the `g3` (chord member of bar 0) must
    // touch exactly the `g3` token; every bracket, comma, `@0.75`, and other
    // pitch rides back byte-for-byte.
    const src = '<[g3,b3,e4] [a3,c3,e4] [b3,d3,f#4] [b3,e4,g4]@0.75 [b3,d3,f#4]@0.25>'
    const r = parseStepGrid(src)
    expect(r.ok, `${src} should leaf-project`).toBe(true)
    if (!r.ok || !r.model.leafSource) throw new Error('expected a leaf-anchored grid')
    const lane = r.model.lanes.find((l) => l.sound === 'g3')!
    const col = lane.cells.findIndex(isCellOn)
    const cleared = toggleCell(r.model, r.model.lanes.indexOf(lane), col, false)
    const out = serializeStepGrid(cleared)
    expect(out).toBe('<[~,b3,e4] [a3,c3,e4] [b3,d3,f#4] [b3,e4,g4]@0.75 [b3,d3,f#4]@0.25>')
  })

  /**
   * The adapter, made literal: a leaf edit changes ONLY bytes inside the edited
   * leaf's span, at ANY depth. `<bd hh sd hh>*2` puts the leaf two levels down —
   * inside an alternation carrying a trailing operator — and clearing `bd`
   * produces a one-token diff: the `<`, the `*2`, and the three other sounds are
   * the user's own bytes coming back.
   */
  it('leaf: an edit is a byte replacement at the leaf span, structure verbatim', () => {
    const src = '<bd hh sd hh>*2'
    const r = parseStepGrid(src)
    expect(r.ok).toBe(true)
    if (!r.ok || !r.model.leafSource) throw new Error('expected a leaf-anchored grid')
    const col = r.model.lanes[0].cells.findIndex(isCellOn)
    const out = serializeStepGrid(toggleCell(r.model, 0, col, false))
    expect(out).toBe('<~ hh sd hh>*2')
    // literal locality: the diff is confined to the `bd` span
    const before = src.indexOf('bd')
    expect(out!.slice(0, before)).toBe(src.slice(0, before))
    expect(out!.slice(before + 1)).toBe(src.slice(before + 2)) // `~` vs `bd`
  })

  /**
   * The preference #994 added, as a test. `amen/4` is one element over four bars,
   * so the element writer's "only the touched region is re-spelled" promise covers
   * the whole pattern — clearing the single cell re-emits it as `<~ ~ ~ ~>` and the
   * `/4` is gone. The leaf writer goes first here and splices the note out, leaving
   * the slow operator exactly where the user typed it.
   */
  it('leaf: a whole-cycle element keeps its operator, which a re-emit would drop', () => {
    const r = parseStepGrid('amen/4')
    expect(r.ok).toBe(true)
    if (!r.ok || !r.model.leafSource) throw new Error('expected a leaf-anchored grid')
    expect(r.model.bars).toBe(4)
    const col = r.model.lanes[0].cells.findIndex(isCellOn)
    expect(serializeStepGrid(toggleCell(r.model, 0, col, false))).toBe('~/4')
  })

  /**
   * The bijection refusal, as a test. When a projected model's cells no longer
   * agree about a shared leaf, the leaf writer DECLINES (`null`) and the panel
   * keeps the document — it never lets the last writer silently win. Built by
   * hand from a real leaf model so the invariant is asserted regardless of which
   * patterns happen to open a view.
   */
  it('leaf: a shared-leaf disagreement declines to null, never corrupts', () => {
    const src = '<bd - - -> *2' // one `bd` leaf under bar 0, `-` (silence) elsewhere
    const r = parseStepGrid(src)
    expect(r.ok).toBe(true)
    if (!r.ok || !r.model.leafSource) throw new Error('expected a leaf-anchored grid')
    // forge a disagreement: turn the `bd` ON at a column its leaf isn't under.
    // No single byte-replacement satisfies both columns → refuse.
    //
    // THE REFUSAL MOVED TO THE OP (#1064). `toggleCell` asks the real writer
    // before returning, so it hands back the INPUT rather than a model the
    // writer then nulls. Asserted at both layers, because the original
    // guarantee — never corrupt — is the one that must not weaken:
    const forged = toggleCell(r.model, 0, 1, true)
    expect(forged, 'the op refuses rather than producing an unspellable model').toBe(r.model)
    // and the document is left exactly as the user wrote it, not half-written.
    expect(serializeStepGrid(forged)).toBe(src)
  })

  /**
   * THE LEAF WRITER'S PROOF, THE PITCHED VIEW (#986 P1b). Same law as the grid's
   * leaf tests above, on the surface that also models DURATION — which is exactly
   * where the roll's boundary sits. All fixtures are real corpus units.
   */
  /** A real corpus unit the leaf writer still owns: a chord with an alternation member. */
  const LEAF_ROLL = '[0,<5@2 7@2>] -'

  it('leaf roll: clearing a chord member edits only that member`s bytes', () => {
    // a chord whose second member is an alternation — no element re-emit can spell
    // it, so it reaches the leaf writer. Clearing the `5` touches the `5` and nothing
    // else: every bracket, comma, `<`, `@2` and sibling pitch rides back byte-for-byte.
    // (This was `- [0,3,7], [- [-2,1]] -`, which #1849 opened on the core: each of its
    // `,`-parts is read as it would be alone.)
    const src = LEAF_ROLL
    const r = parsePianoRoll(src)
    expect(r.ok, `${src} should leaf-project`).toBe(true)
    if (!r.ok || !r.model.leafSource) throw new Error('expected a leaf-anchored roll')
    const m = r.model
    const target = m.notes.find((n) => n.pitch === '5')!
    const out = serializePianoRoll({ ...m, notes: m.notes.filter((n) => n !== target) })
    expect(out).toBe('[0,<~@2 7@2>] -')
  })

  /**
   * A pitch drag at DEPTH, through an alternation inside an alternation inside a
   * `*2`. The edit is one token wide; `<`, `>`, `[`, `]`, `,`, `-` and `*2` are
   * bytes the writer copies and provably cannot invent.
   */
  it('leaf roll: dragging a deeply nested pitch is a one-token diff', () => {
    const src = '<- - <g4 [d4 c5]> [- [[bb4,d4] [- [g4,d3]]]]>*2'
    const r = parsePianoRoll(src)
    expect(r.ok, `${src} should leaf-project`).toBe(true)
    const ls = r.ok ? r.model.leafSource : undefined
    if (!r.ok || !ls) throw new Error('expected a leaf-anchored roll')
    const m = r.model
    // the `g4` inside `<g4 [d4 c5]>` — the first note whose span is that token
    const span = ls.anchors.find((a) => src.slice(a.span.start, a.span.end) === 'g4')!
    const target = m.notes.find((n) => n.start === span.start && n.pitch === 'g4')!
    const out = serializePianoRoll({
      ...m,
      notes: m.notes.map((n) => (n === target ? { ...n, pitch: 'c9' } : n)),
    })
    expect(out).toBe('<- - <c9 [d4 c5]> [- [[bb4,d4] [- [g4,d3]]]]>*2')
    // literal locality: the diff is confined to that one leaf span
    expect(out!.slice(0, span.span.start)).toBe(src.slice(0, span.span.start))
    expect(out!.slice(span.span.start + 2)).toBe(src.slice(span.span.end))
  })

  /**
   * THE `@n` DECISION, MADE A TEST (#986 P1b §6.1). A held note's hap carries ONLY
   * its pitch leaf — the `@n` is never a location of its own (observed by driving
   * `reifyMini` on `c3@2`, `[c3 e3]@2`, `0@2 2`). So:
   *  - clearing a held note replaces the PITCH and leaves the `@n` byte-identical;
   *  - changing a DURATION has no span to write through and is REFUSED, never
   *    approximated — authoring `@n` would be the printer this mechanism deletes.
   * Refusing is not a limitation to fix later; it is the adapter boundary holding.
   */
  it('leaf roll: clearing a held note keeps its `@n` verbatim', () => {
    // (was `6@8, 4!, 7, 13@2`, which #1849 opened on the core)
    const src = LEAF_ROLL
    const r = parsePianoRoll(src)
    expect(r.ok, `${src} should leaf-project`).toBe(true)
    if (!r.ok || !r.model.leafSource) throw new Error('expected a leaf-anchored roll')
    const m = r.model
    const held = m.notes.find((n) => n.pitch === '7')!
    expect(serializePianoRoll({ ...m, notes: m.notes.filter((n) => n !== held) })).toBe(
      '[0,<5@2 ~@2>] -',
    )
  })

  it('leaf roll: a duration change is refused — no `@n` span to splice', () => {
    const src = LEAF_ROLL
    const r = parsePianoRoll(src)
    expect(r.ok).toBe(true)
    if (!r.ok || !r.model.leafSource) throw new Error('expected a leaf-anchored roll')
    const m = r.model
    const held = m.notes.find((n) => n.pitch === '5')!
    // longer than anything at its column…
    expect(
      serializePianoRoll({
        ...m,
        notes: m.notes.map((n) => (n === held ? { ...n, duration: n.duration + 1 } : n)),
      }),
    ).toBeNull()
    // …and shortened onto a SIBLING's length, which a per-note check would wave
    // through as a silent no-op. The multiset match is what catches this one.
    const sibling = m.notes.find((n) => n.start === held.start && n.duration !== held.duration)
    if (sibling) {
      expect(
        serializePianoRoll({
          ...m,
          notes: m.notes.map((n) => (n === held ? { ...n, duration: sibling.duration } : n)),
        }),
      ).toBeNull()
    }
  })

  /**
   * A RESTRUCTURE must not read as a pile of deletions.
   *
   * `resizeRoll` re-lays the grid and carries the model's other fields through, so
   * the anchors survive describing a layout that no longer exists. Widening leaves
   * every note's start and length intact — which passes the per-note check and would
   * write the ORIGINAL source back, silently discarding the resize. Narrowing is
   * worse: the notes that fall outside the new width look exactly like notes the user
   * DELETED, and the writer would splice `~` over them — observed emitting
   * `- [~,~,~], [- [-2,1]] -` from a resize gesture before this was guarded. Both
   * must be a clean refusal, so the panel keeps the document.
   */
  it('leaf roll: a resized model declines — a restructure is not a delete', () => {
    // THE REFUSAL MOVED ONE LAYER UP at #1010 P4c, and this test is where that shows. It
    // used to assert the WRITER returns null for a resized leaf-anchored roll. It still
    // would — but the OP no longer hands it one: `resizeRoll` asks the writer before
    // returning, and where the writer cannot spell the result the op returns the input by
    // reference (`ifRollSpellable`). So the model is never resized in the first place, the
    // panel's control is disabled rather than dead, and `mutate` skips the write.
    //
    // That is strictly stronger than the old assertion, so it is asserted as identity and
    // the old mechanism is checked too: serializing what the op returned gives the source
    // back verbatim, i.e. the document is untouched — which was always the point.
    const src = LEAF_ROLL
    const r = parsePianoRoll(src)
    expect(r.ok).toBe(true)
    if (!r.ok || !r.model.leafSource) throw new Error('expected a leaf-anchored roll')
    const m = r.model
    expect(resizeRoll(m, m.steps * 2, 'pad'), 'widen must not apply').toBe(m)
    expect(resizeRoll(m, 2, 'pad'), 'narrow must not apply — the data-loss one').toBe(m)
    expect(serializePianoRoll(resizeRoll(m, 2, 'pad'))).toBe(src)
  })

  it('leaf roll: a moved note is refused — no leaf spells a new position', () => {
    const src = LEAF_ROLL
    const r = parsePianoRoll(src)
    expect(r.ok).toBe(true)
    if (!r.ok || !r.model.leafSource) throw new Error('expected a leaf-anchored roll')
    const m = r.model
    const target = m.notes.find((n) => n.pitch === '0')!
    expect(
      serializePianoRoll({
        ...m,
        notes: m.notes.map((n) => (n === target ? { ...n, start: n.start + 1 } : n)),
      }),
    ).toBeNull()
  })

  /**
   * THE SAME LAW, THE OTHER VIEW. The roll's writer rebuilds the whole mini from
   * its model exactly as the grid's used to, so this is not a new property — it
   * is the property the grid already holds, asserted on the view that does not
   * hold it yet (#916).
   */
  it('roll: dragging a note leaves every earlier element byte-identical', () => {
    const report = rollRows
      .slice(0, 12)
      .map(
        (v) =>
          `  ${JSON.stringify(v.mini)}\n     ->   ${JSON.stringify(v.out)}\n     kept?  ${JSON.stringify(v.prefix)}`,
      )
      .join('\n')
    const dropped = rollRejects.map((r) => `     ${String(r.n).padStart(4)}  ${r.reason}`).join('\n')
    expect(
      rollRows.length,
      `${rollRows.length} of ${rollRows.length + rollOutcomes.filter((x) => x === null).length}` +
        ` probed minis lose notation OUTSIDE the edited element.\n${report}\n` +
        `\n   NOT probed, and why (the filter's rejects — read these, they are where the next bug hides):\n${dropped}`,
    ).toBe(0)
  })

  /**
   * The named case, next to the sweep for the same reason as the grid's: a sweep
   * tells you HOW MANY and a case tells you WHAT. `hh*2`'s roll analogue — an
   * element whose sugar the model cannot hold, sitting beside the edit.
   */
  it('roll: `c4*2 e4` keeps its `*2` when the drag lands on the `e4`', () => {
    const r = parsePianoRoll('c4*2 e4')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // `c4*2` makes this FOUR columns, so `e4` starts at 2 and sustains to 4 —
    // the last note, not a note at the last column.
    const latest = Math.max(...r.model.notes.map((n) => n.start))
    const last = r.model.notes.find((n) => n.start === latest)!
    expect(serializePianoRoll(dragPitch(r.model, last, 'g4'))).toBe('c4*2 g4')
  })

  /**
   * A `,`-stack in the roll is 12 real minis and every one is a chord (`0,2,4`).
   * They are here because the grid's stacks were EXCLUDED by the first version of
   * this file and a live bug was in that hole — a shape a gate cannot see is a
   * shape its green says nothing about. Dragging the last part's note must leave
   * the parts beside it exactly as the user typed them.
   */
  it('roll: dragging one `,`-part`s note does not rewrite the part beside it', () => {
    const r = parsePianoRoll('0,2,4')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const note = r.model.notes.find((n) => n.pitch === '4')!
    expect(serializePianoRoll(dragPitch(r.model, note, '5'))).toBe('0,2,5')
  })

  /**
   * A note sustaining ACROSS an internal step boundary of an elongated group
   * (`[0 1@2]@2`, the `1` runs into the next step) has no per-step token — the
   * writer wraps the whole region as one weighted group `[..]@2` rather than
   * flattening the line. Found by the audit that swept a pitch-drag over EVERY
   * note of every roll mini: this was the last shape where one edit touched more
   * than one top-level element.
   */
  it('roll: editing inside an elongated group stays local (group-wrap, no flatten)', () => {
    const src = '[1@2 2] [3@2 4] 2 [0 1@2]@2 - - -'
    const r = parsePianoRoll(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const note = r.model.notes.find((n) => n.start === 9)! // the `0` in [0 1@2]@2
    const out = serializePianoRoll(dragPitch(r.model, note, '7'))
    // only the edited element changes; every other element byte-identical
    //
    // ⚠ THIS EXPECTATION WAS THE ELEMENT WRITER'S RE-SPELLING UNTIL #1233, and the
    // difference is worth stating because updating an expectation is how a defect gets
    // frozen as ground truth ([[P483]]). The old value was `[7@2 1@4]@2` — same music, but
    // re-emitted at TWICE the document's internal resolution, because the element writer
    // rebuilds the group onto its own grid. Verified by re-parsing all three strings rather
    // than by reading them:
    //
    //     source   0:2:1 | 2:1:2 | 3:2:3 | 5:1:4 | 6:3:2 | 9:2:0 | 11:4:1
    //     surgery  0:2:1 | 2:1:2 | 3:2:3 | 5:1:4 | 6:3:2 | 9:2:7 | 11:4:1
    //     re-emit  0:4:1 | 4:2:2 | 6:4:3 | 10:2:4 | 12:6:2 | 18:4:7 | 22:8:1
    //
    // Surgery's answer differs from the SOURCE in exactly one place — the pitch the drag
    // asked for — while the re-emit doubles every start and duration in the line. Bytes
    // moved from the source: 1 against 7. So this arm's own stated property, "only the
    // edited element changes", is satisfied strictly harder than it was before, and the
    // number that had to move was the oracle rather than the writer.
    expect(out).toBe('[1@2 2] [3@2 4] 2 [7 1@2]@2 - - -')
  })

  /**
   * Fractional columns (`@2.5` / `@3.5`, #628) don't sit on the integer grid the OLD
   * per-step walk re-emitted onto, so an edited pattern declined to `null` and the panel
   * kept the document untouched. The refusal existed to prevent a specific harm, stated
   * here when it was written: before it, deleting a note wrote `<~ ~>` and LOST the other.
   *
   * ⚠ THE HARM IS NOW UNREACHABLE, so the refusal became a write at #1312 — and this arm
   * asserts the write rather than being deleted, because "it stopped refusing" and "it
   * still keeps the survivor" are different claims and only the second one matters.
   * Lane emission measures every gap from the group's own start and spells the remainder
   * as a weighted rest (`~@0.5`), so a fractional bar is expressible after all.
   *
   * VERIFIED AGAINST THE ENGINE, not against the bytes: the surviving `d2` plays at
   * 2.4375 for 0.25 both before and after the delete — nothing dropped, nothing invented.
   * That is the property the old `toBeNull()` was standing in for.
   */
  it('roll: an edit on a fractional-weight pattern keeps the survivor, never drops a note', () => {
    const src = '<~ [~@3.5 d2@2 c#2@2.5]>'
    const r = parsePianoRoll(src)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(serializePianoRoll(r.model)).toBe(src) // unedited: round-trips
    const last = r.model.notes[r.model.notes.length - 1]
    expect(last.pitch, 'the note being deleted').toBe('c#2')
    const deleted = { ...r.model, notes: r.model.notes.filter((n) => n !== last) }
    const out = serializePianoRoll(deleted)
    // the deleted voice is gone and the survivor is still at 3.5 for 2 in an 8-weight bar
    expect(out).toBe('<~ [~ ~ ~ ~@0.5 d2@2 ~ ~ ~@0.5]>')
    expect(out).not.toContain('c#2')
    const back = parsePianoRoll(out!)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.model.notes.map((n) => `${n.pitch}@${n.start}+${n.duration}`)).toEqual([
      'd2@11.5+2',
    ])

    // ⚠ AND THE CLAIM THAT ACTUALLY JUSTIFIES THE WRITE, asked of the ENGINE. The two
    // round-trips above prove OUR parser agrees with itself; they cannot prove Strudel
    // does, and the rewrite changes the string Strudel evaluates. So query the haps.
    //
    // ⚠ ASK THE PERIOD FIRST. This document is a two-slot `<...>`, so cycle 0 is silent
    // and every note lives in cycle 1 — a one-cycle window would report NOTHING for both
    // spellings and read as a clean pass while proving nothing at all.
    const period = truePeriod(src)
    expect(period, 'the window has to cover the document').toBe(2)
    expect(truePeriod(out!), 'the rewrite must not change the period').toBe(period)
    const hapsOf = (m: string, c: number) =>
      (enginePlayedCycle(m, c) ?? []).map((r) => `${r.atom}@${r.pos}+${r.dur}`)
    for (const c of [0, 1]) {
      const before = hapsOf(src, c)
      const after = hapsOf(out!, c)
      // the survivor is untouched: same pitch, same onset, same length, same cycle
      expect(after, `cycle ${c}: nothing invented, survivor unmoved`).toEqual(
        before.filter((h) => !h.startsWith('c#2@')),
      )
    }
    expect(hapsOf(src, 1)).toEqual(['d2@1.4375+0.25', 'c#2@1.6875+0.3125'])
    expect(hapsOf(out!, 1)).toEqual(['d2@1.4375+0.25'])
  })
})
