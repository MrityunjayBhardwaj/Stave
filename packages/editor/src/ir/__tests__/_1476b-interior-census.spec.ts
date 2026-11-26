/**
 * #1476 PROBE — BEFORE measurement for the interior rule.
 *
 * Two questions, both answered against the real archive:
 *   1. On `0/-7zrPK5Bii8_`: does the live track keep its `.slow(".1275")` tail
 *      today, and is there a phantom commented row?
 *   2. Census: over every document, how many carry a commented label that is
 *      INTERIOR to a top-level statement — i.e. the blast radius of the rule.
 *
 * The predicate is spelled out here so this probe measures the SAME thing
 * before and after the fix lands in `extractTracks`.
 */
import { describe, it } from 'vitest'
import { extractTracks, splitTopLevelStatements, parseStrudel } from '../parseStrudel'
import {
  hasCorpusArchive,
  loadEveryCorpusDocument,
} from '../../visualEdit/miniSource/__tests__/evalHarness'

function leaves(n: unknown): number {
  let c = 0
  const visit = (x: unknown): void => {
    if (x === null || typeof x !== 'object') return
    if (Array.isArray(x)) return void x.forEach(visit)
    const r = x as Record<string, unknown>
    if (r.tag === 'Play' || r.tag === 'Sound') c++
    for (const [k, v] of Object.entries(r)) {
      if (k === 'loc') continue
      visit(v)
    }
  }
  visit(n)
  return c
}

/** Is `pos` strictly inside some top-level statement's extent? */
function interiorToStatement(code: string, pos: number): boolean {
  return splitTopLevelStatements(code, 0).some(
    (s) => pos > s.offset && pos < s.offset + s.text.length,
  )
}

describe('#1476 interior census', () => {
  it.skipIf(!hasCorpusArchive())('measures the target doc and the blast radius', async () => {
    const docs = await loadEveryCorpusDocument()
    // eslint-disable-next-line no-console
    console.log(`population = ${docs.length}`)

    const doc = docs.find((d) => d.name === '0/-7zrPK5Bii8_')
    if (!doc) throw new Error(`target not found; population = ${docs.length}`)
    const tracks = extractTracks(doc.code)
    // eslint-disable-next-line no-console
    console.log(
      `TARGET 0/-7zrPK5Bii8_: tracks=${tracks.length} ` +
        `commented=${tracks.filter((t) => t.commented).length} ` +
        `liveKeepsTail=${tracks.some((t) => !t.commented && t.expr.includes('.slow(".1275")'))} ` +
        `leaves=${leaves(parseStrudel(doc.code))}`,
    )
    for (const t of tracks) {
      // eslint-disable-next-line no-console
      console.log(
        `  label=${t.label} commented=${t.commented} dollarStart=${t.dollarStart} ` +
          `end=${t.end} exprLen=${t.expr.length}`,
      )
    }

    // Census. Re-run the label scan the same way extractTracks does, and ask
    // the interior question of every COMMENTED entry it admits today.
    let docsWithCommented = 0
    let docsWithInterior = 0
    const names: string[] = []
    for (const d of docs) {
      const ts = extractTracks(d.code)
      const commented = ts.filter((t) => t.commented)
      if (commented.length === 0) continue
      docsWithCommented++
      if (commented.some((t) => interiorToStatement(d.code, t.dollarStart))) {
        docsWithInterior++
        names.push(d.name)
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `CENSUS examined=${docs.length} withCommentedLabel=${docsWithCommented} ` +
        `withINTERIORcommentedLabel=${docsWithInterior}`,
    )
    // eslint-disable-next-line no-console
    console.log(`INTERIOR docs: ${names.join(', ')}`)
  })
})
