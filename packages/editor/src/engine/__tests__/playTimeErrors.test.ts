// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { watchSkippedTicks, listenForPlayTimeErrors, playTimeErrorFrom, STRUDEL_LOG_EVENT } from '../StrudelEngine'

/**
 * #2173 — an error raised while the played pattern is queried is caught by
 * Strudel and only logged (`pattern.mjs` `queryArc`, `tonal.mjs`). These run
 * REAL Strudel patterns through a scheduler that queries the way the cyclist
 * does (`{ cyclist: 'cyclist' }`), with Strudel's real logger dispatching its
 * `strudel.log` event, so they fail if any side of that boundary moves.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let core: any
beforeAll(async () => {
  core = await import('@strudel/core')
  await import('@strudel/tonal') // registers `.scale`
})

let stop: () => void = () => {}
afterEach(() => stop())

function playing() {
  const sched: { pattern: any } = { pattern: null } // eslint-disable-line @typescript-eslint/no-explicit-any
  const inQuery = { depth: 0 }
  watchSkippedTicks(sched, () => {}, inQuery)
  const raised: string[] = []
  stop = listenForPlayTimeErrors(STRUDEL_LOG_EVENT, inQuery, (e) => raised.push(e.message))
  let at = 0
  const tick = () => {
    const haps = sched.pattern.queryArc(at, at + 0.5, { _cps: 0.5, cyclist: 'cyclist' })
    at += 0.5
    return haps
  }
  return { sched, inQuery, raised, tick }
}

describe('play-time errors reach Stave (#2173)', () => {
  it('listens for the event Strudel’s logger actually dispatches', () => {
    expect(core.logger.key).toBe(STRUDEL_LOG_EVENT)
  })

  it('a bad scale name, caught inside tonal, is raised with its message', () => {
    const p = playing()
    p.sched.pattern = core.n(core.sequence(0, 1)).scale('NotAScale:major')
    expect(p.tick()).toEqual([])
    expect(p.raised).toHaveLength(1)
    expect(p.raised[0]).toMatch(/^Scale name NotAScale major is incomplete/)
  })

  it('a callback that throws, caught by the query, is raised with its own message', () => {
    const p = playing()
    p.sched.pattern = core.s('hh').withValue(() => { throw new Error('boom') })
    expect(p.tick()).toEqual([])
    expect(p.raised).toEqual(['boom'])
  })

  it('the same failing pattern queried by anyone else stays quiet', () => {
    const p = playing()
    p.sched.pattern = core.s('hh').withValue(() => { throw new Error('quiet') })
    expect(p.sched.pattern.queryArc(0, 1)).toEqual([]) // a visualiser
    core.s('hh').withValue(() => { throw new Error('unplayed') }).queryArc(0, 1) // the quiet timeline evaluate
    expect(p.raised).toEqual([])
    expect(p.inQuery.depth).toBe(0)
  })

  it('a pattern that plays fine raises nothing', () => {
    const p = playing()
    p.sched.pattern = core.n(core.sequence(0, 1)).scale('C:major')
    expect(p.tick()).toHaveLength(1)
    expect(p.raised).toEqual([])
  })

  it('stops listening once removed', () => {
    const p = playing()
    stop()
    p.sched.pattern = core.s('hh').withValue(() => { throw new Error('after') })
    p.tick()
    expect(p.raised).toEqual([])
  })

  it('the counter comes back down even when the query itself throws', () => {
    const sched: { pattern: any } = { pattern: null } // eslint-disable-line @typescript-eslint/no-explicit-any
    const inQuery = { depth: 0 }
    watchSkippedTicks(sched, () => {}, inQuery)
    sched.pattern = { queryArc() { throw new Error('escaped') } }
    expect(() => sched.pattern.queryArc(0, 1, { cyclist: 'cyclist' })).toThrow('escaped')
    expect(inQuery.depth).toBe(0)
  })
})

describe('playTimeErrorFrom (#2173)', () => {
  it('reads the message Strudel’s errorLogger writes, without its origin', () => {
    expect(playTimeErrorFrom({ message: '[query] error: boom' })?.message).toBe('boom')
    expect(playTimeErrorFrom({ message: '[tonal] error: Scale name x is incomplete' })?.message).toBe('Scale name x is incomplete')
  })

  it('leaves out evaluate errors, which already arrive through onEvalError', () => {
    expect(playTimeErrorFrom({ message: '[eval] error: s(...).fooo is not a function' })).toBeNull()
  })

  it('leaves out log lines that are not errors', () => {
    expect(playTimeErrorFrom({ message: '[cyclist] start' })).toBeNull()
    expect(playTimeErrorFrom({ message: '"x" is not a number, falling back to 0', type: 'warning' })).toBeNull()
    expect(playTimeErrorFrom({ message: '[query] error: ' })).toBeNull()
    expect(playTimeErrorFrom(null)).toBeNull()
    expect(playTimeErrorFrom({})).toBeNull()
  })
})
