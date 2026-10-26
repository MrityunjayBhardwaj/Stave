import { describe, expect, it } from 'vitest'
import { detectChunk } from '../chunkDetect'
import { applyEdits } from '../writeback'
import { noteSounds, soundBlockEdit, soundLane } from '../noteSounds'
import { readSoundArg, soundArgLabel, soundPickEdit, soundPickRefusal } from '../soundArg'
import { parsePianoRoll } from '../notation/parse'
import { stepToCycle } from '../../visualEdit/panels/usePlayingStep'
import { mini as reifyMini } from '@strudel/mini/mini.mjs'
import * as strudelCore from '@strudel/core'

type Hap = { hasOnset(): boolean; whole: { begin: { valueOf(): number } }; value: { note: unknown; s: string } }
type Pat = { sound(p: unknown): Pat; queryArc(a: number, b: number): Hap[] }
/** Strudel's own `note(…)`, which the repo's type stub for `@strudel/core` leaves out */
const strudelNote = (strudelCore as unknown as { note(p: unknown): Pat }).note

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

describe('noteSounds — which sound each note of a roll plays (#2226)', () => {
  /** the roll's own notes for `doc`, with their onsets in cycles, and what noteSounds says they play */
  function rollSounds(doc: string): { notes: string[]; sounds: string[][] | null } {
    const chunk = detectChunk(doc, 0)!
    const r = parsePianoRoll(chunk.miniString!)
    if (!r.ok) throw new Error('not a roll')
    const m = r.model
    const onsets = m.notes.map((n) => stepToCycle(n.start, m.steps, m.bars ?? 1, m.barSteps))
    return { notes: m.notes.map((n) => n.pitch), sounds: noteSounds(chunk, onsets, m.bars ?? 1) }
  }

  it('the reported line: 48 and 67 play piano, 63 62 58 the guitar', () => {
    const { notes, sounds } = rollSounds('note("48 67 63 [62, 58]").sound("piano gm_electric_guitar_muted")')
    expect(notes).toEqual(['48', '67', '63', '62', '58'])
    expect(sounds).toEqual([['piano'], ['piano'], ['gm_electric_guitar_muted'], ['gm_electric_guitar_muted'], ['gm_electric_guitar_muted']])
  })

  it('alternation across bars: a one-bar roll plays each sound in turn, so every note names both', () => {
    const { sounds } = rollSounds('note("c e").sound("<piano gm_electric_guitar_muted>")')
    expect(sounds).toEqual([
      ['piano', 'gm_electric_guitar_muted'],
      ['piano', 'gm_electric_guitar_muted'],
    ])
  })

  it('alternation in step with a two-bar roll: bar 1 piano, bar 2 the guitar', () => {
    const { notes, sounds } = rollSounds('note("<c e> g").sound("<piano gm_electric_guitar_muted>")')
    expect(notes).toEqual(['c', 'g', 'e', 'g'])
    expect(sounds).toEqual([['piano'], ['piano'], ['gm_electric_guitar_muted'], ['gm_electric_guitar_muted']])
  })

  it('a rest in the sound silences the notes under it; a variant names its sound', () => {
    expect(rollSounds('note("c e").sound("piano:2 ~")').sounds).toEqual([['piano'], []])
  })

  it('a stack of sounds plays both on every note', () => {
    expect(rollSounds('note("c e").sound("[piano, sawtooth]")').sounds).toEqual([
      ['piano', 'sawtooth'],
      ['piano', 'sawtooth'],
    ])
  })

  it('nothing to tell apart: one name, or a pattern of one name', () => {
    expect(rollSounds('note("c e").sound("piano")').sounds).toBeNull()
    expect(rollSounds('note("c e")').sounds).toBeNull()
  })

  it('a value-only call before the sound is fine; a time change before it claims nothing', () => {
    expect(rollSounds('note("c e").gain(0.5).sound("piano sawtooth")').sounds).toEqual([['piano'], ['sawtooth']])
    expect(rollSounds('note("c e").fast(2).sound("piano sawtooth")').sounds).toBeNull()
    // after the sound, a time change moves both together: the pairing holds
    expect(rollSounds('note("c e").sound("piano sawtooth").slow(2)').sounds).toEqual([['piano'], ['sawtooth']])
  })

  // The rule `noteSounds` relies on — a note plays the sound held at its onset — checked
  // against Strudel composing the two patterns itself.
  it.each([
    ['48 67 63 [62, 58]', 'piano gm_electric_guitar_muted'],
    ['c e g b', '<piano sawtooth> [square triangle]'],
    ['c@3 e', 'piano sawtooth square'],
    ['<c e> g', '<piano gm_electric_guitar_muted>'],
    // onsets just before a sound boundary: a rule that looks a little late gets these wrong
    ['c e', 'piano sawtooth square'],
    ['c [e g] b', 'piano sawtooth square triangle gm_electric_guitar_muted'],
  ])('agrees with Strudel: note("%s").sound("%s")', (notes, sounds) => {
    const doc = `note("${notes}").sound("${sounds}")`
    const ours = rollSounds(doc)
    const chunk = detectChunk(doc, 0)!
    const r = parsePianoRoll(chunk.miniString!)
    if (!r.ok) throw new Error('not a roll')
    const span = r.model.bars ?? 1
    // Strudel: every onset over 8 passes, by (pitch, position in the pass) → sounds heard
    const played = new Map<string, string[]>()
    const pat = strudelNote(reifyMini(notes)).sound(reifyMini(sounds))
    for (const h of pat.queryArc(0, 8 * span)) {
      if (!h.hasOnset()) continue
      const key = `${h.value.note}@${(h.whole.begin.valueOf() % span).toFixed(6)}`
      const heard = played.get(key) ?? []
      if (!heard.includes(h.value.s)) heard.push(h.value.s)
      played.set(key, heard)
    }
    const m = r.model
    const expected = m.notes.map(
      (n) => played.get(`${n.pitch}@${stepToCycle(n.start, m.steps, span, m.barSteps).toFixed(6)}`) ?? [],
    )
    expect(ours.sounds).toEqual(expected)
  })
})

