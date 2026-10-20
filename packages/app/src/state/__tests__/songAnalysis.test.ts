/**
 * #1726 — the song analysis runs at the app, whether or not the Song timeline
 * is mounted, and hands the transport display the frame the timeline would
 * draw.
 *
 * The browser spec (`transport-wraps-drawer-closed.spec.ts`) sees the display.
 * These arms pin what it cannot: which result survives a fast re-evaluation,
 * and that another file's snapshot withdraws the previous song's frame at once
 * rather than once the new analysis lands, which in a browser is too quick to
 * catch between two readings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Snapshot = { source?: string; ir: unknown } | null
type Lane = { armByCycle?: unknown }

const snapshots = {
  current: null as Snapshot,
  listeners: new Set<(s: Snapshot) => void>(),
  publish(s: Snapshot) {
    this.current = s
    for (const l of this.listeners) l(s)
  },
}
/** Each call to analyzeSong, left pending until the test settles it. */
const runs: Array<{
  ir: unknown
  signal: { aborted: boolean }
  capCycles: number | undefined
  resolve: (a: unknown) => void
}> = []
/** What the structural walk reports: an arrangement unless a test says bare. */
let walkLanes: Lane[] = [{ armByCycle: [0] }]

vi.mock('@stave/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@stave/editor')>()),
  analyzeSong: (ir: unknown, opts: { signal: { aborted: boolean }; capCycles?: number }) =>
    new Promise((resolve) => runs.push({ ir, signal: opts.signal, capCycles: opts.capCycles, resolve })),
  getIRSnapshot: () => snapshots.current,
  subscribeIRSnapshot: (l: (s: Snapshot) => void) => {
    snapshots.listeners.add(l)
    return () => snapshots.listeners.delete(l)
  },
  signalDimensionsOf: () => [],
  structuralWalk: () => walkLanes,
}))
vi.mock('../../components/musicalTimeline/songCollector', () => ({
  createSongCollector: () => ({ collectFn: undefined, hasUnheardTrack: () => false }),
}))
const camera = {
  saved: null as { bareSpan?: number } | null,
  listeners: new Set<(c: { bareSpan?: number }) => void>(),
  save(c: { zoom: number; expanded: string[]; bareSpan?: number }) {
    this.saved = c
    for (const l of this.listeners) l(c)
  },
}
vi.mock('../../components/musicalTimeline/timelineCameraPersistence', () => ({
  loadTimelineCamera: () => camera.saved,
  subscribeTimelineCamera: (l: (c: { bareSpan?: number }) => void) => {
    camera.listeners.add(l)
    return () => camera.listeners.delete(l)
  },
}))

const { startSongAnalysis, readSongAnalysis, subscribeSongAnalysis } = await import('../songAnalysis')
const { readDrawnSongFrame, publishDrawnSongFrame } = await import('../drawnSongFrame')
const { getSongCycleLimit, setSongCycleLimit, SONG_CYCLE_LIMIT_DEFAULT } = await import('../songCycleLimit')

const analysis = (cycles: number, kind: 'arranged' | 'loop' | 'capped' = 'arranged') =>
  ({ displaySpan: { kind, cycles } }) as unknown
const flush = () => new Promise((r) => setTimeout(r, 0))

let stop: () => void
beforeEach(() => {
  snapshots.current = null
  snapshots.listeners.clear()
  runs.length = 0
  walkLanes = [{ armByCycle: [0] }]
  camera.saved = null
  camera.listeners.clear()
  publishDrawnSongFrame(null)
  setSongCycleLimit(SONG_CYCLE_LIMIT_DEFAULT)
})
afterEach(() => stop?.())

describe('song analysis at the app (#1726)', () => {
  it('analyzes a snapshot published before it started, and hands over its frame', async () => {
    snapshots.current = { source: 'a', ir: 'IR-a' }
    stop = startSongAnalysis({})
    expect(runs).toHaveLength(1)
    runs[0].resolve(analysis(8))
    await flush()
    expect(readSongAnalysis()).toEqual(analysis(8))
    expect(readDrawnSongFrame()).toEqual({ window: { originCycle: 0, spanCycles: 8 }, looping: true })
  })

  it('keeps only the latest re-evaluation: an earlier run that lands late is dropped', async () => {
    stop = startSongAnalysis({})
    snapshots.publish({ source: 'a', ir: 'IR-1' })
    snapshots.publish({ source: 'a', ir: 'IR-2' })
    expect(runs[0].signal.aborted).toBe(true)
    runs[1].resolve(analysis(4))
    runs[0].resolve(analysis(8))
    await flush()
    expect(readSongAnalysis()).toEqual(analysis(4))
  })

  it('a re-evaluation of the SAME file keeps the previous result until the new one lands', async () => {
    stop = startSongAnalysis({})
    snapshots.publish({ source: 'a', ir: 'IR-1' })
    runs[0].resolve(analysis(8))
    await flush()
    snapshots.publish({ source: 'a', ir: 'IR-2' })
    expect(readSongAnalysis()).toEqual(analysis(8))
    expect(readDrawnSongFrame()?.window.spanCycles).toBe(8)
  })

  it("ANOTHER file's snapshot withdraws the previous song's frame at once", async () => {
    stop = startSongAnalysis({})
    snapshots.publish({ source: 'a', ir: 'IR-a' })
    runs[0].resolve(analysis(8))
    await flush()
    snapshots.publish({ source: 'b', ir: 'IR-b' })
    // The new file's analysis has not landed: nothing is known about its length.
    expect(readSongAnalysis()).toBeNull()
    expect(readDrawnSongFrame()).toBeNull()
    runs[1].resolve(analysis(2))
    await flush()
    expect(readDrawnSongFrame()?.window.spanCycles).toBe(2)
  })

  it('a snapshot with no IR, and stopping, withdraw the analysis and the frame', async () => {
    stop = startSongAnalysis({})
    snapshots.publish({ source: 'a', ir: 'IR-a' })
    runs[0].resolve(analysis(8))
    await flush()
    snapshots.publish({ source: 'a', ir: null })
    expect(readSongAnalysis()).toBeNull()
    expect(readDrawnSongFrame()).toBeNull()
    snapshots.publish({ source: 'a', ir: 'IR-a2' })
    runs[1].resolve(analysis(8))
    await flush()
    stop()
    expect(readSongAnalysis()).toBeNull()
    expect(readDrawnSongFrame()).toBeNull()
    expect(snapshots.listeners.size).toBe(0)
  })

  it('tells subscribers of every change', async () => {
    const seen = vi.fn()
    const unsubscribe = subscribeSongAnalysis(seen)
    stop = startSongAnalysis({})
    snapshots.publish({ source: 'a', ir: 'IR-a' })
    runs[0].resolve(analysis(8))
    await flush()
    expect(seen).toHaveBeenCalled()
    unsubscribe()
  })
})

