import { describe, it, expect } from 'vitest'
import { detectChunk, detectAllChunks, isChunkFresh, type ChunkInfo } from '../chunkDetect'
import { chunkSurface } from '../surface/surfaceRoute'
import { parsePianoRoll, parseStepGrid } from '../notation/parse'
import { readChunkGain, gridWriteEdits } from '../notation/gainEdit'
import { applyEdits } from '../writeback'
import { knobsFromChunk } from '../../visualEdit/panels/MixerBody'

/**
 * #2118 — a string choice of a `pick` is a pattern the Pattern tab can open.
 *
 * The cursor lookup used to read only the first call of a chain. With `pick`, that
 * call is whatever CHOOSES between the lines (a helper of any name, `irand`, or
 * `pick` itself), and the lines sit in a list it never looked into, so the grid
 * stayed in standby and the chooser's numbers showed up as the track's knobs.
 */

const LINES = [
  '<[e1 ~ ~ e2 ~ ~ e1 ~ g1 ~ a1 ~ ~ b1 d2 ~] [a1 ~ ~ a2 ~ ~ a1 ~ c#2 ~ e2 ~ g1 ~ f#1 ~]>',
  '<[e1 ~ e1 ~ ~ e2 ~ d2 ~ b1 ~ ~ g1 ~ a1 b1] [a1 ~ a1 ~ ~ a2 ~ g2 ~ e2 ~ ~ c#2 ~ d2 d#2]>',
  '<[e1 ~ ~ ~ e2 e1 ~ ~ e1 ~ g1 a1 ~ b1 ~ d2] [a1 ~ ~ ~ a2 a1 ~ ~ a1 ~ c#2 e2 ~ g2 ~ e2]>',
]
const LIST = `[\n  "${LINES[0]}",\n  "${LINES[1]}",\n  "${LINES[2]}"\n]`

/** The song the issue was filed from, verbatim. */
const SONG = `const roll = (n, seed) => irand(n).early(seed * 13.7).segment(1).slow(64)
const bass = roll(3, 1).pick(${LIST}).note().s("gm_slap_bass_1")
  .lpf("<2500!20 600!4 2500!8>").gain(1)

$: bass`

/** The cursor a little way into `needle`'s LAST occurrence (the choices come last). */
const at = (doc: string, needle: string) => doc.lastIndexOf(needle) + 3

/** Does the Pattern tab open this chunk, in the view its route names? */
function opens(c: ChunkInfo | null): boolean {
  const surface = chunkSurface(c)
  if (!c || !surface) return false
  return (surface === 'roll' ? parsePianoRoll(c.miniString!) : parseStepGrid(c.miniString!)).ok
}

