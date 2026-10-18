/**
 * `measureSongLength` — the branch that decides what a bounce can offer (#1365).
 *
 * ── WHY THESE ARMS AND NOT A MOCK OF `analyzeSong` ───────────────────────────
 * The whole value of this module is that it distinguishes a MEASURED period from
 * a horizon the analysis gave up at, and that distinction is made by
 * `analyzeSong`. Stubbing it would leave these arms asserting that a switch
 * statement routes three literals — green with the real decision entirely
 * absent. So the real `songExtent` and the real `analyzeSong` are imported from
 * `@stave/editor` and driven with synthetic onsets.
 *
 * The collector is the one injected stub. Its correctness is already pinned next
 * door by `songCollector.test.ts`; re-testing the band rule here would duplicate
 * that, and what these arms need is control over the ONSETS analysis sees.
 */
import { describe, it, expect } from 'vitest'
import { IR, type PatternIR } from '@stave/editor'
import { songExtent } from '@stave/editor'
import { analyzeSong, songEnd, songEndOf } from '@stave/editor'
import { parseStrudel } from '@stave/editor'
import type { IREvent } from '@stave/editor'
import {
  measureSongLength,
  songLoopCycles,
  cyclesToSeconds,
  bounceOffers,
  formatDuration,
  MAX_LIVE_BOUNCE_SECONDS,
  MAX_OFFLINE_BOUNCE_SECONDS,
  type SongLengthDeps,
  type BounceSizing,
  type SongSources,
} from '../songLength'

const bd = IR.play('bd')
const arm = (weight: number, pattern: PatternIR = bd) => ({ weight, pattern })

function ev(begin: number, s: string): IREvent {
  return {
    begin,
    end: begin + 0.25,
    endClipped: begin + 0.25,
    note: null,
    freq: null,
    s,
    trackId: 'd1',
  } as unknown as IREvent
}

/**
 * Deps wired to the REAL editor functions, with a collector yielding `onsets`
 * clipped to the requested band. `analyzeSong` walks adjacent bands as its
 * horizon grows, so the band filter matters: without it every onset would be
 * returned for every band and the fingerprints would be meaningless.
 */
function depsWith(onsets: IREvent[]): SongLengthDeps {
  return {
    analyzeSong,
    createCollector: () => ({
      collectFn: (startCycle, endCycle) =>
        onsets.filter((e) => e.begin >= startCycle && e.begin < endCycle),
      hasUnheardTrack: undefined,
    }),
  }
}

/**
 * Both readings of the same IR — the shape every pre-#1373 caller assumed.
 * Only tests about the STRUCTURE/MEASUREMENT split pass the two apart.
 */
function both(ir: PatternIR): SongSources {
  return { end: songEnd(ir), analysis: ir }
}

/** `n` cycles of the SAME sound — fingerprints repeat, so a period is findable. */
function repeating(cycles: number): IREvent[] {
  return Array.from({ length: cycles }, (_, c) => ev(c, 'bd'))
}

/** Every cycle different, so no fingerprint ever repeats and analysis gives up. */
function everChanging(cycles: number): IREvent[] {
  return Array.from({ length: cycles }, (_, c) => ev(c, `s${c}`))
}

