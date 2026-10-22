/**
 * `createEndOfSongWatcher` — the comparison that ends playback (#1388).
 *
 * ── WHY THE EXTENTS ARE REAL, NOT LITERALS ───────────────────────────────────
 * Every arm below gets its `SongExtent` from the REAL `songExtent` walking a
 * real `PatternIR`, both from `@stave/editor` (as `songLength.test.ts` next
 * door). Hand-written `{ kind: 'opaque' }` literals would pin these arms to my
 * idea of the type rather than to what the walk actually produces, and `opaque`
 * is exactly the kind that must not drift: it is the one that would truncate a
 * real song if it regressed into the `arranged` branch.
 *
 * The clock and the transport ARE stubs, deliberately. What is under test is
 * WHEN the comparison fires, so the position has to be a sequence this file
 * controls; the runtime's own clock is pinned by `LiveCodingRuntime`'s suite and
 * observed for real in the app (#1388's listening pass).
 */
import { describe, it, expect } from 'vitest'
import { IR, type PatternIR } from '@stave/editor'
import { songExtent } from '@stave/editor'
import type { SongExtent } from '@stave/editor'
import {
  createEndOfSongWatcher,
  hasDefiniteEnd,
  sameExtent,
  type EndOfSongDeps,
} from '../songTermination'

const bd = IR.play('bd')
const arm = (weight: number, pattern: PatternIR = bd) => ({ weight, pattern })

/** A 16-cycle song: `arrange([4, intro], [8, verse], [4, outro])`. */
const ARRANGED = songExtent(IR.arrange('arrange', [arm(4), arm(8), arm(4)]))
/** No arrangement anywhere — 96.7% of real documents. */
const LOOPING = songExtent(bd)
/** An arrangement under a transform Stave could not read. */
const OPAQUE = songExtent({
  tag: 'Code',
  code: '.someUnknownMethod(2)',
  lang: 'strudel',
  via: {
    method: 'someUnknownMethod',
    args: '2',
    callSiteRange: [0, 0],
    inner: IR.arrange('arrange', [arm(4), arm(8), arm(4)]),
  },
} as PatternIR)


/** A one-file rig: set the position, tick, and see whether it stopped. */
function rig(
  extent: SongExtent | null | undefined,
  opts: { stopAtEnd?: boolean; fileId?: string } = {},
) {
  const fileId = opts.fileId ?? 'f1'
  const state = {
    playing: true,
    position: 0 as number | null,
    extent,
    stopAtEnd: opts.stopAtEnd ?? false,
    stops: [] as string[],
  }
  const deps: EndOfSongDeps = {
    playingFileIds: () => (state.playing ? [fileId] : []),
    extentOf: () => state.extent,
    positionOf: () => state.position,
    isStopAtEnd: () => state.stopAtEnd,
    stop: (id) => {
      state.stops.push(id)
      state.playing = false
      state.position = null
    },
  }
  const watcher = createEndOfSongWatcher(deps)
  /** Play through the given positions, one tick each. */
  const play = (...positions: (number | null)[]) => {
    for (const p of positions) {
      state.position = p
      watcher.tick()
    }
  }
  return { state, watcher, play }
}

describe('the fixtures themselves', () => {
  it('really are one of each kind', () => {
    // Without this, a change in `songExtent` that stopped producing `opaque`
    // would leave every arm below green while testing nothing.
    expect(ARRANGED).toEqual({ kind: 'arranged', cycles: 16 })
    expect(LOOPING).toEqual({ kind: 'loop' })
    expect(OPAQUE).toEqual({ kind: 'opaque' })
  })
})

