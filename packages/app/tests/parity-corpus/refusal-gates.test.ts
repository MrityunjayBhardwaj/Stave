/**
 * refusal-gates.test.ts — every refusal names the gate that actually stopped it
 * (#990), measured over the real-world corpus.
 *
 * WHY THIS EXISTS. Three writers stack behind one parse call:
 *
 *   parse{StepGrid,PianoRoll}Core → element projection → leaf projection
 *
 * and the `reason` a refused unit reported used to be whichever of them declined
 * FIRST — almost always the syntactic core. Nothing downstream updated it, so the
 * reason described a subsystem that often had nothing to do with why the unit was
 * unavailable. That was not a tidiness problem: the class our blocker backlog
 * ranked near the top for months, "nested groups are beyond the editable subset",
 * turns out to contain ZERO units stopped by anything to do with nesting. We were
 * steering by a signal that pointed at the wrong module.
 *
 * WHAT IS MEASURED, through the REAL shipped parsers — never a re-walk of the
 * gate sequence, which would be a second oracle that can only agree with itself:
 * for each of the 1500 corpus units, both surfaces are asked, and every refusal
 * is bucketed by the `gate` the parser itself reports.
 *
 * THE ASSERTIONS are about LEGIBILITY, not reach. This phase must move no
 * verdict — `writer-reach.test.ts` holds the floors, `mini-corpus.test.ts` pins
 * every verdict — so what is gated here is that the refusals are CAUSAL:
 *   1. every refusal a projection produced carries a gate;
 *   2. the syntactic core's feature vocabulary ("nested groups", "beyond the
 *      editable subset", "is not a note name") never surfaces on a unit a
 *      projection ruled on;
 *   3. the gates are non-vacuous — the dominant ones actually occur;
 *   4. wrong-surface is separable from the rest, because it is the bucket that
 *      must be read differently depending on who is asking (see below).
 *
 * READING `wrong-surface`. It is ~67% of all refusals HERE and it is mostly not a
 * failure: this sweep asks BOTH surfaces of every unit, so a drum pattern
 * declining the piano roll is counted, and it should be — the pattern is simply
 * not the roll's. That single fact inflated every denominator quoted off a
 * both-surfaces sweep. It reads the OTHER way in `editCoverage.ts`, which routes
 * by head exactly as the app does: there a `wrong-surface` unit is one whose head
 * asks for a view its own values cannot fill, and the user gets code. Same gate,
 * two honest readings — which is the whole reason to name it rather than fold it
 * into "refused".
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import type { Gate } from '../../../editor/src/codeView/notation/model'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(corpusDir, 'mini-corpus.json'), 'utf8'),
)
const minis = corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== '')

/**
 * Vocabulary that belongs to the SYNTACTIC core alone — feature names it refuses
 * by. None of it may appear on a unit a projection ruled on, because the
 * projection never looks at syntax: it reads what the pattern PLAYS.
 */
const CORE_VOCABULARY = [
  'beyond the editable subset',
  'beyond the drum-grid subset',
  'nested groups',
  'is not a note name',
  'unsupported token',
  'invalid * multiplier',
  'stacked sub-sequences',
  'random degrade',
]

interface Row {
  mini: string
  surface: 'step' | 'roll'
  gate: Gate | null
  reason: string
}

const rows: Row[] = []
for (const mini of minis) {
  for (const [surface, r] of [
    ['step', parseStepGrid(mini)],
    ['roll', parsePianoRoll(mini)],
  ] as const) {
    if (r.ok) continue
    rows.push({ mini, surface, gate: r.gate ?? null, reason: r.reason })
  }
}

const byGate = new Map<string, { step: number; roll: number }>()
for (const r of rows) {
  const key = r.gate ?? '(core syntax)'
  const e = byGate.get(key) ?? { step: 0, roll: 0 }
  e[r.surface]++
  byGate.set(key, e)
}

/**
 * THE REFINED SWEEP (#1132) — and the reason it exists is the sharper half of #1130.
 *
 * Everything above asks at UNREFINED, where the gate vocabulary is total: 0 ungated
 * refusals out of 1559. That total-looking result is a property of the POPULATION,
 * not of the vocabulary. `view-resolution` cannot fire at UNREFINED at all (the
 * document ceiling 64 sits below the view ceiling 256), and `no-finer-view` is raised
 * by a check that returns early unless a scale was asked for. So the two gates that
 * only a refined ask can reach were exactly the two that went unnamed — 788 ungated
 * refusals across scales 1/2/3/4/8/16, invisible here because this file never passed
 * a scale.
 *
 * A vocabulary is only as total as the widest ask made of it. This sweep makes the
 * ask.
 *
 * FOUR SCALES, CHOSEN BY MEASUREMENT rather than assumed representative: every scale
 * 1..16 was swept and each reports ZERO ungated refusals (counts climb 1552 → 1850
 * across that range, so none of those sweeps is degenerate). Powers of two are kept
 * because they are what the presets actually ask for, and the odd scales surfaced no
 * class of their own — so widening this would cost time and find nothing. If a new
 * refusal site ever appears, re-run the 1..16 check before trusting these four.
 */
