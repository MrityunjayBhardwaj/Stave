import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  emitLog,
  subscribeLog,
  getLogHistory,
  clearLog,
  emitFixed,
  subscribeFixed,
  getFixedMarkers,
  makeFixedKey,
  __resetEngineLogForTests,
  type LogEntry,
  type FixedMarker,
} from '../engineLog'

beforeEach(() => {
  __resetEngineLogForTests()
})

describe('emitLog', () => {
  it('returns a LogEntry with generated id + ts', () => {
    const e = emitLog({
      level: 'error',
      runtime: 'strudel',
      message: 'boom',
    })
    expect(e.id).toMatch(/^log-/)
    expect(e.ts).toBeGreaterThan(0)
    expect(e.message).toBe('boom')
  })

  it('appends to history in chronological order', () => {
    emitLog({ level: 'info', runtime: 'p5', message: 'one' })
    emitLog({ level: 'info', runtime: 'p5', message: 'two' })
    const h = getLogHistory()
    expect(h.map((e) => e.message)).toEqual(['one', 'two'])
  })

  it('generates unique ids across rapid emits', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 50; i++) {
      ids.add(emitLog({ level: 'info', runtime: 'stave', message: String(i) }).id)
    }
    expect(ids.size).toBe(50)
  })

  it('bounds history at the cap', () => {
    for (let i = 0; i < 600; i++) {
      emitLog({ level: 'info', runtime: 'p5', message: `m${i}` })
    }
    const h = getLogHistory()
    expect(h.length).toBe(500)
    // Newest retained, oldest dropped
    expect(h[h.length - 1].message).toBe('m599')
    expect(h[0].message).toBe('m100')
  })

  it('drops info rows first, so a busy `.log()` keeps the errors and warnings beside it (#2205)', () => {
    emitLog({ level: 'error', runtime: 'strudel', message: 'the error' })
    emitLog({ level: 'warn', runtime: 'strudel', message: 'the warning' })
    for (let i = 0; i < 600; i++) {
      emitLog({ level: 'info', runtime: 'strudel', message: `[hap] ${i}` })
    }
    const h = getLogHistory()
    expect(h.length).toBe(500)
    expect(h.slice(0, 2).map((e) => e.message)).toEqual(['the error', 'the warning'])
    // the newest info rows are the ones kept
    expect(h[2].message).toBe('[hap] 102')
    expect(h[h.length - 1].message).toBe('[hap] 599')
  })

  it('with no info rows left, the oldest of any level goes', () => {
    for (let i = 0; i < 501; i++) {
      emitLog({ level: i % 2 ? 'warn' : 'error', runtime: 'strudel', message: `w${i}` })
    }
    const h = getLogHistory()
    expect(h.length).toBe(500)
    expect(h[0].message).toBe('w1')
    // an evicted row's key is free again: the same message comes back as a new row
    emitLog({ level: 'error', runtime: 'strudel', message: 'w0' })
    expect(getLogHistory().at(-1)?.message).toBe('w0')
    expect(getLogHistory().at(-1)?.count).toBe(1)
  })

  it('dedupes consecutive identical entries (p5 FES flood defense)', () => {
    const shape = {
      level: 'warn' as const,
      runtime: 'p5' as const,
      source: 'sketch.p5',
      line: 4,
      message: 'fill() expects 3 args',
    }
    const first = emitLog(shape)
    emitLog(shape)
    emitLog(shape)
    const h = getLogHistory()
    expect(h).toHaveLength(1)
    // Same id — consumers can treat the emit as a repeat.
    expect(h[0].id).toBe(first.id)
    expect(h[0].message).toBe('fill() expects 3 args')
    expect(h[0].count).toBe(3)
  })

  it('treats a different line as a distinct entry', () => {
    const base = {
      level: 'warn' as const,
      runtime: 'p5' as const,
      source: 'sketch.p5',
      message: 'oops',
    }
    emitLog({ ...base, line: 4 })
    emitLog({ ...base, line: 7 })
    expect(getLogHistory()).toHaveLength(2)
  })

  // #563 — a repeating GROUP of distinct messages (soundfont flood cycling
  // c7,d7,e7,… each beat) defeats a compare-to-last dedup. Coalesce by key so
  // identical-but-NON-consecutive entries collapse into one counted row.
  it('coalesces identical NON-consecutive entries, keeping position + bumping count', () => {
    const a = { level: 'error' as const, runtime: 'strudel' as const, message: 'A' }
    const b = { level: 'error' as const, runtime: 'strudel' as const, message: 'B' }
    emitLog(a)
    emitLog(b)
    emitLog(a) // not consecutive with the first A — still merges
    const h = getLogHistory()
    expect(h.map((e) => e.message)).toEqual(['A', 'B']) // 2 rows, A keeps its slot
    expect(h[0].count).toBe(2)
    expect(h[1].count).toBe(1)
  })

  it('fresh entry starts at count 1', () => {
    expect(emitLog({ level: 'info', runtime: 'p5', message: 'hello' }).count).toBe(1)
  })

  it('clearLog resets the coalescing index (a repeat after clear is a fresh row)', () => {
    const shape = { level: 'error' as const, runtime: 'strudel' as const, message: 'boom' }
    emitLog(shape)
    emitLog(shape)
    expect(getLogHistory()[0].count).toBe(2)
    clearLog()
    const fresh = emitLog(shape)
    expect(fresh.count).toBe(1)
    expect(getLogHistory()).toHaveLength(1)
  })
})

