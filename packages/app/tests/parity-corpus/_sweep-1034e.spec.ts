/**
 * A/B EQUIVALENCE — the derived arrays against the ACTUAL pre-change reader.
 * Proves inertness by observation over the real corpus rather than by
 * construction, which is the claim that matters for a representation change.
 *
 * RESULT WHEN RUN (2026-07-26, against `b08326cf`): 4662 ok unit×cycle pairs
 * compared, **0 differences** in `atoms`/`spans`/`durs`; 19375 occurrences
 * retained against 19331 atoms after display dedupe, i.e. **44 occurrences the
 * old reader dropped**.
 *
 * RE-TAKEN (2026-08-03, at `c5d3f6f5`, same `b08326cf` baseline): 4703 pairs,
 * again **0 differences**; 21342 occurrences retained against 21284 atoms, i.e.
 * **58 dropped**. The pair and occurrence counts moved with the corpus, which
 * has grown since; the claim that matters — the two readers derive identical
 * `atoms`/`spans`/`durs` — still holds across everything that has landed since
 * #1034. This re-take is also what proves the skip below is not vacuous: the
 * instrument was armed once and observed to pass, not merely observed to skip.
 *
 * TO RE-RUN, materialize the old reader beside the new one first — it is not
 * committed, because a second copy of `parse.ts` in the tree is exactly the kind
 * of divergent oracle this suite exists to avoid:
 *
 *     git show b08326cf:packages/editor/src/visualEdit/notation/parse.ts \
 *       > packages/editor/src/codeView/notation/parseBASE.ts
 *     pnpm --filter @stave/app exec vitest run \
 *       --config vitest.instruments.config.ts tests/parity-corpus/_sweep-1034e.spec.ts
 *     rm packages/editor/src/codeView/notation/parseBASE.ts
 *
 * (The old recipe renamed this to `_sweep-1034e.test.ts` first, because the gate
 * config includes `*.test.ts` only. `vitest.instruments.config.ts` — added with
 * #1141 — includes the `_*.spec.ts` instruments directly, so the rename is no
 * longer needed. Leave `parseBASE.ts` out of any commit.)
 *
 * The baseline is still reachable: `b08326cf` resolves, and `readGridOnsets` has
 * the same signature there as it does today, so this A/B is re-runnable — it is
 * waiting on the scratch copy, not on a reader that no longer exists.
 *
 * WHY IT SKIPS RATHER THAN FAILS (#1141). Without `parseBASE.ts` this used to die
 * mid-test on "Failed to load url … parseBASE. Does the file exist?", which reads
 * as a broken instrument rather than an unarmed one. It now detects the baseline
 * and declares the precondition instead. The honest cost: a skipped test is green
 * forever, which is the shape #1062 warns about, and weaker than a passing
 * assertion. It is the price of an instrument whose oracle deliberately does not
 * live in the tree.
 *
 * What stands against that cost is the explicit warning below — NOT the skip
 * itself, and not the `describe` title. Checked rather than assumed: the default
 * reporter prints a skipped file as `↓ … (1 test | 1 skipped)` and shows neither
 * the title nor any reason, so a bare `skipIf` would have gone quiet in exactly
 * the way that let this instrument rot unnoticed to begin with.
 */
import { describe, it, expect } from 'vitest'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import { miniPattern } from '../../../editor/src/codeView/strudelMini/pattern'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readGridOnsets as NEW } from '../../../editor/src/codeView/notation/parse'

/**
 * Loaded through a non-literal specifier ON PURPOSE: `parseBASE.ts` is a scratch
 * copy that is deleted after the run, and a static import of a missing module is
 * a typecheck error in every build that follows. The indirection keeps this file
 * committed and TYPECHECKING while the module it needs exists only during the A/B.
 *
 * It does not keep the file green — that was the original claim and it was wrong.
 * A dynamic import is invisible to collection, so the absence surfaced as a red
 * test rather than as a missing precondition, and a collect-only sweep over the
 * instruments reports this file green either way (#1141). Hence the explicit
 * existence check below: the thing collection cannot see, we look for ourselves.
 */