const REFINED_SCALES = [2, 4, 8, 16] as const
const refinedRows: Row[] = []
for (const mini of minis) {
  for (const k of REFINED_SCALES) {
    for (const [surface, r] of [
      ['step', parseStepGrid(mini, k)],
      ['roll', parsePianoRoll(mini, k)],
    ] as const) {
      if (r.ok) continue
      refinedRows.push({ mini, surface, gate: r.gate ?? null, reason: r.reason })
    }
  }
}

const byRefinedGate = new Map<string, number>()
for (const r of refinedRows) {
  const key = r.gate ?? '(ungated)'
  byRefinedGate.set(key, (byRefinedGate.get(key) ?? 0) + 1)
}

describe('refusal gates — a refusal names what stopped it, not who spoke first', () => {
  it('reports the anatomy of "no" over the real-world corpus', () => {
    const ranked = [...byGate.entries()].sort(
      (a, b) => b[1].step + b[1].roll - (a[1].step + a[1].roll),
    )
    console.log(`\n===== REFUSAL GATES (${minis.length} corpus units, both surfaces) =====`)
    console.log(`  refusals: ${rows.length}`)
    console.log(`  ${'gate'.padEnd(20)} ${'step'.padStart(5)} ${'roll'.padStart(5)} ${'total'.padStart(6)}`)
    for (const [g, v] of ranked) {
      const t = v.step + v.roll
      const pct = ((100 * t) / rows.length).toFixed(0)
      console.log(
        `  ${g.padEnd(20)} ${String(v.step).padStart(5)} ${String(v.roll).padStart(5)} ${String(t).padStart(6)}  (${pct}%)`,
      )
    }
    expect(rows.length).toBeGreaterThan(0)
  })

  it('every projection refusal carries a gate', () => {
    // Only a unit nothing could REIFY keeps the core's own message — there the
    // core names the actual syntax and is the better answer.
    const ungated = rows.filter((r) => r.gate === null)
    const sample = ungated.slice(0, 10).map((r) => `  ${r.surface}  ${JSON.stringify(r.mini)}  ⟶  ${r.reason}`)
    console.log(`\n  ungated refusals (core syntax, nothing reified): ${ungated.length}`)
    sample.forEach((s) => console.log(s))
    // a handful of genuinely unparseable strings is expected; a flood is not
    expect(ungated.length, sample.join('\n')).toBeLessThan(rows.length * 0.02)
  })

  it('no gated refusal still speaks the syntactic core\'s feature vocabulary', () => {
    // No exemptions: the gate sentences are deliberately worded so that none of
    // them reuses the core's phrasing, which is what keeps "did this reason come
    // from a gate?" answerable by reading it.
    const leaked = rows.filter(
      (r) => r.gate !== null && CORE_VOCABULARY.some((v) => r.reason.includes(v)),
    )
    expect(
      leaked.map((r) => `${r.surface} ${r.gate} ${JSON.stringify(r.mini)} ⟶ ${r.reason}`),
    ).toEqual([])
  })

  it('the units that used to blame "nested groups" are stopped by something else entirely', () => {
    // The acceptance test of #990, stated as an assertion rather than a story.
    //
    // All 51 corpus units whose refusal read "nested groups are beyond the
    // editable subset" were re-measured against the shipped parsers: they die at
    // wrong-surface 19 · no-note-content 12 · unstable-period 11 ·
    // irrational-onset 5 · edit-unsafe 3 · resolution 1 — and at the leaf
    // write-back guard ZERO times. Not one is stopped by nesting.
    //
    // These three are real corpus members, one per dominant gate. The assertion
    // is deliberately loose about WHICH gate — a later reach change (#991 raises
    // the period cap) may legitimately open one — and strict about the thing
    // this phase owes: a refusal must name a gate, never a feature the core
    // happened to notice first.
    const WAS_NESTED = [
      '[0 <2 3>] <5 7 5>', //                      roll: unstable-period
      '[- <hh!4 oh>]*5', //                        roll: wrong-surface
      '- c3 - g#2 - g2 - [c2 [g2 d3]]', //         step: irrational-onset
    ]
    let stillRefused = 0
    for (const mini of WAS_NESTED) {
      for (const [surface, r] of [
        ['step', parseStepGrid(mini)],
        ['roll', parsePianoRoll(mini)],
      ] as const) {
        if (r.ok) continue
        stillRefused++
        expect(
          r.reason,
          `${surface} refused ${JSON.stringify(mini)} — the reason must name the gate`,
        ).not.toContain('nested')
        expect(r.gate, `${surface} ${JSON.stringify(mini)} carries no gate`).toBeDefined()
      }
    }
    // non-vacuity: if every one of them opened, this test proved nothing and the
    // examples need replacing with units that are still refused
    expect(stillRefused, 'all the sample units now open — pick new ones').toBeGreaterThan(0)
  })

  it('the gates are non-vacuous — each dominant one actually fires', () => {
    // A taxonomy nothing reaches is a taxonomy that says nothing. These are the
    // gates the corpus is known to exercise; a zero here means a gate stopped
    // being reachable and the refusals moved somewhere unexamined.
    for (const g of [
      'wrong-surface',
      'no-note-content',
      'unstable-period',
      'irrational-onset',
      'no-leaf-anchor',
      'note-crosses-bar',
      'edit-unsafe',
      'view-unusable',
    ] as const) {
      const v = byGate.get(g) ?? { step: 0, roll: 0 }
      expect(v.step + v.roll, `gate ${g} never fires — is it still reachable?`).toBeGreaterThan(0)
    }
  })

  it('escaped-source fires, and says so from the string alone (#1254)', () => {
    // Deliberately NOT in the list above. That list rests on the corpus exercising
    // each gate, and this one is exercised by exactly ONE corpus member — so a
    // refresh that dropped that tune would redden it for no defect. Asserted against
    // a synthetic string instead, which makes the gate non-vacuous by construction
    // and independent of what the corpus happens to hold.
    //
    // The signal is the backslash, and it is complete: every JS escape leaves one in
    // the document slice, and mini-notation has no backslash syntax anywhere — asked
    // of krill, which refuses one even inside a `//` comment. So this cannot be a
    // regex standing in for the grammar's answer; it is the grammar's answer.
    for (const [surface, r] of [
      ['step', parseStepGrid('bd \\ sd', 1)],
      ['roll', parsePianoRoll('c3 \\ e3', 1)],
    ] as const) {
      expect(r.ok, `${surface}: an escaped mini must not open a view`).toBe(false)
      if (r.ok) continue
      expect(r.gate, `${surface}: an escaped mini must name its gate`).toBe('escaped-source')
    }
    // Reported, not asserted: the corpus count is a fact about today's corpus, and
    // pinning it is what the carve-out this replaced was already doing wrong.
    const inCorpus = refinedRows.filter((r) => r.gate === 'escaped-source').length
    console.log(`\n  escaped-source over the corpus: ${inCorpus} refined refusals`)
  })

  it('a REFINED refusal names its gate too — the ask the vocabulary was blind to', () => {
    const ungated = refinedRows.filter((r) => r.gate === null)
    const sample = [...new Set(ungated.map((r) => r.reason))]
      .slice(0, 8)
      .map((reason) => `  ${reason}  (×${ungated.filter((u) => u.reason === reason).length})`)
    console.log(
      `\n===== REFINED REFUSAL GATES (scales ${REFINED_SCALES.join('/')}, both surfaces) =====`,
    )
    console.log(`  refusals: ${refinedRows.length}`)
    for (const [g, n] of [...byRefinedGate].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${g.padEnd(20)} ${String(n).padStart(6)}`)
    }
    // Zero, not a percentage. At UNREFINED the sibling assertion tolerates <2% for
    // strings nothing could reify; every mini here ALREADY reified (it is the same
    // corpus), so a refined refusal has no honest reason to be anonymous.
    //
    // ⚠ THIS ARM ONCE CARRIED AN ENUMERATED EXCEPTION, AND #1254 REMOVED IT. The
    // editor models a unit's content as the DOCUMENT SLICE while the transpiler
    // reifies a double-quoted literal from `node.value`, the JS-COOKED one — so a
    // literal carrying any JS escape leaves a backslash on our side that the engine
    // never sees, and krill (which has no backslash syntax anywhere, comments
    // included) refused it with the core's own message and no gate. That was the
    // sole reason this number was not zero: 8 refusals, one string × 4 scales × 2
    // surfaces. It is now the `escaped-source` gate, so the claim below is whole
    // again and needs no carve-out to stand.
    expect(
      ungated.length,
      `ungated refined refusals:\n${sample.join('\n')}`,
    ).toBe(0)
  })

  it('the two refine-only gates actually fire — they are unreachable from the sweep above', () => {
    // Non-vacuity, and the point of the whole exercise: these two cannot appear in
    // `byGate` at all, so without this arm they could regress to zero unnoticed —
    // which is exactly the state #1132 found them in.
    for (const g of ['view-resolution', 'no-finer-view'] as const) {
      expect(byRefinedGate.get(g) ?? 0, `refine-only gate ${g} never fires`).toBeGreaterThan(0)
      expect(byGate.get(g), `${g} is not supposed to be reachable unrefined`).toBeUndefined()
    }
  })

  it('surface mismatch is separable from the rest of the residual', () => {
    // The number the roadmap needs to stop double-counting: how much of "refused"
    // is really "you asked the wrong view". It must be its own bucket, and it
    // must dominate — if it ever stops dominating a both-surfaces sweep, the
    // sweep changed shape and every percentage quoted off it needs re-reading.
    const wrong = byGate.get('wrong-surface') ?? { step: 0, roll: 0 }
    const mismatch = wrong.step + wrong.roll
    const rest = rows.length - mismatch
    console.log(
      `\n  surface mismatch ${mismatch}/${rows.length} (${((100 * mismatch) / rows.length).toFixed(0)}%) · genuine residual ${rest}`,
    )
    expect(mismatch).toBeGreaterThan(rest / 2)
  })
})
