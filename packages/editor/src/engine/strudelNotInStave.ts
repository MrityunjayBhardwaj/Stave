/**
 * #2167 — Strudel features Stave does not have yet, and what to say when
 * code uses one.
 *
 * Code pasted from strudel.cc that calls one of these fails with the
 * browser's own words (`gamepad is not defined`, `s(...).mqtt is not a
 * function`), which reads as Stave being broken — and the fuzzy fallback
 * makes it worse (`H` got "Did you mean `s`?"). Each row here becomes a
 * set of curated hints in `STRUDEL_DOCS_INDEX.globalMistakes`, so the console says
 * the feature belongs to Strudel and links the issue that tracks it.
 *
 * The names are each module's own exports and registered methods, read
 * from the published packages (@strudel/osc 1.3.2, csound 1.3.0, mqtt
 * 1.2.6, serial 1.2.6, gamepad 1.2.6, motion 1.2.6, tidal 0.1.0, hydra
 * 1.2.6). `markcss` is a core method that Strudel's editor implements.
 * `edoScale` is read from @strudel/edo's source (strudel f73b3956), since that
 * package is not on npm yet.
 *
 * When a feature lands in Stave, delete its row — `strudelNotInStave.test.ts`
 * fails while a row names something Stave's Strudel scope defines.
 *
 * #2191 — it lives in `engine/` (it was in `monaco/docs/`) because the engine
 * reads its `inertMethods`, and the engine may not import from `monaco/`;
 * `monaco/strudelDocs.ts` reads the hints from here.
 */

import type { CommonMistake } from '../monaco/docs/types'

const ISSUES = 'https://github.com/MrityunjayBhardwaj/stave/issues/'

export interface NotInStave {
  /** what the feature does, as the hint says it */
  what: string
  /** the issue tracking it in Stave */
  issue: number
  /** names code uses bare: `gamepad(0)`, `accelerationX` */
  names?: readonly string[]
  /** names code chains on a pattern: `.osc()` */
  methods?: readonly string[]
  /**
   * #2191 — methods Stave's patterns DO have, because Strudel's sound module
   * imports its drawing module for its own use, but which would draw where
   * nobody can see. They never fail, so the hint cannot ride an error: the
   * engine swaps each for one that warns once per evaluation (`inertNotice`)
   * and returns what Strudel's own method returns, so what is heard stays
   * Strudel's: `.animate()` gives `silence` (its pattern is drawn, not
   * played), `.onPaint()` the pattern it was called on.
   */
  inertMethods?: Readonly<Record<string, { returns: 'pattern' | 'silence'; heard: string }>>
  /** a sentence on what to do in Stave meanwhile, when there is one */
  meanwhile?: string
}