describe('measureSongLength — the three answers a bounce can act on', () => {
  it('a document with no IR is `no-document`, not a zero-length song', async () => {
    // The same distinction `songExtent` is typed for, one layer up: a bounce
    // must not read "nothing to measure" as "measured zero".
    expect(await measureSongLength({ end: null, analysis: null }, depsWith([]))).toEqual({
      kind: 'unknown',
      why: 'no-document',
    })
  })

  it('an arrangement gives a definite length, WITHOUT consulting the analysis', async () => {
    const ir = IR.arrange('arrange', [arm(4), arm(8), arm(16)])
    // Deps whose analyzeSong would throw if reached — the arrangement branch
    // must not depend on anything having been evaluated or heard.
    const deps: SongLengthDeps = {
      analyzeSong: () => {
        throw new Error('analyzeSong must not be reached for an arrangement')
      },
      createCollector: () => ({ collectFn: undefined, hasUnheardTrack: undefined }),
    }
    expect(await measureSongLength({ end: songEnd(ir), analysis: null }, deps)).toEqual({
      kind: 'arranged',
      cycles: 28,
    })
  })

  it('an arrangement under an automation offers the length the SONG takes (#1580)', async () => {
    // Four bars of structure under a three-step gain: the structure ends at 4,
    // the song first comes back round at 12, and a bounce of 4 would loop
    // `.2 .5 .9 .2`. Still without consulting the analysis — the fold is read
    // off the parsed document, so this branch keeps answering before a note has
    // been evaluated, which is the property the arm above pins.
    const end = songEndOf('arrange([2,s("bd*2")],[2,s("hh*4")]).gain("<.2 .5 .9>")')
    const deps: SongLengthDeps = {
      analyzeSong: () => {
        throw new Error('analyzeSong must not be reached for an arrangement')
      },
      createCollector: () => ({ collectFn: undefined, hasUnheardTrack: undefined }),
    }
    expect(await measureSongLength({ end, analysis: null }, deps)).toEqual({
      kind: 'arranged',
      cycles: 12,
    })
    // The control, same document, a period that divides: the offer must NOT move.
    const divides = songEndOf('arrange([2,s("bd*2")],[2,s("hh*4")]).gain("<.2 .5>")')
    expect(await measureSongLength({ end: divides, analysis: null }, deps)).toEqual({
      kind: 'arranged',
      cycles: 4,
    })
  })

  it('an arrangement wins over a period that disagrees with it (#1373)', async () => {
    // THE ARM THAT WOULD HAVE CAUGHT #1373. Before it, the structural question
    // was asked of the published snapshot, whose pass pipeline leaves a
    // top-level `arrange(...)` as an opaque `Code` — so `songExtent` answered
    // `loop` for every document and this branch never fired in the running app.
    //
    // It hid because on a simple arrangement the two numbers COINCIDE:
    // `arrange([4,a],[8,b],[4,c])` has Σ weights 16 and a measured period of
    // 16. Here they are deliberately pulled apart — a 28-cycle arrangement over
    // content that repeats every cycle — so only a reader of the STRUCTURAL IR
    // can get 28. Measured live: a 104-cycle song whose bass alternates over 4
    // was offered an 8-second bounce.
    const arranged = IR.arrange('arrange', [arm(4), arm(8), arm(16)])
    const result = await measureSongLength(
      { end: songEnd(arranged), analysis: bd },
      depsWith(repeating(64)),
    )
    expect(result).toEqual({ kind: 'arranged', cycles: 28 })
  })

  it('sizes an arrangement that has never been evaluated', async () => {
    // Structure needs no playback, so a song can be sized before a note sounds.
    // The old shape could not express this: one IR meant no analysis IR was the
    // same as no document.
    const arranged = IR.arrange('arrange', [arm(2), arm(2)])
    expect(
      await measureSongLength({ end: songEnd(arranged), analysis: null }, depsWith([])),
    ).toEqual({ kind: 'arranged', cycles: 4 })
  })

  it('an unevaluated document with no arrangement is `no-document`, not `silent`', async () => {
    // The period path genuinely needs the snapshot. Absent it there is nothing
    // to measure, which is not the same as measuring and hearing nothing.
    expect(
      await measureSongLength({ end: songEnd(bd), analysis: null }, depsWith([])),
    ).toEqual({ kind: 'unknown', why: 'no-document' })
  })

  it('a repeating loop yields its MEASURED period', async () => {
    const result = await measureSongLength(both(bd), depsWith(repeating(64)))
    expect(result.kind).toBe('loop')
    if (result.kind === 'loop') expect(result.periodCycles).toBeGreaterThan(0)
  })

  it('a loop whose tracks repeat at different lengths is offered its WHOLE repeat, not the view span (#1599)', async () => {
    // A 4-cycle track beside a 3-cycle one. The view spans 4 so the tracks phase
    // inside it (#488); the audio only comes back round at 12, and a bounce of 4
    // cycles is a third of the song.
    const onsets = Array.from({ length: 64 }, (_, c) => [
      { ...ev(c, `a${c % 4}`), trackId: 'd1' },
      { ...ev(c, `b${c % 3}`), trackId: 'd2' },
    ]).flat() as IREvent[]
    expect(await measureSongLength(both(bd), depsWith(onsets))).toEqual({ kind: 'loop', periodCycles: 12 })
  })

  it('a loop with a track that never repeats has no loop to offer (#2109)', async () => {
    // The song never comes back round while one track never loops, so there is no
    // length to vouch for and the dialog asks. Until #2109 it was offered the span
    // of the tracks that do loop (#1104 abstention): 8 here, a third of nothing.
    const onsets = Array.from({ length: 300 }, (_, c) => [
      { ...ev(c, `a${c % 8}`), trackId: 'd1' },
      { ...ev(c, `n${c}`), trackId: 'd2' },
    ]).flat() as IREvent[]
    expect(await measureSongLength(both(bd), depsWith(onsets))).toEqual({ kind: 'unknown', why: 'no-period' })
  })

  it("measures as far as the timeline's limit and no further (#2109)", async () => {
    // A 96-cycle loop: found when the limit reaches past it, unmeasurable below it
    // — the same answer the timeline gives at that limit ("64+ cycles").
    const onsets = Array.from({ length: 300 }, (_, c) => ev(c, `a${c % 96}`))
    const at = (capCycles: number) => measureSongLength(both(bd), { ...depsWith(onsets), capCycles })
    expect(await at(256)).toEqual({ kind: 'loop', periodCycles: 96 })
    expect(await at(64)).toEqual({ kind: 'unknown', why: 'no-period' })
  })

  it('an aperiodic document is `no-period` — NEVER the horizon it stopped at', async () => {
    // This is the arm the module exists for. The analysis still returns a span
    // for this document; that span is where it gave up, and a bounce driven off
    // it renders a length nobody asked for. `unknown` is the honest answer.
    const result = await measureSongLength(both(bd), depsWith(everChanging(300)))
    expect(result).toEqual({ kind: 'unknown', why: 'no-period' })
  })

  it('a document with no onsets at all is `silent`, distinct from unmeasurable', async () => {
    // Two different situations for the user: nothing to bounce, versus something
    // to bounce whose length we cannot name. Collapsing them loses the message.
    expect(await measureSongLength(both(bd), depsWith([]))).toEqual({
      kind: 'unknown',
      why: 'silent',
    })
  })

  it('an OPAQUE arrangement declines rather than posing as a loop', async () => {
    // `songExtent` keeps `opaque` separate precisely so a caller cannot present
    // an arrangement of unknown length as an endless loop. Pinned with a stub
    // extent because a real opaque document is rare and this is the contract.
    expect(await measureSongLength({ end: { kind: 'opaque' }, analysis: bd }, depsWith(repeating(64)))).toEqual({
      kind: 'unknown',
      why: 'no-period',
    })
  })

  it('an analysis that throws degrades to `no-period` rather than rejecting', async () => {
    const deps: SongLengthDeps = {
      ...depsWith([]),
      analyzeSong: () => Promise.reject(new Error('boom')),
    }
    expect(await measureSongLength(both(bd), deps)).toEqual({
      kind: 'unknown',
      why: 'no-period',
    })
  })
})

