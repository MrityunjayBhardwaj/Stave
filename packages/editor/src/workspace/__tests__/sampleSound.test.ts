/**
 * sampleSound — unit tests (editor-fixes Task 5).
 *
 * The critical Task 5 invariant: the sample sound publishes a
 * complete enough payload that a p5 sketch pinned to `__sample__`
 * can render BOTH scheduler-driven viz (via stave.scheduler.query)
 * AND analyser-driven viz (via stave.analyser).
 *
 * These tests exercise the virtual `SampleSoundScheduler` in
 * isolation with a fake ctx object — no real AudioContext needed.
 * The scheduler's query logic is pure pattern math and should be
 * fully deterministic given a time range.
 *
 * The actual audio graph (oscillator + LFO + analyser) and the
 * bus publication path are not covered here because they depend
 * on a real Web Audio implementation. The scheduler is the piece
 * Task 5 specifically adds, and the piece most likely to drift.
 */

import { describe, it, expect } from 'vitest'
import { SampleSoundScheduler } from '../sampleSound'
import type { IREvent } from '../../codeView/ir/IREvent'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Build a scheduler backed by a mutable `currentTime` container.
 * Tests mutate `ctx.currentTime` to simulate the AudioContext clock
 * advancing between `now()` calls.
 */
function makeScheduler(initialTime = 0) {
  const ctx = { currentTime: initialTime }
  const scheduler = new SampleSoundScheduler(ctx)
  return { scheduler, ctx }
}

// ---------------------------------------------------------------------------
// now()
// ---------------------------------------------------------------------------

describe('SampleSoundScheduler.now', () => {
  it('forwards ctx.currentTime', () => {
    const { scheduler, ctx } = makeScheduler(0)
    expect(scheduler.now()).toBe(0)
    ctx.currentTime = 1.25
    expect(scheduler.now()).toBe(1.25)
    ctx.currentTime = 42
    expect(scheduler.now()).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// query() — pattern math
// ---------------------------------------------------------------------------

describe('SampleSoundScheduler.query', () => {
  // A-minor arpeggio: A3(57), C4(60), E4(64), G4(67)
  // Cycle = 2s, note duration = 0.5s
  // Cycle 0 notes: 57@[0,0.5), 60@[0.5,1), 64@[1,1.5), 67@[1.5,2)
  // Cycle 1 notes: same notes, offset by +2s

  it('returns the four notes in the first cycle [0, 2)', () => {
    const { scheduler } = makeScheduler()
    const events = scheduler.query(0, 2)
    expect(events.length).toBe(4)
    const notes = events.map((e) => e.note)
    expect(notes).toEqual([57, 60, 64, 67])
    const begins = events.map((e) => e.begin)
    expect(begins).toEqual([0, 0.5, 1, 1.5])
  })

  it('returns the first note alone when the range covers only [0, 0.5)', () => {
    const { scheduler } = makeScheduler()
    const events = scheduler.query(0, 0.5)
    expect(events.length).toBe(1)
    expect(events[0].note).toBe(57)
    expect(events[0].begin).toBe(0)
    expect(events[0].end).toBe(0.5)
  })

  it('includes notes whose window partially overlaps the query range', () => {
    const { scheduler } = makeScheduler()
    // Range [0.25, 0.75) — overlaps note0 (ends at 0.5) and note1
    // (begins at 0.5). Both should be included.
    const events = scheduler.query(0.25, 0.75)
    expect(events.map((e) => e.note)).toEqual([57, 60])
  })

  it('spans cycle boundaries seamlessly', () => {
    const { scheduler } = makeScheduler()
    // Range [1.5, 2.5) — last note of cycle 0 (G4 at [1.5, 2)) and
    // first note of cycle 1 (A3 at [2, 2.5)).
    const events = scheduler.query(1.5, 2.5)
    expect(events.length).toBe(2)
    expect(events[0].note).toBe(67)
    expect(events[0].begin).toBe(1.5)
    expect(events[1].note).toBe(57)
    expect(events[1].begin).toBe(2)
  })

  it('returns events across multiple full cycles', () => {
    const { scheduler } = makeScheduler()
    // Three full cycles = 12 notes (4 notes × 3 cycles).
    const events = scheduler.query(0, 6)
    expect(events.length).toBe(12)
    // Each cycle's first note is A3 (57).
    const firstNotes = events.filter((_, i) => i % 4 === 0).map((e) => e.note)
    expect(firstNotes).toEqual([57, 57, 57])
  })

  it('returns [] for an empty range (begin >= end)', () => {
    const { scheduler } = makeScheduler()
    expect(scheduler.query(1, 1)).toEqual([])
    expect(scheduler.query(2, 1)).toEqual([])
  })

  it('returns [] for a range that falls strictly between notes', () => {
    // Note boundaries are exact — a query range entirely inside a
    // single note should return that note, not an empty list.
    const { scheduler } = makeScheduler()
    // Range [0.1, 0.4) is wholly inside note 0 [0, 0.5).
    const events = scheduler.query(0.1, 0.4)
    expect(events.length).toBe(1)
    expect(events[0].note).toBe(57)
  })

  it('handles negative time ranges (pre-start queries)', () => {
    // The pianoroll sketch queries `scheduler.now() - 3` for the
    // window behind the playhead. If now() is small, the query
    // begin can be negative — the scheduler must handle that
    // without throwing or returning garbage. Negative cycles
    // still produce correctly-aligned events.
    const { scheduler } = makeScheduler()
    const events = scheduler.query(-2, 0)
    // Cycle -1 spans [-2, 0) — four notes at begins -2, -1.5, -1, -0.5.
    expect(events.length).toBe(4)
    expect(events[0].begin).toBe(-2)
    expect(events[events.length - 1].begin).toBe(-0.5)
  })

  it('populates IREvent fields the pianoroll reads (note, begin, end, freq, gain, velocity)', () => {
    const { scheduler } = makeScheduler()
    const [first] = scheduler.query(0, 0.5)
    expect(first).toMatchObject<Partial<IREvent>>({
      begin: 0,
      end: 0.5,
      endClipped: 0.5,
      note: 57,
      gain: 1,
      velocity: 1,
      color: null,
      type: 'synth',
    })
    // freq should equal 440 * 2^((57 - 69) / 12) = ~220 Hz (A3).
    expect(first.freq).toBeCloseTo(220, 1)
  })

  it('tags every event with the sample sound source id', () => {
    // Consumers that filter haps by source id (e.g., only show
    // notes from a specific pattern track) rely on `s` and
    // `trackId` being populated. For the sample sound we fill
    // both with the reserved SAMPLE_SOUND_SOURCE_ID so any
    // filtering logic behaves consistently.
    const { scheduler } = makeScheduler()
    const events = scheduler.query(0, 2)
    for (const e of events) {
      expect(e.s).toBe('__sample__')
      expect(e.trackId).toBe('__sample__')
    }
  })
})