describe('hasDefiniteEnd — the one rule two consumers share', () => {
  it('is true only for a measurable arrangement', () => {
    expect(hasDefiniteEnd(ARRANGED)).toBe(true)
    expect(hasDefiniteEnd(LOOPING)).toBe(false)
    expect(hasDefiniteEnd(OPAQUE)).toBe(false)
    expect(hasDefiniteEnd(null)).toBe(false)
    expect(hasDefiniteEnd(undefined)).toBe(false)
  })

  it('a degenerate cycle count is NOT a definite end', () => {
    // A zero or NaN length would make `floor(pos / cycles)` meaningless, and
    // the failure would be a song that stops on its first tick.
    expect(hasDefiniteEnd({ kind: 'arranged', cycles: 0 })).toBe(false)
    expect(hasDefiniteEnd({ kind: 'arranged', cycles: Number.NaN })).toBe(false)
    expect(
      hasDefiniteEnd({ kind: 'arranged', cycles: Number.POSITIVE_INFINITY }),
    ).toBe(false)
  })

  it('refuses an OPAQUE extent even if it were to carry a length', () => {
    // ⚠ THE GUARD MUST BE THE KIND, NOT THE ABSENCE OF `cycles`. Today `opaque`
    // has no `cycles` field, so `Number.isFinite(undefined)` rejects it even
    // with the kind check deleted — which means deleting that check leaves
    // every other arm here GREEN and the protection reads as tested when it is
    // not. Measured: a break-test run with `extent.kind === 'arranged'` removed
    // passed 18/18 before this arm existed. If `SongExtent` ever gains an "it
    // would have been N" length on `opaque`, that accident evaporates and a
    // 3:28 song gets truncated — #1373, exactly.
    const withLength = { kind: 'opaque', cycles: 16 } as unknown as SongExtent
    expect(hasDefiniteEnd(withLength)).toBe(false)
  })
})

describe('sameExtent — the no-op gate on the render path', () => {
  it('a LENGTH change is a change, even at the same kind', () => {
    // The case the gate exists for: an edit that only widens the arrangement
    // moves neither the error nor the BPM, so without this the old length
    // survives and the song stops where it used to end.
    expect(sameExtent(ARRANGED, { kind: 'arranged', cycles: 16 })).toBe(true)
    expect(sameExtent(ARRANGED, { kind: 'arranged', cycles: 24 })).toBe(false)
  })

  it('separates the kinds, and absence from presence', () => {
    expect(sameExtent(LOOPING, LOOPING)).toBe(true)
    expect(sameExtent(LOOPING, OPAQUE)).toBe(false)
    expect(sameExtent(ARRANGED, LOOPING)).toBe(false)
    expect(sameExtent(null, null)).toBe(true)
    expect(sameExtent(null, undefined)).toBe(true)
    expect(sameExtent(null, LOOPING)).toBe(false)
    expect(sameExtent(ARRANGED, null)).toBe(false)
  })
})

describe('an ARRANGED document LOOPS unless asked to stop (#1396)', () => {
  it('⚠ THE DEFAULT — nothing stops a fresh arranged document', () => {
    // The arm #1396 exists for. Nothing is set on this rig; it is an arranged
    // document exactly as the app hands one over. Under #1388 this stopped at
    // 16, and that was the wrong way round — every reference DAW runs past the
    // end of the arrangement, and a document should not gain the ability to
    // stop under someone mid-edit just by acquiring an `arrange(...)`.
    const { state, play } = rig(ARRANGED)
    play(0, 8, 16.1, 24, 32.1, 48.1, 64.1)
    expect(state.stops).toEqual([])
  })

  it('stops on the tick that crosses its last cycle, once asked to', () => {
    const { state, play } = rig(ARRANGED, { stopAtEnd: true })
    play(0, 4, 8, 12, 15.9)
    expect(state.stops).toEqual([])
    play(16.02)
    expect(state.stops).toEqual(['f1'])
  })

  it('does not stop before the end even after many samples', () => {
    const { state, play } = rig(ARRANGED, { stopAtEnd: true })
    for (let c = 0; c < 16; c += 0.25) play(c)
    expect(state.stops).toEqual([])
  })
})

