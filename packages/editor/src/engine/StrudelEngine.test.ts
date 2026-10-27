// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

// Unique counter for Pattern instances so queryArc returns distinguishable results
let patternInstanceCounter = 0

// Controls what pattern.p() calls the mock repl.evaluate() simulates
type EvalBehavior =
  | 'two-anon'     // two anonymous $: patterns → "$0", "$1"
  | 'one-named'    // one named pattern → "d1"
  | 'mixed'        // one anonymous + one named → "$0", "d1"
  | 'error'        // fires onEvalError (no patterns captured)
  | 'muted'        // muted patterns: "_muted" and "muted_"
  | 'one-track'    // single anonymous pattern → "$0"
  | 'viz-backdrop-flag'  // `.viz('name', { backdrop: true })` → backdrop slot (#364)
  | 'viz-inline-no-flag' // `.viz('name')` no flag → inline zone (#364 control)
  | 'inert-draw'         // `.animate()` twice + `.onPaint()` → one warning each (#2191)

let evalBehavior: EvalBehavior = 'two-anon'
// #2191 — what `.animate()` / `.onPaint()` returned inside the mock evaluate
let inertReturns: { pattern: unknown; animate: unknown[]; onPaint: unknown } | null = null
const MOCK_SILENCE = vi.hoisted(() => ({ silence: true }))

// #345 — what the transpiler reports for `$: s("bd").gain(slider(0.5, 0, 1))._pianoroll()`
const SLIDER_WIDGETS = [
  { type: 'slider', from: 23, to: 26, value: '0.5', min: 0, max: 1 },
  { type: '_pianoroll', to: 47, index: 0 },
]

// #2165 — `gated-<track>` codes wait here before running, so a test can hold one
// engine's evaluate open while another engine evaluates.
const GATES = new Map<string, Promise<void>>()

// Captured onEvalError callback from webaudioRepl construction
let capturedOnEvalError: ((err: Error) => void) | null = null

// #1621 — the engine's `wrappedOutput`, which the scheduler calls for every hap it plays.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let capturedDefaultOutput: ((hap: any, deadline: number, duration: number, cps: number, t: number) => Promise<unknown>) | null = null

// ---------------------------------------------------------------------------
// Mock Pattern class
// ---------------------------------------------------------------------------

class MockPattern {
  private instanceId: number
  // Accumulated `.late()` shift (#863) — the seek wrap the engine applies to the
  // SCHEDULER-frame pattern. `0` for a pattern in the song frame.
  private shift: number
  // #1570 — the transport wraps this pattern has been through, IN ORDER.
  //
  // `ribbon` cannot be modelled on this mock's time axis: it re-bases the slice
  // it cuts, so what it changes is WHICH song cycle sounds, and these haps carry
  // time rather than song-cycle values. (The real semantics are asserted against
  // the actual @strudel/core in `__tests__/transportFrame.test.ts` — that is the
  // authority; this records the WIRING.) The ops ride out on the hap value,
  // where `normalizeStrudelHap` passes unknown fields through as `params`, so a
  // test can read back exactly which wraps the engine applied to which frame.
  private ops: string[]
  // #1619 — `context.locations` for this pattern's haps, when a test sets them.
  // Omitted otherwise, so no other test's haps change.
  locations?: Array<{ start: number; end: number }>
  constructor(clone?: { instanceId: number; shift: number; ops: string[]; locations?: Array<{ start: number; end: number }> }) {
    this.instanceId = clone ? clone.instanceId : ++patternInstanceCounter
    this.shift = clone ? clone.shift : 0
    this.ops = clone ? clone.ops : []
    this.locations = clone?.locations
  }
  // Models `@strudel/core`'s `.late(offset)`: delays every onset by `offset`
  // cycles. Returns a NEW pattern (as Strudel does) that keeps the same
  // instanceId, so the orbit each analyser test asserts on is unaffected.
  late(offset: number) {
    return new MockPattern({
      instanceId: this.instanceId,
      shift: this.shift + offset,
      ops: [...this.ops, `late(${offset})`],
      locations: this.locations,
    })
  }
  // #1570 — `.ribbon(offset, cycles)`: cut a span and loop it. Recorded, not
  // simulated (see `ops` above).
  ribbon(offset: number, cycles: number) {
    return new MockPattern({
      instanceId: this.instanceId,
      shift: this.shift,
      ops: [...this.ops, `ribbon(${offset},${cycles})`],
      locations: this.locations,
    })
  }
  queryArc(begin: number, end: number) {
    return [{
      whole: { begin: begin + this.shift, end: end + this.shift },
      ...(this.locations ? { context: { locations: this.locations } } : {}),
      // `orbit` field is read by StrudelEngine.resolveOrbit() to decide which
      // superdough orbit to side-tap for per-track analysers. Using instanceId
      // gives each pattern a distinct orbit in tests.
      value: {
        note: `note_${this.instanceId}`,
        s: `inst_${this.instanceId}`,
        orbit: this.instanceId,
        // Omitted entirely on an unwrapped pattern, so the mock adds no
        // `params` to the haps every other test in this file reads.
        ...(this.ops.length > 0 ? { transportOps: this.ops } : {}),
      },
    }]
  }
}

// ---------------------------------------------------------------------------
// Mock @strudel/core
// ---------------------------------------------------------------------------

vi.mock('@strudel/core', () => {
  return {
    Pattern: MockPattern,
    evalScope: vi.fn().mockResolvedValue(undefined),
    // Phase 20-14 α-4: vendored piano.ts imports noteToMidi + valueToMidi
    // from @strudel/core at engine boot. Stubbed here so the test env can
    // load the side-effect module without an undefined-export crash.
    // The functions aren't exercised by these tests — any numeric return
    // is fine.
    noteToMidi: vi.fn((_note: string) => 108),
    valueToMidi: vi.fn((_value: unknown) => 60),
    // `init()` installs the bare-string parser through these (#1018). They must be
    // present even though nothing here exercises them: vitest throws on ANY access to
    // an export a mock does not define, so an optional call (`setStringParser?.()`) is
    // not enough to make the mock's omission harmless.
    setStringParser: vi.fn(),
    pure: vi.fn((v: unknown) => v),
    // #345 — the vendored `sliderWithID` is built over these at boot.
    ref: vi.fn(),
    // #2191 — what the inert `.animate()` returns, as Strudel's own does.
    silence: MOCK_SILENCE,
  }
})

// ---------------------------------------------------------------------------
// Mock @strudel/webaudio
// ---------------------------------------------------------------------------

