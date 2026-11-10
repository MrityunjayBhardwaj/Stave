import { describe, it, expect } from 'vitest'
import { readMasterViz, masterVizEdit, detectMasterAudioAll } from '../masterEdit'
import { readCodeViz } from '../codeViz'
import { lastTrackBackdropCall } from '../backdropCall'
import type { OffsetEdit } from '../../writeback'

const applied = (src: string, e: OffsetEdit | null): string =>
  e ? src.slice(0, e.range[0]) + e.text + src.slice(e.range[1]) : src

const literal = (values: Record<string, unknown>, dynamic: string[] = []) => ({ kind: 'literal', values, dynamic })

// #2387 — the code reader names the background the engine plays. `all()`
// transforms run in source order, each overwriting the background, so the LAST
// master viz is the one that plays; and an underscore viz method on the master
// line is a background too (no track ever takes its inline zone).
describe('readMasterViz — the master viz the engine keeps', () => {
  it('picks the LAST of several master viz lines', () => {
    const doc = '$: s("bd")\nall(x => x.viz("scope"))\nall(x => x.viz("Fold", { theme: "white" }))'
    expect(readMasterViz(doc)).toEqual({ name: 'Fold', options: literal({ theme: 'white' }) })
  })

  it('picks the last flagged master line too', () => {
    const doc = 'all(x => x.viz("A", { backdrop: true }))\nall(x => x.viz("B", { backdrop: true }))'
    expect(readMasterViz(doc)?.name).toBe('B')
  })

  it('picks the last viz within one master chain', () => {
    expect(readMasterViz('all(x => x.viz("A").viz("B"))')?.name).toBe('B')
  })

  it('reads an underscore viz method on the master line, with its options', () => {
    expect(readMasterViz('$: note("c")\nall(x => x._pianoroll({ background: "#cc1133" }))')).toEqual({
      name: 'pianoroll',
      options: literal({ background: '#cc1133' }),
    })
  })

  it('reads a non-underscore viz method on the master line, by its renderer', () => {
    expect(readMasterViz('all(x => x.tscope())')).toEqual({ name: 'scope', options: null })
  })

  it('names nothing when the last master viz has a name only an evaluation knows', () => {
    // an earlier, readable line is NOT what plays
    expect(readMasterViz('all(x => x.viz("scope"))\nall(x => x.viz(myViz))')).toBeNull()
  })
})

