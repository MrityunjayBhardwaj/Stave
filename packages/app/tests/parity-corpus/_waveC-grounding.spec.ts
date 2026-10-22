/**
 * _waveC-grounding.spec.ts — 20-18 Wave C-1 grounded-modelling probe.
 *
 * Underscore-prefixed maintainer harness (NOT in CI gate). Records the
 * Wave C action 4 evidence VERBATIM:
 *   - #7 `-KLGNJUtyyj1` (arrange(...) builder-root) flips whole-program
 *     STRUCTURED + deep walk reaches {tag:'Builder', kind:'arrange'} —
 *     **gate-critical PASS**.
 *   - #3 `-6c1hEXe8Agi` (chord("Am Am").voicing()...) — chord recogniser
 *     ARM works (proven by the stripped-shape probe in
 *     _waveC-diagnose.spec.ts), but the WHOLE-PROGRAM does NOT flip
 *     because of a `bindings*, sideEffect, finalExpr` shape rejection
 *     in `buildBindingMap` (NEW-class blocker → PK18 STOP recorded
 *     verbatim; backlog filed; pre-mortem 2 mitigation applied — no
 *     scope-expansion).
 *
 * Source code loaded VERBATIM from the bakery samples snapshot (the same
 * one R-1 classified) — no paraphrase, no transcription.
 *
 * Body-decision grounding (per ref/GROUND_TRUTH_SIGNAL_MJS.md §5):
 *   chord  → @strudel/core@1.2.6 controls.mjs:2130 + :10-54 + :41-49.
 *            Sublanguage mismatch → args RAW, body ABSENT (asserted on
 *            stripped-shape via _waveC-diagnose.spec.ts; the body-ABSENT
 *            contract is mechanism-level, NOT shape-dependent).
 *   arrange → @strudel/core@1.2.6 pattern.mjs:1469-1473. JS-tuple-array
 *             surface → args RAW, body ABSENT (asserted here on #7).
 *
 * vite-node deep import path per 20-18 EXECUTOR NOTES (the `@stave/editor`
 * barrel crashes standalone node via `@strudel/draw → gifenc`).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseStrudel } from '../../../editor/src/codeView/ir/parseStrudel'

const SAMPLES = path.join(
  __dirname,
  '.bakery-runs',
  'samples-2026-05-19T13-24-45-538Z.json',
)

type AnyNode = { tag?: string; via?: unknown; kind?: string; body?: unknown } & Record<string, unknown>

const isWholeStructured = (ir: unknown): boolean => {
  if (!ir || typeof ir !== 'object') return false
  const n = ir as AnyNode
  // Per the proto/oracle convention (`_proto-d01.spec.ts:256-263`,
  // `_bakery-classify.spec.ts:32-41`): peel the Track wrapper, then
  // structured = (tag !== 'Code') || (Code.via !== undefined).
  const body =
    n.tag === 'Track' && n.body && typeof n.body === 'object'
      ? (n.body as AnyNode)
      : n
  return body.tag !== 'Code' || body.via !== undefined
}

function findNode(
  root: unknown,
  pred: (n: AnyNode) => boolean,
  seen = new Set<unknown>(),
): AnyNode | undefined {
  if (!root || typeof root !== 'object' || seen.has(root)) return undefined
  seen.add(root)
  const n = root as AnyNode
  if (pred(n)) return n
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) {
      for (const x of v) {
        const hit = findNode(x, pred, seen)
        if (hit) return hit
      }
    } else if (v && typeof v === 'object') {
      const hit = findNode(v, pred, seen)
      if (hit) return hit
    }
  }
  return undefined
}

const findBuilder = (ir: unknown, kind: string) =>
  findNode(ir, (n) => n.tag === 'Builder' && n.kind === kind)

describe('20-18 Wave C-1 grounded chord/arrange modelling (maintainer-only)', () => {
  it('records #7 grounded flip + #3 PK18-STOP classification (whole-program shape gap, not chord-arm)', () => {
    const { samples } = JSON.parse(fs.readFileSync(SAMPLES, 'utf8')) as {
      samples: { hash: string | null; code: string }[]
    }
    const s3 = samples.find((s) => s.hash === '-6c1hEXe8Agi')
    const s7 = samples.find((s) => s.hash === '-KLGNJUtyyj1')
    expect(s3, '#3 -6c1hEXe8Agi must be present in samples snapshot').toBeDefined()
    expect(s7, '#7 -KLGNJUtyyj1 must be present in samples snapshot').toBeDefined()

    const out: string[] = []
    out.push('=== Wave C-1 grounded chord/arrange modelling — production parseStrudel ===')

    // #7 -KLGNJUtyyj1 — arrange([cycles, pattern], ...) as final expression.
    // GROUNDED PASS expected (clean `bindings*, finalExpr` shape).
    const ir7 = parseStrudel(s7!.code) as AnyNode
    const struct7 = isWholeStructured(ir7)
    const hit7 = findBuilder(ir7, 'arrange')
    out.push('--- #7 -KLGNJUtyyj1 (arrange final expr) — GROUNDED PASS expected ---')
    out.push(`whole-program tag=${String(ir7.tag).padEnd(8)} structured=${struct7}`)
    out.push(`deep-walk Builder/arrange = ${hit7 ? 'HIT' : 'MISS'}`)
    if (hit7) {
      out.push(`  hit.kind=${hit7.kind}  args="${String(hit7.args).slice(0, 60)}${String(hit7.args).length > 60 ? '…' : ''}"`)
      out.push(`  body present? ${('body' in hit7 && hit7.body !== undefined) ? 'YES (UNEXPECTED — should be ABSENT per grounded disposition)' : 'NO (correct — args-RAW-only per Ground Truth §5)'}`)
    }

    // #3 -6c1hEXe8Agi — chord(...) bindings + `all(x=>x.punchcard())` side-effect
    // + `"<...>".pick([...])` final expression. The chord recogniser ARM works
    // (verified by _waveC-diagnose.spec.ts → "proves chord works: synthetic
    // shape without all() side-effect statement" — when the side-effect line
    // is stripped, the program flips Track/body.tag=Pick with deep Builder/chord
    // HIT). The whole-program does NOT flip because `buildBindingMap` rejects
    // the `bindings*, sideEffect, finalExpr` shape (`finalIdx !==
    // stmts.length - 1` → return null → whole-program bareCode fallback).
    // This is a NEW-class blocker (program-shape, not chain-root recognition)
    // → PK18 STOP per plan pre-mortem 2 (PLAN line 380) — no scope expansion.
    const ir3 = parseStrudel(s3!.code) as AnyNode
    const struct3 = isWholeStructured(ir3)
    const hit3 = findBuilder(ir3, 'chord')
    out.push('--- #3 -6c1hEXe8Agi (chord-rooted bindings + trailing side-effect) — PK18 STOP recorded ---')
    out.push(`whole-program tag=${String(ir3.tag).padEnd(8)} structured=${struct3}`)
    out.push(`deep-walk Builder/chord  = ${hit3 ? 'HIT' : 'MISS'}`)
    out.push('CLASSIFICATION: whole-program-shape blocker (NOT chain-root) →')
    out.push('  buildBindingMap rejects `bindings*, all(...), finalExpr` shape')
    out.push('  (finalIdx !== stmts.length-1 → returns null → bareCode fallback).')
    out.push('  The chord arm itself WORKS — verified by _waveC-diagnose.spec.ts')
    out.push('  ("proves chord works" probe): stripped-#3 → Track/body.tag=Pick,')
    out.push('  deep Builder/chord HIT, args="\\"Am Am\\"".')
    out.push('  Disposition: PK18 STOP per plan pre-mortem 2 (PLAN:380).')
    out.push('  Backlog: file issue for buildBindingMap shape-tolerance gap.')

    const text = out.join('\n')
    // eslint-disable-next-line no-console
    console.log('\n' + text + '\n')
    fs.writeFileSync('/tmp/waveC-grounding-output.txt', text)

    // #7 ASSERT — the gate-critical GROUNDED PASS.
    expect(struct7, '#7 must flip whole-program STRUCTURED').toBe(true)
    expect(hit7, '#7 must deep-walk to {tag:Builder, kind:arrange}').toBeTruthy()
    // Grounded body-ABSENT contract (Ground Truth §3 + §5):
    expect((hit7 as AnyNode).body, '#7 arrange body MUST be absent — args-RAW-only per grounded disposition (JS-tuple-array surface outside matcher competence)').toBeUndefined()

    // #3 — 20-19 (#158) FLIP RECORDED. 20-18 Wave C grounded the chord arm
    // via the stripped-#3 probe (`Track/body.tag=Pick`, deep Builder/chord
    // HIT, args="\"Am Am\""). 20-18 locked the negative `struct3 === false`
    // as a PK18 STOP because the whole-program shape `bindings*, sideEffect,
    // finalExpr` was rejected by `buildBindingMap` (the side-effect
    // intermediate `all(x=>x.punchcard())` tripped the shape guard at
    // `parseStrudel.ts:534`). 20-19 (#158) ships `stripSideEffectStatements`
    // — a curated-list filter applied to `splitTopLevelStatements`'s output
    // BEFORE `buildBindingMap` consumes it — so the program shape becomes
    // `bindings*, finalExpr` (the shape the existing pS:534 guard already
    // accepts). #3 now flips whole-program STRUCTURED via the same chord/
    // arrange recogniser arm that 20-18 grounded. The Wave-C historical
    // narrative ABOVE this block (`#3 RECORD-NOT-BLOCK` … `stripped-shape`)
    // is preserved as load-bearing context for future debuggers: the chord
    // arm itself was correct in 20-18; the 20-19 shape-fence relaxation
    // unblocks the whole-program flip.
    expect(struct3, '#3 20-19 FLIP RECORDED — whole-program STRUCTURED via chord recogniser arm (closes #158); if this fails, either `stripSideEffectStatements` dropped a stmt it should not have OR the chord arm regressed').toBe(true)
  })
})