vi.mock('@strudel/webaudio', () => {
  const mockScheduler = {
    now: () => 0,
    pattern: new MockPattern(),
    start: vi.fn(),
    stop: vi.fn(),
    // #1621 — the breakpoint hit-check pauses through here.
    pause: vi.fn(),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webaudioRepl = vi.fn((options: { onEvalError?: (err: Error) => void; defaultOutput?: any }) => {
    capturedOnEvalError = options.onEvalError ?? null
    capturedDefaultOutput = options.defaultOutput ?? null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repl: any = {
      scheduler: mockScheduler,
      // #1619 — Strudel's repl keeps the transpiler's declared spans here
      // (`repl.mjs:273-274`), replaced by every evaluate that succeeds.
      state: { miniLocations: [] as Array<[number, number]> },
      evaluate: vi.fn(async (code: string) => {
        // Simulate Strudel's internal sequence:
        // (1) injectPatternMethods: sets Pattern.prototype.p = function(id) { ... }
        // (2) hush() would run (reset counters) — simulated by starting fresh
        // (3) user code runs — calls pattern.p(id)

        // #2165 — Strudel awaits (prebake, transpile) before it injects and runs
        if (GATES.has(code)) await GATES.get(code)

        // Step 1: Simulate injectPatternMethods assigning Pattern.prototype.p
        const strudelsOwnP = function(this: MockPattern, id: string) {
          // Strudel's own implementation: returns this (simplified)
          return this
        }
        // This is the critical line: Strudel's injectPatternMethods does:
        //   Pattern.prototype.p = function(id) { pPatterns[id] = this; return this; }
        ;(MockPattern.prototype as any).p = strudelsOwnP

        // Step 2: Simulate user code calling .p(id) based on eval behavior
        if (code === 'error-code') {
          // Trigger eval error instead of running user code
          capturedOnEvalError?.(new Error('Simulated eval error'))
          return
        }

        // #1193 — the case the engine's own comment said could not happen:
        // repl.evaluate REJECTS instead of routing the failure through
        // onEvalError. Nothing in Strudel promises it never does, and when it
        // did, the engine's bridge promise never settled.
        if (code === 'reject-code') {
          throw new Error('Simulated repl.evaluate rejection')
        }

        // #1619 — a successful evaluate replaces the declared spans, as the real repl
        // does before it resolves. `unknown-locs` is a runtime with no such state.
        repl.state = code === 'unknown-locs'
          ? undefined
          : {
              miniLocations: code === 'declared-locs' ? [[9, 17]] : [],
              // #345 — the transpiler's widgets, kept beside the spans (`repl.mjs:275`)
              widgets: code === 'sliders' ? SLIDER_WIDGETS : [],
            }

        if (code === 'slider-in-eval') {
          // #2165 — what the transpiled `slider(5, 0, 10)` calls during an evaluate
          const { sliderFunctions } = await import('./vendored/slider')
          sliderFunctions({ ref: (r: () => unknown) => r, pure: (v: unknown) => v }).sliderWithID('slider_9', 5)
          const p = new MockPattern()
          ;(p as any).p('$')
        } else if (code.startsWith('gated-')) {
          // one track, named after the code
          const p = new MockPattern()
          ;(p as any).p(code.slice('gated-'.length))
        } else if (code === 'declared-locs' || code === 'unknown-locs') {
          // #1619 — a stray quoted-space span FIRST ([1,7), what `.color('sienna')`
          // gives), then the declared document span ([9,17)).
          const p = new MockPattern()
          p.locations = [{ start: 1, end: 7 }, { start: 9, end: 17 }]
          ;(p as any).p('$')
        } else if (code === 'two-anon' || evalBehavior === 'two-anon') {
          const p0 = new MockPattern()
          const p1 = new MockPattern()
          ;(p0 as any).p('$')
          ;(p1 as any).p('$')
        } else if (code === 'one-named' || evalBehavior === 'one-named') {
          const p = new MockPattern()
          ;(p as any).p('d1')
        } else if (code === 'mixed' || evalBehavior === 'mixed') {
          const p0 = new MockPattern()
          const p1 = new MockPattern()
          ;(p0 as any).p('$')
          ;(p1 as any).p('d1')
        } else if (code === 'muted-code' || evalBehavior === 'muted') {
          const p1 = new MockPattern()
          const p2 = new MockPattern()
          ;(p1 as any).p('_muted')
          ;(p2 as any).p('muted_')
        } else if (code === 'one-track' || evalBehavior === 'one-track') {
          const p = new MockPattern()
          ;(p as any).p('$')
        } else if (evalBehavior === 'viz-backdrop-flag') {
          // #364: `.viz('pianoroll', { backdrop: true })` promotes the viz to
          // the BACKDROP slot. The flag fires BEFORE .p(); .p() must then NOT
          // register an inline viz request (no `_pendingViz` was tagged).
          const p = new MockPattern()
          ;(p as any).viz('pianoroll', { backdrop: true, opacity: 0.5 })
          ;(p as any).p('$')
        } else if (evalBehavior === 'viz-inline-no-flag') {
          // #364 control: `.viz('spectrum')` with no flag stays inline — it
          // tags `_pendingViz`, so .p() registers an inline request and the
          // backdrop slot stays empty.
          const p = new MockPattern()
          ;(p as any).viz('spectrum')
          ;(p as any).p('$')
        } else if (evalBehavior === 'inert-draw') {
          const p = new MockPattern()
          inertReturns = {
            pattern: p,
            animate: [(p as any).animate(), (p as any).animate({ smear: 0.2 })],
            onPaint: (p as any).onPaint(() => {}),
          }
          ;(p as any).p('$')
        }
      }),
    }
    return repl
  })

  return {
    webaudioRepl,
    initAudio: vi.fn().mockResolvedValue(undefined),
    getAudioContext: vi.fn(() => ({
      createAnalyser: vi.fn(() => ({
        fftSize: 2048,
        smoothingTimeConstant: 0.8,
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      currentTime: 0,
      sampleRate: 44100,
    })),
    webaudioOutput: vi.fn(),
    registerSynthSounds: vi.fn(),
    registerZZFXSounds: vi.fn(),
    // Stave's superdough patch (#2058): stop() fades out what is still sounding
    stopAllSounds: vi.fn(() => 0),
    // Real superdough returns the SAME SuperdoughAudioController singleton on
    // every call. The mock memoizes so tests can inspect the same getOrbit spy
    // the engine itself used during init().
    getSuperdoughAudioController: (() => {
      const orbits = new Map<number, { output: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> } }>()
      const controller = {
        output: { destinationGain: { connect: vi.fn() } },
        getOrbit: vi.fn((n: number) => {
          let orbit = orbits.get(n)
          if (!orbit) {
            orbit = { output: { connect: vi.fn(), disconnect: vi.fn() } }
            orbits.set(n, orbit)
          }
          return orbit
        }),
      }
      return vi.fn(() => controller)
    })(),
    samples: vi.fn().mockResolvedValue(undefined),
    soundMap: { get: vi.fn(() => ({})) },
  }
})

// ---------------------------------------------------------------------------
// Mock remaining strudel modules
// ---------------------------------------------------------------------------

vi.mock('@strudel/mini', () => ({
  miniAllStrings: vi.fn(),
}))

vi.mock('@strudel/tonal', () => ({}))

vi.mock('@strudel/soundfonts', () => ({
  registerSoundfonts: vi.fn(),
}))

vi.mock('@strudel/xen', () => ({}))

vi.mock('@strudel/midi', () => ({}))

// Phase 20-14 α-1: audio-pure addition to evalScope; tests don't exercise
// mondo notation so an empty mock is sufficient (matches the @strudel/tonal,
// @strudel/xen, @strudel/midi pattern above).
vi.mock('@strudel/mondo', () => ({}))

vi.mock('@strudel/transpiler', () => ({
  transpiler: vi.fn((code: string) => ({ output: code })),
}))

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are set up)
// ---------------------------------------------------------------------------

import { StrudelEngine, isBootStepFailure, type BootStepFailure } from './StrudelEngine'
import type { LiveCodingEngine } from './LiveCodingEngine'
import type { HapEvent } from './HapStream'
import { Pattern } from '@strudel/core'
import { withOfflineGraph } from './offlineGraph'
import { getLogHistory, __resetEngineLogForTests } from './engineLog'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StrudelEngine.getTrackSchedulers', () => {
  beforeEach(() => {
    patternInstanceCounter = 0
    capturedOnEvalError = null
    evalBehavior = 'two-anon'
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Ensure Pattern.prototype.p is not left as a setter after any test
    const desc = Object.getOwnPropertyDescriptor(MockPattern.prototype, 'p')
    if (desc?.set) {
      // Clean up leaked setter
      delete (MockPattern.prototype as any).p
    }
  })

  it('returns empty Map before evaluate', () => {
    const engine = new StrudelEngine()
    expect(engine.getTrackSchedulers().size).toBe(0)
  })

  it('captures anonymous $: patterns as $0, $1 (TRACK-01, TRACK-04)', async () => {
    evalBehavior = 'two-anon'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('two-anon')
    const map = engine.getTrackSchedulers()
    expect(map.size).toBe(2)
    expect(map.has('$0')).toBe(true)
    expect(map.has('$1')).toBe(true)
  })

  it('captures named patterns with literal key (TRACK-01, TRACK-04)', async () => {
    evalBehavior = 'one-named'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-named')
    const map = engine.getTrackSchedulers()
    expect(map.has('d1')).toBe(true)
  })

  it('each track scheduler queries its own pattern (TRACK-03)', async () => {
    evalBehavior = 'two-anon'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('two-anon')
    const map = engine.getTrackSchedulers()
    const sched0 = map.get('$0')!
    const sched1 = map.get('$1')!
    expect(sched0).toBeDefined()
    expect(sched1).toBeDefined()
    const result0 = sched0.query(0, 1)
    const result1 = sched1.query(0, 1)
    // Each returns its own Pattern's queryArc result (different note/s from instanceId)
    expect(result0).not.toEqual(result1)
    expect(result0[0].note).not.toBe(result1[0].note)
  })

  it('restores Pattern.prototype.p after successful evaluate (TRACK-02)', async () => {
    evalBehavior = 'two-anon'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('two-anon')
    const after = Object.getOwnPropertyDescriptor(MockPattern.prototype, 'p')
    // Should not be a setter (our intercept should be removed)
    expect(after?.set).toBeUndefined()
  })

  /**
   * #2165 — two engines on one page (the project's and the Library's preview).
   * `Pattern.prototype` is shared, and an evaluate patches it for as long as it
   * runs; held open together, the second engine's trap caught the FIRST
   * engine's tracks, and a trap was left on the prototype.
   */
  it('two engines evaluating at once each keep their own tracks', async () => {
    let openA!: () => void
    let openB!: () => void
    GATES.set('gated-a', new Promise<void>((r) => { openA = r }))
    GATES.set('gated-b', new Promise<void>((r) => { openB = r }))
    try {
      const a = new StrudelEngine()
      const b = new StrudelEngine()
      await a.init()
      await b.init()
      const evalA = a.evaluate('gated-a')
      // let A get as far as its repl (prototype patched), then start B
      for (let i = 0; i < 20; i++) await Promise.resolve()
      const evalB = b.evaluate('gated-b')
      for (let i = 0; i < 20; i++) await Promise.resolve()
      openA()
      await evalA
      openB()
      await evalB
      expect([...a.getTrackSchedulers().keys()]).toEqual(['a'])
      expect([...b.getTrackSchedulers().keys()]).toEqual(['b'])
      expect(Object.getOwnPropertyDescriptor(MockPattern.prototype, 'p')?.set).toBeUndefined()
    } finally {
      GATES.clear()
    }
  })

  it("an engine's sliders are kept under its own scope, only while it evaluates (#2165)", async () => {
    const { sliderValues } = await import('./vendored/slider')
    try {
      const project = new StrudelEngine()
      const preview = new StrudelEngine({ sliderScope: 'preview:' })
      await project.init()
      await preview.init()
      await preview.evaluate('slider-in-eval')
      expect(sliderValues['preview:slider_9']).toBe(5)
      expect('slider_9' in sliderValues).toBe(false)
      await project.evaluate('slider-in-eval')
      expect(sliderValues['slider_9']).toBe(5)
    } finally {
      delete sliderValues['slider_9']
      delete sliderValues['preview:slider_9']
    }
  })

  it('restores Pattern.prototype.p after eval error (TRACK-02)', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('error-code')
    const desc = Object.getOwnPropertyDescriptor(MockPattern.prototype, 'p')
    expect(desc?.set).toBeUndefined()
  })

  /**
   * #1193 — REGRESSION GUARD. `evaluate()` must SETTLE when `repl.evaluate`
   * rejects, rather than waiting forever for a success callback that will
   * never come.
   *
   * WHY THIS IS THE ARM AND NOT A TIMING ONE. The bridge promise used to have
   * exactly one settle path — the `.then` — because a comment asserted that
   * repl.evaluate never rejects. That is a claim about someone else's
   * function, and the whole failure follows from it being false ONCE: the
   * promise never settles, `runExclusiveEval` holds its gate against every
   * later caller, and the snapshot publish sequenced behind it never runs. The
   * Song view then reads "No song to map yet — press play." about a loaded
   * document, permanently, with nothing logged anywhere.
   *
   * ⚠ On the unfixed engine this test does not fail with a wrong value — it
   * HANGS, and vitest's own timeout is what reddens it. That is the honest
   * shape: the defect is a promise that never settles, so the assertion is
   * that control returns at all.
   */
  it('settles instead of hanging when repl.evaluate REJECTS (#1193)', async () => {
    const engine = new StrudelEngine()
    await engine.init()

    // Reaching the next line at all is the property under test.
    await engine.evaluate('reject-code')

    // And the gate must be free afterwards: a second evaluate has to run, or
    // the hang has merely moved from the first caller to every later one.
    evalBehavior = 'one-track'
    await engine.evaluate('one-track')
    expect(engine.getTrackSchedulers().size).toBeGreaterThan(0)
  })

  it('skips muted patterns _x and x_ (TRACK-04)', async () => {
    evalBehavior = 'muted'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('muted-code')
    const map = engine.getTrackSchedulers()
    expect(map.has('_muted')).toBe(false)
    expect(map.has('muted_')).toBe(false)
    expect(map.size).toBe(0)
  })

  it('re-evaluate replaces map entirely', async () => {
    evalBehavior = 'two-anon'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('two-anon')
    expect(engine.getTrackSchedulers().size).toBe(2)
    evalBehavior = 'one-track'
    await engine.evaluate('one-track')
    expect(engine.getTrackSchedulers().size).toBe(1)
  })

  it('mixed $: and named patterns produce correct keys (TRACK-04)', async () => {
    evalBehavior = 'mixed'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('mixed')
    const map = engine.getTrackSchedulers()
    expect(map.has('$0')).toBe(true)
    expect(map.has('d1')).toBe(true)
    expect(map.size).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// #1619 — a hap's locations are filtered to the spans the transpiler declared.
// ---------------------------------------------------------------------------

describe('StrudelEngine keeps only declared hap locations (#1619)', () => {
  beforeEach(() => {
    patternInstanceCounter = 0
    capturedOnEvalError = null
    vi.clearAllMocks()
  })

  it('drops a span the transpiler never declared, from timeline events and the live scheduler alike', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('declared-locs')
    const events = engine.getTimelineEvents(1)
    expect(events.length, 'the located pattern produced no event').toBeGreaterThan(0)
    for (const ev of events) expect(ev.loc).toEqual([{ start: 9, end: 17 }])
    const live = engine.getTrackSchedulers().get('$0')!.query(0, 1)
    expect(live.length).toBeGreaterThan(0)
    for (const ev of live) expect(ev.loc).toEqual([{ start: 9, end: 17 }])
  })

  it('keeps every location when the runtime says nothing about declared spans', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('unknown-locs')
    const events = engine.getTimelineEvents(1)
    expect(events.length).toBeGreaterThan(0)
    for (const ev of events) expect(ev.loc).toEqual([{ start: 1, end: 7 }, { start: 9, end: 17 }])
  })

  it('a failed evaluate keeps the spans that belong to the patterns it keeps', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('declared-locs')
    await engine.evaluate('error-code')
    const events = engine.getTimelineEvents(1)
    expect(events.length, 'the failed evaluate dropped the last good patterns — this arm tests nothing').toBeGreaterThan(0)
    for (const ev of events) expect(ev.loc).toEqual([{ start: 9, end: 17 }])
  })
})

