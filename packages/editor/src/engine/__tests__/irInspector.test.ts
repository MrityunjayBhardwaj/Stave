import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  publishIRSnapshot,
  clearIRSnapshot,
  getIRSnapshot,
  subscribeIRSnapshot,
  type IRSnapshot,
  type IRSnapshotInput,
} from '../irInspector'
import { IR } from '../../codeView/ir/PatternIR'
import type { IREvent } from '../../codeView/ir/IREvent'

const sample = (): IRSnapshotInput => {
  const ir = IR.play('c4')
  return {
    ts: 1000,
    source: 'pattern.strudel',
    runtime: 'strudel',
    code: 'note("c4")',
    passes: [{ name: 'Parsed', ir }],
    ir, // alias of passes[last].ir per contract
    events: [],
  }
}

describe('irInspector store', () => {
  beforeEach(() => {
    clearIRSnapshot()
  })

  it('starts empty', () => {
    expect(getIRSnapshot()).toBeNull()
  })

  it('publish replaces the current snapshot', () => {
    publishIRSnapshot(sample())
    const s = getIRSnapshot()
    expect(s?.code).toBe('note("c4")')
    expect(s?.runtime).toBe('strudel')
  })

  it('subscribers fire on every publish', () => {
    const fn = vi.fn()
    subscribeIRSnapshot(fn)
    publishIRSnapshot(sample())
    publishIRSnapshot({ ...sample(), code: 'note("d4")' })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('clear notifies with null', () => {
    const fn = vi.fn()
    subscribeIRSnapshot(fn)
    publishIRSnapshot(sample())
    clearIRSnapshot()
    expect(fn).toHaveBeenLastCalledWith(null)
  })

  it('unsubscribe stops notifications', () => {
    const fn = vi.fn()
    const off = subscribeIRSnapshot(fn)
    off()
    publishIRSnapshot(sample())
    expect(fn).not.toHaveBeenCalled()
  })

  it('listener errors do not block other listeners', () => {
    const a = vi.fn(() => { throw new Error('boom') })
    const b = vi.fn()
    subscribeIRSnapshot(a)
    subscribeIRSnapshot(b)
    publishIRSnapshot(sample())
    expect(b).toHaveBeenCalledOnce()
  })

  // -------------------------------------------------------------------
  // passes[] schema (Phase 19-02)
  // -------------------------------------------------------------------

  it('round-trip preserves passes[]', () => {
    const snap = sample()
    publishIRSnapshot(snap)
    const got = getIRSnapshot()
    expect(got).not.toBeNull()
    expect(got!.passes).toHaveLength(1)
    expect(got!.passes[0].name).toBe('Parsed')
    expect(got!.passes[0].ir).toBe(snap.ir)
  })

  it('subscriber receives the new passes[] field', () => {
    const fn = vi.fn()
    subscribeIRSnapshot(fn)
    const snap = sample()
    publishIRSnapshot(snap)
    const received = fn.mock.calls[0][0] as IRSnapshot
    expect(received.passes).toEqual(snap.passes)
    expect(received.passes[0].name).toBe('Parsed')
  })

  it('ir alias matches passes[last] for single-pass snapshots', () => {
    const snap = sample()
    publishIRSnapshot(snap)
    const got = getIRSnapshot()!
    expect(got.ir).toBe(got.passes[got.passes.length - 1].ir)
  })

  it('multi-pass: ir alias matches passes[last]', () => {
    const irA = IR.play('c4')
    const irB = IR.play('d4')
    const snap: IRSnapshotInput = {
      ts: 1,
      source: 'pattern.strudel',
      runtime: 'strudel',
      code: 'note("c4 d4")',
      passes: [
        { name: 'A', ir: irA },
        { name: 'B', ir: irB },
      ],
      ir: irB, // alias of last
      events: [],
    }
    publishIRSnapshot(snap)
    const got = getIRSnapshot()!
    expect(got.passes).toHaveLength(2)
    expect(got.ir).toBe(got.passes[1].ir)
    expect(got.ir).toBe(irB)
  })

  it('schema sanity: a snapshot literal without passes fails tsc (compile-time check)', () => {
    // @ts-expect-error — `passes` is required on IRSnapshot.
    const bad: IRSnapshot = {
      ts: 0,
      runtime: 'strudel',
      code: '',
      ir: IR.play('c4'),
      events: [],
    }
    // Reference `bad` to silence noUnusedLocals while keeping the
    // ts-expect-error directive load-bearing (the literal above is the
    // sole reason this assignment is type-checked).
    expect(bad).toBeDefined()
  })

  it('publishIRSnapshot enriches with frozen lookup tables (PV38 clause 1 / PV33)', () => {
    publishIRSnapshot(sample())
    const got = getIRSnapshot()
    expect(got).not.toBeNull()
    expect(got!.irNodeIdLookup).toBeInstanceOf(Map)
    expect(got!.irNodeLocLookup).toBeInstanceOf(Map)
    expect(got!.irNodeIdsByLine).toBeInstanceOf(Map)
  })

  // -------------------------------------------------------------------
  // 20-07 — irNodeIdsByLine substrate (PV38 clause 1; pre-substrate for
  // BreakpointStore gutter-click resolver). Tests validate the publish-
  // time line index built by enrichWithLookups: every event with both
  // irNodeId and loc[0] contributes its id to the bucket keyed by the
  // 1-based Monaco line number derived from snap.code.
  // -------------------------------------------------------------------

  describe('20-07 — irNodeIdsByLine substrate (PV38)', () => {
    const stubIR = IR.play('c4')
    const makeEvent = (id: string | undefined, start: number, end: number): IREvent => ({
      irNodeId: id,
      trackId: 't',
      s: 'bd',
      begin: 0,
      end: 1,
      endClipped: 1,
      loc: [{ start, end }],
      note: null,
      freq: null,
      gain: 1,
      velocity: 1,
      color: null,
    })

    it('groups irNodeIds by 1-based Monaco line number', () => {
      const code = 'line1\nline2\nline3 with bd here'
      // Newlines at offsets 5 and 11 → offsets 0..4 → line 1, 6..10 →
      // line 2, 12+ → line 3. Pick a start on line 1 (offset 0) and
      // line 3 (offset 18).
      publishIRSnapshot({
        ts: 1,
        runtime: 'strudel',
        code,
        passes: [{ name: 'final', ir: stubIR }],
        ir: stubIR,
        events: [
          makeEvent('id-line1', 0, 5),
          makeEvent('id-line3', 18, 20),
        ],
      })
      const snap = getIRSnapshot()!
      expect(snap.irNodeIdsByLine.get(1)).toEqual(['id-line1'])
      expect(snap.irNodeIdsByLine.get(3)).toEqual(['id-line3'])
      expect(snap.irNodeIdsByLine.get(2)).toBeUndefined()
    })

    it('groups multiple ids on the same line into a single bucket', () => {
      const code = 's("bd hh sd")'
      publishIRSnapshot({
        ts: 1,
        runtime: 'strudel',
        code,
        passes: [{ name: 'final', ir: stubIR }],
        ir: stubIR,
        events: [
          makeEvent('id-bd', 3, 5),
          makeEvent('id-hh', 6, 8),
          makeEvent('id-sd', 9, 11),
        ],
      })
      const snap = getIRSnapshot()!
      expect(snap.irNodeIdsByLine.get(1)).toEqual(['id-bd', 'id-hh', 'id-sd'])
    })

    it('omits events without irNodeId (PV37 alignment)', () => {
      const code = 's("bd")'
      publishIRSnapshot({
        ts: 1,
        runtime: 'strudel',
        code,
        passes: [{ name: 'final', ir: stubIR }],
        ir: stubIR,
        events: [makeEvent(undefined, 3, 5)],
      })
      const snap = getIRSnapshot()!
      expect(snap.irNodeIdsByLine.size).toBe(0)
    })

    it('returns empty Map when snap has no events', () => {
      publishIRSnapshot({ ...sample(), events: [] })
      const snap = getIRSnapshot()!
      expect(snap.irNodeIdsByLine.size).toBe(0)
    })
  })
})
