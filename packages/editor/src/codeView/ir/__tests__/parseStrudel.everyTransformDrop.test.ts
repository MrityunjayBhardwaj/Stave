/**
 * A transform the typed arms don't model must be WRAPPED, never DROPPED (#963).
 *
 * `parseTransform` classifies the function passed to `.every()` / `.sometimes()`
 * / `.chunk()` etc. It knows `fast(<number>)`, `slow(<number>)` and the
 * single-char arrow `x => x.fast(2)`. Everything else — `fast(2*2)` (arithmetic
 * arg), `slow(-2)` (negative), a bare `rev`, or a multi-char / parenthesised
 * arrow param (`pp => pp.fast(2)`, `(x) => x.fast(2)`) — used to fall through to
 * `return defaultIr`: it handed BACK the untransformed body. The IR then
 * positively asserted `every(n, identity)` — the transform node was absent and
 * the timeline drew the base pattern unchanged. Silent data loss (PV37
 * wrap-never-drop; north-star invariant 4).
 *
 * This is PARITY-BLIND: the node vanishes, so no tag COUNT moves — the metric
 * that catches classification drift is structurally blind here. So the gate
 * asserts on STRUCTURE (the transform node is present and distinct from the
 * body) and on ROUND-TRIP (the source text survives), never on a count. Both
 * the plain `parseStrudel` and its recording path (the Inspector's views,
 * #1387) are checked, so recording cannot change what `parseTransform` builds.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { evalScope, evaluate } from '@strudel/core/evaluate.mjs'
import * as strudelCore from '@strudel/core'
import { mini, miniAllStrings } from '@strudel/mini/mini.mjs'
import { parseStrudel } from '../parseStrudel'
import { toStrudel } from '../toStrudel'
import { IR, type PatternIR } from '../PatternIR'
import { parseStrudelStages } from '../parseStrudelStages'

function staged(code: string): PatternIR {
  const stages = parseStrudelStages(code)
  return stages[stages.length - 1].ir
}

type EveryNode = { tag: 'Every'; n: number; body: PatternIR; default_?: PatternIR }
function findEvery(node: unknown): EveryNode | null {
  if (!node || typeof node !== 'object') return null
  const n = node as Record<string, unknown>
  if (n.tag === 'Every') return n as unknown as EveryNode
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) {
      for (const x of v) {
        const r = findEvery(x)
        if (r) return r
      }
    } else if (v && typeof v === 'object') {
      const r = findEvery(v)
      if (r) return r
    }
  }
  return null
}

/** The transform arm and the default arm must be DISTINCT — equal arms are the
 *  every(n, identity) signature of a dropped transform. */
function transformIsDistinct(ev: EveryNode | null): boolean {
  if (!ev) return false
  return JSON.stringify(ev.body) !== JSON.stringify(ev.default_)
}

describe('every() transform is wrapped, never dropped (#963)', () => {
  // Each case: the unmodelled transform + the substring the round-trip MUST
  // still contain (the transform never silently disappears).
  const CASES: Array<{ code: string; keeps: string }> = [
    { code: 'note("c3").every(2, fast(2*2))', keeps: 'fast(2*2)' },
    { code: 'note("c3").every(2, slow(-2))', keeps: 'slow(-2)' },
    { code: 'note("c3").every(2, rev)', keeps: 'rev' },
    { code: 'note("c3").every(2, pp => pp.fast(2))', keeps: 'fast(2)' },
    { code: 'note("c3").every(2, (x) => x.fast(2))', keeps: 'fast(2)' },
  ]

  for (const { code, keeps } of CASES) {
    it(`headless — ${code} keeps a distinct transform node`, () => {
      const ir = parseStrudel(code)
      const ev = findEvery(ir)
      expect(ev, 'an Every node exists').not.toBeNull()
      expect(transformIsDistinct(ev)).toBe(true)
      // The transform is a real node (a modelled tag like Fast, or an opaque
      // Code wrapper) — never the bare body it would be if dropped.
      expect(ev!.body.tag === 'Play').toBe(false)
    })

    it(`headless — ${code} round-trips the transform source`, () => {
      expect(toStrudel(parseStrudel(code))).toContain(keeps)
    })

    it(`staged — ${code} keeps a distinct transform node on the recording path`, () => {
      const ev = findEvery(staged(code))
      expect(ev, 'an Every node exists on the recording path').not.toBeNull()
      expect(transformIsDistinct(ev)).toBe(true)
      expect(ev!.body.tag === 'Play').toBe(false)
    })
  }

  // Opaque wrappers must carry the VERBATIM arg so `2*2` is not silently
  // truncated to `2` (which routing through applyChain's parseFloat would do).
  it('an arithmetic arg is preserved byte-exact in the opaque wrapper', () => {
    const ev = findEvery(parseStrudel('note("c3").every(2, fast(2*2))'))
    const via = (ev!.body as { via?: { method?: string; args?: string } }).via
    expect(via?.method).toBe('fast')
    expect(via?.args).toBe('2*2')
  })

  // Control arm: the forms parseTransform ALREADY modelled must be untouched —
  // this is what makes the drop-cases above meaningful rather than a no-op.
  it('the modelled numeric + single-char-arrow forms are unchanged', () => {
    expect(toStrudel(parseStrudel('note("c3").every(2, fast(2))'))).toContain('.every(2, fast(2))')
    expect(toStrudel(parseStrudel('note("c3").every(2, x => x.fast(2))'))).toContain('.every(2, fast(2))')
  })
})