// ---------------------------------------------------------------------------
// #1621 — the live stream (highlighting, the breakpoint hit-check, the Inspector
// pulse) keeps only declared spans too. Driven through the engine's real
// `wrappedOutput`, the function the scheduler calls for every hap it plays.
// ---------------------------------------------------------------------------

describe('StrudelEngine live stream keeps only declared hap locations (#1621)', () => {
  // The hap the scheduler would play for `declared-locs`: stray span first, declared second.
  const playedHap = () => ({ whole: { begin: 0, end: 1 }, value: { s: 'hh' }, context: { locations: [{ start: 1, end: 7 }, { start: 9, end: 17 }] } })

  beforeEach(() => {
    patternInstanceCounter = 0
    capturedOnEvalError = null
    capturedDefaultOutput = null
    vi.clearAllMocks()
  })

  async function playOne(engine: StrudelEngine): Promise<HapEvent> {
    const seen: HapEvent[] = []
    const onEvent = (e: HapEvent) => seen.push(e)
    engine.getHapStream().on(onEvent)
    expect(capturedDefaultOutput, 'init() handed the repl no output — this arm tests nothing').not.toBeNull()
    await capturedDefaultOutput!(playedHap(), 0, 0.25, 1, 0)
    engine.getHapStream().off(onEvent)
    expect(seen).toHaveLength(1)
    return seen[0]
  }

  it('emits only the declared span to every subscriber', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('declared-locs')
    expect((await playOne(engine)).loc).toEqual([{ start: 9, end: 17 }])
  })

  it('keeps every location when the runtime says nothing about declared spans', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('unknown-locs')
    expect((await playOne(engine)).loc).toEqual([{ start: 1, end: 7 }, { start: 9, end: 17 }])
  })

  it('a failed evaluate keeps the spans of the patterns that keep playing', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('declared-locs')
    await engine.evaluate('error-code')
    expect((await playOne(engine)).loc).toEqual([{ start: 9, end: 17 }])
  })

  it('a breakpoint fires on the node the declared span names, not the one the stray span would', async () => {
    const { webaudioOutput } = await import('@strudel/webaudio')
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('declared-locs')
    // One IR node at each span, so the match decides which breakpoint the note hits.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(engine as any).lastIRNodeLocLookup = new Map([
      ['1:7', [{ begin: 0, end: 1, irNodeId: 'stray-node' }]],
      ['9:17', [{ begin: 0, end: 1, irNodeId: 'declared-node' }]],
    ])
    const store = engine.getBreakpointStore()

    // Control: a breakpoint on the node only the stray span names never pauses.
    store.add('stray-node')
    const passed = await playOne(engine)
    expect(passed.irNodeId).toBe('declared-node')
    expect(engine.getPaused()).toBe(false)
    expect(vi.mocked(webaudioOutput)).toHaveBeenCalledTimes(1)

    store.add('declared-node')
    await playOne(engine)
    expect(engine.getPaused()).toBe(true)
    expect(vi.mocked(webaudioOutput), 'a paused note must not reach the audio output').toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// #364 (350b) — `.viz('name', { backdrop: true })` as a code-override.
