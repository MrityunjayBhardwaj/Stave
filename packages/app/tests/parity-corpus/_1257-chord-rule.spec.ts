/**
 * _1257-chord-rule.spec.ts — DECISION INSTRUMENT for the chord/octave collision.
 *
 * #1256 found that the chord grammar reads a trailing octave digit as a chord
 * QUALITY, so 125 of 210 note spellings parse as chord symbols and a trumpet
 * melody gets captioned "Chord chart". This measured the candidate rule against
 * the real vocabularies and the real corpora BEFORE any production code moved,
 * because the constraint that decides it cannot be reasoned to: whatever landed
 * had to keep the three genuine charts captioned, and `<Gsus G7 Em7 D7>` contains
 * `G7` and `D7`, which are themselves ordinary note spellings. It shipped, so
 * this now measures the rule as it stands and is kept as the record of both.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────
 * Not "note names are not chords" — `C` really is a legal chord symbol, and a
 * rule that denies it is a lie about the grammar. The precedence goes one level
 * up, where the question actually is:
 *
 *   a grid is a chord chart when every lane is a chord symbol AND at least one
 *   lane is a chord symbol that is NOT also an ordinary note spelling.
 *
 * That is the `cb` precedence rule generalised rather than a second rule beside
 * it. `chordLanes.ts` already argues that "a grid's lanes are sounds by default
 * and a chord reading has to DISPLACE that rather than tie with it" — it just
 * applied the argument to one cowbell. A lane set of `a4 a4 a4 a4` ties: every
 * token is equally readable as a pitch, so nothing displaces the default. A
 * lane set containing `Gsus` does not tie, because no other reading explains it.
 *
 * The pitch question is asked of `pitchToMidi`, which is the ROLL's own
 * note-name authority (`parse.ts:3070` decides what the roll accepts with it),
 * so the two surfaces cannot come to different views about what a pitch is.
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1257-chord-rule.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isChordSymbol,
  chordLanes,
  forcesChordReading,
} from '../../../editor/src/codeView/surface/chordLanes'
import { parseStepGrid, parsePianoRoll } from '../../../editor/src/codeView/notation/parse'
import { chunkSurface, routeSurface } from '../../../editor/src/codeView/surface/surfaceRoute'
import { unitsWithStatus } from './editCoverage'
import { loadCorpus } from '../../../editor/src/codeView/miniSource/__tests__/evalHarness'
import { DRUM_SOUNDS } from '../../../editor/src/visualEdit/panels/soundCatalog'

/**
 * ⚠ THIS FILE NO LONGER HOLDS A COPY OF THE RULE, and the sequence matters.
 *
 * The candidate was spelled here first, deliberately, so that it could be
 * measured against both corpora before a line of production changed. It shipped,
 * so the copy is gone and both names below are imported from the module that
 * decides — `chordLanes` now carries the evidence clause itself, which is why
 * `candidateChordLanes` no longer exists as a separate thing to compare against.
 *
 * What that costs is the before/after column: this file measures the rule AS
 * SHIPPED, and the "125 of 210 read as a chart / 15 captioned, 3 kept" figures
 * are recorded in `chordLanes.ts` and in the issue rather than recomputed here
 * against a second implementation. A local copy kept for the comparison would be
 * a second oracle for exactly the reason #1259 existed.
 */

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
const ACCIDENTALS = ['', '#', 'b']
const OCTAVES = ['', '0', '1', '2', '3', '4', '5', '6', '7', '8']

/** the chord vocabulary the shipped predicate's own arms pin — none may be lost */
const REAL_CHORDS = ['Gsus', 'G7', 'Em7', 'D7', 'am', 'dm', 'em', 'Em11', 'Am9', 'C', 'G', 'F', 'Am']

