import { describe, it, expect } from 'vitest'
import { detectChunk, detectAllChunks, isChunkFresh, type ChunkInfo } from '../chunkDetect'
import { chunkSurface } from '../surface/surfaceRoute'
import { parseStepGrid } from '../notation/parse'
import { serializeStepGrid } from '../notation/serialize'
import { cellOn } from '../notation/model'
import type { StepGridModel } from '../notation/model'
import { readChunkGain, gridWriteEdits } from '../notation/gainEdit'
import { applyEdits } from '../writeback'
import { knobsFromChunk } from '../../visualEdit/panels/MixerBody'

/**
 * #2120 — a rhythm line in `.struct(…)` is a pattern the Pattern tab can open.
 *
 * `.struct` takes WHEN from its argument and WHAT from the chain, so with the cursor
 * in a rhythm line the grid used to show the chords instead: the lookup never looked
 * inside a method's argument partway along the chain.
 */

const LINES = [
  'x ~ x x ~ x ~ x x ~ x ~ ~ x ~ x',
  '~ x x ~ x ~ x x ~ x ~ x x ~ x ~',
  'x x ~ x ~ x x ~ x ~ ~ x ~ x x ~',
]

/** The track the issue was filed from, verbatim, with what it refers to. */
const SONG = `const roll = (n, seed) => irand(n).early(seed * 13.7).segment(1).slow(64)
const vamp = "<Em9 A13>"
const clavM = "<1 1 0 1>"
const clav = chord(vamp).voicing()
  .struct(roll(3, 3).pick([
    "${LINES[0]}",
    "${LINES[1]}",
    "${LINES[2]}"
  ]))
  .s("gm_clavinet").clip(0.25).lpf(3000).gain(0.4).mask(clavM)

$: clav`

const PLAIN = '$: chord("<Em9 A13>").voicing().struct("x ~ x x ~ x ~ x").s("piano").gain(0.5)'

/** The cursor a little way into `needle`'s first occurrence. */
const at = (doc: string, needle: string) => doc.indexOf(needle) + 3

function grid(c: ChunkInfo): StepGridModel {
  const r = parseStepGrid(c.miniString!)
  if (!r.ok) throw new Error(`grid declined: ${r.reason}`)
  return r.model
}

/** Turn step `i` of the only lane on or off, as a click does. */
function toggle(m: StepGridModel, i: number): StepGridModel {
  return {
    ...m,
    lanes: m.lanes.map((l) => ({ ...l, cells: l.cells.map((cell, j) => (j === i ? (cell ? false : cellOn()) : cell)) })),
  }
}

describe('chunkDetect — a .struct rhythm line is the pattern (#2120)', () => {
  it('each rhythm line of the song opens on its own, as a one-lane step grid', () => {
    for (const line of LINES) {
      const c = detectChunk(SONG, at(SONG, line))!
      expect(c.miniString, line).toBe(line)
      expect(c.structRhythm).toBe(true)
      expect(chunkSurface(c)).toBe('step')
      const m = grid(c)
      expect(m.lanes.map((l) => l.sound)).toEqual(['x'])
      expect(m.steps).toBe(16)
    }
  })

  it('a plain string in .struct opens too', () => {
    const c = detectChunk(PLAIN, at(PLAIN, 'x ~ x x'))!
    expect(c.miniString).toBe('x ~ x x ~ x ~ x')
    expect(chunkSurface(c)).toBe('step')
  })

  it('a cursor anywhere else in the track binds what it bound before', () => {
    // the chooser, the sound, the mask: none of them is a rhythm line.
    for (const needle of ['roll(3, 3)', 'gm_clavinet', 'mask(clavM']) {
      const c = detectChunk(SONG, SONG.indexOf(needle) + 1)!
      expect(c.structRhythm, needle).toBeUndefined()
      expect(c.headFn, needle).toBe('chord')
    }
    const masked = '$: chord("<Em9 A13>").struct("x ~ x x").mask("1 0 1 1")'
    expect(detectChunk(masked, at(masked, '1 0 1 1'))!.structRhythm).toBeUndefined()
  })

  it("a step click changes that line's bytes and nothing else, and re-finds the same line", () => {
    for (const doc of [SONG, PLAIN]) {
      const line = doc === SONG ? LINES[1] : 'x ~ x x ~ x ~ x'
      const c = detectChunk(doc, at(doc, line))!
      expect(isChunkFresh(doc, c)).toBe(true)
      // useActiveChunk.applyEdit re-detects at statementRange[0] before writing.
      const again = detectChunk(doc, c.statementRange[0])!
      expect(again.miniRange).toEqual(c.miniRange)
      const next = serializeStepGrid(toggle(grid(again), 0))!
      expect(next).not.toBe(line)
      const out = applyEdits(doc, gridWriteEdits(again, next, null)!)
      expect(out).toBe(doc.replace(line, next))
    }
  })

  it('goes stale when anything else in the statement changes, since the mixer writes there', () => {
    const c = detectChunk(SONG, at(SONG, LINES[0]))!
    expect(isChunkFresh(SONG.replace('.gain(0.4)', '.gain(0.8)'), c)).toBe(false)
  })

  it("the velocity lane hands off: the chain's .gain is the track's, not this line's", () => {
    const c = detectChunk(PLAIN, at(PLAIN, 'x ~ x x'))!
    expect(readChunkGain(c).foreign).toBe(true)
    expect(readChunkGain(detectAllChunks(PLAIN)[0])).toEqual({ mini: null, numeric: 0.5, foreign: false })
  })

  it("the side panel shows the track's own controls", () => {
    const methods = (c: ChunkInfo) => knobsFromChunk(c).map((k) => k.method)
    const doc = '$: chord("<Em9 A13>").lpf(800).struct("x ~ x x").s("piano").room(0.3)'
    expect(methods(detectChunk(doc, at(doc, 'x ~ x x'))!)).toEqual(methods(detectAllChunks(doc)[0]))
    expect(methods(detectAllChunks(doc)[0])).toEqual(['lpf', 'room'])
  })
})
