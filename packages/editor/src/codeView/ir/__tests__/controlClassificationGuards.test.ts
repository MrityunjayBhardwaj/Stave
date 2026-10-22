/**
 * controlClassificationGuards.test.ts — the control-classification behaviours
 * that NO metric can see.
 *
 * The FX→Param collapse moves ~54 corpus nodes off the `FX` tag. Tag counts and
 * parity snapshots will move loudly and review well. This file exists for the
 * behaviours that sit in the blind spots BEHIND those counts — where a
 * regression produces no count movement, no snapshot churn, no thrown error,
 * and no failing gate.
 *
 * Three independent reasons a blind spot exists here:
 *
 *   1. ZERO CORPUS OCCURRENCES. `reverb` and `hpf` appear nowhere in the 57
 *      corpus files, so no count can ever observe them regressing.
 *   2. THE METRIC IS THE WRONG SHAPE. `extractTransform` emits a transform
 *      arrow; a change there alters the emitted STRING while leaving every tag
 *      count identical. Counting nodes cannot see a change in how a node is
 *      spelled.
 *   3. SEMANTICS DO NOT MOVE EITHER. The two arrow forms are hap-equivalent
 *      (pinned below with the eval oracle), so even a behavioural test would
 *      stay green. Only the emitted string shows a change.
 *
 * So the assertions here are deliberately on the EMITTED STRING and the
 * CLASSIFIED PARAM NODE (its canonical key/value on the IR), not on tags. Each pin says whether the collapse is
 * expected to PRESERVE it or deliberately FLIP it — a pin whose intent is
 * unstated is just a tripwire, and the next person deletes it.
 *
 * ---------------------------------------------------------------------------
 * SCOPE — what these pins are, and what they are NOT
 * ---------------------------------------------------------------------------
 * Read before treating a failure here as a user-facing bug. It is not one.
 * Both surfaces this file pins are INTERNAL:
 *
 *   - `toStrudel` has ZERO production callers. The two modules that could call
 *     it document that they deliberately do not (`codeView/writeback.ts:11`,
 *     `codeView/arrange/serialize.ts:7`): write-back does span surgery on
 *     TEXT precisely to avoid this whole-statement regenerator, and
 *     `dist/index.d.ts:156` states the reason outright — "NEVER calls
 *     `toStrudel` (no fidelity tax)". So neither arrow spelling ever reaches a
 *     user's document. `toStrudel` IS the oracle for several test suites, and
 *     that is the reason to pin it.
 *   - The split param keys (`params.lpf` vs `params.cutoff`) are read in
 *     production by NOTHING except the IR Inspector's `Object.keys()` debug
 *     views (`IRInspectorPanel.tsx:469`, `IRInspectorChrome.ts:29`). Pitch
 *     resolution reads only `note`/`n`/`freq` (`musicalTimeline/pitch.ts`).
 *     Audio gets its `room`/`cutoff`/`delay` from Strudel's own eval, never
 *     from our IR.
 *
 * The collapse these pins guard is therefore INTERNAL COHERENCE and drift
 * removal — retiring the last hand-maintained mirror of Strudel's control
 * vocabulary — not a fix for anything a user can currently observe. That is a
 * good reason to do it, and a bad reason to rush it ahead of defects that ARE
 * user-visible. Stating the scope here so the next reader prices it correctly
 * rather than inferring urgency from the density of assertions.
 *
 * Everything asserted here was verified against unmodified `f6c5049f` before
 * being written down. Nothing here is transcribed from a design document.
 *
 * See #955 (this suite) · #944 (the collapse) · #929 (adapter consolidation).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { evalScope, evaluate } from '@strudel/core/evaluate.mjs'
import * as strudelCore from '@strudel/core'
import { mini, miniAllStrings } from '@strudel/mini/mini.mjs'
import { isControlName } from '@strudel/core/controls.mjs'
import type { PatternIR } from '../PatternIR'
import { parseStrudel } from '../parseStrudel'
import { toStrudel } from '../toStrudel'

/* eslint-disable @typescript-eslint/no-explicit-any */

// One-time Strudel scope boot. Needed only by the hap-equivalence / merge
// eval-oracle pins; the string + Param-node pins are pure.
beforeAll(async () => {
  await evalScope(Promise.resolve(strudelCore), Promise.resolve({ mini }))
  miniAllStrings()
})

/** Every node in the tree, depth-first. Walks the sub-IR carriers by name so a
 *  Stack's `tracks` and a Seq's `children` are both reached. */
