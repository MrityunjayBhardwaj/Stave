import { describe, it, expect } from 'vitest'
import { detectAllChunks, type ChunkInfo } from '../chunkDetect'
import { applyEdits, type OffsetEdit } from '../writeback'
import {
  setNumberCall,
  setLiteralCall,
  setStringCall,
  removeCall,
  knobEdit,
  knobRangeEdit,
  knobRangeResetEdit,
  toggleCallEdit,
  removeNamedCall,
  type ChainArgRef,
} from '../chainEdit'

const chunk = (doc: string): ChunkInfo => detectAllChunks(doc)[0]
/** the document after the edit; the document itself when nothing may be written */
const after = (doc: string, edit: OffsetEdit | null): string => (edit ? applyEdits(doc, [edit]) : doc)
/** the dial a render of `doc` would draw for `method` */
const dial = (doc: string, method: string, argIndex = 0): ChainArgRef => ({
  chainIndex: chunk(doc).chain.findIndex((c) => c.name === method),
  argIndex,
  method,
})

describe('chainEdit — the three primitives (#1888)', () => {
  it('a number call: replaces the literal, appends when absent, refuses a non-number', () => {
    const has = '$: s("bd*4").pan(0.2).room(0.5)'
    expect(after(has, setNumberCall(chunk(has), ['pan'], 'pan', 0.75))).toBe('$: s("bd*4").pan(0.75).room(0.5)')
    const none = '$: s("bd*4").room(0.5)'
    expect(after(none, setNumberCall(chunk(none), ['pan'], 'pan', 0.75))).toBe('$: s("bd*4").room(0.5).pan(0.75)')
    const signal = '$: s("bd*4").pan(sine)'
    expect(setNumberCall(chunk(signal), ['pan'], 'pan', 0.75)).toBeNull()
  })

  it('a number call writes nothing for a non-finite value — it would land as `0` (#1918)', () => {
    for (const doc of ['$: s("bd*4").pan(0.2)', '$: s("bd*4")']) {
      for (const v of [Number.NaN, Number.POSITIVE_INFINITY]) expect(setNumberCall(chunk(doc), ['pan'], 'pan', v)).toBeNull()
    }
  })

  it('a number call is found under any of its names and written under the one it has', () => {
    const doc = '$: s("bd*4").cutoff(800)'
    expect(after(doc, setNumberCall(chunk(doc), ['lpf', 'cutoff'], 'lpf', 1200))).toBe('$: s("bd*4").cutoff(1200)')
  })

  it('a string call: replaces the string in place, else appends; ids are single-quoted', () => {
    const has = '$: note("c e g").s("sawtooth").room(0.2)'
    expect(after(has, setStringCall(chunk(has), ['sound', 's'], 'sound', 'piano'))).toBe(
      `$: note("c e g").s('piano').room(0.2)`,
    )
    const none = '$: note("c e g").room(0.2)'
    expect(after(none, setStringCall(chunk(none), ['sound', 's'], 'sound', 'piano'))).toBe(
      `$: note("c e g").room(0.2).sound('piano')`,
    )
    expect(after(none, setLiteralCall(chunk(none), ['viz'], 'viz', '"pianoroll"'))).toBe(
      '$: note("c e g").room(0.2).viz("pianoroll")',
    )
  })

  it('remove: a member call goes whole; the head and a missing index are never removed', () => {
    const doc = '$: s("bd*4").lpf(800).room(0.5)'
    expect(after(doc, removeCall(chunk(doc), 1))).toBe('$: s("bd*4").room(0.5)')
    expect(removeCall(chunk(doc), 0)).toBeNull()
    expect(removeCall(chunk(doc), -1)).toBeNull()
    expect(removeCall(chunk(doc), 9)).toBeNull()
  })
})