const BASE = '../../../editor/src/codeView/notation/parseBASE'

const dir = path.dirname(fileURLToPath(import.meta.url))
const minis: string[] = JSON.parse(fs.readFileSync(path.join(dir, 'mini-corpus.json'), 'utf8'))
  .minis.map((o: { mini: string }) => o.mini.trim()).filter((m: string) => m !== '')

/**
 * Resolved from THIS file's directory against the same relative specifier the
 * dynamic import uses, so the check and the import cannot drift apart. `.ts` is
 * the extension the recipe above writes.
 */
const HAVE_BASE = fs.existsSync(path.join(dir, `${BASE}.ts`))

/**
 * Said out loud, because the default reporter will not say it for us. A skipped
 * test prints as `↓ _sweep-1034e.spec.ts (1 test | 1 skipped)` — the file name
 * and nothing else. The `describe` title carrying the recipe is never shown, so
 * without this the instrument would go quiet in exactly the way that let it rot
 * unnoticed in the first place. A silent skip is not better than a red test; a
 * loud one is.
 */
if (!HAVE_BASE) {
  console.warn(
    '\n  [#1034 A/B] SKIPPED — baseline reader absent, so nothing was compared.\n' +
      '  To arm it, from the repo root:\n' +
      '    git show b08326cf:packages/editor/src/visualEdit/notation/parse.ts \\\n' +
      '      > packages/editor/src/codeView/notation/parseBASE.ts\n' +
      '  then re-run, and delete parseBASE.ts afterwards (it must not be committed).\n',
  )
}

describe.skipIf(!HAVE_BASE)('#1034 A/B — derived atoms/spans/durs are byte-identical to the old reader (needs parseBASE.ts — see the recipe in this file’s header)', () => {
  it('agrees on every corpus mini across a 4-cycle window', async () => {
    const OLD = (await import(/* @vite-ignore */ BASE)).readGridOnsets as typeof NEW
    let compared = 0, occTotal = 0, derivedTotal = 0
    const diffs: string[] = []
    for (const m of minis) {
      for (const cyc of [0, 1, 2, 3]) {
        let pat: unknown
        try { pat = reifyMini(m) } catch { continue }
        // the archived reader takes Strudel's own pattern; today's takes the adapter's (#1973)
        const a = (OLD as unknown as (p: unknown, c: number) => unknown)(pat, cyc) as any
        const b = NEW(miniPattern(m), cyc) as any
        if (a.ok !== b.ok) { diffs.push(`ok mismatch: ${m} @${cyc}`); continue }
        if (!a.ok) { if (a.gate !== b.gate) diffs.push(`gate: ${m} @${cyc}`); continue }
        compared++
        const strip = (o: any[]) => o.map((x) => ({ pos: x.pos, atoms: x.atoms, spans: x.spans, durs: x.durs }))
        if (JSON.stringify(strip(a.onsets)) !== JSON.stringify(strip(b.onsets))) {
          diffs.push(`onsets: ${JSON.stringify(m)} @${cyc}`)
        }
        for (const o of b.onsets) { occTotal += o.occ.length; derivedTotal += o.atoms.length }
      }
    }
    console.log(`\n  compared (ok) unit×cycle pairs: ${compared}`)
    console.log(`  occurrences RETAINED:           ${occTotal}`)
    console.log(`  atoms after display dedupe:     ${derivedTotal}`)
    console.log(`  occurrences the old reader DROPPED: ${occTotal - derivedTotal}`)
    console.log(`  differences in derived output:  ${diffs.length}`)
    if (diffs.length) console.log(diffs.slice(0, 10).join('\n'))
    expect(diffs).toHaveLength(0)
  })
})
