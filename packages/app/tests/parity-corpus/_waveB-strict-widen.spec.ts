/**
 * _waveB-strict-widen.spec.ts — 20-18 Wave B-1 strict-widen probe.
 *
 * Underscore-prefixed maintainer harness (NOT in CI gate). Records the
 * three-part Wave B-1 action 4 evidence VERBATIM to OBSERVATIONS:
 *   (i)  every R-1 isolated chain-root → STRUCTURED + deep walk reaches
 *        `{tag:'Signal'|'Builder', kind:…}`.
 *   (ii) CONTROLS byte-identical pre-arm: `sound("hh hh hh hh")`→Seq,
 *        `` note(`<e5 d5>`).slow(4) ``→Slow, `n("0 1 2")`→Seq.
 *   (iii) User-shadow resolves via G2 (the bound subtree wins; the
 *        curated arm never sees `sine` as a bare ident because G2 fires
 *        first — placement-AFTER-G2 correctness).
 *
 * vite-node deep import path per 20-18 EXECUTOR NOTES (the `@stave/editor`
 * barrel crashes standalone node via `@strudel/draw → gifenc`).
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { parseExpression } from '../../../editor/src/codeView/ir/parseStrudel'

type AnyNode = { tag?: string; via?: unknown } & Record<string, unknown>

const isBare = (ir: unknown): boolean => {
  if (!ir || typeof ir !== 'object') return false
  const n = ir as AnyNode
  return n.tag === 'Code' && n.via === undefined
}

// Deep walk: returns the first node matching the predicate, or undefined.
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

const findKind = (ir: unknown, kind: string, tag?: 'Signal' | 'Builder') =>
  findNode(ir, (n) => n.tag === (tag ?? n.tag) && (n as { kind?: string }).kind === kind && (n.tag === 'Signal' || n.tag === 'Builder'))

describe('20-18 Wave B-1 strict-widen probe (maintainer-only)', () => {
  it('records (i) R-1 chain-roots structured + (ii) controls unchanged + (iii) user-shadow via G2', () => {
    const out: string[] = []
    out.push('=== Wave B-1 strict-widen probe — production parseExpression ===')

    // (i) Every R-1 isolated chain-root → STRUCTURED + deep-walk reaches {tag:'Signal'|'Builder', kind}.
    const r1Cases: [string, string, 'Signal' | 'Builder', string][] = [
      ['irand bare',        'irand(12)',                                 'Builder', 'irand'],
      ['irand.struct',      'irand(12).struct("x(8,8)|x(4,8)")',         'Builder', 'irand'],
      ['sine bare',         'sine',                                       'Signal',  'sine'],
      ['sine.range',        'sine.range(200,2000)',                       'Signal',  'sine'],
      ['perlin bare',       'perlin',                                     'Signal',  'perlin'],
      ['perlin.range',      'perlin.range(0.3,0.8)',                      'Signal',  'perlin'],
      ['rand bare',         'rand',                                       'Signal',  'rand'],
      ['run',               'run(8)',                                     'Builder', 'run'],
      ['saw.range',         'saw.range(0,1)',                             'Signal',  'saw'],
    ]
    out.push('--- (i) R-1 chain-roots → STRUCTURED + deep-walk hits ---')
    for (const [label, src, tag, kind] of r1Cases) {
      const ir = parseExpression(src, 0, undefined, new Map()) as AnyNode
      const bare = isBare(ir)
      const hit = findKind(ir, kind, tag)
      out.push(
        `${label.padEnd(22)} tag=${String(ir.tag).padEnd(8)} bare=${bare}  deep:${tag}/${kind}=${hit ? 'HIT' : 'MISS'}  src="${src}"`,
      )
      expect(bare, `${label} must NOT be bareCode`).toBe(false)
      expect(hit, `${label} must deep-walk to {tag:'${tag}', kind:'${kind}'}`).toBeTruthy()
    }

    // (ii) Controls byte-identical pre-arm.
    out.push('--- (ii) CONTROLS — byte-identical to pre-arm ---')
    const sound = parseExpression('sound("hh hh hh hh")', 0, undefined, new Map()) as AnyNode
    out.push(`sound("hh hh hh hh")    tag=${String(sound.tag).padEnd(8)} bare=${isBare(sound)}`)
    expect(sound.tag).toBe('Seq')

    const noteSlow = parseExpression('note(`<e5 d5>`).slow(4)', 0, undefined, new Map()) as AnyNode
    out.push(`note(\`<e5 d5>\`).slow(4) tag=${String(noteSlow.tag).padEnd(8)} bare=${isBare(noteSlow)}`)
    expect(noteSlow.tag).toBe('Slow')

    const nStrlit = parseExpression('n("0 1 2")', 0, undefined, new Map()) as AnyNode
    out.push(`n("0 1 2")              tag=${String(nStrlit.tag).padEnd(8)} bare=${isBare(nStrlit)}`)
    expect(nStrlit.tag).toBe('Seq')

    // (iii) User-shadow: bind `sine` to `s("bd")` → reference `sine` in chain
    //       must resolve to the bound subtree via G2, NOT the curated Signal
    //       arm (placement-AFTER-G2 correctness).
    out.push('--- (iii) USER-SHADOW via G2 (bound sine wins) ---')
    const sineBound = parseExpression('s("bd")', 0, undefined, new Map()) as AnyNode
    const bindings = new Map<string, AnyNode>([['sine', sineBound]]) as unknown as ReadonlyMap<
      string,
      AnyNode
    >
    const shadow = parseExpression(
      'sine',
      0,
      undefined,
      bindings as unknown as ReadonlyMap<string, never>,
    ) as AnyNode
    out.push(
      `bound sine bare-ref     tag=${String(shadow.tag).padEnd(8)} bare=${isBare(shadow)}  isSignal=${shadow.tag === 'Signal'}`,
    )
    // The bound subtree is the Seq from s("bd") (mini-parsed); MUST NOT be
    // {tag:'Signal', kind:'sine'} (that would be a regression — the
    // curated arm fired before G2 / the G2 arm was bypassed).
    expect(shadow.tag).not.toBe('Signal')
    // G2's contract returns the bound subtree as-is.
    expect(shadow).toBe(sineBound)

    const text = out.join('\n')
    // eslint-disable-next-line no-console
    console.log('\n' + text + '\n')
    fs.writeFileSync('/tmp/waveB-strict-widen-output.txt', text)
  })
})