function walk(node: unknown, out: PatternIR[] = []): PatternIR[] {
  if (!node || typeof node !== 'object') return out
  const n = node as any
  if (typeof n.tag === 'string') out.push(n)
  for (const key of ['body', 'tracks', 'children', 'items', 'default_', 'transform', 'lookup', 'selector']) {
    const v = n[key]
    if (Array.isArray(v)) v.forEach((c) => walk(c, out))
    else if (v) walk(v, out)
  }
  return out
}

const nodesWithTag = (src: string, tag: string): any[] =>
  walk(parseStrudel(src)).filter((n) => n.tag === tag)

const emit = (src: string): string => toStrudel(parseStrudel(src) as never)

/** The classified {key: value} of the first Param node — the structural source
 *  the classification produces (a canonical `key` + its literal `value`), read
 *  straight off the IR instead of off a collected event. For a numeric-arg
 *  control the value is the scalar; a pattern-arg control carries a sub-IR value
 *  (its per-slot resolution was the retired collect engine's job — assert its
 *  canonical key via `nodesWithTag(...).key` instead). */
const firstEventParams = (src: string): Record<string, unknown> => {
  const [node] = nodesWithTag(src, 'Param')
  expect(node).toBeTruthy()
  return { [node.key]: node.value }
}

/** Haps as comparable strings, 4 cycles — the second oracle. Asks Strudel what
 *  it actually triggers rather than trusting our own re-parse. */
async function haps(code: string, cycles = 4): Promise<string[]> {
  const evaluated = await evaluate(code)
  const out: string[] = []
  for (let c = 0; c < cycles; c++) {
    for (const h of (evaluated.pattern as any).queryArc(c, c + 1)) {
      out.push(`${h.whole?.begin?.valueOf?.() ?? '?'}:${JSON.stringify(h.value)}`)
    }
  }
  return out.sort()
}

// ---------------------------------------------------------------------------
// 1. extractTransform — the FX-only privileged path (toStrudel.ts:347)
// ---------------------------------------------------------------------------
describe('extractTransform: the FX arrow form is gone', () => {
  // COLLAPSE FLIPPED THIS (#944). `x => x.room(0.8)` was reachable ONLY because
  // a numeric-arg control still tagged FX. Once room/delay/lpf became Param the
  // `tag === 'FX'` branch had no real users, and #967 deleted the FX tag (and
  // that branch) entirely. Every control body now takes the `() =>` fallback —
  // hap-identical for every AND chunk (pinned in section 2).
  it('a collapsed control body emits the 0-arg arrow form (room is Param now)', () => {
    expect(emit('s("bd hh").every(4, x => x.room(0.8))'))
      .toBe('s("bd hh").every(4, () => s("bd hh").room(0.8))')
  })

  // COLLAPSE PRESERVES THESE. They already take the generic fallback today —
  // which is the point: the `() =>` form is the MAJORITY behaviour, covering
  // all 18 transform-arrow bodies in the corpus (add 12, speed 5, rev 1, ply 1).
  // The fallback emits a ZERO-ARGUMENT arrow that inlines a duplicate copy of
  // the receiver, discarding its input entirely — which is verbose but, per the
  // hap pins below, plays identically. Calling it "the norm" is not a value
  // judgement either way; it is simply which path most bodies take.
  it.each([
    // Every corpus transform-arrow shape, with the tag it carries. The tag is
    // ASSERTED, not just documented — otherwise this table would keep passing
    // if a body silently changed tag while its emission happened to match.
    ['s("bd hh").every(4, x => x.speed(2))', 's("bd hh").every(4, () => s("bd hh").speed(2))', 'Param'],
    ['s("bd hh").every(4, x => x.add(12))',  's("bd hh").every(4, () => s("bd hh").add(12))',  'Code'],
    ['s("bd hh").every(4, x => x.rev())',    's("bd hh").every(4, () => s("bd hh").rev())',    'Code'],
    ['s("bd hh").every(4, x => x.ply(2))',   's("bd hh").every(4, () => s("bd hh").ply(2))',   'Ply'],
  ])('a non-FX body (%s) emits a 0-arg arrow duplicating the receiver', (src, expected, tag) => {
    expect(emit(src)).toBe(expected)
    expect(nodesWithTag(src, tag)).not.toHaveLength(0)
  })

  // The incoherence the collapse RESOLVES. Before #944 a numeric arg tagged FX
  // and emitted `x => x.room(0.8)` while a pattern arg tagged Param and emitted
  // `() => …room("0.3 0.5")` — same control, same position, two spellings
  // decided purely by arg shape. Now both are Param, so both take the `() =>`
  // form: one control, one arrow form.
  it('one control now emits the same arrow form regardless of arg shape', () => {
    expect(emit('s("bd hh").every(4, x => x.room(0.8))'))
      .toBe('s("bd hh").every(4, () => s("bd hh").room(0.8))')
    expect(emit('s("bd hh").every(4, x => x.room("0.3 0.5"))'))
      .toBe('s("bd hh").every(4, () => s("bd hh").room("0.3 0.5"))')
  })

  // The duplication is not cosmetic — it scales with the receiver. An upstream
  // chain is copied wholesale into the arrow body.
  it('the duplicated receiver carries the whole upstream chain', () => {
    expect(emit('s("bd hh").fast(2).every(4, x => x.room("0.3 0.5"))'))
      .toBe('s("bd hh").fast(2).every(4, () => s("bd hh").fast(2).room("0.3 0.5"))')
  })
})

