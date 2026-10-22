import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  captureSnapshot,
  getCaptureBuffer,
  subscribeCapture,
  clearCapture,
  getCaptureCapacity,
  setCaptureCapacity,
  __resetCaptureForTest,
} from '../timelineCapture'
import type { IRSnapshot } from '../irInspector'
import { IR } from '../../codeView/ir/PatternIR'

// Mirror irInspector.test.ts:11-22 sample shape; freshen each call so
// Object.freeze in captureSnapshot doesn't poison cross-test references.
// Phase 20-05: IRSnapshot grew two ReadonlyMap lookup fields (PV38 clause 1)
// — empty Maps are fine here since captureSnapshot is called directly,
// bypassing the publisher's enrichWithLookups.
// Phase 20-07 wave α0: third lookup `irNodeIdsByLine` added — same
// bypass rationale, empty Map is the natural fixture.
function sample(label: string = 'a'): IRSnapshot {
  const ir = IR.play('c4')
  return {
    ts: 1000,
    source: label,
    runtime: 'strudel',
    code: 'note("c4")',
    passes: [{ name: 'Parsed', ir }],
    ir, // alias of passes[last].ir per IRSnapshot contract
    events: [],
    irNodeIdLookup: new Map(),
    irNodeLocLookup: new Map(),
    irNodeIdsByLine: new Map(),
  }
}

describe('timelineCapture', () => {
  beforeEach(() => {
    __resetCaptureForTest()
  })

  it('starts empty', () => {
    expect(getCaptureBuffer()).toHaveLength(0)
  })

  it('default capacity is 30', () => {
    expect(getCaptureCapacity()).toBe(30)
  })

  it('push grows the buffer by one', () => {
    captureSnapshot(sample('a'))
    expect(getCaptureBuffer()).toHaveLength(1)
    expect(getCaptureBuffer()[0].snapshot.source).toBe('a')
  })

  it('FIFO eviction drops oldest when capacity is exceeded', () => {
    setCaptureCapacity(3)
    captureSnapshot(sample('a'))
    captureSnapshot(sample('b'))
    captureSnapshot(sample('c'))
    captureSnapshot(sample('d'))
    expect(getCaptureBuffer()).toHaveLength(3)
    expect(getCaptureBuffer()[0].snapshot.source).toBe('b')
    expect(getCaptureBuffer()[2].snapshot.source).toBe('d')
  })

  it('subscribers fire on push; unsubscribe stops them', () => {
    const fn = vi.fn()
    const off = subscribeCapture(fn)
    captureSnapshot(sample('a'))
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    captureSnapshot(sample('b'))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('listener errors do not block other listeners', () => {
    const a = vi.fn(() => {
      throw new Error('boom')
    })
    const b = vi.fn()
    subscribeCapture(a)
    subscribeCapture(b)
    captureSnapshot(sample('a'))
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('setCaptureCapacity clamps existing entries from oldest', () => {
    captureSnapshot(sample('a'))
    captureSnapshot(sample('b'))
    captureSnapshot(sample('c'))
    setCaptureCapacity(1)
    expect(getCaptureBuffer()).toHaveLength(1)
    expect(getCaptureBuffer()[0].snapshot.source).toBe('c')
  })

  it('setCaptureCapacity ignores non-finite or sub-1 values', () => {
    setCaptureCapacity(5)
    captureSnapshot(sample('a'))
    setCaptureCapacity(NaN)
    expect(getCaptureCapacity()).toBe(5)
    setCaptureCapacity(0)
    expect(getCaptureCapacity()).toBe(5)
    setCaptureCapacity(-3)
    expect(getCaptureCapacity()).toBe(5)
  })

  it('clearCapture empties + fires subscribers', () => {
    const fn = vi.fn()
    subscribeCapture(fn)
    captureSnapshot(sample('a'))
    fn.mockClear()
    clearCapture()
    expect(getCaptureBuffer()).toHaveLength(0)
    expect(fn).toHaveBeenCalled()
  })

  it('Object.freeze defensive guard — captured snapshot.passes is non-mutable', () => {
    captureSnapshot(sample('a'))
    const entry = getCaptureBuffer()[0]
    // Strict mode (vitest default) throws on frozen array mutation.
    expect(() => {
      // Cast to bypass readonly tuple typing; the runtime check is the load-bearing one.
      ;(entry.snapshot.passes as unknown as { push: (x: unknown) => void }).push({
        name: 'X',
        ir: {} as never,
      })
    }).toThrow()
  })

  it('Object.freeze defensive guard — captured snapshot top-level is non-mutable', () => {
    captureSnapshot(sample('a'))
    const entry = getCaptureBuffer()[0]
    expect(() => {
      ;(entry.snapshot as unknown as { code: string }).code = 'mutated'
    }).toThrow()
  })

  it('pin-by-reference invariant — held reference survives FIFO eviction', () => {
    setCaptureCapacity(2)
    const s = sample('a')
    captureSnapshot(s)
    const heldRef = getCaptureBuffer()[0].snapshot
    captureSnapshot(sample('b'))
    captureSnapshot(sample('c')) // evicts 'a' from the buffer
    expect(getCaptureBuffer()).toHaveLength(2)
    expect(getCaptureBuffer()[0].snapshot.source).toBe('b')
    // The held reference is still valid — React state would still render it
    // even though the buffer no longer contains it. Trap #5 mitigation.
    expect(heldRef.source).toBe('a')
    expect(Array.isArray(heldRef.passes)).toBe(true)
  })

  it('cycleCount is recorded on the entry when meta provided', () => {
    captureSnapshot(sample('a'), { cycleCount: 1.5 })
    expect(getCaptureBuffer()[0].cycleCount).toBe(1.5)
  })

  it('cycleCount defaults to null when meta omitted', () => {
    captureSnapshot(sample('a'))
    expect(getCaptureBuffer()[0].cycleCount).toBeNull()
  })

  it('entry.ts defaults to snap.ts when meta.ts omitted', () => {
    const s = sample('a') // ts: 1000
    captureSnapshot(s)
    expect(getCaptureBuffer()[0].ts).toBe(1000)
  })

  it('entry.ts honors meta.ts override when provided', () => {
    captureSnapshot(sample('a'), { ts: 9999 })
    expect(getCaptureBuffer()[0].ts).toBe(9999)
  })

  it('snapshot stored by reference (not cloned)', () => {
    const s = sample('a')
    captureSnapshot(s)
    expect(getCaptureBuffer()[0].snapshot).toBe(s)
  })
})
