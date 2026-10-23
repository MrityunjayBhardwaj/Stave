/**
 * #2201 — Strudel's own messages in Stave's Console: what each one shows as,
 * and whose file it is.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetEngineLogForTests, getLogHistory } from '../engineLog'
import {
  __withQueryForTests,
  registerStrudelLogOwner,
  routeStrudelLog,
  strudelLogRow,
  type LogClaim,
  type StrudelLogOwner,
  type StrudelLogRow,
} from '../strudelLogBridge'

describe('strudelLogRow', () => {
  it('keeps the level Strudel gives a message', () => {
    expect(strudelLogRow({ message: '[sampler] could not load "bdd:0"', type: 'error' })).toEqual({
      level: 'error', message: '[sampler] could not load "bdd:0"', raisedAsError: false,
    })
    expect(strudelLogRow({ message: '"x" is not a number, falling back to 0', type: 'warning' })?.level).toBe('warn')
    expect(strudelLogRow({ message: '[sampler] loading sound "bd:0" took too long', type: 'highlight' })?.level).toBe('warn')
    expect(strudelLogRow({ message: '[tonal] transpose: not a note "foo"', type: 'warning' })?.level).toBe('warn')
    // `.log()` output, and anything else Strudel doesn't type
    expect(strudelLogRow({ message: '[hap] 0/1 → 1/2: s:bd', data: { hap: {} } })?.level).toBe('info')
    expect(strudelLogRow({ message: '[voicing]: unknown chord "Xyz"' })?.level).toBe('info')
  })

  it("marks what Strudel's errorLogger wrote, which is an error whatever its type", () => {
    expect(strudelLogRow({ message: '[getTrigger] error: boom' })).toEqual({
      level: 'error', message: '[getTrigger] error: boom', raisedAsError: true,
    })
  })

  it('leaves out what Stave already shows another way', () => {
    for (const message of [
      '[eval] code updated',
      '[eval] error: Unexpected token',
      '[cyclist] start',
      '[cyclist] stop',
      '[cyclist] pause',
      '🌀 @strudel/core loaded 🌀',
      '[superdough] ready',
      '[superdough] AudioWorklets loaded',
      '[superdough]: AudioWorklets disabled with disableWorklets',
      '[webaudio] preloading',
      '[webaudio] start rendering',
      "[superdough] Deprecation warning: it seems your code path is setting 'node.onended = callback' instead of using the onceEnded helper",
    ]) {
      expect(strudelLogRow({ message }), message).toBeNull()
    }
    // the first half of a load; the "done" half is kept
    expect(strudelLogRow({ message: '[sampler] load sound "bd:0:0"..', type: 'load-sample' })).toBeNull()
    expect(strudelLogRow({ message: '[wavetable] load table x..', type: 'load-table' })).toBeNull()
    expect(strudelLogRow({ message: '[sampler] load sound "bd:0:0"... done! loaded 79 KiB in 197ms', type: 'loaded-sample' })?.level).toBe('info')
  })

  it('keeps near neighbours of what it leaves out', () => {
    expect(strudelLogRow({ message: '[cyclist] error: boom' })?.level).toBe('error')
    expect(strudelLogRow({ message: '[superdough] failed to set audio interface', type: 'warning' })?.level).toBe('warn')
    expect(strudelLogRow({ message: 'eval code updated' })?.level).toBe('info')
  })

  it('ignores an entry with no message', () => {
    expect(strudelLogRow(null)).toBeNull()
    expect(strudelLogRow({ type: 'error' })).toBeNull()
    expect(strudelLogRow({ message: '' })).toBeNull()
  })
})

describe('routeStrudelLog', () => {
  const taken: Array<{ who: string; row: StrudelLogRow; claim: LogClaim }> = []
  const owner = (who: string, claim: () => LogClaim | null): StrudelLogOwner => ({
    claimLog: claim,
    takeLog: (row, c) => { taken.push({ who, row, claim: c }) },
  })
  let unregister: Array<() => void> = []

  beforeEach(() => {
    taken.length = 0
    __resetEngineLogForTests()
  })
  afterEach(() => {
    for (const u of unregister) u()
    unregister = []
  })

  it("gives a message to the engine that claims it, and doesn't write it itself", () => {
    unregister.push(registerStrudelLogOwner(owner('a', () => null), 'strudel.log.test', null))
    unregister.push(registerStrudelLogOwner(owner('b', () => 'play'), 'strudel.log.test', null))
    routeStrudelLog({ message: '[hap] 0/1: s:bd' })
    expect(taken.map((t) => [t.who, t.claim])).toEqual([['b', 'play']])
    expect(getLogHistory()).toEqual([])
  })

  it("prefers a query or an output step over another file's evaluate", () => {
    // file A is mid-evaluate (it spans awaits) while file B's scheduler ticks
    unregister.push(registerStrudelLogOwner(owner('a', () => 'evaluate'), 'strudel.log.test', null))
    unregister.push(registerStrudelLogOwner(owner('b', () => 'query'), 'strudel.log.test', null))
    routeStrudelLog({ message: '[tonal] transpose: not a note "foo"', type: 'warning' })
    expect(taken.map((t) => t.who)).toEqual(['b'])
  })

  it('writes what no engine claims without a file', () => {
    unregister.push(registerStrudelLogOwner(owner('a', () => null), 'strudel.log.test', null))
    routeStrudelLog({ message: '[sampler] could not load "bdd:0"', type: 'error' })
    expect(getLogHistory().map((e) => [e.level, e.runtime, e.source, e.message])).toEqual([
      ['error', 'strudel', undefined, '[sampler] could not load "bdd:0"'],
    ])
  })

  it("leaves out what no engine claims when it was raised inside some other query (a visual's, the timeline's)", () => {
    unregister.push(registerStrudelLogOwner(owner('a', () => null), 'strudel.log.test', null))
    __withQueryForTests(() => routeStrudelLog({ message: '[tonal] transpose: not a note "fo"', type: 'warning' }))
    expect(getLogHistory()).toEqual([])
    // the same message outside a query is written
    routeStrudelLog({ message: '[tonal] transpose: not a note "fo"', type: 'warning' })
    expect(getLogHistory()).toHaveLength(1)
  })

  it('drops what it leaves out before asking anyone', () => {
    unregister.push(registerStrudelLogOwner(owner('a', () => 'play'), 'strudel.log.test', null))
    routeStrudelLog({ message: '[cyclist] start' })
    expect(taken).toEqual([])
  })
})

describe('registerStrudelLogOwner', () => {
  beforeEach(() => { __resetEngineLogForTests() })

  it("listens on the page for Strudel's event while an engine is registered, and stops after the last", () => {
    const seen: string[] = []
    const off = registerStrudelLogOwner(
      { claimLog: () => 'play', takeLog: (row) => { seen.push(row.message) } },
      'strudel.log.reg',
      null,
    )
    document.dispatchEvent(new CustomEvent('strudel.log.reg', { detail: { message: '[hap] one' } }))
    off()
    document.dispatchEvent(new CustomEvent('strudel.log.reg', { detail: { message: '[hap] two' } }))
    expect(seen).toEqual(['[hap] one'])
    expect(getLogHistory()).toEqual([])
  })

  it("counts every query of the runtime's patterns, so an unclaimed message inside one is left out", () => {
    class FakePattern {
      queryArc(onQuery: () => void) { onQuery(); return [] }
    }
    const off = registerStrudelLogOwner({ claimLog: () => null, takeLog: () => {} }, 'strudel.log.q', FakePattern)
    try {
      new FakePattern().queryArc(() => routeStrudelLog({ message: '"x" is not a number, falling back to 0', type: 'warning' }))
      expect(getLogHistory()).toEqual([])
      routeStrudelLog({ message: '"x" is not a number, falling back to 0', type: 'warning' })
      expect(getLogHistory()).toHaveLength(1)
    } finally {
      off()
    }
  })
})