// ---------------------------------------------------------------------------
// 2. Both arrow forms are hap-equivalent — why no behavioural test catches it
// ---------------------------------------------------------------------------
describe('both arrow forms play identically (so only the string shows a change)', () => {
  // This pin is the REASON the string assertions above must exist, and the
  // reason not to over-claim them. The 0-arg arrow ignores its argument and
  // rebuilds the receiver — and the receiver is exactly what it rebuilds, so
  // the music is unchanged. The two forms are verbosely different and
  // semantically identical. Since `toStrudel` has no production callers
  // (see SCOPE above), neither spelling reaches a user's file either.
  //
  // COLLAPSE MUST PRESERVE THIS. If a later change makes these diverge, the
  // duplication has turned into wrong music and this test is the alarm.
  it.each([
    's("bd hh").every(4, x => x.room(0.8))',        // #944 — the newly-flipped NUMERIC case
    's("bd hh").every(4, x => x.room("0.3 0.5"))',
    's("bd hh").every(4, x => x.lpf("400 800"))',
    's("bd hh").fast(2).every(4, x => x.room("0.3 0.5"))',
    's("bd sd hh cp").chunk(2, x => x.room(0.5))',  // #944 — chunk, not just every: the 0-arg arrow is equivalent here too
  ])('%s round-trips to hap-identical code', async (src) => {
    const out = emit(src)
    expect(out).not.toBe(src)          // the spelling really did change
    expect(await haps(out)).toEqual(await haps(src))
  })
})

// ---------------------------------------------------------------------------
// 3. reverb / hpf — zero corpus occurrences, therefore metric-invisible
// ---------------------------------------------------------------------------
describe('controls the corpus cannot see', () => {
  // The registry itself is the authority for WHY reverb must stay curated.
  // Asserting `isControlName` rather than a transcribed list means this pin
  // re-derives from Strudel on every run and cannot go stale.
  it('reverb is not a core control, hence cannot migrate to the registry path', () => {
    expect(isControlName('reverb')).toBe(false)
    expect(isControlName('room')).toBe(true)
  })

  // #967 MUST PRESERVE classification. reverb is not a registry control, so
  // when the FX tag was deleted its numeric arm was rehomed to Param under the
  // user's own token — NOT opaqued. Regressing to Code would be a silent
  // classified→opaque loss no count shows (PV201).
  it('reverb with a numeric arg classifies as Param under its own key', () => {
    expect(nodesWithTag('s("bd").reverb(0.5)', 'Param')).toHaveLength(1)
    expect(firstEventParams('s("bd").reverb(0.5)')).toMatchObject({ reverb: 0.5 })
  })

  // Faithful and deliberate: reverb is not in the registry, so the #935
  // pattern-arg rescue does not apply and it opaques. Pinned as the asymmetry
  // it is — NOT as an endorsement.
  it('reverb with a pattern arg opaques, unlike every registry control', () => {
    expect(nodesWithTag('s("bd").reverb("0.3 0.5")', 'Code')).not.toHaveLength(0)
    expect(nodesWithTag('s("bd").reverb("0.3 0.5")', 'Param')).toHaveLength(0)
  })

  it('hpf classifies as Param in both arg shapes though the corpus contains none', () => {
    // #944 — hpf is a real control, so numeric now takes the registry path too;
    // both arg shapes are Param (canonical hcutoff). Pre-collapse the numeric
    // arm tagged FX.
    expect(nodesWithTag('s("bd").hpf(400)', 'Param')).toHaveLength(1)
    expect(nodesWithTag('s("bd").hpf("200 400")', 'Param')).toHaveLength(1)
  })

  // `scale` is the OTHER non-registry control (#944 names it beside `reverb`),
  // and the two do NOT behave alike — the reason to pin both rather than treat
  // "non-core" as one case. `reverb`'s pattern form opaques; `scale` is a
  // curated Param arm, so it classifies. A change that reasons about "the
  // non-core controls" as one group gets one wrong, and neither is in the
  // corpus to catch it.
  it('scale is also non-core, but classifies as Param where reverb opaques', () => {
    expect(isControlName('scale')).toBe(false)
    const [node] = nodesWithTag('s("bd").scale("C:major")', 'Param')
    expect(node.key).toBe('scale')
    expect(firstEventParams('s("bd").scale("C:major")')).toMatchObject({ scale: 'C:major' })
  })
})