describe('a document with no trustworthy end keeps looping', () => {
  it('LOOP — no arrangement bounds it, so there is nothing to end', () => {
    const { state, play } = rig(LOOPING)
    play(0, 8, 16, 24, 32, 64)
    expect(state.stops).toEqual([])
  })

  it('OPAQUE — an arrangement is present but its length cannot be trusted', () => {
    // The arm that matters most. `opaque` carries a real `arrange(...)`
    // underneath, and reading it as `arranged` is exactly how #1373 offered a
    // 3:28 song an 0:08 bounce. It must keep playing past every multiple of the
    // length it would have reported (16).
    const { state, play } = rig(OPAQUE)
    play(0, 8, 16, 24, 32, 64)
    expect(state.stops).toEqual([])
  })

  it('OPAQUE stays looping even if the extent were to carry a length', () => {
    // The running twin of the `hasDefiniteEnd` arm above — the predicate being
    // right is worth nothing if the watcher does not consult it.
    const withLength = { kind: 'opaque', cycles: 16 } as unknown as SongExtent
    const { state, play } = rig(withLength)
    play(0, 8, 16.1, 32.1, 64.1)
    expect(state.stops).toEqual([])
  })

  it('UNKNOWN — nothing measured yet (pre-eval, non-Strudel)', () => {
    const nothing = rig(null)
    nothing.play(0, 16, 32)
    expect(nothing.state.stops).toEqual([])

    const notYet = rig(undefined)
    notYet.play(0, 16, 32)
    expect(notYet.state.stops).toEqual([])
  })
})

describe('the end-behaviour toggle', () => {
  it('left alone, an arranged document keeps looping', () => {
    const { state, play } = rig(ARRANGED, { stopAtEnd: false })
    play(0, 8, 16, 24, 32, 48)
    expect(state.stops).toEqual([])
  })

  it('cannot make a document with no end stop, even when switched on', () => {
    // `stopAtEnd` is only ever offered for a document that HAS an end; this
    // pins that the watcher ignores it otherwise, so a flag left behind by an
    // edit cannot stop a document that has nowhere to stop.
    const { state, play } = rig(LOOPING, { stopAtEnd: true })
    play(0, 16, 32, 64)
    expect(state.stops).toEqual([])
  })

  it('switching it ON mid-flight stops at the NEXT end, not instantly', () => {
    // Starts LOOPING, which is the default, and runs well past `cycles` before
    // the user asks it to stop. A bare `position >= cycles` would then stop on
    // the very next tick, cutting the pass the user is listening to.
    const { state, play } = rig(ARRANGED)
    play(0, 8, 16, 24, 32, 36)
    expect(state.stops).toEqual([])
    state.stopAtEnd = true
    play(40, 44, 47.9)
    expect(state.stops).toEqual([])
    play(48.1)
    expect(state.stops).toEqual(['f1'])
  })

  it('switching it back OFF mid-flight lets the song carry on', () => {
    const { state, play } = rig(ARRANGED, { stopAtEnd: true })
    play(0, 8, 15.9)
    state.stopAtEnd = false
    play(16.1, 32.1, 48.1, 64.1)
    expect(state.stops).toEqual([])
  })
})