// Listener notifications are deferred to a microtask to prevent
// mid-commit React setState chains. `flush` yields the microtask queue.
const flush = () => new Promise<void>((r) => queueMicrotask(r))

describe('subscribeLog', () => {
  it('fires the listener with the emitted entry', async () => {
    const listener = vi.fn()
    subscribeLog(listener)
    const e = emitLog({ level: 'warn', runtime: 'hydra', message: 'hi' })
    await flush()
    expect(listener).toHaveBeenCalledOnce()
    const [entry, history] = listener.mock.calls[0] as [
      LogEntry,
      readonly LogEntry[],
    ]
    expect(entry).toEqual(e)
    expect(history.map((h) => h.message)).toEqual(['hi'])
  })

  it('unsubscribes cleanly', async () => {
    const listener = vi.fn()
    const off = subscribeLog(listener)
    off()
    emitLog({ level: 'info', runtime: 'stave', message: 'x' })
    await flush()
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not replay history to new subscribers', async () => {
    emitLog({ level: 'info', runtime: 'p5', message: 'pre' })
    await flush()
    const listener = vi.fn()
    subscribeLog(listener)
    expect(listener).not.toHaveBeenCalled()
    emitLog({ level: 'info', runtime: 'p5', message: 'post' })
    await flush()
    expect(listener).toHaveBeenCalledOnce()
  })

  it('a thrown listener does not stop other listeners', async () => {
    const ok = vi.fn()
    subscribeLog(() => {
      throw new Error('rude')
    })
    subscribeLog(ok)
    emitLog({ level: 'info', runtime: 'stave', message: 'x' })
    await flush()
    expect(ok).toHaveBeenCalledOnce()
  })
})

describe('clearLog', () => {
  it('empties history and notifies with null', async () => {
    emitLog({ level: 'info', runtime: 'p5', message: 'a' })
    await flush()
    const listener = vi.fn()
    subscribeLog(listener)
    clearLog()
    expect(getLogHistory()).toEqual([])
    const [entry, history] = listener.mock.calls[0] as [
      LogEntry | null,
      readonly LogEntry[],
    ]
    expect(entry).toBeNull()
    expect(history).toEqual([])
  })
})

describe('emitFixed / subscribeFixed', () => {
  const flush = (): Promise<void> =>
    new Promise<void>((resolve) => queueMicrotask(() => resolve()))

  it('records a marker keyed by (runtime, source)', () => {
    emitFixed({ runtime: 'strudel', source: 'patterns/beat.strudel' })
    const m = getFixedMarkers()
    expect(m.get(makeFixedKey('strudel', 'patterns/beat.strudel'))).toBeGreaterThan(0)
  })

  it('notifies subscribers with the marker + full table', async () => {
    const spy = vi.fn()
    subscribeFixed(spy)
    emitFixed({ runtime: 'sonicpi', source: 'x.rb' })
    await flush()
    const [marker, markers] = spy.mock.calls[0] as [
      FixedMarker,
      ReadonlyMap<string, number>,
    ]
    expect(marker.runtime).toBe('sonicpi')
    expect(marker.source).toBe('x.rb')
    expect(markers.get(makeFixedKey('sonicpi', 'x.rb'))).toBe(marker.ts)
  })

  it('supports a runtime-wide marker when source is omitted', () => {
    emitFixed({ runtime: 'hydra' })
    const m = getFixedMarkers()
    expect(m.has(makeFixedKey('hydra', undefined))).toBe(true)
  })

  it('later emits overwrite the earlier marker for the same key', () => {
    const first = emitFixed({ runtime: 'p5', source: 'a.p5' })
    // Ensure a measurable gap so timestamps can differ.
    const second = emitFixed({ runtime: 'p5', source: 'a.p5' })
    expect(second.ts).toBeGreaterThanOrEqual(first.ts)
    const m = getFixedMarkers()
    expect(m.get(makeFixedKey('p5', 'a.p5'))).toBe(second.ts)
  })

  it('clearLog wipes fixed markers', () => {
    emitFixed({ runtime: 'strudel', source: 's' })
    clearLog()
    expect(getFixedMarkers().size).toBe(0)
  })

  it('a broken fixed-listener does not kill the emitter', async () => {
    subscribeFixed(() => {
      throw new Error('boom')
    })
    const ok = vi.fn()
    subscribeFixed(ok)
    expect(() => emitFixed({ runtime: 'stave' })).not.toThrow()
    await flush()
    expect(ok).toHaveBeenCalledOnce()
  })
})

describe('suggestion metadata round-trips', () => {
  it('keeps suggestion + stack on the emitted entry', () => {
    const e = emitLog({
      level: 'error',
      runtime: 'p5',
      message: '`stave` is not defined.',
      suggestion: {
        name: 'save',
        docsUrl: '/docs/reference/p5/#save',
        example: 'save("out.png")',
      },
      stack: 'at evalSketch (sketch.js:5)',
      line: 5,
      source: 'Piano Roll.p5',
    })
    expect(e.suggestion?.name).toBe('save')
    expect(e.stack).toContain('evalSketch')
    expect(e.line).toBe(5)
  })
})
