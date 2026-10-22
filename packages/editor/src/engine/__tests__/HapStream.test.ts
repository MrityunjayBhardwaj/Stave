import { describe, it, expect } from 'vitest'
import { HapStream, type HapEvent } from '../HapStream'
import type { IREvent } from '../../codeView/ir/IREvent'

/**
 * Phase 20-06 — HapStream.emit gains optional `lookup` 6th positional param.
 * When supplied + the hap carries a structural loc, `findMatchedEvent`
 * resolves the IR-side match and the matched event's `irNodeId` is populated
 * onto the fan-out HapEvent (PV38 clause 2 — onTrigger half; queryArc half
 * landed in 20-05).
 *
 * Discipline:
 *  - Truthy-only assignment preserves "absent vs present:undefined" (PV37).
 *  - 5-arg back-compat unchanged: 8 useHighlighting test callers + 1 prod
 *    StrudelEngine call site stay as-is when lookup is `undefined`.
 *  - NO fallback ladder (P50) — single-strategy match.
 */
describe('20-06 — HapStream.emit enriches HapEvent with irNodeId via lookup (PV38 clause 2)', () => {
  function makeHap(opts?: {
    locStart?: number
    locEnd?: number
    begin?: number
  }): unknown {
    const locStart = opts?.locStart ?? 5
    const locEnd = opts?.locEnd ?? 10
    const begin = opts?.begin ?? 0.5
    return {
      whole: { begin, end: begin + 0.25 },
      value: { note: 'c4', s: 'piano' },
      context: { locations: [{ start: locStart, end: locEnd }] },
    }
  }

  it('hit case — populates irNodeId when lookup matches', () => {
    const irEvent: IREvent = {
      begin: 0.5, end: 1.0, endClipped: 1.0,
      note: 'c4', freq: null, s: null, gain: 1, velocity: 1, color: null,
      loc: [{ start: 5, end: 10 }],
      irNodeId: 'fnvHit01',
    }
    const lookup = new Map<string, IREvent[]>([['5:10', [irEvent]]])
    const captured: HapEvent[] = []
    const hs = new HapStream()
    hs.on(e => captured.push(e))
    hs.emit(makeHap({ begin: 0.5 }), 0.1, 0.5, 1, 0, lookup)
    expect(captured).toHaveLength(1)
    expect(captured[0].irNodeId).toBe('fnvHit01')
  })

  it('5-arg back-compat — irNodeId absent when no lookup supplied', () => {
    const captured: HapEvent[] = []
    const hs = new HapStream()
    hs.on(e => captured.push(e))
    // Original 5-arg signature; the production StrudelEngine call site
    // and 8 useHighlighting test callers all use this form.
    hs.emit(makeHap(), 0.1, 0.5, 1, 0)
    expect(captured).toHaveLength(1)
    // PV37 — absent (not `present:undefined`). Object-shape-stable.
    expect('irNodeId' in captured[0]).toBe(false)
  })

  it('no-loc case — irNodeId absent when hap has no context.locations (PV37 alignment)', () => {
    const irEvent: IREvent = {
      begin: 0.5, end: 1.0, endClipped: 1.0,
      note: 'c4', freq: null, s: null, gain: 1, velocity: 1, color: null,
      loc: [{ start: 5, end: 10 }],
      irNodeId: 'fnvHit01',
    }
    const lookup = new Map<string, IREvent[]>([['5:10', [irEvent]]])
    const hapNoLoc = { whole: { begin: 0.5, end: 0.75 }, value: { note: 'c4' } }
    const captured: HapEvent[] = []
    const hs = new HapStream()
    hs.on(e => captured.push(e))
    hs.emit(hapNoLoc, 0.1, 0.5, 1, 0, lookup)
    expect(captured).toHaveLength(1)
    expect('irNodeId' in captured[0]).toBe(false)
  })

  it('20-07 (T-α-2) — emit returns the enriched HapEvent (same object as fan-out)', () => {
    // The engine's wrappedOutput hit-check reads `irNodeId` off this
    // return value to avoid re-running findMatchedEvent. Object identity
    // matters: subscribers + caller must see the SAME instance so any
    // mutation discipline lands on a single object.
    const irEvent: IREvent = {
      begin: 0.5, end: 1.0, endClipped: 1.0,
      note: 'c4', freq: null, s: null, gain: 1, velocity: 1, color: null,
      loc: [{ start: 5, end: 10 }],
      irNodeId: 'returnId01',
    }
    const lookup = new Map<string, IREvent[]>([['5:10', [irEvent]]])
    const hs = new HapStream()
    const captured: HapEvent[] = []
    hs.on(e => captured.push(e))
    const result = hs.emit(makeHap({ begin: 0.5 }), 0.1, 0.5, 1, 0, lookup)
    // Return is the same object the subscriber received.
    expect(captured).toHaveLength(1)
    expect(result).toBe(captured[0])
    // Enriched fields are populated on the returned event.
    expect(result.irNodeId).toBe('returnId01')
    expect(result.audioTime).toBe(0.1)
  })

  it('fast(N) shared-id disambig — closest-by-begin picks the right IREvent', () => {
    // Two IR events at the same loc with begins 0.0 and 0.5 (distinct
    // irNodeIds — exercises that the helper returns the matched event,
    // not just an id; row-level disambig at the timeline subscriber
    // happens in Wave β).
    const ev0: IREvent = {
      begin: 0.0, end: 0.5, endClipped: 0.5,
      note: 'c4', freq: null, s: null, gain: 1, velocity: 1, color: null,
      loc: [{ start: 5, end: 10 }], irNodeId: 'idA',
    }
    const ev1: IREvent = {
      begin: 0.5, end: 1.0, endClipped: 1.0,
      note: 'c4', freq: null, s: null, gain: 1, velocity: 1, color: null,
      loc: [{ start: 5, end: 10 }], irNodeId: 'idB',
    }
    const lookup = new Map<string, IREvent[]>([['5:10', [ev0, ev1]]])

    const hs = new HapStream()
    const captured: HapEvent[] = []
    hs.on(e => captured.push(e))
    hs.emit(makeHap({ begin: 0.5 }), 0.1, 0.5, 1, 0, lookup)
    hs.emit(makeHap({ begin: 0.0 }), 0.1, 0.5, 1, 0, lookup)
    expect(captured).toHaveLength(2)
    expect(captured[0].irNodeId).toBe('idB')
    expect(captured[1].irNodeId).toBe('idA')
  })
})