// ---------------------------------------------------------------------------
// 4. One control, two param keys — the defect at the consumer-facing level
// ---------------------------------------------------------------------------
describe('the same control files under different keys by arg shape', () => {
  // Tag counts show a node moving between tags; THIS shows a reader of
  // `params.lpf` finding nothing when the user wrote a pattern. The canonical
  // key (`cutoff`) is the one #928 established, so the pattern arm is already
  // correct and the NUMERIC arm is the one out of step.
  //
  // Scope, so this is not read as bigger than it is: the only production
  // readers of these keys are the IR Inspector's `Object.keys()` debug views.
  // Audio never reads them — Strudel's own eval supplies the real values. So
  // this is an internal-coherence defect, and the honest reason to fix it is
  // that ONE control answering to TWO keys will mislead the next person who
  // reasons about the IR, not that anything currently sounds or looks wrong.
  //
  // #944 FLIPPED THE NUMERIC ROW: both spellings now file under the canonical
  // key. Pre-collapse the numeric arm filed under the raw name (`lpf`/`hpf`, an
  // FX params Record) while only the pattern arm canonicalised (`cutoff`/
  // `hcutoff`, #928). One control, one key — the whole point.
  it('lpf: both arg shapes now file under the canonical cutoff', () => {
    // Numeric arg carries its scalar on the node; pattern arg carries a sub-IR
    // value (per-slot resolution was collect's job), so assert its canonical key.
    expect(firstEventParams('s("bd").lpf(800)')).toMatchObject({ cutoff: 800 })
    expect(nodesWithTag('s("bd").lpf("400 800")', 'Param')[0].key).toBe('cutoff')
  })

  it('hpf: both arg shapes now file under the canonical hcutoff', () => {
    expect(firstEventParams('s("bd").hpf(400)')).toMatchObject({ hcutoff: 400 })
    expect(nodesWithTag('s("bd").hpf("200 400")', 'Param')[0].key).toBe('hcutoff')
  })

  // `delay` is the flagship case and a DIFFERENT shape from lpf/hpf: it splits
  // the TAG without splitting the KEY, because `getControlName('delay')` is
  // already `delay`. In the corpus it appears as 16 FX plus 3 Param — one
  // control, two tags, decided purely by how the user wrote the argument.
  //
  // This is why the collapse is worth doing and also why "did the key move?"
  // is not a sufficient check: for delay the key never moves, so only the tag
  // shows the defect, while for lpf only the key shows it. Pin both shapes.
  it('delay no longer splits the tag — both arg shapes are Param under delay', () => {
    // #944 resolved the flagship split (16 FX + 3 Param in the corpus): one
    // control, two tags decided by arg shape. Both are Param now. The key never
    // split (getControlName('delay') === 'delay'), so only the tag showed it.
    expect(nodesWithTag('s("bd").delay(0.5)', 'Param')).toHaveLength(1)
    expect(nodesWithTag('s("bd").delay("0.3 0.5")', 'Param')).toHaveLength(1)
    expect(firstEventParams('s("bd").delay(0.5)')).toMatchObject({ delay: 0.5 })
    // Pattern arg: the key never splits (getControlName('delay') === 'delay').
    expect(nodesWithTag('s("bd").delay("0.3 0.5")', 'Param')[0].key).toBe('delay')
  })

  // The remaining curated arms, pinned as a set so the collapse cannot quietly
  // drop one. All four are real registry controls that key to themselves, so a
  // correct collapse leaves every assertion here untouched.
  it.each([
    ['crush', 4], ['begin', 0.2], ['resonance', 10], ['cut', 1],
  ])('%s classifies numerically as Param and keys to itself', (method, value) => {
    const src = `s("bd").${method}(${value})`
    expect(nodesWithTag(src, 'Param')).toHaveLength(1)  // #944 — FX pre-collapse
    expect(isControlName(method)).toBe(true)
    expect(firstEventParams(src)).toMatchObject({ [method]: value })
  })

  // `userMethod` is what keeps the round-trip byte-identical while the key is
  // canonicalised. If this drifts, the user's source gets rewritten under them.
  it('the user token survives canonicalisation, so source round-trips', () => {
    expect(nodesWithTag('s("bd").lpf("400 800")', 'Param')[0].userMethod).toBe('lpf')
    expect(emit('s("bd").lpf("400 800")')).toBe('s("bd").lpf("400 800")')
    expect(emit('s("bd").hpf("200 400")')).toBe('s("bd").hpf("200 400")')
  })
})

