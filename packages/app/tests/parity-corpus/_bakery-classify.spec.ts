/**
 * _bakery-classify.spec.ts — V-1 classifier harness (NOT a CI gate).
 *
 * Driven ONLY by parity-bakery.mjs (maintainer tool) via the BAKERY_SAMPLES
 * / BAKERY_RESULT env vars. When those are absent it self-skips, so a plain
 * `vitest run` (CI) never touches the network-sourced samples and this file
 * is inert in the suite count. The leading underscore + the env guard keep
 * it out of the 34-file parity/loc CI gate.
 *
 * Why a spec and not a plain node script: parseStrudel must be imported
 * from the editor SOURCE path (the @stave/editor barrel pulls
 * @strudel/draw → gifenc CJS → ESM crash under standalone node — see
 * parity.test.ts:31-38 and the 20-15 α-1 commit body). vite-node resolves
 * the TS source cleanly; this is the same proven import the parity gate
 * uses, so the parser under measurement is byte-identical to CI's.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import { parseStrudel } from '../../../editor/src/codeView/ir/parseStrudel'
import { classifyFallback } from './classifyFallback'

const SAMPLES = process.env.BAKERY_SAMPLES
const RESULT = process.env.BAKERY_RESULT

/**
 * Canonical P67 discriminator (mirrors parseStrudel.ts:389/461 and the
 * γ observations): descend through the synthetic Track wrapper; the sample
 * is a Code-FALLBACK iff the musical body is `tag === 'Code'` with
 * `via === undefined` (the canonical bare-Code shape). A `via`-carrying
 * Code is a structural opaque-fragment wrapper, NOT a whole-program
 * fallback, so it counts as structured for the parity rung.
 */
function isCodeFallback(ir: unknown): boolean {
  if (!ir || typeof ir !== 'object') return false
  const node = ir as Record<string, unknown>
  // Unwrap a single synthetic Track('d1', body) / Stack to reach the body.
  const body =
    node.tag === 'Track' && node.body && typeof node.body === 'object'
      ? (node.body as Record<string, unknown>)
      : node
  return body.tag === 'Code' && (body as { via?: unknown }).via === undefined
}

// Cause attribution for a Code-fallback sample lives in `./classifyFallback`
// (extracted + unit-tested in `classifyFallback.test.ts`). It previously
// mis-attributed every binding-containing fallback to a phantom "#141 binding
// ref" gap; the honest version detects the real causes (Hydra/DSP/lambda/def)
// first and never claims binding resolution is the cause, because parseStrudel
// resolves bindings. See that module's header for the full rationale.

describe('bakery real-world classification (V-1, maintainer-driven)', () => {
  it(SAMPLES && RESULT ? 'classifies the fresh Supabase pull' : 'skipped (no BAKERY_SAMPLES env — CI inert)', () => {
    if (!SAMPLES || !RESULT) return
    const { samples } = JSON.parse(fs.readFileSync(SAMPLES, 'utf8')) as {
      samples: { hash: string | null; code: string }[]
    }
    let structured = 0
    let codeFallback = 0
    const classes: Record<string, number> = {}
    const perSample: { hash: string | null; verdict: string; firstLine: string }[] = []
    for (const s of samples) {
      let fallback: boolean
      try {
        fallback = isCodeFallback(parseStrudel(s.code))
      } catch {
        // parseStrudel is wrap-never-drop (PV37); a throw here is itself a
        // fallback-class observation, not a crash to swallow silently.
        fallback = true
      }
      const firstLine = (s.code.split('\n').find((l) => l.trim()) ?? '').slice(0, 70)
      if (fallback) {
        codeFallback++
        const cls = classifyFallback(s.code)
        classes[cls] = (classes[cls] ?? 0) + 1
        perSample.push({ hash: s.hash, verdict: 'code', firstLine })
      } else {
        structured++
        perSample.push({ hash: s.hash, verdict: 'structured', firstLine })
      }
    }
    fs.writeFileSync(
      RESULT,
      JSON.stringify(
        { total: samples.length, structured, codeFallback, classes, perSample },
        null,
        2,
      ),
    )
  })
})