describe('how far the analysis looks (#2109)', () => {
  it("passes the user's limit, 64 cycles by default, not the analysis's own 256", () => {
    expect(getSongCycleLimit()).toBe(64)
    snapshots.current = { source: 'a', ir: 'IR-a' }
    stop = startSongAnalysis({})
    expect(runs.map((r) => r.capCycles)).toEqual([64])
  })

  it('a new limit re-runs the SAME document at once, keeping its result until the new one lands', async () => {
    snapshots.current = { source: 'a', ir: 'IR-a' }
    stop = startSongAnalysis({})
    runs[0].resolve(analysis(64, 'capped'))
    await flush()
    setSongCycleLimit(128)
    expect(runs.map((r) => r.capCycles)).toEqual([64, 128])
    expect(runs[1].ir).toBe('IR-a')
    expect(readSongAnalysis()).toEqual(analysis(64, 'capped'))
    runs[1].resolve(analysis(96, 'loop'))
    await flush()
    expect(readSongAnalysis()).toEqual(analysis(96, 'loop'))
  })

  it('a limit set mid-analysis aborts the run in flight', () => {
    snapshots.current = { source: 'a', ir: 'IR-a' }
    stop = startSongAnalysis({})
    setSongCycleLimit(32)
    expect(runs[0].signal.aborted).toBe(true)
    expect(runs[1].capCycles).toBe(32)
  })

  it('after stopping, a new limit starts nothing', () => {
    snapshots.current = { source: 'a', ir: 'IR-a' }
    startSongAnalysis({})()
    setSongCycleLimit(32)
    expect(runs).toHaveLength(1)
  })
})

describe('the frame the display reads (#1725, #1726)', () => {
  it("the timeline's frame, while it is mounted, wins over the analysis's", async () => {
    stop = startSongAnalysis({})
    snapshots.publish({ source: 'a', ir: 'IR-a' })
    runs[0].resolve(analysis(8))
    await flush()
    // A bare loop the user has dragged wider: only the timeline knows, live.
    const drawn = { window: { originCycle: 0, spanCycles: 12 }, looping: true }
    publishDrawnSongFrame(drawn)
    expect(readDrawnSongFrame()).toBe(drawn)
    publishDrawnSongFrame(null)
    expect(readDrawnSongFrame()?.window.spanCycles).toBe(8)
  })

  it('a bare loop is floored to four cycles, as the timeline draws it', async () => {
    walkLanes = [{}]
    stop = startSongAnalysis({})
    snapshots.publish({ source: 'a', ir: 'IR-a' })
    runs[0].resolve(analysis(1, 'loop'))
    await flush()
    expect(readDrawnSongFrame()).toEqual({ window: { originCycle: 0, spanCycles: 4 }, looping: true })
  })

  it("a bare loop the user resized is framed at the resized length, even a resize saved after the analysis (#1774)", async () => {
    walkLanes = [{}]
    camera.saved = { bareSpan: 6 }
    stop = startSongAnalysis({})
    snapshots.publish({ source: 'a', ir: 'IR-a' })
    runs[0].resolve(analysis(1, 'loop'))
    await flush()
    expect(readDrawnSongFrame()?.window.spanCycles).toBe(6)
    // Dragged to 7 in the timeline, then the drawer closes: no new analysis.
    camera.save({ zoom: 1, expanded: [], bareSpan: 7 })
    expect(readDrawnSongFrame()?.window.spanCycles).toBe(7)
    stop()
    expect(camera.listeners.size).toBe(0)
  })

  it('a span the analysis gave up at does not loop', async () => {
    stop = startSongAnalysis({})
    snapshots.publish({ source: 'a', ir: 'IR-a' })
    runs[0].resolve(analysis(256, 'capped'))
    await flush()
    expect(readDrawnSongFrame()?.looping).toBe(false)
  })
})
