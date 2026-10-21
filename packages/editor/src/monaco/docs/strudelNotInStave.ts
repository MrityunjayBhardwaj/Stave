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
 *
 * When a feature lands in Stave, delete its row — `strudelNotInStave.test.ts`
 * fails while a row names something Stave's Strudel scope defines.
 */

import type { CommonMistake } from './types'

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
]

function hintFor(row: NotInStave, shown: string): string {
  const base = `${shown} is part of Strudel (it ${row.what}), but it isn't in Stave yet.`
  return row.meanwhile ? `${base} ${row.meanwhile}` : base
}

/**
 * The table as curated hints — one per name, so the hint repeats the name the
 * code actually used (`accX`, not the row's first name).
 */
export function notInStaveMistakes(rows: readonly NotInStave[] = STRUDEL_NOT_IN_STAVE): CommonMistake[] {
  const out: CommonMistake[] = []
  for (const row of rows) {
    const link = { label: `#${row.issue}`, url: `${ISSUES}${row.issue}`, description: 'Follow it in Stave' }
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
        // "s(...).mqtt is not a function" (Chrome, Firefox); Safari spells the receiver out.
        detect: { kind: 'message', match: new RegExp(`\\.${method} is not a function`) },
        hint: hintFor(row, `\`.${method}()\``),
        link,
      })
    }
  }
  return out
}