// ---------------------------------------------------------------------------
// 5. Stacked same-control calls — first-wins at the merge
// ---------------------------------------------------------------------------
describe('repeated control calls merge last-wins (matching Strudel eval)', () => {
  // The merge order FLIPPED with #944, and the original pin here required any
  // flip to be ARGUED, not just accepted. Here is the argument: pre-collapse
  // two nested FX nodes merged in `collect` to the INNER (first-written) value;
  // the Param path takes the OUTER (last-written) value — and last-wins is what
  // Strudel itself plays (verified below with the eval oracle, not our own
  // re-parse). So the collapse did not introduce a divergence; it removed one —
  // the FX first-wins merge was the outlier all along. See #944.
  it('.room(0.3).room(0.5) collects the last value, matching Strudel', async () => {
    // Both calls survive as two Param nodes on the IR; which one WINS on the hap
    // is Strudel's own last-wins merge — the eval oracle is the ground truth now
    // that the collect merge is retired.
    expect(nodesWithTag('s("bd").room(0.3).room(0.5)', 'Param')).toHaveLength(2)
    const [hap] = await haps('s("bd").room(0.3).room(0.5)', 1)
    expect(hap).toContain('"room":0.5')
  })

  it('holds for a control that canonicalises, too', async () => {
    const [hap] = await haps('s("bd").lpf(400).lpf(900)', 1)
    expect(hap).toContain('"cutoff":900')
  })
})

// ---------------------------------------------------------------------------
// 6. Synthetic jux pans — a private marker, since #967 a Param not an FX
// ---------------------------------------------------------------------------
describe('jux pan nodes are not a control classification', () => {
  // `jux` synthesises one pan node per arm to spread its two copies L/R. These
  // are NOT user-written controls. Since #967 deleted the FX tag they are
  // Param('pan', ±1) with NO userMethod — the discriminator that `irProjection`
  // strips on (`tag === 'Param' && key === 'pan' && userMethod === undefined`).
  it('jux synthesises one pan Param node per arm, neither with a userMethod', () => {
    const pans = nodesWithTag('s("bd hh").jux(x => x.rev())', 'Param')
    expect(pans).toHaveLength(2)                        // one per stacked arm
    expect(pans.map((p) => p.value).sort()).toEqual([-1, 1])
    for (const p of pans) {
      expect(p.key).toBe('pan')
      expect(p.userMethod).toBeUndefined()              // the strip predicate
    }
  })

  // The contrast that gives the discriminator its meaning. Both a user pan and
  // a jux pan are now Param('pan', …) — same tag, same key. What separates them
  // is `userMethod`: a user-written `.pan(0.5)` carries the token 'pan'
  // (tagMeta), while jux's synthetic pan carries none. `userMethod` alone is
  // the private-marker flag now that FX is gone; the strip predicate keys on it
  // plus the 'pan' key so an ordinary `.pan(...)` is never folded away.
  it('a user-written pan carries userMethod, the jux marker does not', () => {
    const [userPan] = nodesWithTag('s("bd").pan(0.5)', 'Param')
    expect(userPan.key).toBe('pan')
    expect(userPan.userMethod).toBe('pan')
    const juxPans = nodesWithTag('s("bd hh").jux(x => x.rev())', 'Param')
    expect(juxPans.every((p) => p.key === 'pan' && p.userMethod === undefined)).toBe(true)
  })
})
