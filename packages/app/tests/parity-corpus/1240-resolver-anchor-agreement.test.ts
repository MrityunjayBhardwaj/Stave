/**
 * 1240-resolver-anchor-agreement — the soundness condition for wiring the
 * resolver into a SYNCHRONOUS code path.
 *
 * ── THE PROBLEM THIS GATES ────────────────────────────────────────────────
 * `resolveMiniSource` was calibrated with EVAL proposals in hand (#1015,
 * `miniSource-calibration.test.ts`). The product cannot have those:
 * `useActiveChunk` calls `detectChunk` on every cursor move, `chunkDetect` is
 * pure by contract, and `admitProposals` needs an `EvaluatedDoc` the engine only
 * produces asynchronously. So `chunkDetect` runs the PARSE proposer alone.
 *
 * Parse-only is not simply "eval minus some hits". It hands every literal
 * exactly ONE proposal, so the resolver's most-evidence-first ranking has
 * nothing to rank and degenerates to source order wherever a unit reaches more
 * than one `source` literal — and it then answers CONFIDENTLY and WRONGLY. That
 * is worse than refusing: a wrong anchor is a write to a literal the user did
 * not mean, and the count of resolutions looks identical either way. Measured
 * when this was built: parse-only and eval both resolve 148 of the 173-unit
 * unoffered pool — the same number — while 14 of them name a DIFFERENT span
 * (`"siren"` where eval says `"<[b4, g#4, e4, c#4]> …"`). A gate that counted
 * resolutions would have read 148 = 148 and called them equivalent.
 *
 * ── THE CONDITION ─────────────────────────────────────────────────────────
 * `MiniSourceHit.alternatives` is what separates them, and it separates them
 * exactly: of the 148, the 125 with no alternatives ALL agree with eval, and
 * every one of the 14 disagreements carries alternatives. So `chunkDetect`
 * refusing whenever `alternatives` is non-empty buys a wrong-anchor rate of
 * ZERO, at a cost of the 9 ambiguous units that would have agreed anyway.
 *
 * ⚠ THOSE FIGURES ARE THE UNOFFERED POOL; THIS GATE IS WIDER. The numbers above
 * come from the scoping probe, which asked only the 173 units that had no view
 * — the population the wiring was sized against. This file asks EVERY unit in
 * all 150 documents, because the invariant is a property of the disposal rule
 * rather than of that slice, and a gate scoped to the slice would go quiet the
 * moment the slice shrank (which is exactly what wiring the resolver does to
 * it). Over the wide population it reads 862 unambiguous / 0 disagreements /
 * 36 ambiguous, 18 of which would have agreed. Both denominators are named
 * because quoting one without it is how a coverage figure misleads ([[P549]]).
 *
 * That is the invariant here: **an unambiguous parse-only resolution names the
 * same span evaluation would have named.** It is not a property of the corpus,
 * it is the premise the synchronous wiring rests on — if a disposal change ever
 * makes it false, `chunkDetect` starts writing to wrong literals in the live
 * editor and nothing else in the suite would say so.
 *
 * ── WHY THIS IS NOT CIRCULAR ──────────────────────────────────────────────
 * The two sides are produced by genuinely different machinery: the eval arm's
 * candidate spans come from located haps the transpiler declared and the engine
 * played, the parse arm's from acorn walking literals. They share only the
 * disposal rule. So agreement is evidence, not tautology — and the 14
 * disagreements are the proof that this comparison can fail.
 *
 * The reciprocal figures are REPORTED rather than asserted: they are properties
 * of the corpus and will drift with it, whereas the zero is a property of the
 * rule ([[PV320]] — keep the count as the floor and the claim separate).
 */
import { describe, it, expect } from 'vitest'
import { unitsWithStatus } from './editCoverage'
import {
  boot,
  evalLocations,
  hasCorpusArchive,
  loadCorpus,
} from '../../../editor/src/codeView/miniSource/__tests__/evalHarness'
import { admitProposals, QUERY_CYCLES } from '../../../editor/src/codeView/miniSource/evalProposals'
import { resolveMiniSource } from '../../../editor/src/codeView/miniSource/resolveMiniSource'
import { SpanIndex } from '../../../editor/src/codeView/miniSource/spanRole'

describe('#1240 — the synchronous wiring names the span evaluation would have', () => {
  // `.bakery-runs/` is gitignored — unreviewed third-party tunes (#1307). On a
  // machine without it this SKIPS and vitest reports it as skipped, rather than
  // dying on an ENOENT naming a path git refuses to track. The rule is imported,
  // never restated, so it cannot drift from the read it guards.
  it.skipIf(!hasCorpusArchive())('every UNAMBIGUOUS parse-only resolution agrees with the eval-first one', async () => {
    const docs = await loadCorpus()
    await boot()

    let unambiguous = 0
    let ambiguous = 0
    let ambiguousAgreed = 0
    const disagreements: string[] = []

    for (const doc of docs) {
      const units = unitsWithStatus(doc.code)
      if (units.length === 0) continue
      const ev = await evalLocations(doc.code, QUERY_CYCLES)
      const index = SpanIndex.build(doc.code)
      const proposals = admitProposals({ miniLocations: ev.declared, locations: ev.seen }).proposals

      for (const { unit } of units) {
        const withEval = resolveMiniSource(doc.code, unit, { proposals, index })
        const parseOnly = resolveMiniSource(doc.code, unit, { index })
        if (!withEval.ok || !parseOnly.ok) continue

        const same =
          withEval.range[0] === parseOnly.range[0] && withEval.range[1] === parseOnly.range[1]
        if (parseOnly.alternatives.length > 0) {
          ambiguous++
          if (same) ambiguousAgreed++
          continue // refused by `chunkDetect`, so its answer is never used
        }
        unambiguous++
        if (!same) {
          disagreements.push(
            `${doc.name} head=${unit.headFn}\n` +
              `    eval  ${JSON.stringify(withEval.text.slice(0, 60))} @${withEval.range}\n` +
              `    parse ${JSON.stringify(parseOnly.text.slice(0, 60))} @${parseOnly.range}`,
          )
        }
      }
    }

    console.log(
      [
        `\n─── #1240 anchor agreement (parse-only vs eval-first) ───`,
        `unambiguous (chunkDetect USES these)  ${unambiguous}  — disagreements ${disagreements.length}`,
        `ambiguous   (chunkDetect REFUSES)     ${ambiguous}  — of which ${ambiguousAgreed} would have agreed`,
        ...disagreements.map((d) => `  DISAGREE ${d}`),
      ].join('\n'),
    )

    // THE INVARIANT. Not a floor — a zero. Any disagreement means the live
    // editor can write to a literal the user did not mean.
    expect(disagreements).toEqual([])

    // The comparison must be able to fail: if nothing is unambiguous, the
    // assertion above is vacuous and would pass with the resolver deleted.
    expect(unambiguous).toBeGreaterThan(100)
  }, 600_000)
})