// #2394 — a background declared on a TRACK is read from the code too, with the
// same options reader, so it follows the code before Play and on every edit.
describe('readCodeViz — the background the code declares, wherever it is', () => {
  it('reads a flagged .viz() on a named track, options included', () => {
    const doc = `lead: note("c e g").viz("Fold", { backdrop: true, theme: 'white' })`
    expect(readCodeViz(doc)).toEqual({
      name: 'Fold',
      options: literal({ backdrop: true, theme: 'white' }),
      level: 'track',
    })
  })

  it('does NOT read an implicit viz method on a track: it is a background only once it plays', () => {
    expect(readCodeViz(`$: note("c").pianoroll({ background: '#cc1133' })`)).toBeNull()
    expect(readCodeViz('$: note("c").scope().gain(0.5)')).toBeNull()
    expect(readCodeViz('_lead: note("c").spiral()')).toBeNull()
  })

  it('reads a declared call on a muted track (its methods still run)', () => {
    expect(readCodeViz('_lead: note("c").viz("Fold", { backdrop: true })')?.name).toBe('Fold')
  })

  it('reads the declared track call even when a later implicit one will win at Play', () => {
    // the evaluation then reports `scope`, and the app keeps that answer
    const doc = 'lead: note("e").viz("Fold", { backdrop: true })\n$: note("c").scope()'
    expect(readCodeViz(doc)).toMatchObject({ name: 'Fold', level: 'track' })
  })

  it("Clear's reader still finds an implicit track call, so Clear can remove it", () => {
    expect(lastTrackBackdropCall('$: note("c").scope().gain(0.5)')?.name).toBe('scope')
    expect(lastTrackBackdropCall('$: note("c").scope()', { declaredOnly: true })).toBeNull()
  })

  it('leaves an unflagged .viz() and an underscore method on a track inline', () => {
    expect(readCodeViz('$: note("c").viz("Fold", { theme: "white" })')).toBeNull()
    expect(readCodeViz('$: note("c")._pianoroll({ background: "#c13" })')).toBeNull()
  })

  it('takes the LAST track declaration, as the engine does', () => {
    const doc = '$: note("c").scope()\nlead: note("e").viz("Fold", { backdrop: true })'
    expect(readCodeViz(doc)?.name).toBe('Fold')
  })

  it('lets a master viz win over any track one: all() runs after every track', () => {
    const doc = 'all(x => x.viz("Prism"))\n$: note("c").scope()'
    expect(readCodeViz(doc)).toMatchObject({ name: 'Prism', level: 'master' })
  })

  it('names nothing when the master viz is unreadable, rather than a track the engine overrides', () => {
    expect(readCodeViz('$: note("c").scope()\nall(x => x.viz(myViz))')).toBeNull()
  })

  it('keeps computed option values dynamic, for the last evaluation to fill in', () => {
    expect(readCodeViz('$: note("c").viz("Fold", { backdrop: true, delay: slider(0.8) })')?.options).toEqual(
      literal({ backdrop: true }, ['delay']),
    )
  })

  it('does not count a track .viz() whose flag only an evaluation knows', () => {
    expect(readCodeViz('$: note("c").viz("Fold", opts)')).toBeNull()
  })

  it('reads nothing from a document that does not parse', () => {
    expect(readCodeViz('$: note("c").pianoroll(')).toBeNull()
  })
})

describe('masterVizEdit — edits the background the reader shows', () => {
  it('renames the LAST master viz line, the one that plays', () => {
    const src = 'all(x => x.viz("scope"))\nall(x => x.viz("Fold", { theme: "white" }))'
    expect(applied(src, masterVizEdit(src, 'spiral'))).toBe(
      'all(x => x.viz("scope"))\nall(x => x.viz("spiral", { theme: "white" }))',
    )
  })

  it('clears the LAST master viz line', () => {
    const src = '$: s("bd")\nall(x => x.viz("scope"))\nall(x => x.viz("Fold"))'
    expect(applied(src, masterVizEdit(src, null))).toBe('$: s("bd")\nall(x => x.viz("scope"))')
  })

  it('renames a master viz method into a .viz() call, keeping its options', () => {
    const src = 'all(x => x._pianoroll({ background: "#c13" }))'
    expect(applied(src, masterVizEdit(src, 'Fold'))).toBe('all(x => x.viz("Fold", { background: "#c13" }))')
  })

  it('clears a master viz method line', () => {
    const src = '$: s("bd")\nall(x => x._pianoroll())'
    expect(applied(src, masterVizEdit(src, null))).toBe('$: s("bd")')
  })

  it('clears a track-level background call when no master one is present', () => {
    const src = `lead: note("c").viz("Fold", { backdrop: true, theme: 'white' }).gain(0.5)`
    expect(applied(src, masterVizEdit(src, null))).toBe('lead: note("c").gain(0.5)')
    const src2 = `$: note("c").pianoroll({ background: '#cc1133' })`
    expect(applied(src2, masterVizEdit(src2, null))).toBe('$: note("c")')
  })

  it('still sets a fresh master line over a track-level background (it wins at play)', () => {
    const src = '$: note("c").scope()'
    expect(applied(src, masterVizEdit(src, 'Fold'))).toBe('$: note("c").scope()\nall(x => x.viz("Fold", { backdrop: true }))')
  })
})

describe('detectMasterAudioAll — a viz-method line is presentation, not audio', () => {
  it('skips a master line carrying only a viz method', () => {
    expect(detectMasterAudioAll('all(x => x._pianoroll())\nall(x => x.gain(0.8))')?.statementText).toBe(
      'all(x => x.gain(0.8))',
    )
  })
})