// The backdrop flag routes a named inline viz to the backdrop slot
// (engine `backdropVizRequest` → `components.inlineViz.backdropRequest`),
// the same channel the non-underscore `.scope()`/`.pianoroll()` methods feed.
// Without the flag, `.viz('name')` stays an inline zone (vizRequests) and the
// backdrop stays empty.
// ---------------------------------------------------------------------------

describe('StrudelEngine .viz() backdrop flag (#364)', () => {
  beforeEach(() => {
    patternInstanceCounter = 0
    capturedOnEvalError = null
    evalBehavior = 'two-anon'
    vi.clearAllMocks()
  })

  afterEach(() => {
    const desc = Object.getOwnPropertyDescriptor(MockPattern.prototype, 'p')
    if (desc?.set) delete (MockPattern.prototype as any).p
  })

  it('`.viz(name, { backdrop: true })` sets the backdrop request, not an inline zone', async () => {
    evalBehavior = 'viz-backdrop-flag'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('viz-backdrop-flag')

    const inlineViz = engine.components.inlineViz
    expect(inlineViz?.backdropRequest).toEqual({
      vizId: 'pianoroll',
      // opacity/quality ride along in the same options bag (#365 applies them).
      options: { backdrop: true, opacity: 0.5 },
    })
    // The flagged viz must NOT also register as an inline zone request.
    expect(inlineViz?.vizRequests.size ?? 0).toBe(0)
  })

  it('`.viz(name)` with no flag stays inline — backdrop request stays undefined', async () => {
    evalBehavior = 'viz-inline-no-flag'
    const engine = new StrudelEngine()
    await engine.init()
    // Code must carry a `$:` line — the exposed vizRequests map is built by
    // line-scanning lastEvaluatedCode (buildVizRequestsWithLines).
    await engine.evaluate('$: spectrum')

    const inlineViz = engine.components.inlineViz
    // Inline request registered for the track; no backdrop promotion.
    expect(inlineViz?.vizRequests.get('$0')?.vizId).toBe('spectrum')
    expect(inlineViz?.backdropRequest).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// #2191 — `.animate()` / `.onPaint()` would draw on Strudel's canvas behind the
// app. They warn once per evaluation, leave the pattern as it was, and never
// reach Strudel's own method.
// ---------------------------------------------------------------------------

describe('StrudelEngine methods that would draw where nobody can see (#2191)', () => {
  const strudelAnimate = vi.fn(function (this: unknown) { return 'drew on the hidden canvas' })
  const strudelOnPaint = vi.fn(function (this: unknown) { return 'added a painter' })

  beforeEach(() => {
    patternInstanceCounter = 0
    capturedOnEvalError = null
    evalBehavior = 'inert-draw'
    inertReturns = null
    vi.clearAllMocks()
    __resetEngineLogForTests()
    // what @strudel/draw puts on every pattern when webaudio imports it
    ;(MockPattern.prototype as any).animate = strudelAnimate
    ;(MockPattern.prototype as any).onPaint = strudelOnPaint
  })

  afterEach(() => {
    const desc = Object.getOwnPropertyDescriptor(MockPattern.prototype, 'p')
    if (desc?.set) delete (MockPattern.prototype as any).p
    delete (MockPattern.prototype as any).animate
    delete (MockPattern.prototype as any).onPaint
  })

  it('notes one warning per method for the app, returns what Strudel\'s returns, and restores Strudel\'s methods after', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    const result = await engine.evaluate('inert-draw')
    expect(result.error).toBeUndefined()

    expect(inertReturns).not.toBeNull()
    const { pattern, animate, onPaint } = inertReturns!
    // `.animate()` is drawn, not played, in Strudel too; `.onPaint()` keeps the pattern
    expect(animate).toEqual([MOCK_SILENCE, MOCK_SILENCE])
    expect(onPaint).toBe(pattern)
    expect(strudelAnimate).not.toHaveBeenCalled()
    expect(strudelOnPaint).not.toHaveBeenCalled()

    // #2200 — nothing is written by the evaluate itself (the timeline's quiet
    // evaluate runs it too); the warnings wait for the app to take them
    expect(getLogHistory()).toEqual([])
    const taken = engine.takeEvalNotices()
    expect(taken.code).toBe('inert-draw')
    const warns = taken.notices
    expect(warns.map((e) => e.level)).toEqual(['warn', 'warn'])
    expect(warns.map((e) => e.message.slice(0, e.message.indexOf(' is part of')))).toEqual(['`.animate()`', '`.onPaint()`'])
    // handed over once
    expect(engine.takeEvalNotices().notices).toEqual([])
    expect(warns[0].message).toContain('As in Strudel, the pattern it draws makes no sound, and here nothing is drawn.')
    expect(warns[1].message).toContain('The sound still plays, but nothing is drawn.')
    expect(warns[0].suggestion).toEqual({
      name: '',
      linkLabel: '#2191',
      docsUrl: 'https://github.com/MrityunjayBhardwaj/stave/issues/2191',
      description: 'Follow it in Stave',
    })

    // outside an evaluation the methods are Strudel's again
    expect((MockPattern.prototype as any).animate).toBe(strudelAnimate)
    expect((MockPattern.prototype as any).onPaint).toBe(strudelOnPaint)
  })
})

// ---------------------------------------------------------------------------
// #345 — `slider(…)`: the transpiler's slider widgets reach the editor through
// `components.inlineViz.sliders`, as the repl reported them.
// ---------------------------------------------------------------------------

describe('StrudelEngine slider widgets (#345)', () => {
  beforeEach(() => {
    patternInstanceCounter = 0
    capturedOnEvalError = null
    evalBehavior = 'one-named'
    vi.clearAllMocks()
  })

  it('publishes the sliders of the last evaluate, without the other widgets', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('sliders')
    expect(engine.components.inlineViz?.sliders).toEqual([SLIDER_WIDGETS[0]])
  })

  it('keeps them when an evaluate fails, and drops them when one succeeds without any', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('sliders')
    await engine.evaluate('error-code')
    expect(engine.components.inlineViz?.sliders).toEqual([SLIDER_WIDGETS[0]])
    await engine.evaluate('one-named')
    expect(engine.components.inlineViz?.sliders).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Per-track AnalyserNode producer (T-02, issue #19)
// ---------------------------------------------------------------------------

describe('StrudelEngine per-track analysers', () => {
  beforeEach(() => { patternInstanceCounter = 0 })

  it('populates audio.trackAnalysers after evaluate — one per captured pattern', async () => {
    evalBehavior = 'two-anon'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('two-anon')
    const { audio } = engine.components
    expect(audio?.trackAnalysers).toBeDefined()
    expect(audio!.trackAnalysers!.size).toBe(2)
    expect(audio!.trackAnalysers!.has('$0')).toBe(true)
    expect(audio!.trackAnalysers!.has('$1')).toBe(true)
    // Distinct analyser instances per track.
    const a = audio!.trackAnalysers!.get('$0')
    const b = audio!.trackAnalysers!.get('$1')
    expect(a).not.toBe(b)
  })

  it('analysers are side-taps — no destination wiring, just orbit.output.connect(analyser)', async () => {
    evalBehavior = 'one-named'
    const { getSuperdoughAudioController } = await import('@strudel/webaudio') as any
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-named')
    const controller = getSuperdoughAudioController()
    // getOrbit was invoked to resolve each captured pattern's orbit
    expect(controller.getOrbit).toHaveBeenCalled()
    // The orbit's output GainNode received a .connect(analyser) call
    const analyser = engine.components.audio!.trackAnalysers!.get('d1')!
    // Find the orbit the engine tapped (any orbit whose output.connect was called with this analyser)
    const connectCalls = (controller.getOrbit as any).mock.results
      .flatMap((r: any) => (r.value.output.connect as any).mock.calls)
    expect(connectCalls.some((c: any[]) => c[0] === analyser)).toBe(true)
  })

  it('reuses existing analyser when re-evaluating identical code (no churn)', async () => {
    evalBehavior = 'one-named'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-named')
    const first = engine.components.audio!.trackAnalysers!.get('d1')!
    await engine.evaluate('one-named')
    const second = engine.components.audio!.trackAnalysers!.get('d1')!
    expect(second).toBe(first)
  })

  it('removes + disconnects analyser when its track disappears on re-evaluate', async () => {
    evalBehavior = 'two-anon'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('two-anon')
    const stale = engine.components.audio!.trackAnalysers!.get('$1')!
    expect(engine.components.audio!.trackAnalysers!.size).toBe(2)
    evalBehavior = 'one-track'
    await engine.evaluate('one-track')
    expect(engine.components.audio!.trackAnalysers!.size).toBe(1)
    expect(stale.disconnect).toHaveBeenCalled()
  })

  it('dispose() disconnects all per-track analysers and clears the map', async () => {
    evalBehavior = 'two-anon'
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('two-anon')
    const a = engine.components.audio!.trackAnalysers!.get('$0')!
    const b = engine.components.audio!.trackAnalysers!.get('$1')!
    engine.dispose()
    expect(a.disconnect).toHaveBeenCalled()
    expect(b.disconnect).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// LiveCodingEngine interface conformance
// ---------------------------------------------------------------------------

describe('StrudelEngine LiveCodingEngine conformance', () => {
  it('satisfies LiveCodingEngine interface (compile-time + runtime)', () => {
    // Compile-time check: if this file compiles, the interface is satisfied
    const engine: LiveCodingEngine = new StrudelEngine()
    expect(engine.init).toBeDefined()
    expect(engine.evaluate).toBeDefined()
    expect(engine.play).toBeDefined()
    expect(engine.stop).toBeDefined()
    expect(engine.dispose).toBeDefined()
    expect(engine.components).toBeDefined()
    expect(engine.setRuntimeErrorHandler).toBeDefined()
    engine.dispose()
  })

  it('has components getter that returns object', () => {
    const engine = new StrudelEngine()
    expect(engine.components).toBeDefined()
    expect(typeof engine.components).toBe('object')
    engine.dispose()
  })

  it('components.streaming.hapStream is defined before init', () => {
    const engine = new StrudelEngine()
    const { streaming } = engine.components
    expect(streaming).toBeDefined()
    expect(streaming!.hapStream).toBeDefined()
    expect(typeof streaming!.hapStream.on).toBe('function')
    expect(typeof streaming!.hapStream.off).toBe('function')
    engine.dispose()
  })
})

// ---------------------------------------------------------------------------
// #384 — transport seek offset. The field + getter/setter are pure (no audio
// env), so they're unit-testable on a bare engine. The `.late()` wrap they
// drive at the `.p` seam is exercised end-to-end (design §10), not here.
// ---------------------------------------------------------------------------
describe('StrudelEngine transport offset (#384)', () => {
  it('defaults to 0 before any seek', () => {
    const engine = new StrudelEngine()
    expect(engine.getTransportOffset()).toBe(0)
    engine.dispose()
  })

  it('setTransportOffset round-trips through getTransportOffset', () => {
    const engine = new StrudelEngine()
    engine.setTransportOffset(7)
    expect(engine.getTransportOffset()).toBe(7)
    engine.setTransportOffset(-2.5)
    expect(engine.getTransportOffset()).toBe(-2.5)
    engine.dispose()
  })

  it('coerces a non-finite offset to 0 (NaN/Infinity guard)', () => {
    const engine = new StrudelEngine()
    engine.setTransportOffset(5)
    engine.setTransportOffset(Number.NaN)
    expect(engine.getTransportOffset()).toBe(0)
    engine.setTransportOffset(Number.POSITIVE_INFINITY)
    expect(engine.getTransportOffset()).toBe(0)
    engine.dispose()
  })
})

// ---------------------------------------------------------------------------
// getTimelineEvents — the SONG frame (#863)
// ---------------------------------------------------------------------------
// The Song timeline draws its static marks on a song-absolute axis, inside lanes
// and clips derived from the (unshifted) static IR. A seek wraps every captured
// pattern in `.late(transportOffset)` so audio and the live playhead stay in one
// scheduler frame — so reading the marks off `trackSchedulers` slid them by the
// offset and desynced them from their own lanes. `getTimelineEvents` must read
// the pre-wrap SONG pattern instead; the live surfaces keep the shifted one.
describe('StrudelEngine.getTimelineEvents (song frame, #863)', () => {
  beforeEach(() => {
    patternInstanceCounter = 0
    capturedOnEvalError = null
    evalBehavior = 'one-track'
    vi.clearAllMocks()
  })

  it('returns no events before the first evaluate', () => {
    const engine = new StrudelEngine()
    expect(engine.getTimelineEvents(4)).toEqual([])
    engine.dispose()
  })

  // #1107 — THE BOUNDARY PAIR. The Song analysis refuses a period while a
  // declared track has produced no onset yet, and it decides that by comparing
  // `getSongTrackIds()` against the `trackId`s `getTimelineEvents` stamps. If
  // those two ever describe different track sets the failure is SILENT and
  // one-directional: a key that never appears is read as a track that has not
  // played, so every document with one would grow to the 256-cycle cap and be
  // drawn as aperiodic — no error, no warning, just a worse view. Asserted here,
  // at the one place that owns both.
  it('reports the same track ids it stamps on timeline events', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    expect(engine.getSongTrackIds()).toEqual([])
    await engine.evaluate('one-track')
    const ids = engine.getSongTrackIds()
    expect(ids.length).toBeGreaterThan(0)
    const stamped = new Set(engine.getTimelineEvents(4).map((e) => e.trackId))
    // Every stamped key is declared. The converse does NOT hold and must not be
    // asserted: a registered track that is silent over the queried window stamps
    // nothing, which is exactly the state the analysis needs to be able to see.
    for (const key of stamped) expect(ids).toContain(key)
    engine.dispose()
  })

  it('is song-absolute at offset 0 (the frames coincide)', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-track')
    const evs = engine.getTimelineEvents(4)
    expect(evs.length).toBe(1)
    expect(evs[0].begin).toBe(0)
    engine.dispose()
  })

  it('stays song-absolute AFTER a seek, while the track schedulers shift', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    // A seek: the transport offset is applied at the next evaluate (the `.late`
    // wrap lives at the engine's `.p` capture seam).
    engine.setTransportOffset(2)
    await engine.evaluate('one-track')

    // DISPLAY frame — unmoved: song cycle 0 is still song cycle 0.
    const marks = engine.getTimelineEvents(4)
    expect(marks.length).toBe(1)
    expect(marks[0].begin).toBe(0)

    // LIVE frame — still shifted by the offset, as the audio/playhead/viz need.
    const sched = engine.getTrackSchedulers().get('$0')!
    expect(sched.query(0, 4)[0].begin).toBe(2)
    engine.dispose()
  })

  // -------------------------------------------------------------------------
  // Loop locators (#1570) — the wrap, and the frame it must not reach.
  // -------------------------------------------------------------------------
  // These are WIRING assertions: which wraps were applied, in which order, to
  // which frame. What `ribbon` actually does to time is asserted against the
  // real @strudel/core in `__tests__/transportFrame.test.ts`.
  //
  // ⚠ The order and the placement are both load-bearing, and both fail SILENTLY:
  // a ribbon applied after `.late` cuts a span the user never set, and a ribbon
  // that reaches the SONG frame folds the looped bars across the whole song axis
  // — the marks repeat under the lanes, which is #863 wearing a different hat.
  it('wraps the SCHEDULER-frame pattern in .ribbon when a loop is armed', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setLoopRange({ startCycle: 3, cycles: 2 })
    await engine.evaluate('one-track')

    const sched = engine.getTrackSchedulers().get('$0')!
    const hap = sched.query(0, 4)[0] as unknown as { params?: { transportOps?: string[] } }
    expect(hap.params?.transportOps).toEqual(['ribbon(3,2)'])
    engine.dispose()
  })

  it('applies the ribbon BEFORE the seek wrap, not after', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setLoopRange({ startCycle: 3, cycles: 2 })
    engine.setTransportOffset(1)
    await engine.evaluate('one-track')

    const sched = engine.getTrackSchedulers().get('$0')!
    const hap = sched.query(0, 4)[0] as unknown as { params?: { transportOps?: string[] } }
    // The offset is a scheduler-frame shift of the already-cut ribbon. Reversed,
    // it would shift the cut instead and the loop would sound the wrong bars.
    expect(hap.params?.transportOps).toEqual(['ribbon(3,2)', 'late(1)'])
    engine.dispose()
  })

  it('leaves the SONG frame unlooped, so the marks stay song-absolute', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setLoopRange({ startCycle: 3, cycles: 2 })
    engine.setTransportOffset(1)
    await engine.evaluate('one-track')

    const marks = engine.getTimelineEvents(4) as unknown as Array<{
      begin: number
      params?: { transportOps?: string[] }
    }>
    expect(marks.length).toBe(1)
    expect(marks[0].begin).toBe(0) // unmoved by either wrap
    expect(marks[0].params?.transportOps).toBeUndefined()
    engine.dispose()
  })

  it('applies NO ribbon with no loop armed (the control for the arms above)', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setTransportOffset(1)
    await engine.evaluate('one-track')

    const sched = engine.getTrackSchedulers().get('$0')!
    const hap = sched.query(0, 4)[0] as unknown as { params?: { transportOps?: string[] } }
    expect(hap.params?.transportOps).toEqual(['late(1)'])
    engine.dispose()
  })

  it('normalises an unusable range to no loop at all', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setLoopRange({ startCycle: 3, cycles: 0 }) // a drag that never moved
    expect(engine.getLoopRange()).toBeNull()
    await engine.evaluate('one-track')

    const sched = engine.getTrackSchedulers().get('$0')!
    const hap = sched.query(0, 4)[0] as unknown as { params?: { transportOps?: string[] } }
    expect(hap.params?.transportOps).toBeUndefined()
    engine.dispose()
  })

  it('clears the loop when handed null, and the next eval runs straight through', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setLoopRange({ startCycle: 3, cycles: 2 })
    await engine.evaluate('one-track')
    engine.setLoopRange(null)
    expect(engine.getLoopRange()).toBeNull()
    await engine.evaluate('one-track')

    const sched = engine.getTrackSchedulers().get('$0')!
    const hap = sched.query(0, 4)[0] as unknown as { params?: { transportOps?: string[] } }
    expect(hap.params?.transportOps).toBeUndefined()
    engine.dispose()
  })

  it('re-evaluating after a seek-back returns the marks to the same place', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setTransportOffset(3.5)
    await engine.evaluate('one-track')
    expect(engine.getTimelineEvents(4)[0].begin).toBe(0)
    engine.setTransportOffset(0)
    await engine.evaluate('one-track')
    expect(engine.getTimelineEvents(4)[0].begin).toBe(0)
    engine.dispose()
  })

  // #1197 — the BAND form. These assert the arc the engine actually passes to
  // `queryArc`, not a count of what came back: the mock echoes its arc into the
  // hap it returns, so `begin` IS the observed `startCycle`. That distinction is
  // the whole point — a band accessor wired to `queryArc(0, end)` returns events
  // that pass every content assertion while doing all the work the band was
  // added to avoid.
  it('queries the BAND it was given, not a prefix from zero', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-track')

    // The band form asks for [4, 8) — observed as the returned hap's own arc.
    const band = engine.getTimelineEventsBand(4, 8)
    expect(band.length).toBe(1)
    expect(band[0].begin).toBe(4)

    // The control: the prefix form over the same end cycle still asks from 0.
    // If the band method regressed to a prefix query these two would agree, and
    // this is the arm that separates them.
    const prefix = engine.getTimelineEvents(8)
    expect(prefix.length).toBe(1)
    expect(prefix[0].begin).toBe(0)
    expect(band[0].begin).not.toBe(prefix[0].begin)
    engine.dispose()
  })

  it('the band form stays in the SONG frame after a seek, exactly as the prefix form does', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setTransportOffset(2)
    await engine.evaluate('one-track')

    // Song-absolute: band [4, 8) is still song cycles 4..8, unshifted by the
    // seek. Reading `trackSchedulers` here instead would return 6, which is the
    // #863 defect one accessor over.
    expect(engine.getTimelineEventsBand(4, 8)[0].begin).toBe(4)
    expect(engine.getTrackSchedulers().get('$0')!.query(4, 8)[0].begin).toBe(6)
    engine.dispose()
  })

  it('returns no band events before the first evaluate', () => {
    const engine = new StrudelEngine()
    expect(engine.getTimelineEventsBand(4, 8)).toEqual([])
    engine.dispose()
  })

  it('normalises a degenerate band to a non-empty arc rather than querying backwards', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-track')
    // end <= start, negatives and non-finite inputs must not reach queryArc as
    // an inverted or NaN arc — Strudel's behaviour there is not ours to assume.
    expect(engine.getTimelineEventsBand(5, 5)[0].begin).toBe(5)
    expect(engine.getTimelineEventsBand(-3, 2)[0].begin).toBe(0)
    expect(engine.getTimelineEventsBand(Number.NaN, 4)[0].begin).toBe(0)
    engine.dispose()
  })
})