describe('the baseline — why a pass counter and not `position >= cycles`', () => {
  it('a run that STARTS past the end does not stop on its first tick', () => {
    // `stop()` resets the scheduler cursor but not an earlier seek's transport
    // offset, so the first sample of a run is not guaranteed to be near zero.
    // Stopping here would make Play look broken — the failure the user cannot
    // diagnose. Degrading to "stops one pass later" is the safe direction.
    const { state, play } = rig(ARRANGED, { stopAtEnd: true })
    play(37)
    expect(state.stops).toEqual([])
    play(40, 47.9)
    expect(state.stops).toEqual([])
    play(48.1)
    expect(state.stops).toEqual(['f1'])
  })

  it('the SONG STARTING is not the song ending — a negative pre-roll', () => {
    // ⚠ THE ARM THAT WAS MISSING, and the bug shipped past 20 green unit tests
    // because of it. These are the REAL numbers, read out of the running app's
    // own watcher: the first sample of a run is `-0.017` (the scheduler clock
    // sits a hair behind the transport origin at the instant playback starts),
    // which floors to pass -1; the next sample `+0.007` is pass 0. That is an
    // increase in the pass number, so a pure crossing rule stopped the song
    // ~50ms after Play and the transport went straight back to "Play".
    //
    // Every arm above starts its position sequence at exactly 0 or higher,
    // which is why none of them could see it. The end of a song is a POSITIVE
    // multiple of the length.
    const { state, play } = rig(ARRANGED, { stopAtEnd: true })
    play(-0.017, 0.007, 0.05, 1, 4, 8, 15.9)
    expect(state.stops).toEqual([])
    play(16.1)
    expect(state.stops).toEqual(['f1'])
  })

  it('a run that begins well before zero still ends at a real boundary', () => {
    // The general form: no crossing below pass 1 is an ending, however many of
    // them there are.
    const { state, play } = rig(ARRANGED, { stopAtEnd: true })
    play(-40, -30, -20, -10, -0.5, 0.5, 8, 15.9)
    expect(state.stops).toEqual([])
    play(16.1)
    expect(state.stops).toEqual(['f1'])
  })

  it('a backwards seek re-arms rather than disarming', () => {
    const { state, play } = rig(ARRANGED, { stopAtEnd: true })
    play(0, 12)
    play(2, 8, 15) // user seeks back to cycle 2, then plays on
    expect(state.stops).toEqual([])
    play(16.5)
    expect(state.stops).toEqual(['f1'])
  })

  it('a null position holds the baseline instead of resetting it', () => {
    // Resetting on every blip would push the end one pass further away each
    // time and the song would never end.
    const { state, play } = rig(ARRANGED, { stopAtEnd: true })
    play(0, 8, null, null, 12, null)
    expect(state.stops).toEqual([])
    play(16.1)
    expect(state.stops).toEqual(['f1'])
  })

  it('a live edit that changes the arrangement length re-baselines', () => {
    // Comparing a pass counted in 16ths against one counted in 8ths would stop
    // playback at an arbitrary moment right after the edit.
    const { state, watcher } = rig(ARRANGED, { stopAtEnd: true })
    state.position = 12
    watcher.tick()
    state.extent = { kind: 'arranged', cycles: 8 } // user shortened the song
    state.position = 12.1
    watcher.tick()
    expect(state.stops).toEqual([])
    state.position = 16.1 // crosses the new 8-cycle grid at pass 2
    watcher.tick()
    expect(state.stops).toEqual(['f1'])
  })

  it('a new run re-baselines from its own first sample', () => {
    const { state, watcher } = rig(ARRANGED, { stopAtEnd: true })
    state.position = 0
    watcher.tick()
    state.position = 16.1
    watcher.tick()
    expect(state.stops).toEqual(['f1'])

    // Stop cleared `playing`; press Play again and land past the end again.
    state.playing = true
    state.position = 30
    watcher.tick()
    expect(state.stops).toEqual(['f1']) // baseline only — no second stop
    state.position = 32.1
    watcher.tick()
    expect(state.stops).toEqual(['f1', 'f1'])
  })

  it('a document that BECOMES arranged starts counting from where it is', () => {
    const { state, watcher } = rig(LOOPING, { stopAtEnd: true })
    state.position = 40
    watcher.tick()
    state.extent = ARRANGED // user pastes in an `arrange(...)`
    state.position = 41
    watcher.tick()
    expect(state.stops).toEqual([])
    state.position = 48.1
    watcher.tick()
    expect(state.stops).toEqual(['f1'])
  })
})

describe('several files playing at once', () => {
  it('stops only the one that reached its own end', () => {
    const extents: Record<string, SongExtent> = {
      song: ARRANGED,
      loop: LOOPING,
    }
    const positions: Record<string, number> = { song: 0, loop: 0 }
    const stops: string[] = []
    const playing = new Set(['song', 'loop'])
    const watcher = createEndOfSongWatcher({
      playingFileIds: () => [...playing],
      extentOf: (id) => extents[id] ?? null,
      positionOf: (id) => positions[id] ?? null,
      isStopAtEnd: () => true,
      stop: (id) => {
        stops.push(id)
        playing.delete(id)
      },
    })

    watcher.tick()
    positions.song = 16.1
    positions.loop = 16.1
    watcher.tick()
    expect(stops).toEqual(['song'])

    positions.loop = 64
    watcher.tick()
    expect(stops).toEqual(['song'])
  })
})
