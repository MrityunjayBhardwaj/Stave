/**
 * parseParamArg.numericLiteral.test.ts — a control argument is a JS numeric
 * literal, in every spelling JS allows (#957).
 *
 * The bug: `parseParamArg` tested numbers with `/^-?\d+(\.\d+)?$/`, which
 * requires a digit BEFORE the decimal point. `.5` did not match, so
 * `.gain(.8)` — ordinary Strudel shorthand — failed to classify and the whole
 * call wrapped as opaque `Code`. Nothing threw. The node simply lost its
 * structure, which is what makes an opaque node expensive: it cannot be shown
 * as a control or edited through a view.
 *
 * Why it survived so long: the 13 curated FX arms have a `parseFloat`
 * fallback, and `parseFloat('.5') === 0.5`. So `.room(.5)` and `.delay(.2)`
 * re-tagged as FX and looked healthy — the fallback masked the defect for
 * exactly the controls most often written with a leading decimal, while every
 * other control silently opaqued.
 *
 * This is the same lexical blind spot #943 fixed one layer down (a leading
 * decimal in MINI-notation: `.speed(".5")` was read as speed 5). Two
 * independently hand-rolled parsers, the same wrong assumption about how a
 * number may be spelled. Hence the fix: delegate to `Number`, the parser that
 * owns the grammar, instead of transcribing it a third time.
 *
 * The refusal cases matter as much as the acceptance cases — `Number` must not
 * become a way to smuggle an expression into a numeric field.
 */
import { describe, it, expect } from 'vitest'
import type { PatternIR } from '../PatternIR'
import { parseStrudel, classifyLiteralRhs, isNumericLiteral } from '../parseStrudel'
import { toStrudel } from '../toStrudel'

/* eslint-disable @typescript-eslint/no-explicit-any */

function walk(node: unknown, out: PatternIR[] = []): PatternIR[] {
  if (!node || typeof node !== 'object') return out
  const n = node as any
  if (typeof n.tag === 'string') out.push(n)
  for (const k of ['body', 'tracks', 'children', 'items', 'default_', 'transform', 'lookup', 'selector']) {
    const v = n[k]
    if (Array.isArray(v)) v.forEach((c) => walk(c, out))
    else if (v) walk(v, out)
  }
  return out
}

const nodes = (src: string, tag: string): any[] =>
  walk(parseStrudel(src)).filter((n) => n.tag === tag)

describe('a leading-decimal control arg classifies (#957)', () => {
  // The regression proper. Each of these opaqued to `Code` before the fix.
  // `gain` and `speed` are CURATED Param arms and still failed, so this was
  // never an off-list gap — it reached every control routed through
  // parseParamArg.
  it.each([
    ['gain', '.8', 0.8],
    ['speed', '.5', 0.5],
    ['sustain', '.5', 0.5],
    ['clip', '.5', 0.5],
    ['attack', '.05', 0.05],
    ['roomsize', '.5', 0.5],       // off-list, reaches via the registry
    ['lpattack', '.1', 0.1],
  ])('.%s(%s) is a Param carrying the number', (method, arg, expected) => {
    const src = `s("bd").${method}(${arg})`
    expect(nodes(src, 'Code')).toHaveLength(0)
    const [param] = nodes(src, 'Param')
    expect(param.value).toBe(expected)
  })

  // Byte-fidelity: the user's spelling survives. `.gain(.8)` must NOT be
  // rewritten to `.gain(0.8)` — rawArgs is re-emitted verbatim, and a control
  // that silently normalises the user's source is its own defect.
  it.each(['.gain(.8)', '.speed(.5)', '.attack(.05)', '.gain(0.8)', '.gain(-1)'])
    ('%s round-trips byte-identically', (call) => {
      const src = `s("bd")${call}`
      expect(toStrudel(parseStrudel(src) as never)).toBe(src)
    })

  // Every other JS numeric literal spelling, since the whole point is to stop
  // guessing which ones exist.
  it.each([
    ['5.', 5], ['+5', 5], ['-.5', -0.5], ['1e-3', 0.001], ['0x10', 16], ['0', 0],
  ])('.gain(%s) parses as %s', (arg, expected) => {
    const [param] = nodes(`s("bd").gain(${arg})`, 'Param')
    expect(param?.value).toBe(expected)
  })
})