describe('the source says which controls are modulated (#1465)', () => {
  // `signalDimensionsOf` used to be handed in, required, so a caller could not drop
  // it; it is imported now (#1943), so this arm is what notices if the call goes.
  // The issue's own example: one lane, the same every cycle, under a 4-cycle gain
  // LFO. The swept gain makes every cycle's fingerprint differ, so without the
  // source's word the song reads as aperiodic.
  it('a loop under a swept control is offered the period its audio repeats at', async () => {
    const ir = parseStrudel('$: s("bd").gain(sine.slow(4).range(0.05, 1))')
    // Past the analysis cap: the source's word only applies once the horizon has
    // stopped growing (a null below the cap is what buys the next doubling).
    const onsets = repeating(300).map((e, i) => ({ ...e, gain: 0.1 + i / 1000 }))
    expect(await measureSongLength({ end: null, analysis: ir }, depsWith(onsets))).toEqual({
      kind: 'loop',
      periodCycles: 4,
    })
  })
})

describe('the bounce sizes an arrangement by the area\'s songEnd (#1723, #1936)', () => {
  // `songEnd` itself is pinned beside `arrangedRepeatCycles` in the editor; this arm
  // holds the bounce to it, on the song whose structure (4) and end (8) differ.
  it('the bounce offers exactly what songEnd says', async () => {
    const source = 'const a = s("bd*2").gain("<.2 .9>")\narrange([2, a], [1, s("hh*2")], [1, a])'
    const ir = parseStrudel(source)
    expect(songExtent(ir)).toEqual({ kind: 'arranged', cycles: 4 })
    // What the bounce hands in: `songEndOf` of the file's text (#1940).
    const length = await measureSongLength({ end: songEndOf(source), analysis: null }, depsWith([]))
    expect(length).toEqual({ kind: 'arranged', cycles: 8 })
    expect(length).toEqual(songEnd(ir))
  })
})

