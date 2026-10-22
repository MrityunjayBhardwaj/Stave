/**
 * SCRATCH PROBE, inert (`_*.spec.ts`; vitest.config includes only `*.test.ts`).
 *   SWEEP=tests/parity-corpus/_1057-refusal-attribution.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * The free-zone gate reports asks that are arithmetically free but REFUSED by the
 * parser, attributed to a NAMED path rather than assumed to be any one issue's.
 *
 * ⚠ ATTRIBUTION IS BY THE GATE THE ENTRY RETURNED, never by a pattern-match over the
 * mini (#1130). The first version bucketed on `/(^|\s)_(\s|$)/` for "held note" and
 * `mini.includes('<')` for "alternation". Measured against the pre-#1120 population,
 * the sustain detector fired on **0 of 16** asks it was named for — all sixteen fell
 * through to `other`. The class had no representative at all: **all six units spell
 * their length as `@n` and not one contains a `_` character**, so the bucket was
 * unreachable rather than merely under-counted. (#1130's body says five of six; the
 * measured answer is six of six.) The totals were still right, because the total is
 * counted independently of the buckets — an instrument that reports the right total
 * through a detector that never fires reads as consistent to anyone checking it
 * against its own output.
 *
 * `ParseResult.gate` is the machine-readable decline site (`model.ts` `Gate`, #990).
 * It is produced by the projection that actually declined, so it cannot drift from
 * the code the way a regex over source text does, and the same call answers for both
 * surfaces without a second vocabulary.
 *
 * ⚠ THE GRANULARITY IS THE PROJECTION, NOT THE WRITER GUARD. All 16 pre-#1120 asks
 * report `edit-unsafe`, which is one named site with no residual — but `edit-unsafe`
 * is raised at nine places in `parse.ts`, so two distinct writer guards would arrive
 * here indistinguishable. That they did NOT here was MEASURED, with a throwaway
 * tagging patch inside `serialize.ts` reporting the distinct guard set each ask
 * touched: all 16 touch exactly one — `sustainTokens`' refusal to lead a `[…]` group
 * with a `_` — and no other. That finer answer is what #1130 means by "the writer
 * says why", and it is what makes one gate sufficient here. It is deliberately
 * NOT shipped: the writer declines at ~80 `return null` sites, and threading a second
 * reason vocabulary through them would duplicate, at the same boundary, what `Gate`
 * already owns. Reach for it when a population actually splits inside one gate.
 *
 * ⚠ THE POPULATION IS EMPTY ON THIS TREE — grid 0 / roll 0 free-zone refusals, since
 * #1117 cleared the roll and the alternation grid and #1120 cleared the held-note
 * grid. An empty run is this probe reporting health, NOT the probe being broken; a
 * change that reopens refusals is what it exists to catch. To exercise it, revert the
 * writer under test (e.g. `serialize.ts` to a pre-#1120 commit) and re-run.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import { freeZoneScale, RESOLUTION_PRESETS } from '../../../editor/src/codeView/notation/resolution'
import { documentSteps } from '../../../editor/src/codeView/notation/viewResolution'
import type { Gate } from '../../../editor/src/codeView/notation/model'

const here = path.dirname(fileURLToPath(import.meta.url))
const corpus: { minis: { mini: string }[] } = JSON.parse(
  fs.readFileSync(path.join(here, 'mini-corpus.json'), 'utf8'),
)
const minis = [...new Set(corpus.minis.map((o) => o.mini.trim()).filter((m) => m !== ''))]

type Refusal = { ok: false; reason: string; gate?: Gate }

/**
 * The bucket an ask falls in.
 *
 * ⚠ A MISSING `gate` IS NOT LABELLED AS A CAUSE, and that restraint is the whole
 * lesson of #1130 applied to this file's own replacement. The tempting label is "the
 * syntactic core answered before any projection ran" — the one documented case
 * (`not-a-pattern`, which `refused` passes through verbatim). It would be wrong:
 * swept over the corpus at scales 1/2/3/4/8/16, **788 refusals carry no gate** (456
 * grid / 332 roll), and they are the view-resolution family, where a projection did
 * speak and simply did not record it (#1132). 27 of them carry the `view-resolution`
 * gate's character-identical sentence while 102 of the same class do carry the field.
 *
 * So the reason string is carried through VERBATIM instead. An unattributed ask then
 * describes itself and stays visibly unattributed, rather than being given a cause
 * this probe cannot actually know ([[P417]]: a missing self-report must not read as a
 * verdict — which is exactly how `other` swallowed all 16 asks before).
 */
const causeOf = (r: Refusal): string => r.gate ?? `NO GATE (#1132) — ${r.reason}`

function sweep(label: string, parse: (m: string, s?: number) => { ok: boolean; model?: any; reason?: string; gate?: Gate }): void {
  let asks = 0
  const byCause: Record<string, number> = {}
  const units = new Set<string>()
  const examples: Record<string, string[]> = {}
  for (const mini of minis) {
    const base = parse(mini)
    if (!base.ok || !base.model || base.model.leafSource != null) continue
    const D = documentSteps(base.model)
    for (const t of RESOLUTION_PRESETS) {
      const scale = freeZoneScale(D, t)
      if (scale === null || t === base.model.steps) continue
      const got = parse(mini, scale)
      if (got.ok) continue
      asks++
      units.add(mini)
      const cause = causeOf(got as Refusal)
      byCause[cause] = (byCause[cause] ?? 0) + 1
      ;(examples[cause] ??= []).length < 6 && examples[cause].push(`${mini}  →${t}`)
    }
  }
  console.log(`\n════ ${label} ════  refused asks ${asks} over ${units.size} units`)
  for (const [c, n] of Object.entries(byCause).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${c}`)
    for (const e of examples[c] ?? []) console.log(`        ${JSON.stringify(e).slice(0, 120)}`)
  }
  console.log(`  units: ${[...units].map((m) => JSON.stringify(m.slice(0, 70))).join('\n         ')}`)
}

describe('#1057 refused-view attribution', () => {
  it('grid', () => sweep('STEP GRID', parseStepGrid as never))
  it('roll', () => sweep('PIANO ROLL', parsePianoRoll as never))
})