describe('chunkDetect — a string choice of a pick is the pattern (#2118)', () => {
  it('each line of the song opens on its own, as a piano roll', () => {
    for (const line of LINES) {
      const c = detectChunk(SONG, at(SONG, line))!
      expect(c.miniString, line).toBe(line)
      expect(c.headFn).toBe('note')
      expect(c.type).toBe('roll')
      expect(chunkSurface(c)).toBe('roll')
      expect(opens(c)).toBe(true)
    }
  })

  it('the chooser does not matter: any helper name, irand, the function form, a literal', () => {
    const forms: Record<string, string> = {
      helper: `const whichOne = (n) => irand(n).segment(1).slow(64)\n$: whichOne(3).pick(${LIST}).note()`,
      irand: `$: irand(3).segment(1).slow(64).pick(${LIST}).note()`,
      functionForm: `$: pick(irand(3).segment(1), ${LIST}).note()`,
      literal: `$: "<0 1 2>".pick(${LIST}).note()`,
      pickmod: `$: "<0 1 2 3>".pickmod(${LIST}).note()`,
      inhabit: `$: "<0 1 2>".inhabit(${LIST}).note()`,
    }
    for (const [name, doc] of Object.entries(forms)) {
      const c = detectChunk(doc, at(doc, LINES[1]))
      expect(c?.miniString, name).toBe(LINES[1])
      expect(opens(c), name).toBe(true)
    }
  })

  it('reads what the strings play from the call around the pick when nothing follows it', () => {
    // Strudel's own inhabit example, and its squeeze example: function form, inside s()/note().
    const inhabit = 's("a@2 [a b] a".inhabit({a: "bd(3,8)", b: "sd sd"})).slow(4)'
    const c = detectChunk(inhabit, at(inhabit, 'sd sd'))!
    expect(c.miniString).toBe('sd sd')
    expect(c.headFn).toBe('s')
    expect(chunkSurface(c)).toBe('step')
    expect(opens(c)).toBe(true)

    const squeeze = 'note(squeeze("<0@2 [1!2] 2>", ["g a", "f g f g", "g a c d"]))'
    const s = detectChunk(squeeze, at(squeeze, 'f g f g'))!
    expect(s.miniString).toBe('f g f g')
    expect(s.headFn).toBe('note')
    expect(opens(s)).toBe(true)
  })

  it('object choices work as well as a list', () => {
    const doc = '$: "<a b>".pick({a: "bd ~ sd ~", b: "bd bd sd ~"}).s()'
    const c = detectChunk(doc, at(doc, 'bd bd sd'))!
    expect(c.miniString).toBe('bd bd sd ~')
    expect(c.headFn).toBe('s')
    expect(opens(c)).toBe(true)
  })

  it('a method .squeeze is the operator alias, not a choice: nothing changes there', () => {
    const doc = '$: note("c e").squeeze(["g a", "f g"])'
    const c = detectChunk(doc, at(doc, 'f g'))!
    expect(c.pickChoice).toBeUndefined()
    expect(c.miniString).toBe('c e') // the head's own string, as before
  })

  it('the selector string is not a choice', () => {
    const doc = `$: "<0 1 2>".pick(${LIST}).note()`
    const c = detectChunk(doc, doc.indexOf('<0 1 2>') + 2)!
    expect(c.pickChoice).toBeUndefined()
    const fn = `$: pick("<0 1>", ${LIST}).note()`
    expect(detectChunk(fn, fn.indexOf('<0 1>') + 2)!.pickChoice).toBeUndefined()
  })

  it('a choice with nothing saying what it plays stays in standby, as before', () => {
    const doc = `$: irand(3).pick(${LIST})`
    const c = detectChunk(doc, at(doc, LINES[0]))!
    expect(c.miniString).toBe(LINES[0])
    expect(c.headFn).toBeNull()
    expect(chunkSurface(c)).toBeNull()
  })

  it("an edit lands in that line's own bytes, and the write re-finds the same line", () => {
    const c = detectChunk(SONG, at(SONG, LINES[1]))!
    expect(isChunkFresh(SONG, c)).toBe(true)
    // useActiveChunk.applyEdit re-detects at statementRange[0] before writing.
    const again = detectChunk(SONG, c.statementRange[0])!
    expect(again.miniRange).toEqual(c.miniRange)
    const edits = gridWriteEdits(again, 'e1 e1 e1 e1', null)!
    const out = applyEdits(SONG, edits)
    expect(out).toBe(SONG.replace(LINES[1], 'e1 e1 e1 e1'))
  })

  it('goes stale when anything else in the statement changes, since the mixer writes there', () => {
    const c = detectChunk(SONG, at(SONG, LINES[0]))!
    expect(isChunkFresh(SONG.replace('.gain(1)', '.gain(0.8)'), c)).toBe(false)
  })

  it("the velocity lane hands off: the track's .gain is every line's, not this one's", () => {
    const c = detectChunk(SONG, at(SONG, LINES[0]))!
    expect(readChunkGain(c).foreign).toBe(true)
    const whole = detectAllChunks(SONG)[0]
    expect(readChunkGain(whole)).toEqual({ mini: null, numeric: 1, foreign: false })
  })

  it("the side panel shows the track's controls after the pick, never the chooser's numbers", () => {
    const doc = `const roll = (n, seed) => irand(n).segment(1).slow(64)\n$: roll(3, 1).pick(${LIST}).note().s("sawtooth").lpf(800).room(0.3)`
    const methods = (c: ChunkInfo) => knobsFromChunk(c).map((k) => k.method)
    expect(methods(detectChunk(doc, at(doc, LINES[0]))!)).toEqual(['lpf', 'room'])
    // The whole track, as the Mixer tab reads it: same controls, no `roll 1`/`roll 2`.
    expect(methods(detectAllChunks(doc)[0])).toEqual(['lpf', 'room'])
    const irand = `$: irand(3).segment(1).slow(64).pick(${LIST}).note().lpf(800)`
    expect(methods(detectAllChunks(irand)[0])).toEqual(['lpf'])
  })

  it('a chain with no pick keeps every knob', () => {
    const doc = '$: s("bd*4").slow(2).lpf(800)'
    expect(knobsFromChunk(detectAllChunks(doc)[0]).map((k) => k.method)).toEqual(['slow', 'lpf'])
  })
})

describe('chunkDetect — a choice written as a call (#2121)', () => {
  /** the source the chunk's statementRange covers */
  const span = (doc: string, c: ChunkInfo) => doc.slice(c.statementRange[0], c.statementRange[1])

  it('a call inside a list binds that call, with the method form', () => {
    const doc = '$: irand(2).segment(1).pick([s("bd ~ sd ~").bank("tr909"), note("c e g").s("piano")])'
    const c = detectChunk(doc, at(doc, 'c e g'))!
    expect({ head: c.headFn, mini: c.miniString, span: span(doc, c) }).toEqual({
      head: 'note',
      mini: 'c e g',
      span: 'note("c e g").s("piano")',
    })
    expect(opens(c)).toBe(true)
  })

  it('and with the function form, in a list or an object', () => {
    const list = '$: pick(irand(2).segment(1), [s("bd sd"), s("hh*8")])'
    expect(span(list, detectChunk(list, at(list, 'hh*8'))!)).toBe('s("hh*8")')
    const obj = '$: pick("<a b>", {a: s("bd sd"), b: note("c e")})'
    expect(span(obj, detectChunk(obj, at(obj, 'c e'))!)).toBe('note("c e")')
  })

  it('every name of the family binds a call in an object, and never the selector', () => {
    const names = ['pick', 'pickmod', 'pickOut', 'pickmodOut', 'pickRestart', 'pickmodRestart', 'pickReset',
      'pickmodReset', 'inhabit', 'inhabitmod', 'pickSqueeze', 'pickmodSqueeze']
    for (const name of names) {
      const doc = `$: "<a b>".${name}({a: s("bd sd"), b: s("hh*4")})`
      expect(span(doc, detectChunk(doc, at(doc, 'hh*4'))!), name).toBe('s("hh*4")')
      expect(detectChunk(doc, doc.indexOf('<a b>') + 2)!.miniString, `${name} selector`).not.toBe('hh*4')
    }
  })

  it('a method .squeeze is the operator alias: a call inside it is not a choice', () => {
    const doc = '$: note("c e").squeeze([s("bd sd")])'
    expect(detectChunk(doc, at(doc, 'bd sd'))!.miniString).toBe('c e')
  })
})