describe('#1621 — HapStream.emit keeps only the spans the transpiler declared', () => {
  // A stray quoted-space span first ([1,7), what `.color('sienna')` gives), then the
  // declared document span ([9,17)).
  const hap = { whole: { begin: 0, end: 1 }, value: { s: 'hh' }, context: { locations: [{ start: 1, end: 7 }, { start: 9, end: 17 }] } }
  const lookup = new Map<string, IREvent[]>([
    ['1:7', [{ begin: 0, end: 1, irNodeId: 'wrong' } as never]],
    ['9:17', [{ begin: 0, end: 1, irNodeId: 'right' } as never]],
  ])

  function emitOne(declared?: ReadonlySet<string>): HapEvent {
    const hs = new HapStream()
    const captured: HapEvent[] = []
    hs.on(e => captured.push(e))
    const returned = hs.emit(hap, 0.1, 0.5, 1, 0, lookup, declared)
    expect(returned).toBe(captured[0])
    return returned
  }

  it('drops the stray span from the event every subscriber paints, and matches the IR node by the declared one', () => {
    // Control: unfiltered, the stray span is painted and is what the match keys on.
    const raw = emitOne()
    expect(raw.loc).toEqual([{ start: 1, end: 7 }, { start: 9, end: 17 }])
    expect(raw.irNodeId).toBe('wrong')

    const filtered = emitOne(new Set(['9:17']))
    expect(filtered.loc).toEqual([{ start: 9, end: 17 }])
    expect(filtered.irNodeId).toBe('right')
  })

  it('an empty declared set leaves nothing to paint and nothing to match', () => {
    const ev = emitOne(new Set())
    expect(ev.loc).toBeNull()
    expect('irNodeId' in ev).toBe(false)
  })
})
