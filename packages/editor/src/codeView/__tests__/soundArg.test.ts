import { describe, expect, it } from 'vitest'
import { detectChunk } from '../chunkDetect'
import { applyEdits } from '../writeback'
import { readSoundArg, soundArgLabel, soundPickEdit, soundPickRefusal } from '../soundArg'

/** pick `value` on the roll chunk at the start of `doc`; the new doc, or the refusal */
function pick(doc: string, value: string, names = ['sound', 's'], canonical = 'sound', noun = 'sound'): string {
  const chunk = detectChunk(doc, 0)
  if (!chunk) throw new Error('no chunk')
  const r = soundPickEdit(chunk, names, canonical, value, noun)
  return 'edit' in r ? applyEdits(doc, [r.edit]) : `REFUSED: ${r.refused}`
}

describe('readSoundArg — what a sound argument names (#2226)', () => {
  it('a bare name is one name', () => {
    expect(readSoundArg('piano')).toEqual({ kind: 'one', name: 'piano' })
  })

  it('a string that is not notation plays as itself: one name', () => {
    expect(readSoundArg('[piano')).toEqual({ kind: 'one', name: '[piano' })
    // krill reads a hyphenated name as one atom
    expect(readSoundArg('my-kick')).toEqual({ kind: 'one', name: 'my-kick' })
    expect(readSoundArg('🍕')).toEqual({ kind: 'one', name: '🍕' })
  })

  it('nothing to name (empty, a rest) is one name — a pick loses nothing', () => {
    expect(readSoundArg('')).toMatchObject({ kind: 'one' })
    expect(readSoundArg('~')).toMatchObject({ kind: 'one' })
  })

  it('two names across the bar are a pattern of two, spans on each name', () => {
    const body = 'piano gm_electric_guitar_muted'
    const a = readSoundArg(body)
    expect(a).toMatchObject({ kind: 'pattern', names: ['piano', 'gm_electric_guitar_muted'], alternates: false })
    if (a.kind !== 'pattern') throw new Error()
    expect(a.spans.map((s) => body.slice(s.start, s.end))).toEqual(['piano', 'gm_electric_guitar_muted'])
  })

  it('<a b> alternates', () => {
    expect(readSoundArg('<piano gm_electric_guitar_muted>')).toMatchObject({
      kind: 'pattern',
      names: ['piano', 'gm_electric_guitar_muted'],
      alternates: true,
    })
  })

  it('one name written as a pattern is a pattern of one; op arguments are not names', () => {
    for (const body of ['piano*2', 'piano:2', '<piano ~>', 'piano(3,8)', '[piano piano]', 'piano?']) {
      expect(readSoundArg(body), body).toMatchObject({ kind: 'pattern', names: ['piano'] })
    }
  })

  it('labels', () => {
    expect(soundArgLabel(readSoundArg('piano'), 'sound')).toBe('piano')
    expect(soundArgLabel(readSoundArg('piano gm_electric_guitar_muted'), 'sound')).toBe(
      '2 sounds: piano, gm_electric_guitar_muted',
    )
    expect(soundArgLabel(readSoundArg('<RolandTR909 RolandTR808>'), 'kit')).toBe('alternates: RolandTR909, RolandTR808')
    expect(soundArgLabel(readSoundArg('piano*2'), 'sound')).toBe('piano')
  })

  it('refuses only a pattern of several', () => {
    expect(soundPickRefusal(readSoundArg('piano'), 'sound')).toBeNull()
    expect(soundPickRefusal(readSoundArg('piano*2'), 'sound')).toBeNull()
    expect(soundPickRefusal(null, 'sound')).toBeNull()
    expect(soundPickRefusal(readSoundArg('piano sawtooth'), 'sound')).toMatch(/pattern of 2 sounds \(piano, sawtooth\)/)
  })
})

describe('soundPickEdit — a pick never replaces a pattern of sounds (#2226)', () => {
  it('the reported line: refused, nothing written', () => {
    const doc = 'note("48 67 63 [62, 58]").sound("piano gm_electric_guitar_muted")'
    expect(pick(doc, 'brown')).toMatch(/^REFUSED: This sound is a pattern of 2 sounds/)
  })

  it('order does not matter: the same with the sounds first', () => {
    const doc = 'note("48 67").sound("<piano gm_electric_guitar_muted>")'
    expect(pick(doc, 'brown')).toMatch(/^REFUSED/)
  })

  it('one plain name: replaced as before, single-quoted', () => {
    expect(pick('note("c e").sound("piano")', 'brown')).toBe(`note("c e").sound('brown')`)
    expect(pick(`note("c e").s('piano')`, 'brown')).toBe(`note("c e").s('brown')`)
  })

  it('no sound call: appended as before', () => {
    expect(pick('note("c e")', 'brown')).toBe(`note("c e").sound('brown')`)
  })

  it('one name in a pattern: renamed where written, the rest kept', () => {
    expect(pick('note("c e").sound("piano*2")', 'brown')).toBe('note("c e").sound("brown*2")')
    expect(pick('note("c e").sound("<piano ~ piano>")', 'brown')).toBe('note("c e").sound("<brown ~ brown>")')
    expect(pick('note("c e").sound("piano:2")', 'brown')).toBe('note("c e").sound("brown:2")')
  })

  it('one name in a pattern, and a pick that is not one name in notation: refused', () => {
    expect(pick('note("c e").sound("piano*2")', 'my kick')).toMatch(/^REFUSED: "my kick" can't be written/)
  })

  it('the kit picker: the same rule on .bank', () => {
    const doc = 's("bd sd").bank("<RolandTR909 RolandTR808>")'
    expect(pick(doc, 'AkaiLinn', ['bank'], 'bank', 'kit')).toMatch(/^REFUSED: This kit is a pattern of 2 kits/)
    expect(pick('s("bd sd").bank("RolandTR909")', 'AkaiLinn', ['bank'], 'bank', 'kit')).toBe(`s("bd sd").bank('AkaiLinn')`)
  })
})
