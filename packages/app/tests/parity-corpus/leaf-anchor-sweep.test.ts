/**
 * leaf-anchor-sweep.test.ts — the whole-corpus proof that a shipped GRID leaf
 * anchor slices to its own token (#986 P1a, PR #987 self-review finding #1).
 *
 * The leaf-anchored projection writes an edit by replacing the bytes at a hap's
 * `context.locations[0]` span. That is only sound if the span really IS the
 * played atom's own token — and `loc[0]` is the leaf for MOST bare reified minis
 * but not all: a `..` range gives each generated note the range END's location, a
 * patterned operator (`*<8 [4 16]>`) puts its own argument first, and a `.`
 * phrase separator can pad a token's span with a trailing space. `leafAnchors`
 * (in parse.ts) is exactly the guard that REJECTS any onset whose span does not
 * slice to its token, so those patterns never open a leaf view.
 *
 * This gate proves the guard holds over the full committed corpus, at scale:
 *  1. every anchor in every SHIPPED leaf model slices to its atom (0 exceptions)
 *     — the property a regression in the guard would break, corrupting on the
 *     first click;
 *  2. the guard is LOAD-BEARING, not vacuous — the raw `gridOnsets` stream does
 *     carry non-slicing spans that never reach a view (asserted > 0, so a guard
 *     that silently started accepting them would be caught).
 *
 * THE ORACLE is the shipped `parseStepGrid` / `gridOnsets` — never a
 * re-implementation, which could only agree with itself.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { miniPattern, type MiniPattern } from '../../../editor/src/codeView/strudelMini/pattern'
import {
  gridOnsets,
  parseStepGrid,
  parsePianoRoll,
  rollOnsets,
} from '../../../editor/src/codeView/notation/parse'
import { serializeStepGrid } from '../../../editor/src/codeView/notation/serialize'
import { cellOn, isCellOn } from '../../../editor/src/codeView/notation/model'
import type { StepGridModel } from '../../../editor/src/codeView/notation/model'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

describe('#986 leaf-anchor sweep — a shipped anchor slices to its own token', () => {
  it('every anchor in every leaf-projected grid slices to its atom (0 exceptions)', () => {
    let views = 0
    let anchors = 0
    const bad: string[] = []
    for (const src of minis) {
      const r = parseStepGrid(src)
      if (!r.ok || !r.model.leafSource) continue
      views++
      const ls = r.model.leafSource
      for (const col of ls.cols) {
        for (const a of col) {
          anchors++
          if (ls.src.slice(a.span.start, a.span.end) !== a.atom && bad.length < 20) {
            bad.push(`${JSON.stringify(src)} atom=${JSON.stringify(a.atom)} span=[${a.span.start},${a.span.end}) slice=${JSON.stringify(ls.src.slice(a.span.start, a.span.end))}`)
          }
        }
      }
    }
    console.log(`\n[grid] ${views} leaf views, ${anchors} anchors — all slice to their token`)
    expect(views).toBeGreaterThan(10) // the projection actually opens views (non-vacuous)
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('the slice===token guard is load-bearing — raw gridOnsets DO carry non-slicing spans', () => {
    let checked = 0
    let nonSlicing = 0
    for (const src of minis) {
      let pat: MiniPattern
      try {
        pat = miniPattern(src)
      } catch {
        continue
      }
      for (let c = 0; c < 2; c++) {
        let onsets: ReturnType<typeof gridOnsets>
        try {
          onsets = gridOnsets(pat, c)
        } catch {
          onsets = null
        }
        if (!onsets) continue
        for (const o of onsets) {
          for (let i = 0; i < o.atoms.length; i++) {
            const s = o.spans[i]
            if (!s) continue
            checked++
            if (src.slice(s.start, s.end) !== o.atoms[i]) nonSlicing++
          }
        }
      }
    }
    console.log(`\n[grid] ${nonSlicing} of ${checked} raw gridOnsets spans are non-slicing — leafAnchors rejects these`)
    expect(checked).toBeGreaterThan(5000) // the sweep ran
    // If this hits zero, the guard has nothing to catch and the first test is
    // vacuously true — a regression that started accepting a bad span would then
    // pass silently. Kept as a live tripwire.
    expect(nonSlicing).toBeGreaterThan(0)
  })
})

/**
 * The ROLL arm (#986 P1b). The same proof, and it matters MORE here: the grid rejects
 * numeric values upstream and so never meets a synthesised location, while numbers are
 * the roll's whole point — it meets every one of them. `rollAnchors` is the guard, and
 * the raw stream it filters carries hundreds of non-slicing spans.
 */
