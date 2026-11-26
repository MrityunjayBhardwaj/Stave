/**
 * #1534 — a binding declared AFTER the first expression takes a timeline row.
 *
 * Written BEFORE the filter, deliberately. The issue's own warning is that the
 * naive filter regresses: drop the trailing binding from
 * `let a = 1 / s("bd") / let b = 2` and the tail falls to ONE statement, misses
 * the `> 1` fence, and lands on the whole-body parse — which for a multi-
 * statement body is wholly opaque. Strictly worse than the extra row.
 *
 * So this file records, in order:
 *   A. what the shape does TODAY (the wart, asserted not described)
 *   B. that the fallback the naive filter would fall into IS opaque
 *      — observed through `parseExpression`, not inferred from reading
 *   C. the arms the fix must satisfy, monolithic AND staged
 */

import { describe, it, expect } from 'vitest'
import {
  parseStrudel,
  parseExpression,
  collectTopLevelBindings,
  BINDING_RE,
} from '../parseStrudel'
import { pipeline, stripStageMeta } from './helpers/stagesParity'
import type { PatternIR } from '../PatternIR'

const THREE = 'let a = s("bd*4")\na.fast(2)\nlet b = 2\ns("hh*8")'
const TWO = 'let a = 1\ns("bd*4")\nlet b = 2'

function rowsOf(ir: PatternIR): string[] {
  const node = ir as unknown as { tag: string; tracks?: unknown[]; body?: unknown; loc?: { start: number; end: number }[] }
  if (node.tag === 'Stack') {
    return (node.tracks as { loc?: { start: number; end: number }[] }[]).map((t) =>
      t.loc && t.loc[0] ? `${t.loc[0].start}..${t.loc[0].end}` : 'no-loc',
    )
  }
  return [node.tag]
}

/** Text of each top-level row, sliced back out of the source by its loc. */
function rowTexts(ir: PatternIR, src: string): string[] {
  const node = ir as unknown as { tag: string; tracks?: { loc?: { start: number; end: number }[] }[] }
  if (node.tag !== 'Stack') return []
  return (node.tracks ?? []).map((t) =>
    t.loc && t.loc[0] ? src.slice(t.loc[0].start, t.loc[0].end) : '',
  )
}

function isBareCode(ir: unknown): boolean {
  const n = ir as { tag?: string; via?: unknown }
  return n?.tag === 'Code' && n.via === undefined
}

describe('#1534 A — what the shape did BEFORE the fix', () => {
  // Both arms below were GREEN on 341c6a40 with exactly these expectations,
  // which is the record that the wart was real and that this change is what
  // moved it. They are inverted here rather than deleted: the pre-fix values
  // are the break-test's prediction.
  it('THREE gave three rows, the middle one the `let`', () => {
    const texts = rowTexts(parseStrudel(THREE), THREE)
    console.log('THREE rows:', JSON.stringify(texts))
    expect(texts).not.toEqual(['a.fast(2)', 'let b = 2', 's("hh*8")'])
  })

  it('TWO gave two rows, one of which was the binding', () => {
    const texts = rowTexts(parseStrudel(TWO), TWO)
    console.log('TWO rows:', JSON.stringify(texts))
    expect(texts).not.toEqual(['s("bd*4")', 'let b = 2'])
  })

  it('the tail the engine returns is what puts it there', () => {
    const got = collectTopLevelBindings(TWO, 0)
    expect(got).not.toBeNull()
    const tail = got!.tail.map((s) => s.text)
    console.log('TWO tail:', JSON.stringify(tail))
    expect(tail).toEqual(['s("bd*4")', 'let b = 2'])
    expect(tail.filter((t) => BINDING_RE.test(t))).toHaveLength(1)
  })
})

describe('#1534 B — the fallback a naive filter falls into', () => {
  it('the whole-body parse of a multi-statement body is wholly opaque', () => {
    // This is the exact call the `trackStmts.length > 1` fence falls through
    // to. Observed, not read: if it were structured, the naive filter would be
    // harmless and this issue would not need a new single-Track arm.
    const inner = parseExpression(TWO.trim(), 0, undefined, undefined)
    console.log('fallback tag:', (inner as { tag: string }).tag, 'bare:', isBareCode(inner))
    expect(isBareCode(inner)).toBe(true)
  })

  it('and a real document that reaches that fallback confirms it end to end', () => {
    // Duplicate name → the engine declines → trackStmts = [] → whole-body parse.
    const dup = 'let a = 1\nlet a = 2\ns("bd*4")'
    const ir = parseStrudel(dup)
    console.log('dup shape:', JSON.stringify(rowsOf(ir)))
    expect(collectTopLevelBindings(dup, 0)).toBeNull()
    expect(isBareCode((ir as unknown as { body: unknown }).body)).toBe(true)
  })
})

describe('#1534 C — what the fix must do', () => {
  it('THREE gives TWO rows and neither is a declaration', () => {
    const texts = rowTexts(parseStrudel(THREE), THREE)
    expect(texts).toEqual(['a.fast(2)', 's("hh*8")'])
    expect(texts.some((t) => BINDING_RE.test(t))).toBe(false)
  })

  it('⚠ REGRESSION ARM — TWO gives ONE PLAYING row, not an opaque document', () => {
    const ir = parseStrudel(TWO)
    const node = ir as unknown as { tag: string; trackId?: string; body?: unknown }
    console.log('TWO after fix:', node.tag, 'bare body:', isBareCode(node.body))
    expect(node.tag).toBe('Track')
    // The point of the arm: the surviving row PLAYS. An opaque body here is
    // the regression, and it is what a filter without a single-expression arm
    // produces.
    expect(isBareCode(node.body)).toBe(false)
  })

  it('⚠ and the identity that states the whole claim: the trailing declaration changes NOTHING', () => {
    // Same document minus the `let b = 2`. The surviving expression sits at the
    // same offset, resolves through the same map, and must therefore give
    // byte-identical IR — a declaration is not a part, so writing one must not
    // change the shape of the answer.
    const WITHOUT = 'let a = 1\ns("bd*4")'
    expect(JSON.stringify(parseStrudel(TWO))).toBe(JSON.stringify(parseStrudel(WITHOUT)))
  })

  it('a tail that was ALREADY one statement is untouched (the P67 fall-through)', () => {
    // `let a = 1 / weird()`: buildBindingMap succeeds, the expression still
    // parses opaque, and the whole-document fallback is where that shape has
    // always been pinned. The new arm is fenced on `trackStmts.length > 1`
    // precisely so it does not widen this.
    const src = 'let a = 1\n?!nonsense?!'
    const node = parseStrudel(src) as unknown as { tag: string; body?: { code?: string } }
    console.log('P67 shape:', node.tag, JSON.stringify(node.body?.code))
    expect(node.body?.code).toBe(src)
  })

  it('the binding still RESOLVES in the rows that survive', () => {
    // `a` is declared above and used in row 1; dropping the declaration row
    // must not drop the declaration.
    const ir = parseStrudel(THREE)
    const first = (ir as unknown as { tracks: { body: unknown }[] }).tracks[0]
    expect(isBareCode((first as { body: unknown }).body)).toBe(false)
  })

  it('STAGED agrees with MONOLITHIC on both shapes', () => {
    for (const src of [THREE, TWO]) {
      const mono = stripStageMeta(parseStrudel(src))
      const staged = stripStageMeta(pipeline(src))
      expect(JSON.stringify(staged)).toBe(JSON.stringify(mono))
    }
  })
})
