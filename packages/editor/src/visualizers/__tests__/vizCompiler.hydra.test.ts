/**
 * vizCompiler — hydra compile path (issue #32).
 *
 * The hydra compiler wraps user code as
 * `new Function('s', 'stave', code)`. This test verifies the eval
 * scope exposes both `s` (synth) and `stave` (scheduler bag) —
 * necessary for pattern-reactive hydra sketches.
 */

import { describe, it, expect } from 'vitest'
import {
  compileHydraCode,
  getHydraLineOffset,
  HYDRA_LINE_OFFSET,
} from '../hydraCompiler'
import type { HydraStaveBag } from '../renderers/HydraVizRenderer'

/** Minimal `stave` bag for the eval-scope tests — these sketches only read
 *  `stave.scheduler`, so we cast a partial mock rather than build the full
 *  `sig`/`H` surface (covered by HydraVizRenderer.staveBag.test.ts). */
const asBag = (b: { scheduler: unknown; tracks: Map<unknown, unknown> }) =>
  b as unknown as HydraStaveBag

describe('compileHydraCode — stave bag in eval scope', () => {
  it('user code can reference `stave` without ReferenceError', () => {
    const pattern = compileHydraCode(
      'if (stave.scheduler) { globalThis.__saw_scheduler = true }',
    )
    const fakeStave = asBag({
      scheduler: { now: () => 0, query: () => [] },
      tracks: new Map(),
    })
    expect(() => pattern({}, fakeStave)).not.toThrow()
    expect(
      (globalThis as Record<string, unknown>).__saw_scheduler,
    ).toBe(true)
    delete (globalThis as Record<string, unknown>).__saw_scheduler
  })

  it('sketches that ignore `stave` still work (backwards-compat)', () => {
    const pattern = compileHydraCode('globalThis.__saw_synth = typeof s')
    const fakeStave = asBag({ scheduler: null, tracks: new Map() })
    expect(() => pattern({}, fakeStave)).not.toThrow()
    expect((globalThis as Record<string, unknown>).__saw_synth).toBe(
      'object',
    )
    delete (globalThis as Record<string, unknown>).__saw_synth
  })

  it('scheduler.query() is callable from user code', () => {
    const pattern = compileHydraCode(
      'globalThis.__query_result = stave.scheduler.query(0, 1)',
    )
    const events = [
      {
        begin: 0,
        end: 1,
        endClipped: 1,
        note: 60,
        freq: 261.63,
        s: null,
        gain: 1,
        velocity: 1,
        color: null,
      },
    ]
    pattern(
      {},
      asBag({
        scheduler: { now: () => 0, query: () => events },
        tracks: new Map(),
      }),
    )
    expect((globalThis as Record<string, unknown>).__query_result).toEqual(
      events,
    )
    delete (globalThis as Record<string, unknown>).__query_result
  })
})

describe('compileHydraCode — syntax + line offset', () => {
  it('throws SyntaxError synchronously for malformed source', () => {
    // by name: #2220's located error extends Error, since on the page the
    // global SyntaxError is Strudel's parser's
    expect(() => compileHydraCode('osc(')).toThrow(expect.objectContaining({ name: 'SyntaxError' }))
  })

  it('HYDRA_LINE_OFFSET accounts for `new Function` 2-line header', () => {
    // Hydra prepends no body wrapper of its own — the offset is exactly
    // the `function anonymous(s,stave\n) {\n` header V8 adds. Any
    // change to that shape must update this constant together with the
    // compiledVizProvider reportError translation.
    expect(getHydraLineOffset()).toBe(2)
    expect(HYDRA_LINE_OFFSET).toBe(2)
  })
})