/**
 * #815 — `init()` is guarded by a flag set at the END of a long async body, so
 * without an in-flight promise every overlapping caller passes the gate and
 * runs the whole body. That is not merely wasteful: the body assigns
 * `this.repl` near its end, so the LAST init to finish replaces whatever repl
 * the engine was holding — including one that `play()` has already started. The
 * abandoned repl keeps producing sound while every transport reader sees a
 * scheduler that was never started, which is how #1185 / #1171 present.
 *
 * ⚠ THE CONCURRENT ARM IS NOT HERE, AND THAT IS A HARNESS LIMIT, NOT A CHOICE.
 * `init()` pulls its eight strudel modules with a single `Promise.all`, and
 * vitest's mocker is not re-entrant for concurrent dynamic imports of the same
 * mocked specifier — it evaluates the REAL module instead. Driving five
 * overlapping inits here dies inside `@strudel/mondo`, then `@strudel/soundfonts`,
 * on missing exports and CJS interop, never reaching the assertion. Stubbing far
 * enough to get past that means rebuilding the ecosystem inside this file.
 * The concurrent arm therefore lives in the browser, against the real modules:
 * `packages/app/tests/engine-init-race-playhead.spec.ts`.
 *
 * What these two DO guard is the fix's own risk. Sharing an in-flight promise
 * is only safe if a rejected one is dropped; a fix that caches the promise
 * unconditionally would leave every later caller re-awaiting a failure with no
 * way back, and the retry test below is what catches that.
 */
