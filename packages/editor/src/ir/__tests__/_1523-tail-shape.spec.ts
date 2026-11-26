/**
 * #1523 DESIGN PROBE — what IS the tail of a bare binding-bearing document?
 *
 * The partition probe found the #1523 shape is 2 of 558, not 13 of 329, and
 * BOTH of those two are large JS programs whose tail is mostly side effects:
 *
 *   "LA Wildfire Dirge"  — 8 bindings, then two `function` declarations, four
 *                          `randomTimeout(…)` calls, and finally the `stack(…)`
 *                          that is the actual music.
 *   "Kolamesque"         — one binding, then a p5 sketch, a `window.inited`
 *                          guard, an `await import`, a prototype assignment,
 *                          a destructuring binding, and finally `stack(…)`.
 *
 * So "one track per trailing statement" — the rule #1096 measured and adopted
 * for binding-FREE documents — would give those two documents six and seven
 * junk rows. Whether that rule transfers is the question this file answers, by
 * counting what tail statements actually ARE across the whole archive rather
 * than by arguing from two documents.
 *
 * Three candidate readings:
 *   (a) N tracks, one per tail statement            — #1096's rule, extended
 *   (b) the LAST tail statement is the music        — strudel's repl rule
 *   (c) N tracks, keeping only tail statements that PARSE musically
 *
 * ⚠ A statement is called "musical" here iff `parseExpression` gives it
 * something other than a bare give-up `Code` node — the parser's own verdict,
 * not a name list.
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import crypto from 'node:crypto'
import {
  parseStrudel,
  collectTopLevelBindings,
  extractTracks,
} from '../parseStrudel'
import type { PatternIR } from '../PatternIR'

const CORPUS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../app/tests/parity-corpus/.bakery-runs',
)

function loadEveryDocument(): { name: string; code: string }[] {
  const isOutput = (f: string): boolean =>
    f.startsWith('result-') || f.startsWith('edit-result-') || f.startsWith('ir-support-result')
  const files = fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.json') && !isOutput(f))
    .sort()
  const seen = new Set<string>()
  const out: { name: string; code: string }[] = []
  for (const f of files) {
    let j: { offset?: unknown; samples?: { hash?: string; code?: unknown }[] }
    try {
      j = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8'))
    } catch {
      continue
    }
    for (const s of j.samples ?? []) {
      if (typeof s.code !== 'string') continue
      const sha = crypto.createHash('sha256').update(s.code).digest('hex')
      if (seen.has(sha)) continue
      seen.add(sha)
      out.push({ name: `${j.offset}/${s.hash}`, code: s.code })
    }
  }
  return out
}

function isBareCode(n: PatternIR): boolean {
  return n.tag === 'Code' && (n as unknown as { via?: unknown }).via === undefined
}

function isWhollyOpaque(n: PatternIR): boolean {
  if (n.tag === 'Track') return isWhollyOpaque((n as unknown as { body: PatternIR }).body)
  if (n.tag === 'Stack') {
    const tracks = (n as unknown as { tracks: PatternIR[] }).tracks
    return tracks.length > 0 && tracks.every(isWhollyOpaque)
  }
  return isBareCode(n)
}

/**
 * Does the document declare a `$:` / `name:` track?
 *
 * ⚠ THIS ASKS THE PARSER, and the first version of this probe did not — it used
 * a regex requiring the expression on the SAME LINE as the label, so a document
 * written
 *
 *     hater:
 *       s("drumloop_170:2 …")
 *
 * read as BARE. Six labelled documents entered the bare population that way, and
 * their labels came back as separate "statements" that then parsed "musically",
 * which is the only reason the miscount was visible at all. The dispatch this
 * probe partitions is `extractTracks`; nothing else is entitled to answer for it.
 */
function hasTrackLabel(code: string): boolean {
  return extractTracks(code).length > 0
}

describe('#1523 — what a bare binding-bearing document\'s tail is made of', () => {
  it('classifies every tail statement across the archive', () => {
    const docs = loadEveryDocument()
    expect(docs.length).toBeGreaterThan(500)

    let population = 0
    let opaqueToday = 0
    const tailLenHist: Record<number, number> = {}
    let totalTail = 0
    let musicalTail = 0
    /** documents whose LAST tail statement is the only musical one → rule (b) fits */
    let lastOnlyMusical = 0
    /** documents where EVERY tail statement is musical → rules (a) and (c) agree */
    let allMusical = 0
    /** documents where SOME but not all are musical → (a) and (c) DIVERGE */
    const mixed: string[] = []
    /** documents where NO tail statement is musical → nothing to build a track from */
    let noneMusical = 0
    const perDoc: string[] = []

    for (const d of docs) {
      if (hasTrackLabel(d.code)) continue
      const engine = collectTopLevelBindings(d.code, 0)
      if (engine === null || engine.tail.length < 2) continue
      population++
      if (isWhollyOpaque(parseStrudel(d.code))) opaqueToday++
      tailLenHist[engine.tail.length] = (tailLenHist[engine.tail.length] ?? 0) + 1

      // Parse each tail statement WITH the resolved bindings — exactly what a
      // fix would do — and ask the parser whether it is music.
      const verdicts = engine.tail.map((s) => {
        // `parseExpression` is not exported; `parseStrudel` on the statement
        // text alone reaches the same single-expression path, and its synthetic
        // Track wrapper is transparent to `isWhollyOpaque`.
        try {
          return !isWhollyOpaque(parseStrudel(s.text))
        } catch {
          return false
        }
      })
      perDoc.push(
        `  ${d.name} tail=${verdicts.length} musical=${verdicts.filter(Boolean).length}\n` +
          engine.tail
            .map(
              (st, i) =>
                `      [${verdicts[i] ? 'MUSIC' : ' ---'}] ${JSON.stringify(st.text.replace(/\s+/g, ' ').slice(0, 90))}`,
            )
            .join('\n'),
      )
      totalTail += verdicts.length
      musicalTail += verdicts.filter(Boolean).length
      const nMusical = verdicts.filter(Boolean).length
      if (nMusical === 0) noneMusical++
      else if (nMusical === verdicts.length) allMusical++
      else {
        mixed.push(`${d.name} (${nMusical}/${verdicts.length} musical)`)
        if (nMusical === 1 && verdicts[verdicts.length - 1]) lastOnlyMusical++
      }
    }

    console.log(
      [
        `bare + leading binding + ≥2 tail statements : ${population} of ${docs.length}`,
        `  …wholly opaque today                     : ${opaqueToday}`,
        `tail statements, total                     : ${totalTail}`,
        `  …that parse musically                    : ${musicalTail}`,
        '',
        `documents where EVERY tail stmt is musical  : ${allMusical}   ← (a) and (c) agree`,
        `documents where SOME are                    : ${mixed.length}   ← (a) and (c) DIVERGE`,
        `  …of those, ONLY the last one is musical   : ${lastOnlyMusical}   ← (b)'s population`,
        `documents where NONE is musical             : ${noneMusical}`,
        '',
        `tail length histogram : ${JSON.stringify(tailLenHist)}`,
        '',
        'EVERY document in the population, statement by statement:',
        ...perDoc,
        '',
        'the mixed documents:',
        ...mixed.map((m) => `  ${m}`),
      ].join('\n'),
    )

    expect(population).toBeGreaterThan(0)
  })
})