describe('chainEdit — the mixer panel gestures (#1888)', () => {
  const drawn = '$: s("bd*4").lpf(800).room(0.5)'

  it('a knob writes its own literal', () => {
    expect(after(drawn, knobEdit(chunk(drawn), dial(drawn, 'room'), 0.9))).toBe('$: s("bd*4").lpf(800).room(0.9)')
  })

  it('a knob on a later argument writes that argument, not the first', () => {
    const doc = '$: s("bd").euclid(3, 8)'
    expect(after(doc, knobEdit(chunk(doc), dial(doc, 'euclid', 1), 16))).toBe('$: s("bd").euclid(3, 16)')
  })

  it('a knob drawn from one chain refuses a chain where that index is another method', () => {
    const room = dial(drawn, 'room')
    const changed = [
      '$: s("bd*4").hpf(200).lpf(800).room(0.5)', // a call inserted ahead
      '$: s("bd*4").room(0.5).lpf(800)', // the two swapped
      '$: s("bd*4").room(0.5)', // the call ahead removed
      '$: s("bd*4").lpf(sine.range(200,2000)).jux(rev).room(0.5)', // a non-number call now there
    ]
    for (const doc of changed) expect([doc, knobEdit(chunk(doc), room, 0.9)]).toEqual([doc, null])
  })

  it('a knob refuses when its literal became an expression under the same name', () => {
    const doc = '$: s("bd*4").lpf(800).room(sine)'
    expect(knobEdit(chunk(doc), dial(drawn, 'room'), 0.9)).toBeNull()
  })

  it('the dial range: writes `min, max`, resets it, and both refuse a changed chain', () => {
    const room = dial(drawn, 'room')
    const ranged = after(drawn, knobRangeEdit(chunk(drawn), room, 0, 100))
    expect(ranged).toBe('$: s("bd*4").lpf(800).room(0.5, 0, 100)')
    expect(after(ranged, knobRangeResetEdit(chunk(ranged), room))).toBe(drawn)
    expect(knobRangeResetEdit(chunk(drawn), room)).toBeNull() // nothing to reset
    // the call now at the dial's index has a range of its own — unguarded, either write would land on it
    const moved = '$: s("bd*4").hpf(200).lpf(800, 20, 2000).room(0.5, 0, 100)'
    expect(knobRangeEdit(chunk(moved), room, 0, 100)).toBeNull()
    expect(knobRangeResetEdit(chunk(moved), room)).toBeNull()
  })

  it('the dial range writes nothing when its call has lost its value argument (#1897)', () => {
    const emptied = '$: s("bd*4").lpf(800).room()'
    expect(knobRangeEdit(chunk(emptied), dial(drawn, 'room'), 0, 100)).toBeNull()
    expect(knobRangeResetEdit(chunk(emptied), dial(drawn, 'room'))).toBeNull()
  })

  it('an effect toggle appends at its default, and removes it under any spelling', () => {
    const names = ['lpf', 'cutoff']
    const off = '$: s("bd*4").room(0.5)'
    expect(after(off, toggleCallEdit(chunk(off), names, 'lpf', 1000))).toBe('$: s("bd*4").room(0.5).lpf(1000)')
    const on = '$: s("bd*4").cutoff(800).room(0.5)'
    expect(after(on, toggleCallEdit(chunk(on), names, 'lpf', 1000))).toBe('$: s("bd*4").room(0.5)')
  })

  it('remove by name drops that call and nothing else; an absent name writes nothing', () => {
    expect(after(drawn, removeNamedCall(chunk(drawn), 'lpf'))).toBe('$: s("bd*4").room(0.5)')
    expect(removeNamedCall(chunk(drawn), 'delay')).toBeNull()
  })

  it('neither the toggle nor remove-by-name ever deletes the head pattern', () => {
    const doc = '$: s("bd*4").room(0.5)'
    expect(removeNamedCall(chunk(doc), 's')).toBeNull()
    // toggling an "effect" named like the head appends rather than deleting the pattern
    expect(after(doc, toggleCallEdit(chunk(doc), ['s'], 's', 1))).toBe('$: s("bd*4").room(0.5).s(1)')
  })
})