describe('StrudelEngine.init() guard (#815)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('a second init() after one has completed does not rebuild the repl', async () => {
    // Imported here, not at module top: the `@strudel/webaudio` factory closes
    // over MockPattern, and a top-level import of a mocked module runs that
    // factory before the class declaration is initialised.
    const { webaudioRepl } = await import('@strudel/webaudio')
    const engine = new StrudelEngine()
    await engine.init()
    await engine.init()
    expect(vi.mocked(webaudioRepl)).toHaveBeenCalledTimes(1)
    engine.dispose()
  })

  it('a FAILED init does not poison the engine — a retry can still initialise', async () => {
    const { webaudioRepl } = await import('@strudel/webaudio')
    const { evalScope } = await import('@strudel/core')
    const engine = new StrudelEngine()
    vi.mocked(evalScope).mockRejectedValueOnce(new Error('init blew up'))

    await expect(engine.init()).rejects.toThrow('init blew up')
    expect(vi.mocked(webaudioRepl)).toHaveBeenCalledTimes(0)

    await expect(engine.init()).resolves.toBeUndefined()
    expect(vi.mocked(webaudioRepl)).toHaveBeenCalledTimes(1)
    engine.dispose()
  })

  /**
   * #1218 — a failed REQUIRED step arrives branded, carrying which step it was.
   *
   * The app has to tell "the engine cannot start" apart from every other
   * runtime error to decide whether to offer a reload, and the only other way
   * to do that is to match the message text — a second copy of a rule that
   * lives in `createRequiredStep`, which drifts the first time the wording is
   * improved. This arm is what makes the brand a contract rather than a detail:
   * it drives the real producer, so a rename here reddens instead of silently
   * dropping the app back to the generic error path.
   */
  it('a failed required step is branded with the step that failed (#1218)', async () => {
    // Reached through a cast rather than the destructure the test above uses:
    // that spelling carries a known `evalScope does not exist on type` error
    // (#1204's 63-error baseline), and that count is being used as a control
    // elsewhere — a new arm should not quietly add to it.
    const core = (await import('@strudel/core')) as unknown as {
      evalScope: { mockRejectedValueOnce: (e: Error) => void }
    }
    const engine = new StrudelEngine()
    core.evalScope.mockRejectedValueOnce(new Error('init blew up'))

    const err: unknown = await engine.init().then(
      () => null,
      (e: unknown) => e,
    )
    expect(isBootStepFailure(err)).toBe(true)
    expect((err as BootStepFailure).bootStep).toBe('evalScope')
    // the underlying error is annotated, never replaced — the cause survives
    expect((err as Error).message).toBe('init blew up')
    // and an ordinary failure is NOT a boot-step failure, or the app would
    // offer a reload for a typo in the user's pattern
    expect(isBootStepFailure(new Error('reference error'))).toBe(false)
    engine.dispose()
  })
})

