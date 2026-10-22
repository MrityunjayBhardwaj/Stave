/**
 * #1929 — the built-in sketches draw a note at the pitch Strudel plays it.
 *
 * A sketch runs sandboxed and cannot import, so each built-in sketch used to parse
 * note names itself with `/^([a-g])(b|#)?(-?\d+)$/`, which has no pitch for `cs3`,
 * `g` or `ef3`. The engine now reads the pitch once (`IREvent.midi`, through the
 * one note reader) and the sketches read that. These arms run the sketches' own
 * helper functions, taken out of the shipped sketch source, on a hap that travels
 * the real path: `normalizeStrudelHap` → (worker) `MainSignalSampler`'s raw feed →
 * `RawSchedulerShim.query`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  PIANOROLL_P5_CODE,
  FSCOPE_P5_CODE,
  SPECTRUM_P5_CODE,
  PITCHWHEEL_P5_CODE,
} from '../builtinP5Code'
import { normalizeStrudelHap } from '../../engine/NormalizedHap'
import { MainSignalSampler } from '../worker/signalSampler'
import { RawSchedulerShim } from '../worker/rawShims'
import type { IREvent } from '../../codeView/ir/IREvent'

/**
 * A named function from a sketch's source, evaluated beside every other top-level
 * function there (so one helper can call another) with p5's `pow`. Nothing runs:
 * `setup`/`draw` are only declared.
 */
function sketchFn(src: string, name: string): (h: unknown) => unknown {
  const declarations = src.match(/^function \w+\([^)]*\) \{\n[\s\S]*?\n\}\n/gm) ?? []
  expect(declarations.some((d) => d.startsWith(`function ${name}(`)), `${name} in the sketch`).toBe(true)
  // eslint-disable-next-line no-new-func
  return new Function('pow', `${declarations.join('')}; return ${name}`)(Math.pow)
}

/** The hap a sketch on the main thread sees. */
function mainEvent(value: Record<string, unknown>): IREvent {
  return normalizeStrudelHap({ whole: { begin: 0, end: 1 }, value })
}

/** The same hap after the worker's raw feed and the sketch-side shim. */
function workerEvent(value: Record<string, unknown>): IREvent {
  const event = mainEvent(value)
  const sampler = new MainSignalSampler()
  sampler.bind({ scheduler: { now: () => 0.5, query: () => [event] } })
  const shim = new RawSchedulerShim()
  shim.set(sampler.sample().rawScheduler)
  const [out] = shim.query(0, 1)
  return out
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

const PATHS = [
  ['main thread', mainEvent],
  ['worker', workerEvent],
] as const

// Strudel's pitch for each (`noteToMidi`, default octave 3); `c3` is the control
// the old grammar already read.
const NOTES: Array<[string, number]> = [
  ['c3', 48],
  ['cs3', 49],
  ['g', 55],
  ['ef3', 51],
]

describe.each(PATHS)('built-in sketches read the pitch on the %s (#1929)', (_label, toEvent) => {
  const hapFreqs = [
    ['Frequency Scope', sketchFn(FSCOPE_P5_CODE, 'hapFreq')],
    ['Spectrum', sketchFn(SPECTRUM_P5_CODE, 'hapFreq')],
    ['Pitchwheel', sketchFn(PITCHWHEEL_P5_CODE, 'hapFreq')],
  ] as const
  const valueOf = sketchFn(PIANOROLL_P5_CODE, 'valueOf')

  it.each(NOTES)('%s is drawn at MIDI %i', (name, midi) => {
    expect(valueOf(toEvent({ note: name })), 'Piano Roll row').toBe(midi)
    for (const [sketch, hapFreq] of hapFreqs) {
      expect(hapFreq(toEvent({ note: name })) as number, sketch).toBeCloseTo(hz(midi), 9)
    }
  })

  it('reads n the way it reads note', () => {
    expect(valueOf(toEvent({ n: 'cs3', s: 'piano' }))).toBe(49)
  })

  it('a written freq wins over the note, as in Strudel', () => {
    expect(valueOf(toEvent({ note: 'c3', freq: 440 }))).toBe(69)
    for (const [sketch, hapFreq] of hapFreqs) expect(hapFreq(toEvent({ note: 'c3', freq: 440 })), sketch).toBe(440)
  })

  it('a note number is its own pitch', () => {
    expect(valueOf(toEvent({ note: 60 }))).toBe(60)
    for (const [sketch, hapFreq] of hapFreqs) expect(hapFreq(toEvent({ note: 60 })) as number, sketch).toBeCloseTo(hz(60), 9)
  })

  it('a name that is not a note, and a drum with no note, have no pitch', () => {
    expect(valueOf(toEvent({ note: 'bd' }))).toBe('_bd')
    expect(valueOf(toEvent({ s: 'bd' }))).toBe('_bd')
    for (const [sketch, hapFreq] of hapFreqs) {
      expect(hapFreq(toEvent({ note: 'bd' })), sketch).toBeNull()
      expect(hapFreq(toEvent({ s: 'bd' })), sketch).toBeNull()
    }
  })
})

describe('no sketch carries a note grammar of its own (#1929)', () => {
  it('the old note-name regex appears nowhere in the built-in sketch source', () => {
    const OLD_GRAMMAR = '[a-g])(b|#)?(-?'
    const source = readFileSync(path.join(__dirname, '..', 'builtinP5Code.ts'), 'utf8')
    expect(source.includes(OLD_GRAMMAR)).toBe(false)
    // Control: the same search finds it where it is written (this file).
    expect(readFileSync(__filename, 'utf8').includes(OLD_GRAMMAR)).toBe(true)
  })
})