describe('a non-number is still refused', () => {
  // The guard that keeps `Number` from becoming a hole. Each of these must
  // stay opaque so the paths that DO handle them (binding resolution, signal
  // chains, mini patterns) still get their turn. A regression here would be
  // far worse than the bug being fixed: it would file an expression under a
  // numeric key and claim a value the audio never used.
  it.each([
    's("bd").gain(vol)',          // bare identifier — a binding
    's("bd").gain(1/8)',          // arithmetic expression
    's("bd").gain(sine)',         // signal
    's("bd").gain(sine.range(0,.5))',
    's("bd").gain(5abc)',         // not a literal
    's("bd").gain()',             // empty
    's("bd").gain( )',            // whitespace only — Number(" ") is 0, not NaN
  ])('%s does not become a numeric Param', (src) => {
    const params = nodes(src, 'Param')
    expect(params.filter((p) => typeof p.value === 'number')).toHaveLength(0)
  })

  // Named non-finite spellings: `Number` accepts these, the IR must not —
  // `value` is serialised as JSON, where Infinity and NaN become null.
  it.each(['Infinity', '-Infinity', 'NaN'])('.gain(%s) is not a numeric Param', (arg) => {
    const params = nodes(`s("bd").gain(${arg})`, 'Param')
    expect(params.filter((p) => typeof p.value === 'number')).toHaveLength(0)
  })
})

describe('all THREE sites of the transcribed token, not just the reported one', () => {
  // The report was `.gain(.8)`. The same regex was transcribed in three places,
  // so fixing only the reported site would have left two identical bugs in the
  // same file — which is exactly what the first pass of this fix did. These
  // pins exist so the class stays closed, not just the instance.

  // SITE 2 — classifyLiteralRhs (`:205`). A binding whose RHS is a literal is
  // substitutable; one that is not bails the WHOLE binding map, so the entire
  // program falls back to bare Code even when the binding is unreferenced.
  // `const beat = .5` hit that.
  it.each(['0.5', '.5', '-.5', '5.', '1e-3', '+.5'])
    ('classifyLiteralRhs accepts the numeric literal %s', (rhs) => {
      expect(classifyLiteralRhs(rhs)).not.toBeNull()
    })

  it.each(['bpm/2', 'foo(2)', '(1+2)/3', '2**3', 'x', ''])
    ('classifyLiteralRhs still refuses %s', (rhs) => {
      expect(classifyLiteralRhs(rhs)).toBeNull()
    })

  // The arithmetic arm now validates OPERANDS through the shared helper rather
  // than embedding a second copy of the number token, so leading decimals work
  // there too — and the grammar stays closed for the same reason as before.
  it.each(['172/4', '.5*2', '-0.5 + 1', '1/8', '2 * .5 * 4'])
    ('classifyLiteralRhs accepts the enumerated arithmetic %s', (rhs) => {
      expect(classifyLiteralRhs(rhs)).not.toBeNull()
    })

  // `raw` is spliced byte-verbatim — a matcher, never an interpreter.
  it('arithmetic is spliced verbatim, never computed', () => {
    expect(classifyLiteralRhs('172/4')?.via.raw).toBe('172/4')
  })

  // SITE 3 — the bare numeric element of a `.pick([...])` list (`:2910`).
  it('a leading-decimal element in a pick list becomes a Play, not a drop', () => {
    const ir = parseStrudel('note("0 1").pick([.5, 1])')
    const plays = walk(ir).filter((n: any) => n.tag === 'Play')
    expect(plays.some((p: any) => String(p.note) === '.5')).toBe(true)
  })
})

describe('the helper is the single answer', () => {
  it.each(['.5', '5.', '+5', '-.5', '1e-3', '0x10', '0', '-0'])
    ('%s is a numeric literal', (t) => expect(isNumericLiteral(t)).toBe(true))

  it.each(['', '   ', '5abc', '1/8', '1 2', 'vol', 'Infinity', 'NaN', '.', '-'])
    ('%s is not', (t) => expect(isNumericLiteral(t)).toBe(false))
})

describe('the quoted forms are unaffected', () => {
  // `parseParamArg` tries number → identifier-string → mini-pattern in order.
  // Widening the number arm must not shadow the two below it.
  it('a quoted identifier is still a string Param', () => {
    expect(nodes('s("bd").s("bd")', 'Param')[0].value).toBe('bd')
  })

  it('a quoted pattern is still a sub-IR Param', () => {
    const [param] = nodes('s("bd").gain("0.3 0.5")', 'Param')
    expect(typeof param.value).toBe('object')
    expect((param.value as any).tag).toBe('Seq')
  })

  // A quoted number stays a STRING-ish mini value, not a JS number — the quotes
  // are the user asking for a pattern, and `Number('"0.5"')` is NaN anyway.
  it('a quoted number is not coerced to a JS number', () => {
    const [param] = nodes('s("bd").gain("0.5")', 'Param')
    expect(typeof param.value).not.toBe('number')
  })
})