/**
 * The second oracle: Strudel's own runtime. A structural node could still be a
 * DEAD wrapper — present in the tree but round-tripping to code that no longer
 * plays the transform. So we evaluate the round-trip and compare haps against
 * (a) the original source — they must MATCH (the wrap is behaviour-preserving)
 * — and (b) the identity `every(n, () => body)` the drop used to emit — they
 * must DIFFER (the transform genuinely runs).
 */
describe('every() transform round-trip is hap-faithful, not identity (#963)', () => {
  beforeAll(async () => {
    await evalScope(Promise.resolve(strudelCore), Promise.resolve({ mini }))
    miniAllStrings()
  })

  async function haps(code: string, cycles = 4): Promise<string[]> {
    const evaluated = await evaluate(code)
    const out: string[] = []
    for (let c = 0; c < cycles; c += 1) {
      for (const h of (evaluated.pattern as { queryArc: (a: number, b: number) => Array<{ whole?: { begin?: { valueOf?: () => number } }; value: unknown }> }).queryArc(c, c + 1)) {
        out.push(`${h.whole?.begin?.valueOf?.() ?? '?'}:${JSON.stringify(h.value)}`)
      }
    }
    return out.sort()
  }

  it('fast(2*2) round-trips to the same haps as the source, and is not identity', async () => {
    const source = 'note("c3 e3 g3 b3").every(2, fast(2*2))'
    const roundTrip = toStrudel(parseStrudel(source))
    const identity = 'note("c3 e3 g3 b3").every(2, () => note("c3 e3 g3 b3"))'
    const [srcHaps, rtHaps, idHaps] = await Promise.all([haps(source), haps(roundTrip), haps(identity)])
    expect(rtHaps).toEqual(srcHaps) // behaviour preserved through parse→serialize
    expect(rtHaps).not.toEqual(idHaps) // the transform actually fires (the drop did not)
  })
})

/**
 * A transform we cannot express as a chain on the body — a fresh-expression
 * arrow (`x => n("a").set(x)`), a `compose`, … — is signalled with `null` from
 * `parseTransform`, and the calling method opaques the WHOLE `.method(args)`
 * call site (its existing D-03 fallback). That round-trips the transform
 * VERBATIM rather than embedding a broken `body.method(args)` wrapper or
 * asserting identity (#969). An identity arrow (`x => x`) is the exception: it
 * IS the body, so it stays a structural transform.
 */
describe('un-modellable transforms opaque the whole call and round-trip verbatim (#969)', () => {
  beforeAll(async () => {
    await evalScope(Promise.resolve(strudelCore), Promise.resolve({ mini }))
    miniAllStrings()
  })

  // Every method that threads a transform through parseTransform, with a
  // fresh-expression arrow it cannot model. Each must round-trip byte-for-byte.
  const VERBATIM: string[] = [
    'note("c3").every(2, x => n("a").set(x))',
    'note("c3").sometimes(x => n("a").set(x))',
    'note("c3").off(1/8, x => n("a").set(x))',
    'note("c3").jux(x => n("a").set(x))',
    'note("c3").chunk(4, x => n("a").set(x))',
    'chord("<G#m>").layer(x => n("a").set(x), x => n("b").set(x))',
  ]

  for (const code of VERBATIM) {
    it(`round-trips verbatim: ${code}`, () => {
      const rt = toStrudel(parseStrudel(code))
      expect(rt).toBe(code) // the whole call is opaque → byte-identical
      // ...and it is NOT the silent identity the drop produced.
      expect(rt).not.toContain('() =>')
    })
  }

  it('the verbatim round-trip still evaluates (it is runnable, not just present)', async () => {
    const code = 'note("c3").every(2, x => n("a").set(x))'
    const evaluated = await evaluate(toStrudel(parseStrudel(code)))
    expect(evaluated.pattern).toBeTruthy()
  })

  it('an identity arrow stays a structural transform (not opaqued)', () => {
    const ev = findEvery(parseStrudel('note("c3").every(2, x => x)'))
    expect(ev, 'x => x keeps its Every node').not.toBeNull()
    // Identity: the transform arm equals the default arm — correct for `x => x`.
    expect(JSON.stringify(ev!.body)).toEqual(JSON.stringify(ev!.default_))
  })
})