describe('#986 P1b leaf-anchor sweep — a shipped ROLL anchor slices to its own pitch', () => {
  it('every anchor in every leaf-projected roll slices to its pitch (0 exceptions)', () => {
    let views = 0
    let anchors = 0
    const bad: string[] = []
    for (const src of minis) {
      const r = parsePianoRoll(src)
      if (!r.ok || !r.model.leafSource) continue
      views++
      const ls = r.model.leafSource
      for (const a of ls.anchors) {
        anchors++
        // the roll case-folds note names for its row math; the anchor must still point
        // at the user's own bytes, which is what the writer puts back
        if (
          ls.src.slice(a.span.start, a.span.end).toLowerCase() !== a.pitch.toLowerCase() &&
          bad.length < 20
        ) {
          bad.push(
            `${JSON.stringify(src)} pitch=${JSON.stringify(a.pitch)} span=[${a.span.start},${a.span.end}) slice=${JSON.stringify(ls.src.slice(a.span.start, a.span.end))}`,
          )
        }
      }
    }
    console.log(`\n[roll] ${views} leaf views, ${anchors} anchors — all slice to their pitch`)
    expect(views).toBeGreaterThan(10) // the projection actually opens views (non-vacuous)
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('the slice===pitch guard is load-bearing — raw rollOnsets DO carry non-slicing spans', () => {
    let checked = 0
    let nonSlicing = 0
    for (const src of minis) {
      let pat: MiniPattern
      try {
        pat = miniPattern(src)
      } catch {
        continue
      }
      for (let c = 0; c < 2; c++) {
        let onsets: ReturnType<typeof rollOnsets>
        try {
          onsets = rollOnsets(pat, c)
        } catch {
          onsets = null
        }
        if (!onsets) continue
        for (const o of onsets) {
          if (!o.loc) continue
          checked++
          if (src.slice(o.loc.start, o.loc.end).toLowerCase() !== o.pitch.toLowerCase()) {
            nonSlicing++
          }
        }
      }
    }
    console.log(
      `\n[roll] ${nonSlicing} of ${checked} raw rollOnsets spans are non-slicing — rollAnchors rejects these`,
    )
    expect(checked).toBeGreaterThan(5000) // the sweep ran
    // The measured class: a `..` range gives every generated note the range END's
    // location, and a patterned operator (`*<8 [4 16]>`) puts its own argument first.
    // Splicing any of them would rewrite the wrong bytes, so this staying > 0 is what
    // proves `rollAnchors` has something real to refuse.
    expect(nonSlicing).toBeGreaterThan(0)
  })
})

/**
 * #986 P2 — THE BIJECTION, HELD OVER EVERY SHIPPED VIEW.
 *
 * The projection's whole editability rule is one property: a played note is
 * view-editable exactly when it maps to a source span that is its OWN and that no
 * other note's span partly claims. `claimLeafSpan` states it once and both
 * surfaces ask it; the ~25 syntactic guards in the core are the same rule detected
 * feature-by-feature, which is why they need a case for nesting, for `*n`, for
 * every spelling, and this needs none.
 *
 * The sweeps above already hold the first clause — a shipped anchor slices to its
 * own token. This holds the two nothing gated at corpus scale:
 *
 *  - DISJOINTNESS: any two anchor spans in one view are IDENTICAL or do not
 *    overlap at all. Identical is the normal case and means shared (`bd*4` is one
 *    token played four times, and the writer makes the sharers agree). Partial
 *    overlap is the one no byte replacement can satisfy, because the two notes
 *    disagree about who owns the bytes between them — a view shipped with that in
 *    it corrupts on a click, silently.
 *
 *    Measured honestly, and unlike its sibling clause this one is DEFENSIVE, not
 *    load-bearing: across the whole corpus, on both surfaces, exactly ZERO span
 *    pairs that pass the slices-to-its-own-token clause then partly overlap. The
 *    clause below therefore proves the property holds, not that it is exercised —
 *    which is the opposite of what the two "load-bearing" sweeps above assert, and
 *    is stated rather than implied so nobody reads a passing test as evidence the
 *    guard is doing work. It stays because it is the other half of the rule and
 *    the cost of asking is a comparison.
 *  - TOTALITY: every cell the view DRAWS has an anchor behind it. A drawn cell
 *    with nothing to write through is a dead control — the failure #986 P1a's
 *    usable-view gate exists to prevent, asserted here as a property of the model
 *    rather than of one fixture.
 *
 * THE ORACLE is the shipped parser. These read the models it actually returns; a
 * re-walk of the anchor logic could only agree with itself.
 */
describe('#986 P2 — the bijection holds on every shipped leaf view', () => {
  /** two spans may be identical (shared) or disjoint — never partly overlapping */
  const partlyOverlaps = (
    a: { start: number; end: number },
    b: { start: number; end: number },
  ): boolean => {
    const identical = a.start === b.start && a.end === b.end
    return !identical && a.end > b.start && b.end > a.start
  }

  it('grid: anchor spans are pairwise identical-or-disjoint, and every drawn cell has one', () => {
    let views = 0
    let spans = 0
    let shared = 0
    const overlapping: string[] = []
    const dead: string[] = []
    for (const src of minis) {
      const r = parseStepGrid(src)
      if (!r.ok || !r.model.leafSource) continue
      views++
      const all = r.model.leafSource.cols.flat().map((a) => a.span)
      spans += all.length
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          if (all[i].start === all[j].start && all[i].end === all[j].end) shared++
          else if (partlyOverlaps(all[i], all[j])) overlapping.push(src)
        }
      }
      // totality: a lane cell drawn ON must have an anchor in that column
      for (let c = 0; c < r.model.steps; c++) {
        const drawn = r.model.lanes.some((l) => isCellOn(l.cells[c]))
        if (drawn && (r.model.leafSource.cols[c]?.length ?? 0) === 0) dead.push(`${src} @${c}`)
      }
    }
    console.log(`\n[grid] bijection: ${views} views, ${spans} anchor spans, ${shared} shared pairs`)
    expect(views).toBeGreaterThan(50) // the sweep ran
    // never yet observed on real content (see the header) — this holds the property
    expect(overlapping, 'anchors that partly overlap would corrupt on a click').toEqual([])
    expect(dead, 'a drawn cell with no anchor is a control that does nothing').toEqual([])
    // sharing is the normal case, not an edge one — if this hit zero the disjointness
    // assertion above would be passing for the wrong reason
    expect(shared).toBeGreaterThan(0)
  })

  it('roll: anchor spans are pairwise identical-or-disjoint, and every drawn note has one', () => {
    let views = 0
    let spans = 0
    const overlapping: string[] = []
    for (const src of minis) {
      const r = parsePianoRoll(src)
      if (!r.ok || !r.model.leafSource) continue
      views++
      const anchors = r.model.leafSource.anchors
      spans += anchors.length
      // totality, exactly: the roll's notes ARE its anchors, one for one
      expect(r.model.notes.length, `every drawn note needs an anchor (${src})`).toBe(anchors.length)
      for (let i = 0; i < anchors.length; i++) {
        for (let j = i + 1; j < anchors.length; j++) {
          if (partlyOverlaps(anchors[i].span, anchors[j].span)) overlapping.push(src)
        }
      }
    }
    console.log(`\n[roll] bijection: ${views} views, ${spans} anchor spans`)
    expect(views).toBeGreaterThan(20) // the sweep ran
    expect(overlapping, 'anchors that partly overlap would corrupt on a drag').toEqual([])
  })

  /**
   * Non-vacuity, and the point of stating the rule as a property: the corpus DOES
   * contain patterns whose played notes share a leaf, and the writer — not the
   * projection — is what makes disagreeing edits on a shared leaf decline. If this
   * ever hit zero, both disjointness assertions above would be trivially true.
   */
  it('the shared-leaf case is real, and a disagreeing edit on one declines', () => {
    const r = parseStepGrid('bd*4')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // whether `bd*4` opens as a leaf view or not, the corpus sweep above proved
    // shared spans occur; this pins the WRITER's half of the contract on a model
    // built by hand, so it holds regardless of which patterns happen to project
    const model: StepGridModel = {
      steps: 2,
      lanes: [{ sound: 'bd', cells: [cellOn(), cellOn()] }],
      leafSource: {
        src: 'bd*2',
        attachedSteps: 2,
        cols: [
          [{ atom: 'bd', span: { start: 0, end: 2 }, duration: 1 }],
          [{ atom: 'bd', span: { start: 0, end: 2 }, duration: 1 }],
        ],
      },
    }
    // both columns agree (both still bd) → the shared span writes once
    expect(serializeStepGrid(model)).toBe('bd*2')
    // clear one and they disagree → no single byte replacement satisfies both
    const half: StepGridModel = { ...model, lanes: [{ sound: 'bd', cells: [cellOn(), false] }] }
    expect(serializeStepGrid(half)).toBeNull()
  })
})