describe('songLoopCycles — one pass of the song, read the same for every span kind', () => {
  const base = { horizonCycles: 8, lanes: [], sections: [], lanePeriods: [] } as const
  it('a measured loop reads its repeat, else its period', () => {
    expect(songLoopCycles({ ...base, periodCycles: 4, repeatCycles: 12, displaySpan: { kind: 'loop', cycles: 4 } })).toBe(12)
    expect(songLoopCycles({ ...base, periodCycles: 4, repeatCycles: null, displaySpan: { kind: 'loop', cycles: 4 } })).toBe(4)
  })
  it('#1721 — an arranged span reads the MEASURED period, not its declared end', () => {
    // A 4-bar arrangement under a curve that comes back round every 16 (#1611's case):
    // the span is 4, the song repeats at 16, and the menus ask the second question.
    expect(songLoopCycles({ ...base, periodCycles: 16, repeatCycles: null, displaySpan: { kind: 'arranged', cycles: 4 } })).toBe(16)
    expect(songLoopCycles({ ...base, periodCycles: 4, repeatCycles: 12, displaySpan: { kind: 'arranged', cycles: 4 } })).toBe(12)
    // Measured nothing (a 187-bar song): unknown, as it was when the span was capped.
    expect(songLoopCycles({ ...base, periodCycles: null, repeatCycles: null, displaySpan: { kind: 'arranged', cycles: 187 } })).toBeNull()
  })
  it('a span where the analysis stopped is no length', () => {
    expect(songLoopCycles({ ...base, periodCycles: null, repeatCycles: null, displaySpan: { kind: 'capped', cycles: 256 } })).toBeNull()
    expect(songLoopCycles({ ...base, periodCycles: null, repeatCycles: null, displaySpan: { kind: 'horizon', cycles: 8 } })).toBeNull()
  })
})

describe('cyclesToSeconds — the conversion refuses rather than guessing', () => {
  it('converts at the given tempo', () => {
    expect(cyclesToSeconds(8, 0.5)).toBe(16) // 8 cycles at 0.5 cps
    expect(cyclesToSeconds(4, 2)).toBe(2)
  })

  it('returns null when the tempo is unknown, instead of assuming a default', () => {
    // Strudel's own default is 0.5, and substituting it here would hand back a
    // confident duration for a document whose tempo was never read. The caller
    // has to decide what to do about not knowing; this function will not decide
    // for it by picking a number that is right most of the time.
    expect(cyclesToSeconds(8, null)).toBeNull()
    expect(cyclesToSeconds(8, 0)).toBeNull()
    expect(cyclesToSeconds(8, Number.NaN)).toBeNull()
  })

  it('refuses a non-positive span', () => {
    expect(cyclesToSeconds(0, 0.5)).toBeNull()
    expect(cyclesToSeconds(-4, 0.5)).toBeNull()
  })
})

