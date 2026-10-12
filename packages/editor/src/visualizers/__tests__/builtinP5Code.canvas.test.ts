/**
 * #2021 — every bundled p5 sketch sizes its canvas from the area it is given.
 *
 * A sketch that asks for a fixed size gets exactly that many pixels, and every
 * renderer then stretches them over whatever area the sketch occupies: Pitchwheel
 * and Spiral asked for 300 x 200 and drew a squashed, blurred wheel in a 1143 x 229
 * inline area. `stave.width` / `stave.height` are the area's own size.
 */
import { describe, it, expect } from 'vitest'
import * as sketches from '../builtinP5Code'

const SOURCES: [string, string][] = Object.entries(sketches as Record<string, unknown>).flatMap(([name, src]) =>
  typeof src === 'string' && name.endsWith('_P5_CODE') ? [[name, src] as [string, string]] : [],
)

describe('bundled p5 sketches — canvas size (#2021)', () => {
  it('finds the bundled sketches', () => {
    // control: an export rename must not turn the arm below into a check of nothing
    expect(SOURCES.map(([name]) => name)).toEqual(
      expect.arrayContaining(['PIANOROLL_P5_CODE', 'PITCHWHEEL_P5_CODE', 'SPIRAL_P5_CODE', 'SCOPE_P5_CODE']),
    )
    expect(SOURCES.length).toBeGreaterThanOrEqual(9)
  })

  it.each(SOURCES)('%s creates its main canvas at the size of its area', (_name, src) => {
    const calls = [...src.matchAll(/^\s*createCanvas\(([^)]*)\)/gm)].map((m) => m[1].trim())
    expect(calls.length).toBeGreaterThanOrEqual(1)
    for (const args of calls) expect(args).toBe('stave.width, stave.height')
  })
})