export const STRUDEL_NOT_IN_STAVE: readonly NotInStave[] = [
  { what: 'sends patterns to SuperCollider over OSC', issue: 126, methods: ['osc'] },
  {
    what: 'plays patterns through Csound',
    issue: 124,
    names: ['loadCsound', 'loadcsound', 'loadCSound', 'loadOrc'],
    methods: ['csound', 'csoundm'],
  },
  { what: 'sends patterns to an MQTT broker', issue: 130, methods: ['mqtt'] },
  { what: 'sends patterns to a serial device, such as a microcontroller', issue: 127, methods: ['serial'] },
  { what: 'reads a game controller', issue: 128, names: ['gamepad'] },
  {
    what: "reads the device's motion sensors",
    issue: 129,
    names: [
      'enableMotion',
      'accelerationX', 'accelerationY', 'accelerationZ', 'accX', 'accY', 'accZ',
      'gravityX', 'gravityY', 'gravityZ', 'gravX', 'gravY', 'gravZ',
      'rotationAlpha', 'rotationBeta', 'rotationGamma', 'rotationX', 'rotationY', 'rotationZ',
      'rotA', 'rotB', 'rotG', 'rotX', 'rotY', 'rotZ',
      'orientationAlpha', 'orientationBeta', 'orientationGamma',
      'orientationA', 'orientationB', 'orientationG', 'orientationX', 'orientationY', 'orientationZ',
      'oriA', 'oriB', 'oriG', 'oriX', 'oriY', 'oriZ',
      'absoluteOrientationAlpha', 'absoluteOrientationBeta', 'absoluteOrientationGamma',
      'absoluteOrientationX', 'absoluteOrientationY', 'absoluteOrientationZ',
      'absOriA', 'absOriB', 'absOriG', 'absOriX', 'absOriY', 'absOriZ',
    ],
  },
  { what: 'runs code written in Tidal syntax', issue: 125, names: ['tidal', 'initTidal'] },
  {
    what: 'draws Hydra visuals from inside Strudel code',
    issue: 2169,
    names: ['initHydra', 'clearHydra', 'H'],
    meanwhile: 'Hydra runs in Stave from a `.hydra` file.',
  },
  { what: 'styles the highlighted code', issue: 2168, methods: ['markcss'] },
  // #2190 — Strudel's REPL loads @strudel/edo; Stave can't until it is published (#121).
  {
    what: 'builds scales that split the octave into any number of equal steps',
    issue: 121,
    names: ['edoScale'],
    methods: ['edoScale'],
  },
  // #2191 — @strudel/draw's own canvas, which the engine leaves out on purpose
  // (StrudelEngine: "drawMod (@strudel/draw) intentionally excluded"). Its viz
  // methods (`.pianoroll()` …) are Stave's own (STRUDEL_VIZ_METHODS); these are the rest.
  {
    what: "draws on Strudel's own full-screen canvas",
    issue: 2191,
    names: [
      'getDrawContext', 'cleanupDraw', 'cleanupDrawContext', 'getDrawOptions',
      'drawPianoroll', 'getPunchcardPainter', 'pianoroll', '__pianoroll', 'pitchwheel',
      'Drawer', 'Framer',
    ],
    // what each returns is read from @strudel/draw (animate.mjs `return silence`,
    // draw.mjs `onPaint` → `this.withState(…)`)
    inertMethods: {
      animate: { returns: 'silence', heard: 'As in Strudel, the pattern it draws makes no sound, and here nothing is drawn.' },
      onPaint: { returns: 'pattern', heard: 'The sound still plays, but nothing is drawn.' },
    },
    meanwhile: 'Stave draws patterns with `.pianoroll()`, `.scope()` and its other visuals, and a `.p5` file draws anything else.',
  },
]

function hintFor(row: NotInStave, shown: string, also?: string): string {
  const base = [`${shown} is part of Strudel (it ${row.what}), but it isn't in Stave yet.`, also, row.meanwhile]
  return base.filter(Boolean).join(' ')
}

function linkFor(row: NotInStave) {
  return { label: `#${row.issue}`, url: `${ISSUES}${row.issue}`, description: 'Follow it in Stave' }
}

/** #2191 — every inert method, for the engine to swap during an evaluation. */
export function inertMethodNames(rows: readonly NotInStave[] = STRUDEL_NOT_IN_STAVE): string[] {
  return rows.flatMap((row) => Object.keys(row.inertMethods ?? {}))
}

/**
 * #2191 — what to say when code calls one of the `inertMethods` (the same
 * sentence an error would get, plus what is heard) and what the call returns.
 * `null` for any other method.
 */
export function inertNotice(
  method: string,
  rows: readonly NotInStave[] = STRUDEL_NOT_IN_STAVE,
): { message: string; link: ReturnType<typeof linkFor>; returns: 'pattern' | 'silence' } | null {
  for (const row of rows) {
    const own = row.inertMethods && Object.prototype.hasOwnProperty.call(row.inertMethods, method)
    const inert = own ? row.inertMethods![method] : undefined
    if (inert) return { message: hintFor(row, `\`.${method}()\``, inert.heard), link: linkFor(row), returns: inert.returns }
  }
  return null
}

/**
 * The table as curated hints — one per name, so the hint repeats the name the
 * code actually used (`accX`, not the row's first name).
 */
export function notInStaveMistakes(rows: readonly NotInStave[] = STRUDEL_NOT_IN_STAVE): CommonMistake[] {
  const out: CommonMistake[] = []
  for (const row of rows) {
    const link = linkFor(row)
    for (const name of row.names ?? []) {
      out.push({
        // Chrome, Edge and Firefox say "x is not defined"; Safari says "Can't find variable: x".
        detect: { kind: 'message', match: new RegExp(`^(?:${name} is not defined|Can't find variable: ${name})$`) },
        hint: hintFor(row, `\`${name}\``),
        link,
      })
    }
    for (const method of row.methods ?? []) {
      out.push({
        // "s(...).mqtt is not a function" in every browser; Safari's is reworded to it first (#2196).
        detect: { kind: 'message', match: new RegExp(`\\.${method} is not a function`) },
        hint: hintFor(row, `\`.${method}()\``),
        link,
      })
    }
  }
  return out
}