describe('bounceOffers — what the user is actually shown', () => {
  const loop = (periodCycles: number, cps: number | null): BounceSizing => ({
    length: { kind: 'loop', periodCycles },
    cps,
  })

  it('offers repeats of a measured loop, each costed in wall clock', () => {
    // 8 cycles at 0.5 cps = 16s per pass.
    const { offers, note } = bounceOffers(loop(8, 0.5), false)
    expect(note).toBeNull()
    expect(offers.map((o) => [o.label, o.seconds])).toEqual([
      ['1 repeat', 16],
      ['2 repeats', 32],
      ['4 repeats', 64],
      ['8 repeats', 128],
    ])
  })

  it('offers the whole arrangement when the document has a definite end', () => {
    const { offers } = bounceOffers({
      length: { kind: 'arranged', cycles: 28 },
      cps: 0.5,
    }, false)
    expect(offers).toEqual([{ id: 'whole', label: 'Whole song', seconds: 56 }])
  })

  it('declines with a REASON when no period was measured', () => {
    // The 56-of-142 case. The seconds picker still works; what the note buys is
    // the user knowing this document will not gain a length by waiting.
    const { offers, note } = bounceOffers({
      length: { kind: 'unknown', why: 'no-period' },
      cps: 0.5,
    }, false)
    expect(offers).toEqual([])
    expect(note).toMatch(/no repeating section/i)
  })

  it('distinguishes a silent document from an unmeasurable one', () => {
    const silent = bounceOffers({ length: { kind: 'unknown', why: 'silent' }, cps: 0.5 }, false)
    const unmeasured = bounceOffers({
      length: { kind: 'unknown', why: 'no-period' },
      cps: 0.5,
    }, false)
    expect(silent.note).not.toEqual(unmeasured.note)
    expect(silent.note).toMatch(/no sound/i)
  })

  it('knows the length and STILL declines when the tempo is unknown', () => {
    // The reason length and cps are separate fields. Assuming Strudel's 0.5
    // default here would hand back a confident duration that is wrong for every
    // document running at any other tempo — and wrong silently.
    const { offers, note } = bounceOffers(loop(8, null), false)
    expect(offers).toEqual([])
    expect(note).toMatch(/tempo is not known/i)
  })

  it('drops repeats past the LIVE ceiling instead of offering an hour-long take', () => {
    // 300 cycles at 0.5 cps = 600s per pass — exactly the ceiling, so one fits
    // and nothing beyond it does. A bounce is real time; 8 repeats here would be
    // an 80-minute wait behind a progress bar.
    const { offers } = bounceOffers(loop(300, 0.5), false)
    expect(offers.map((o) => o.label)).toEqual(['1 repeat'])
    expect(offers[0].seconds).toBe(MAX_LIVE_BOUNCE_SECONDS)
  })

  it('says so when even a single pass is longer than a live take can record', () => {
    const { offers, note } = bounceOffers(loop(1000, 0.5), false)
    expect(offers).toEqual([])
    expect(note).toMatch(/one pass of this loop runs 33:20/i)
  })

  // #1652 — an offline render is offered up to an hour; a live take stays at ten
  // minutes. Same document, two paths, two answers.
  it('offers an offline render the repeats a live take drops', () => {
    // 300 cycles at 0.5 cps = 600s per pass: live fits one, offline fits six.
    const live = bounceOffers(loop(300, 0.5), false)
    const offline = bounceOffers(loop(300, 0.5), true)
    expect(live.offers.map((o) => o.label)).toEqual(['1 repeat'])
    expect(offline.offers.map((o) => o.label)).toEqual(['1 repeat', '2 repeats', '4 repeats'])
  })

  it('offers an offline render exactly an hour, and nothing past it', () => {
    // 1800 cycles at 0.5 cps = 3600s.
    const atCeiling = bounceOffers({ length: { kind: 'arranged', cycles: 1800 }, cps: 0.5 }, true)
    expect(atCeiling.offers).toEqual([
      { id: 'whole', label: 'Whole song', seconds: MAX_OFFLINE_BOUNCE_SECONDS },
    ])
    const past = bounceOffers({ length: { kind: 'arranged', cycles: 1802 }, cps: 0.5 }, true)
    expect(past.offers).toEqual([])
    expect(past.note).toMatch(/runs 60:04, longer than a bounce can render in one go/i)
  })

  it('refuses a twenty-minute arrangement live, and offers it offline', () => {
    // 600 cycles at 0.5 cps = 1200s.
    const song = { length: { kind: 'arranged', cycles: 600 }, cps: 0.5 } as const
    expect(bounceOffers(song, false).note).toMatch(/runs 20:00, longer than a bounce can record in one take/i)
    expect(bounceOffers(song, true).offers).toEqual([{ id: 'whole', label: 'Whole song', seconds: 1200 }])
  })

  it('offers nothing and says nothing while the measurement is still in flight', () => {
    // `null` is "not measured yet", which must not render as a refusal.
    expect(bounceOffers(null, false)).toEqual({ offers: [], note: null })
  })
})

describe('formatDuration', () => {
  it('reads as minutes and seconds', () => {
    expect(formatDuration(93)).toBe('1:33')
    expect(formatDuration(8)).toBe('0:08')
    expect(formatDuration(600)).toBe('10:00')
  })
})
