/**
 * #920 — the every-edit stress gate for `<...>`-as-element writeback, over the
 * real-world corpus. The shipped `edit-locality` gate edits only the LAST element
 * and checks only the prefix — a projection (PV197). This is the property it
 * projects: drag EVERY note / toggle EVERY cell, and assert both
 *   (1) no data loss — the output re-parses with the same note/cell count, and
 *   (2) locality — the changed byte span overlaps at most ONE top-level element,
 * asked of krill (an independent oracle), not of our own regions.
 *
 * This is the sweep that found two data-loss bugs in the roll's whole-cycle span
 * surgery (#916); it must run against the alt-element writer too.
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePianoRoll, parseStepGrid } from '../../../editor/src/codeView/notation/parse'
import { isCellOn } from '../../../editor/src/codeView/notation/model'
// The PRODUCTION cell toggle — see the note at its call site below (#1048).
import { toggleCell } from '../../../editor/src/codeView/notation/place'
import { serializePianoRoll, serializeStepGrid } from '../../../editor/src/codeView/notation/serialize'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'))
const krill = require(
  path.resolve(here, '../../../../node_modules/.pnpm/@strudel+mini@1.2.6/node_modules/@strudel/mini/krill-parser.js'),
)
const minis: string[] = corpus.minis.map((o: { mini: string }) => o.mini)

function topSpans(mini: string): [number, number][] {
  try {
    const ast: { arguments_?: { alignment?: string }; source_?: { location_?: { start: { offset: number }; end: { offset: number } } }[] } =
      krill.parse('"' + mini + '"')
    if (ast.arguments_?.alignment !== 'fastcat') return []
    return (ast.source_ ?? [])
      .map((el): [number, number] | null =>
        el.location_ ? [el.location_.start.offset - 1, el.location_.end.offset - 1] : null,
      )
      .filter((s): s is [number, number] => s !== null)
  } catch {
    return []
  }
}

function changedSpan(a: string, b: string): [number, number] | null {
  if (a === b) return null
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  return [p, a.length - s]
}
const touches = (spans: [number, number][], ch: [number, number]) =>
  spans.filter(([a, b]) => ch[0] < b && ch[1] > a).length

describe('#920 — <...>-as-element writeback holds under every edit', () => {
  it('roll: drag every note — no data loss, ≤1 element touched', () => {
    let edits = 0
    const bad: string[] = []
    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok || !r.model.altSource) continue
      const spans = topSpans(mini.trim())
      const marker = r.model.numeric ? '11' : 'g9'
      for (let i = 0; i < r.model.notes.length; i++) {
        if (r.model.notes[i].pitch === marker) continue
        const edited = { ...r.model, notes: r.model.notes.map((m, j) => (j === i ? { ...m, pitch: marker } : m)) }
        const out = serializePianoRoll(edited)
        edits++
        if (out === null) continue // declined = safe no-op
        const re = parsePianoRoll(out)
        if (!re.ok || re.model.notes.length !== r.model.notes.length) {
          if (bad.length < 8) bad.push(`LOSS ${JSON.stringify(mini.trim())} #${i} -> ${JSON.stringify(out)}`)
          continue
        }
        const ch = changedSpan(mini.trim(), out)
        if (ch && spans.length && touches(spans, ch) > 1 && bad.length < 8) {
          bad.push(`LOCAL ${JSON.stringify(mini.trim())} #${i} -> ${JSON.stringify(out)}`)
        }
      }
    }
    expect(edits, 'the sweep must actually exercise roll alt-element edits').toBeGreaterThan(50)
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('roll: delete every note — output re-parses, ≤1 element touched', () => {
    // Deletes exercise a dimension pitch-drags cannot: emptying a region. A note
    // whose removal makes the bars identical legitimately collapses the pattern to
    // a single cycle (fewer model notes, but hap-equivalent), so the invariant here
    // is "re-parses cleanly and stays local", not "note count − 1".
    let edits = 0
    const bad: string[] = []
    for (const mini of minis) {
      const r = parsePianoRoll(mini)
      if (!r.ok || !r.model.altSource) continue
      const spans = topSpans(mini.trim())
      for (let i = 0; i < r.model.notes.length; i++) {
        const edited = { ...r.model, notes: r.model.notes.filter((_, j) => j !== i) }
        const out = serializePianoRoll(edited)
        edits++
        if (out === null) continue
        const re = parsePianoRoll(out)
        if (!re.ok) {
          if (bad.length < 8) bad.push(`REPARSE ${JSON.stringify(mini.trim())} #${i} -> ${JSON.stringify(out)}`)
          continue
        }
        const ch = changedSpan(mini.trim(), out)
        if (ch && spans.length && touches(spans, ch) > 1 && bad.length < 8) {
          bad.push(`LOCAL ${JSON.stringify(mini.trim())} #${i} -> ${JSON.stringify(out)}`)
        }
      }
    }
    expect(edits, 'the sweep must actually exercise roll alt-element deletes').toBeGreaterThan(50)
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('grid: toggle every cell — no data loss, ≤1 element touched', () => {
    let edits = 0
    const bad: string[] = []
    const declined = new Set<string>()
    let declinedToggles = 0
    let writerNulls = 0
    for (const mini of minis) {
      const r = parseStepGrid(mini)
      if (!r.ok || !r.model.altSource) continue
      const spans = topSpans(mini.trim())
      for (let lane = 0; lane < r.model.lanes.length; lane++) {
        for (let col = 0; col < r.model.steps; col++) {
          // The PRODUCTION toggle, which clamps (#1010 P4c): painting a hit into a
          // column an earlier note was still sounding through takes that note's room.
          // Modelling the flip here instead simulated a model no gesture can produce,
          // and the writer then rightly declined an edit the UI would have clamped
          // before it ever reached here (#1048).
          const edited = toggleCell(r.model, lane, col, !isCellOn(r.model.lanes[lane].cells[col]))
          // THE DECLINE MOVED ONE LAYER EARLIER (#1064). `toggleCell` now asks
          // the real writer before returning, so a toggle whose result cannot be
          // spelled comes back as the INPUT — the `notation/` family's "could not
          // apply" — instead of an unspellable model the writer then nulls. The
          // refusals are the same refusals, observed where the user meets them:
          // the panel can now ask before it offers, rather than swallowing the
          // click. Phase 1 left both pins unchanged (512 toggles / the same 18
          // units), which is what proved the set had not grown or shrunk; phase 2
          // then took them to ZERO by making the clamp span the `,`-part, and the
          // pins below say so — see the note at the assertion for why that is the
          // edit succeeding rather than a guard being weakened.
          if (edited === r.model) {
            declined.add(mini.trim())
            declinedToggles++
            continue
          }
          const out = serializeStepGrid(edited)
          // A null is a DECLINE, and since #1010 P4c that is a legitimate answer
          // rather than a defect: the printer preserves a note's length, and where
          // the grid's own resolution cannot spell one — a note shorter than a
          // column, or a column another note already starts in — it refuses instead
          // of emitting a shortened note. Refusing is the outcome this project ranks
          // above mis-writing. So declines are COLLECTED AND PINNED rather than
          // forbidden: the set must not grow, which is what would signal the guard
          // spreading past the shapes it was measured on.
          // NOTHING should reach here unspellable any more: the op refused it
          // above. A non-zero count means a toggle produced a model the writer
          // cannot spell AND the op said it could — the two disagreeing, which
          // is exactly the drift asking the real writer is meant to make
          // impossible. Kept as an assertion rather than deleted, because a
          // branch that stops being taken silently is how this class hides.
          if (out === null) {
            writerNulls++
            continue
          }
          edits++
          const re = parseStepGrid(out)
          if (!re.ok) {
            if (bad.length < 8) bad.push(`REPARSE ${JSON.stringify(mini.trim())} -> ${JSON.stringify(out)}`)
            continue
          }
          const ch = changedSpan(mini.trim(), out)
          if (ch && spans.length && touches(spans, ch) > 1 && bad.length < 8) {
            bad.push(`LOCAL ${JSON.stringify(mini.trim())} -> ${JSON.stringify(out)}`)
          }
        }
      }
    }
    expect(edits, 'the sweep must actually exercise grid alt-element edits').toBeGreaterThan(20)
    expect(bad, bad.join('\n')).toEqual([])
    // THE DECLINE SET, pinned — and pinned at BOTH granularities, because a decline is
    // per EDIT and the unit set alone hides how much of a view it costs ([[PK65]] step 3).
    //
    // VERIFIED, NOT ASSUMED. 18 units is 18 more than the one this phase predicted, and
    // a count cannot tell an over-broad guard from a correct refusal — both read as "the
    // writer said no". `_p4c-decline-verify.spec.ts` settles it by counterfactual: every
    // declined toggle is emitted by the writer as it stood at `studio_v0.2.0` (the real
    // old code, imported side by side, not a reconstruction) and the ENGINE is asked
    // whether the notes AWAY from the toggled column still play the same.
    //
    //   512 declined toggles / 18 units — 512 DIFFER, and all 512 differ in DURATION
    //   ONLY. 0 structural, 0 identical. Emitting any of them the old way would have
    //   silently shortened a note the user never touched.
    //
    // ⚠ THAT ENTIRE SET IS NOW ZERO, and the reason is the word "silently" (#1064
    // phase 2). The refusal was never about the shortening being wrong — the
    // counterfactual above established that every one of the 512 differed in duration
    // and nothing else. It was about the shortening being INVISIBLE: until #1056 the
    // step grid drew a two-column note exactly like a one-column one, so an edit that
    // trimmed a neighbour changed the document in a way the panel could not show, and
    // a view that cannot display an axis must not change it.
    //
    // The grid draws length now, and the clamp ends every note sounding through a new
    // onset's column across the `,`-part. So these 512 stopped being corruption to
    // refuse and became the edit the user asked for, with its consequence on screen:
    // observed in the app on `s("bd hh*2 sd cp")`, where placing hh at column 1 halves
    // the kick's bar from two columns to one and writes `[bd hh] hh*2 sd cp`.
    //
    // What is still pinned is that the writer is never handed anything it cannot spell
    // (`writerNulls`) and that no edit loses data (`bad`) — those are the guarantees;
    // the decline count was only ever the cost of one of them.
    expect(declinedToggles, 'declined EDITS, not units — the number the user experiences').toBe(0)
    // The op and the writer agree on every one of these toggles. Before #1064 this
    // count WAS the 512 above — same refusals, observed at the writer instead of at
    // the gesture. Zero here and 512 there is the whole claim: nothing was lost,
    // nothing new was refused, and the answer now arrives early enough to offer.
    expect(writerNulls, 'the op must not hand the writer anything it cannot spell').toBe(0)
    // The 18 units that used to decline, named so the change is legible rather than a
    // number going to zero. Each is `<...>`-as-element with a note sustaining under a
    // sibling's onset; the clamp ends that note at the onset and the writer takes it.
    //
    //   '<[d4 c4 d4]> <[g4 c4 bb3]> <[a3 g3 f#3:4]> <[g3]> <[bb4]>'
    //   '<bd[~ bd bd ~ ][bd ~ ~ bd][bd bd]>sd'          '[bd hh:3] sd lt <oh [oh hh] [misc:5 hh]>'
    //   '[<e2 d3>]\n[b2 <a2 e3>]\n[<g2 d3>]\n[f#2]'     '[bd*2 -] <- [~@2 bd bd - bd - sd]>'
    //   '[<e4 d5>]\n[b4 <a4 e5>]\n[<g4 d5>]\n[f#4]'     '[c4 f4 ~ g4] ~ [a3 <c4 g3>] ~'
    //   '[<e5 [d5 g5]>]\n[<d5 a5>]\n[<c5 [e5 d5]>]\n[<b4 b5>]'
    //   '[<g4 [g4 g4]> e4 d4 c4] [a3 ~ g3 a3]'          'a1 c2 e2 <e2 [e2 e2] e2 [f2 f2]>'
    //   '[<g4 e4> [b4 g4]] [- <a4> <->]'                'bd sd <[bd ~] [~ bd]> sd'
    //   'bd:7 [sd ~ ~ bd:7] [<bd [lt,sd]>  bd:7] [sd <~ bd>]'   'c <d c> - [c <d c>]'
    //   'd#3 f3 ~ <~ [~ ~ c#3]>'   'hh*5 <bd bd> ~ sd'   '{c [f g] d# d}%2'
    //   '~ sd ~[sd[~ <~~~ sd>]]'
    //
    // Pinned as an exact SET rather than as `.length === 0`, so a future refusal on a
    // shape never measured here still has to be named before it can pass.
    expect([...declined].sort()).toEqual([])
  })
})