/**
 * #1186 — evaluating must never start the transport.
 *
 * Strudel's `evaluate(code, autostart = true, …)` (@strudel/core/repl.mjs:222)
 * forwards the flag into `cyclist.setPattern(pat, autostart)`, which starts the
 * clock (cyclist.mjs:123-126). Calling it with one argument therefore meant
 * every evaluate started playback — including the one the Song view runs to
 * draw its pre-play marks, so the app emitted notes with no user gesture.
 *
 * Starting playback belongs to `play()` (step 8 of the play lifecycle) and
 * nowhere else. The argument is easy to lose in a refactor and its default is
 * the wrong one, so it is pinned here rather than left to the browser arm — the
 * browser spec proves the CONSEQUENCE, this proves the CALL.
 */
describe('StrudelEngine.evaluate() does not autostart (#1186)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes autostart=false to the repl, so only play() can start the clock', async () => {
    const { webaudioRepl } = await import('@strudel/webaudio')
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-track')

    const repl = vi.mocked(webaudioRepl).mock.results[0]?.value as {
      evaluate: ReturnType<typeof vi.fn>
    }
    expect(repl.evaluate).toHaveBeenCalledWith('one-track', false)
    engine.dispose()
  })

  it('play() is what starts the scheduler', async () => {
    const { webaudioRepl } = await import('@strudel/webaudio')
    const engine = new StrudelEngine()
    await engine.init()

    const repl = vi.mocked(webaudioRepl).mock.results[0]?.value as {
      scheduler: { start: ReturnType<typeof vi.fn> }
    }
    await engine.evaluate('one-track')
    const beforePlay = repl.scheduler.start.mock.calls.length

    engine.play()
    expect(
      repl.scheduler.start.mock.calls.length,
      'play() must be the thing that starts the clock',
    ).toBe(beforePlay + 1)
    engine.dispose()
  })
})

