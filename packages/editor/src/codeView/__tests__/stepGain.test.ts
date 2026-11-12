/**
 * Velocity per step (#2468): a drag on a hit writes its own step of `.gain("…")`.
 *
 * Every write is checked twice: the string it produces, and what Strudel then plays
 * (`soundGainHits`, the page's own composition of `s(…).gain(…)`).
 */
import { describe, expect, it } from 'vitest'
import { gainMirror } from '../strudelMini/spell'
import { soundGainHits } from '../strudelMini/pattern'
import { fmtLevel, gainLevelsAt, stepGainEdit } from '../stepGain'
import type { ChunkGain } from '../notation/model'

const str = (mini: string): ChunkGain => ({ mini, numeric: null, foreign: false })
const num = (n: number): ChunkGain => ({ mini: null, numeric: n, foreign: false })
const none: ChunkGain = { mini: null, numeric: null, foreign: false }

/** what `s(sound).gain(gain)` plays in cycle 0, as `sound@begin=level` */
function heard(sound: string, gain: string, cyc = 0): string[] {
  return soundGainHits(sound, gain, cyc).map((h) => `${Array.isArray(h.sound) ? h.sound.join(':') : String(h.sound)}@${h.begin.toFraction?.() ?? h.begin.valueOf()}=${String(h.gain)}`)
}

function written(sound: string, gain: ChunkGain, hit: { begin: number; end: number }, level: number, bars = 1): string {
  const r = stepGainEdit(sound, gain, bars, hit, level)
  if (!r.ok) throw new Error(`refused: ${r.why}`)
  return r.gain
}

describe('gainMirror: a new .gain with the pattern’s own steps (the 2026-11-08 ruling)', () => {
  it.each([
    ['bd [hh hh] sd hh', '1 [1 1] 1 1'],
    ['bd ~ sd ~', '1 1 1 1'],
    ['<bd sd> hh', '<1 1> 1'],
    ['bd(3,8)', '1*8'],
    ['hh*4 bd!3', '1*4 1!3'],
    ['bd@3 sd', '1@3 1'],
    ['bd _ _ sd', '1@3 1'],
    ['[bd,sd] hh', '1 1'],
    ['bd? sd', '1 1'],
    ['bd:3 sd:1', '1 1'],
    ['bd sd . hh hh hh', '1 1 . 1 1 1'],
    ['[<bd sd> hh]*2', '[<1 1> 1]*2'],
  ])('%s → %s, and every hit plays at it', (sound, want) => {
    expect(gainMirror(sound, '1')).toBe(want)
    for (const c of [0, 1]) expect(soundGainHits(sound, want, c).length).toBe(soundGainHits(sound, '1', c).length)
  })

  it.each(['bd sd, hh*4', '[bd|sd] hh', '{bd sd hh}%4', 'hh*<2 3>', '<bd sd, hh>'])('%s has no mirror: a stack of levels would play a hit twice', (sound) => {
    expect(gainMirror(sound, '1')).toBeNull()
  })
})