describe('soundLane — the sound pattern as its own row (#2226)', () => {
  const lane = (doc: string, span = 1) => soundLane(detectChunk(doc, 0)!, span)
  const edit = (doc: string, i: number, value: string, span = 1) => {
    const chunk = detectChunk(doc, 0)!
    const l = soundLane(chunk, span)!
    const r = soundBlockEdit(chunk, l.blocks[i], value)
    return 'edit' in r ? applyEdits(doc, [r.edit]) : `REFUSED: ${r.refused}`
  }

  it('the reported line: piano over the first half, the guitar over the second', () => {
    const l = lane('note("48 67 63 [62, 58]").sound("piano gm_electric_guitar_muted")')!
    expect(l.readOnly).toBeUndefined()
    expect(l.blocks.map((b) => [b.name, b.begin, b.end])).toEqual([
      ['piano', 0, 0.5],
      ['gm_electric_guitar_muted', 0.5, 1],
    ])
  })

  it('its own divisions, and a rest is a gap', () => {
    const l = lane('note("c e g b").sound("piano [sawtooth ~ square]")')!
    expect(l.blocks.map((b) => [b.name, Number(b.begin.toFixed(4)), Number(b.end.toFixed(4))])).toEqual([
      ['piano', 0, 0.5],
      ['sawtooth', 0.5, 0.6667],
      ['square', 0.8333, 1],
    ])
  })

  it('a block writes only its own name, where it is written', () => {
    const doc = 'note("c e").sound("<piano ~ piano> sawtooth")'
    // `<…>` takes a step per cycle; span 3 shows its whole round
    const l = lane(doc, 3)!
    expect(l.blocks.map((b) => b.name)).toEqual(['piano', 'sawtooth', 'sawtooth', 'piano', 'sawtooth'])
    expect(edit(doc, 3, 'square', 3)).toBe('note("c e").sound("<piano ~ square> sawtooth")')
    expect(edit(doc, 0, 'square', 3)).toBe('note("c e").sound("<square ~ piano> sawtooth")')
    expect(edit('note("c e").sound("piano:2 sawtooth")', 0, 'square')).toBe('note("c e").sound("square:2 sawtooth")')
  })

  it('a pick that is not one name is refused; so is a block the code moved under', () => {
    const doc = 'note("c e").sound("piano sawtooth")'
    expect(edit(doc, 0, 'my kick')).toMatch(/^REFUSED: "my kick"/)
    const chunk = detectChunk(doc, 0)!
    const block = soundLane(chunk, 1)!.blocks[1]
    const moved = detectChunk('note("c e").sound("sawtooth piano")', 0)!
    const r = soundBlockEdit(moved, block, 'square')
    expect('refused' in r).toBe(true)
  })

  it('read-only with a reason, never a wrong picture', () => {
    expect(lane('note("c e").sound("piano | sawtooth")')).toMatchObject({ blocks: [], readOnly: expect.stringMatching(/random/) })
    expect(lane('note("c e").sound("piano? sawtooth")')).toMatchObject({ blocks: [], readOnly: expect.stringMatching(/random/) })
    expect(lane('note("c e").sound("[piano, sawtooth] square")')).toMatchObject({ blocks: [], readOnly: expect.stringMatching(/at a time/) })
    // one bar of notes, a sound per bar: the lane would show only the first
    expect(lane('note("c e").sound("<piano sawtooth>")')).toMatchObject({ blocks: [], readOnly: expect.stringMatching(/longer/) })
    // …and under two bars of notes it draws both
    expect(lane('note("<c e>").sound("<piano sawtooth>")', 2)!.blocks.map((b) => b.name)).toEqual(['piano', 'sawtooth'])
  })

  it('no lane: one name, no sound, a time change before the sound', () => {
    expect(lane('note("c e").sound("piano")')).toBeNull()
    expect(lane('note("c e").sound("piano*2")')).toBeNull()
    expect(lane('note("c e")')).toBeNull()
    expect(lane('note("c e").fast(2).sound("piano sawtooth")')).toBeNull()
  })
})
