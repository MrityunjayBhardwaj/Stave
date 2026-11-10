/**
 * Exact builds no column model (#2295).
 *
 * The Exact step grid draws and writes from the bar's tree. The column model
 * (`parseStepGrid`, capped at 64 a bar) belongs to the shared-column view only. This mounts
 * the real `SequencerGrid` on a real chunk in each mode and counts the column parser's calls,
 * spied at its own module so every importer (the codec, the router, the length handle) is
 * counted. LCM is the control: the same pattern must reach the parser there.
 */
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

const calls = { n: 0 }
vi.mock('../../../codeView/notation/parse', async (orig) => {
  const real = await orig<typeof import('../../../codeView/notation/parse')>()
  return {
    ...real,
    parseStepGrid: (...a: Parameters<typeof real.parseStepGrid>) => {
      calls.n++
      return real.parseStepGrid(...a)
    },
  }
})

let doc = ''
vi.mock('../useActiveChunk', async () => {
  const { detectChunk } = await import('../../../codeView')
  // one object per document, as the real hook keeps it: a fresh chunk every render would
  // re-run every effect keyed on it, forever
  const kept = new Map<string, unknown>()
  const noop = (): void => undefined
  const at = (d: string): unknown => {
    if (!kept.has(d)) kept.set(d, { chunk: detectChunk(d, d.indexOf('"') + 1), applyEdit: noop, beginGesture: noop, endGesture: noop })
    return kept.get(d)
  }
  return { useActiveChunk: () => at(doc) }
})

import { SequencerGrid } from '../SequencerGrid'
import { setGridMode, type GridMode } from '../gridMode'

beforeAll(() => {
  // jsdom has no layout: the grids measure through these and draw nothing without them
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  })
})
afterEach(() => cleanup())

function mount(mode: GridMode, code: string): { calls: number; root: HTMLElement } {
  doc = code
  act(() => setGridMode(mode))
  calls.n = 0
  // a grid that never settles would hang here (#2527): stop it with a reason instead
  let commits = 0
  const onRender = (): void => {
    if (++commits > 300) throw new Error(`render loop: ${commits} commits`)
  }
  const { container } = render(
    <React.Profiler id="grid" onRender={onRender}>
      <SequencerGrid />
    </React.Profiler>,
  )
  return { calls: calls.n, root: container }
}

describe('Exact builds no column model (#2295)', () => {
  // the third is past the column cap (a step 1/96 of the bar, #2289): Exact draws it all the same
  for (const code of ['$: s("bd ~ sd ~")', '$: s("hh*8, bd ~ sd ~")', '$: s("bd [hh [hh [hh*3 [cp]]]] sd [~ cp]")']) {
    it(`${code}: Exact never asks the column parser; LCM does`, () => {
      const exact = mount('exact', code)
      // CONTROL: the Exact grid really drew the pattern
      expect(exact.root.querySelector('[data-exact-grid]')).not.toBeNull()
      expect(exact.calls).toBe(0)
      cleanup()
      const lcm = mount('lcm', code)
      expect(lcm.calls).toBeGreaterThan(0)
    })
  }
})