describe('stepGainEdit', () => {
  it('an existing string: the level whose hit is the hit is rewritten in place', () => {
    const r = stepGainEdit('bd ~ sd ~', str('0.5 ~ 1 ~'), 1, { begin: 0, end: 0.25 }, 0.8)
    expect(r).toEqual({ ok: true, gain: '0.8 ~ 1 ~', created: false, edit: { from: 0, to: 3, insert: '0.8' } })
    expect(heard('bd ~ sd ~', '0.8 ~ 1 ~')).toEqual(['bd@0=0.8', 'sd@1/2=1'])
  })

  it('no .gain: a new one mirrors the steps, with the dragged hit at its level (the ruling’s example)', () => {
    expect(written('bd [hh hh] sd hh', none, { begin: 0, end: 0.25 }, 0.5)).toBe('0.5 [1 1] 1 1')
    const g = written('bd [hh hh] sd hh', none, { begin: 0.25, end: 0.375 }, 0.5)
    expect(g).toBe('1 [0.5 1] 1 1')
    expect(heard('bd [hh hh] sd hh', g)).toEqual(['bd@0=1', 'hh@1/4=0.5', 'hh@3/8=1', 'sd@1/2=1', 'hh@3/4=1'])
  })

  it('a number is every step’s starting level', () => {
    const r = stepGainEdit('bd sd', num(0.4), 1, { begin: 0.5, end: 1 }, 0.8)
    expect(r.ok && r.gain).toBe('0.4 0.8')
    expect(r.ok && r.created).toBe(true)
  })

  it('one hit of a level its own op repeats is written out: only that hit changes', () => {
    const g = written('hh*4', str('1*4'), { begin: 0.25, end: 0.5 }, 0.5)
    expect(g).toBe('[1 0.5 1 1]')
    expect(heard('hh*4', g)).toEqual(['hh@0=1', 'hh@1/4=0.5', 'hh@1/2=1', 'hh@3/4=1'])
  })

  it('a euclid’s new .gain has a level per place, and one hit takes its own', () => {
    const g = written('bd(3,8)', none, { begin: 3 / 8, end: 4 / 8 }, 0.5)
    expect(g).toBe('[1 1 1 0.5 1 1 1 1]')
    expect(heard('bd(3,8)', g)).toEqual(['bd@0=1', 'bd@3/8=0.5', 'bd@3/4=1'])
  })

  it('a level inside a repeated group changes in every copy, as a click on the step does', () => {
    const g = written('[bd hh]*2', none, { begin: 0, end: 0.25 }, 0.5)
    expect(g).toBe('[0.5 1]*2')
    expect(heard('[bd hh]*2', g).sort()).toEqual(['bd@0=0.5', 'bd@1/2=0.5', 'hh@1/4=1', 'hh@3/4=1'])
  })

  it('a level that covers more than the hit is refused', () => {
    expect(stepGainEdit('bd sd hh cp', str('0.5 1'), 1, { begin: 0, end: 0.25 }, 0.8)).toEqual({ ok: false, why: 'gain-step-not-the-hit' })
  })

  it('a hit under a gain ~ plays nothing: there is no level to drag', () => {
    expect(stepGainEdit('bd bd sd ~', str('0.5 ~ 1 ~'), 1, { begin: 0.25, end: 0.5 }, 0.8)).toEqual({ ok: false, why: 'hit-is-silent' })
    expect(stepGainEdit('bd ~ sd ~', str('0.5 ~ 1 ~'), 1, { begin: 0.25, end: 0.5 }, 0.8)).toEqual({ ok: false, why: 'no-hit-there' })
  })

  it('parts side by side get no new .gain; a gain velocity does not manage is left alone', () => {
    expect(stepGainEdit('bd sd, hh*4', none, 1, { begin: 0, end: 0.5 }, 0.8)).toEqual({ ok: false, why: 'no-gain-for-this-pattern' })
    expect(stepGainEdit('bd sd', { mini: null, numeric: null, foreign: true }, 1, { begin: 0, end: 0.5 }, 0.8)).toEqual({ ok: false, why: 'gain-not-ours' })
  })

  it('over two bars, a hit in the second bar edits its own level', () => {
    const g = written('<bd sd> hh', none, { begin: 1, end: 1.5 }, 0.5, 2)
    expect(g).toBe('<1 0.5> 1')
    expect(heard('<bd sd> hh', g, 1)).toEqual(['sd@1=0.5', 'hh@3/2=1'])
  })
})

describe('gainLevelsAt: what plays at each instant', () => {
  it('reads levels, and null under a rest', () => {
    expect(gainLevelsAt(str('0.5 ~ 1 ~'), [0, 0.25, 0.5, 0.8])).toEqual([0.5, null, 1, null])
    expect(gainLevelsAt(num(0.4), [0, 0.5])).toEqual([0.4, 0.4])
    expect(gainLevelsAt(none, [0])).toEqual([1])
    expect(gainLevelsAt({ mini: null, numeric: null, foreign: true }, [0])).toBeNull()
  })
  it('fmtLevel clamps and trims', () => {
    expect([fmtLevel(0.5), fmtLevel(1), fmtLevel(1.4), fmtLevel(-1), fmtLevel(0.333)]).toEqual(['0.5', '1', '1', '0', '0.33'])
  })
})