// ---------------------------------------------------------------------------
// #1344 — `renderLoadedReport` renders what the last SUCCESSFUL evaluate
// loaded, in the frame that evaluate ran in. These arms pin its refusals, which
// are what keep it from bouncing the wrong thing without an error. The render
// itself is observed in the browser (`bounce-paths.spec.ts`, #1344 describe).
// The mock repl's evaluate resolves no pattern, so a load that got through
// every other check refuses as "plays nothing" — which is how these arms tell a
// load that happened from one that did not.
// ---------------------------------------------------------------------------
describe('StrudelEngine.renderLoadedReport refusals (#1344)', () => {
  it('refuses when nothing has been evaluated', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await expect(engine.renderLoadedReport(1)).rejects.toThrow(/no document is loaded/)
    engine.dispose()
  })

  it('a successful evaluate loads what the repl returned', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-track')
    await expect(engine.renderLoadedReport(1)).rejects.toThrow(/plays nothing/)
    engine.dispose()
  })

  it('a failed evaluate unloads the document, even after a good one', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-track')
    await engine.evaluate('error-code')
    await expect(engine.renderLoadedReport(1)).rejects.toThrow(/no document is loaded/)
    engine.dispose()
  })

  it('refuses a load evaluated with a seek', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setTransportOffset(2)
    await engine.evaluate('one-track')
    await expect(engine.renderLoadedReport(1)).rejects.toThrow(/seek or a loop/)
    engine.dispose()
  })

  it('refuses a load evaluated with a loop armed', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    engine.setLoopRange({ startCycle: 1, cycles: 2 })
    await engine.evaluate('one-track')
    await expect(engine.renderLoadedReport(1)).rejects.toThrow(/seek or a loop/)
    engine.dispose()
  })

  it('reads the frame the evaluate ran in, not the frame now', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-track')
    // Armed AFTER the load: the loaded pattern was not wrapped in either, so
    // this is not a reason to refuse.
    engine.setTransportOffset(2)
    engine.setLoopRange({ startCycle: 1, cycles: 2 })
    await expect(engine.renderLoadedReport(1)).rejects.toThrow(/plays nothing/)
    engine.dispose()
  })
})

// ---------------------------------------------------------------------------
// #1635 — `wrappedOutput` applies the alias step the offline render shares
// (`aliasSoundValue`). These arms pin that the live path still rewrites and
// still records the resolution after the step moved out of it. The render side
// is observed in the browser (`bounce-paths.spec.ts`, #1635 describe).
// ---------------------------------------------------------------------------
describe('StrudelEngine live output applies the shared alias step (#1635)', () => {
  const played = (s: string) => ({ whole: { begin: 0, end: 1 }, value: { s }, context: { locations: [] } })

  beforeEach(() => {
    capturedDefaultOutput = null
    vi.clearAllMocks()
  })

  it('a curated alias reaches the audio output rewritten, and is recorded', async () => {
    const { webaudioOutput } = await import('@strudel/webaudio')
    const engine = new StrudelEngine()
    await engine.init()
    await engine.evaluate('one-track')
    expect(capturedDefaultOutput, 'init() handed the repl no output — this arm tests nothing').not.toBeNull()
    await capturedDefaultOutput!(played('kick'), 0, 0.25, 1, 0)
    // The mock is typed from an untyped module, so name the one field read here.
    const calls = vi.mocked(webaudioOutput).mock.calls as unknown as Array<[{ value?: { s?: string } }]>
    expect({
      s: calls[0]?.[0]?.value?.s,
      resolutions: engine.getLastAliasResolutions(),
    }).toEqual({ s: 'bd', resolutions: [{ from: 'kick', to: 'bd' }] })
    engine.dispose()
  })

  it('a name the loaded sound map has is played as written', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wa: any = await import('@strudel/webaudio')
    const get = vi.mocked(wa.soundMap.get)
    get.mockImplementation(() => ({ kick: {} }))
    try {
      const engine = new StrudelEngine()
      await engine.init()
      await engine.evaluate('one-track')
      await capturedDefaultOutput!(played('kick'), 0, 0.25, 1, 0)
      expect({
        s: vi.mocked(wa.webaudioOutput).mock.calls[0]?.[0]?.value?.s,
        resolutions: engine.getLastAliasResolutions(),
      }).toEqual({ s: 'kick', resolutions: [] })
      engine.dispose()
    } finally {
      get.mockImplementation(() => ({}))
    }
  })
})

// #2064 — Stop's fade (#2058) acts on superdough's context and live-sound map,
// which a bounce borrows while it renders. The fade waits for the graph.
describe('StrudelEngine.stop() fades out on the live graph only (#2064)', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0))
  async function stopAllSpy() {
    const wa = (await import('@strudel/webaudio')) as unknown as { stopAllSounds: ReturnType<typeof vi.fn> }
    wa.stopAllSounds.mockClear()
    return wa.stopAllSounds
  }

  it('with no render, the fade happens at once', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    const stopAll = await stopAllSpy()
    engine.stop()
    expect(stopAll).toHaveBeenCalledTimes(1)
  })

  it('during a render, the fade waits until the render lets go of the graph', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    const stopAll = await stopAllSpy()
    let release!: () => void
    const render = withOfflineGraph(() => new Promise<void>((r) => (release = r)))
    await tick()
    engine.stop()
    const during = stopAll.mock.calls.length
    release()
    await render
    await tick()
    expect([during, stopAll.mock.calls.length]).toEqual([0, 1])
  })

  it('a Play pressed before the render lets go drops the fade, or it would cut the new notes', async () => {
    const engine = new StrudelEngine()
    await engine.init()
    const stopAll = await stopAllSpy()
    let release!: () => void
    const render = withOfflineGraph(() => new Promise<void>((r) => (release = r)))
    await tick()
    engine.stop()
    engine.play()
    release()
    await render
    await tick()
    expect(stopAll).not.toHaveBeenCalled()
  })
})