describe('#1257 — the chord/octave collision, measured on the shipped rule', () => {
  it('the note-spelling sweep: the grammar is unmoved, the lane-set decision is not', () => {
    const tokens: string[] = []
    for (const l of LETTERS) for (const a of ACCIDENTALS) for (const o of OCTAVES) tokens.push(`${l}${a}${o}`)

    const asChart = tokens.filter((t) => chordLanes([t]))
    const asSymbol = tokens.filter((t) => isChordSymbol(t))
    console.log(`\n  note-shaped tokens              : ${tokens.length}`)
    console.log(`  legal chord SYMBOLS (unchanged) : ${asSymbol.length}`)
    console.log(`  read as a chord CHART           : ${asChart.length}   (was 125 before #1257)`)
    if (asChart.length) console.log(`    survivors: ${asChart.join(' ')}`)
    // The grammar's answer about a token must NOT have moved — only the lane-set
    // decision did. If this drops, the fix was applied at the wrong layer.
    expect(asSymbol.length).toBe(125)
    expect(asChart.length).toBe(0)

    // Whole lane SETS of note names — the shape the corpus actually contains.
    const sets = [
      ['c5', 'f5', 'a5'],
      ['a4'],
      ['c4', 'e4', 'g4'],
      ['c3', 'e3', 'g3'],
      ['a', 'b', 'c'],
      ['Gsus', 'G7', 'Em7', 'D7'],
      ['am', 'F', 'C', 'G'],
      ['C', 'F', 'G'],
      ['bd', 'sd', 'hh'],
    ]
    console.log(`\n  — lane sets, and what forces each verdict —`)
    for (const s of sets) {
      console.log(`  ${JSON.stringify(s).padEnd(34)} chart=${chordLanes(s)}  forced by ${JSON.stringify(s.filter(forcesChordReading))}`)
    }
  })

  it('the vocabularies that must not move', () => {
    // Every real chord symbol is still a chord symbol — the fix changes the
    // lane-SET decision, never the grammar's answer about one token.
    for (const sym of REAL_CHORDS) expect(isChordSymbol(sym), sym).toBe(true)

    // The drum catalogue is still rejected, all of it.
    const drums = DRUM_SOUNDS.map((d) => d.value)
    const drumChords = drums.filter((d) => isChordSymbol(d))
    console.log(`\n  drum catalogue tokens       : ${drums.length}`)
    console.log(`  read as chord symbols       : ${drumChords.length} ${JSON.stringify(drumChords)}`)

    // And the genuine chart still answers true, which is the one requirement
    // the fix was not allowed to trade away.
    expect(chordLanes(['Gsus', 'G7', 'Em7', 'D7'])).toBe(true)
  })

  it('every captioned unit in both corpora, hand-readable', async () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const vendored = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.strudel'))
      .sort()
      .map((f) => ({ name: f, code: fs.readFileSync(path.join(dir, f), 'utf8') }))
    const real = await loadCorpus()

    let kept = 0
    let dropped = 0
    for (const [label, docs] of [
      ['VENDORED CORPUS', vendored],
      ['150 REAL TUNES', real],
    ] as const) {
      console.log(`\n  ══ ${label} — units whose grid lanes ALL pass the chord test ══`)
      const seen = new Set<string>()
      for (const doc of docs) {
        for (const { unit, status } of unitsWithStatus(doc.code)) {
          if (status.status !== 'note') continue
          const mini = unit.miniString
          if (mini === null) continue
          const key = `${doc.name}|${unit.miniRange?.join(':') ?? unit.exprRange.join(':')}`
          if (seen.has(key)) continue
          seen.add(key)
          if (chunkSurface(unit) !== 'step') continue
          const grid = parseStepGrid(mini)
          if (!grid.ok) continue
          const lanes = grid.model.lanes.map((l) => l.sound)
          if (!lanes.every(isChordSymbol)) continue
          const now = chordLanes(lanes)
          if (now) kept++
          else dropped++
          const forcing = lanes.filter(forcesChordReading)
          const roll = parsePianoRoll(mini)
          console.log(
            `\n    ${doc.name}  head=${unit.headFn ?? '(none)'}` +
              `\n      mini    ${JSON.stringify(mini.slice(0, 70))}` +
              `\n      lanes   ${JSON.stringify(lanes)}` +
              `\n      chord chart: ${now}` +
              `\n      forced by ${forcing.length ? JSON.stringify(forcing) : '(nothing — every lane is also a pitch)'}` +
              `\n      the roll would ${roll.ok ? 'ACCEPT' : `decline (${(roll as { gate?: string }).gate ?? '?'})`}`,
          )
        }
      }
    }
    console.log(`\n  ══ every-lane-is-a-chord-symbol: ${kept + dropped} units — captioned ${kept}, NOT captioned ${dropped} ══`)
    // Non-vacuity: the sweep must have found the population, or every number
    // above is about an empty set.
    expect(kept + dropped).toBeGreaterThan(0)
  }, 900_000)

  it('the routing caller, on the shapes that reach it', () => {
    console.log(`\n  — routeSurface('note', …) —`)
    for (const mini of [
      'c4 e4 g4',
      'c4 e4 p1 g4',
      'a3:0.7 c4 e4',
      '<Gsus G7 Em7 D7>',
      '<am F C G>',
    ]) {
      const roll = parsePianoRoll(mini)
      const grid = parseStepGrid(mini)
      const lanes = grid.ok ? grid.model.lanes.map((l) => l.sound) : []
      console.log(
        `  ${JSON.stringify(mini).padEnd(24)} route=${routeSurface('note', mini)}` +
          `  rollGate=${roll.ok ? 'ok' : ((roll as { gate?: string }).gate ?? '?')}` +
          `  lanes=${JSON.stringify(lanes)}` +
          `  chart=${chordLanes(lanes)}`,
      )
    }
  })
})
