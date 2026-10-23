// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { watchSkippedTicks, listenForPlayTimeErrors, STRUDEL_LOG_EVENT, type SchedulerQuery } from '../StrudelEngine'
import { locateEvalError, measureEvalFrame, type EvalFrameShape } from '../evalErrorLocation'

/**
 * #2188 — an error thrown while a pattern plays is placed where it was
 * written. REAL Strudel: the code is evaluated by `@strudel/core` with the
 * patched transpiler, played through a scheduler that queries the way the
 * cyclist does, and Strudel's own `queryArc` catches and logs the error. The
 * error the listener raises must be the one thrown, so its stack can be read
 * back through the transpiler's source map. (Strudel's logger drops a message
 * repeated within a second, so each test throws its own.)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let core: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transpiler: (code: string, options?: Record<string, unknown>) => any
let shape: EvalFrameShape | null
beforeAll(async () => {
  core = await import('@strudel/core')
  const mini = await import('@strudel/mini')
  ;({ transpiler } = await import('@strudel/transpiler'))
  await core.evalScope(core, mini)
  core.Pattern.prototype.p = function () { return this } // the repl provides `.p`
  shape = await measureEvalFrame()
})

let stop: () => void = () => {}
afterEach(() => stop())

/** evaluate `code`, play one tick of it, and say where each raised error was thrown */
async function playAndPlace(code: string): Promise<string[]> {
  const options = { id: 'test' }
  const { pattern } = await core.evaluate(code, transpiler, options)
  const sched: { pattern: unknown } = { pattern: null }
  const inQuery: SchedulerQuery = { depth: 0 }
  watchSkippedTicks(sched, () => {}, inQuery)
  const raised: Error[] = []
  stop = listenForPlayTimeErrors(STRUDEL_LOG_EVENT, inQuery, (e) => raised.push(e))
  sched.pattern = pattern
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(sched.pattern as any).queryArc(0, 0.5, { _cps: 0.5, cyclist: 'cyclist' })
  expect(inQuery.lastError).toBeUndefined() // handed on, not left for the next one
  return raised.map((e) => {
    const at = locateEvalError(e, () => transpiler(code, { ...options, sourceMap: true }), shape)
    return `${e.message}@${at ? `${at.line}:${at.column}` : '-'}`
  })
}

describe('an error while a pattern plays gets its line (#2188)', () => {
  it('the reported `.fmap(v => v.nope.x)` on line 2', async () => {
    expect(await playAndPlace('$: s("bd sd")\n  .fmap(v => v.nope.x)')).toEqual([
      "Cannot read properties of undefined (reading 'x')@2:21",
    ])
  })

  it('a throw inside a helper defined lines above', async () => {
    // single quotes: a double-quoted string would be read as mini-notation.
    // V8 places a thrown `new Error(...)` where it was made, at the `new`.
    const code = "const loud = (v) => {\n  throw new Error('too loud ' + v.s)\n}\n\n$: s(\"cp\").fmap(loud)"
    expect(await playAndPlace(code)).toEqual(['too loud cp@2:9'])
  })

  it('a throw on the first line, where the wrapper also shifts columns', async () => {
    expect(await playAndPlace('$: s("hh").fmap(v => v.gone.y)')).toEqual([
      "Cannot read properties of undefined (reading 'y')@1:29",
    ])
  })

  it('a kept error is never handed on under another error’s message', async () => {
    // Strudel's logger drops a repeat within a second, so the kept error of a
    // repeated throw is never collected; the next error logged is a different
    // one that tonal logs without throwing.
    await import('@strudel/tonal')
    const sched: { pattern: any } = { pattern: null } // eslint-disable-line @typescript-eslint/no-explicit-any
    const inQuery: SchedulerQuery = { depth: 0 }
    watchSkippedTicks(sched, () => {}, inQuery)
    const raised: Error[] = []
    stop = listenForPlayTimeErrors(STRUDEL_LOG_EVENT, inQuery, (e) => raised.push(e))
    const tick = (from: number) => sched.pattern.queryArc(from, from + 0.5, { _cps: 0.5, cyclist: 'cyclist' })
    sched.pattern = core.s('hh').withValue(() => { throw new Error('repeated kept') })
    tick(0)
    tick(0.5) // dropped by the logger: its kept error is left behind
    sched.pattern = core.n(core.sequence(0, 1)).scale('NotAScale3:major')
    tick(1)
    expect(raised.map((e) => e.message.split(' is incomplete')[0])).toEqual(['repeated kept', 'Scale name NotAScale3 major'])
  })

  it('an error Strudel raises from its own code keeps no line', async () => {
    await import('@strudel/tonal')
    expect(await playAndPlace('$: n("0 1").scale("NotAScale2:major")')).toEqual([
      expect.stringMatching(/^Scale name NotAScale2 major is incomplete.*@-$/),
    ])
  })
})
