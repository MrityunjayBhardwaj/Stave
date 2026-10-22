/**
 * The IR Inspector's intermediate views of a parse — RAW, MINI-EXPANDED and
 * CHAIN-APPLIED — derived from `parseStrudel` itself (#1387).
 *
 * ⚠ THIS FILE USED TO BE A SECOND PARSER. For the Inspector to show a parse in
 * steps, the four stages re-implemented `parseStrudel`'s decisions by hand and
 * carried state across each cut on the nodes themselves (`unresolvedChain`,
 * `dollarStart`, `trackLabel`, …). Every bug of that class landed here — #113,
 * #671, #1373, #1376, #1383, #1384, #1514, #1553 — and #1553 reached a song,
 * because the split is what made it expressible: `parseStrudel` passes a chain
 * from `parseRoot` to `applyChain` as a local and cannot lose it.
 *
 * Now `parseStrudel` records each top-level track body as it parses it
 * (`parseStrudelRecorded`), and the views are that record laid over the final
 * tree. There is nothing left here to keep in step with the parser, so the
 * corpus parity gate that watched the two is gone with it.
 *
 * What each view shows, per top-level track:
 *   RAW            the source text the track's body was parsed from, as `Code`
 *   MINI-EXPANDED  the root the parser built before applying the method chain
 *   CHAIN-APPLIED  the parser's final tree (the `Parsed` tab shows the same)
 *
 * The Track wrappers around each body — ids, `loc`, `muted` — are the final
 * tree's in every view, because the parser decides them once.
 */

import type { PatternIR } from './PatternIR'
import { parseStrudelRecorded, type TopLevelBody } from './parseStrudel'

/** One Inspector tab: its persisted name and the tree it shows. */
export interface NamedStage {
  readonly name: string
  readonly ir: PatternIR
}

export function parseStrudelStages(code: string): NamedStage[] {
  const { ir, bodies } = parseStrudelRecorded(code)
  return [
    { name: 'RAW', ir: withBodies(ir, bodies, (b) => b.raw) },
    { name: 'MINI-EXPANDED', ir: withBodies(ir, bodies, (b) => b.mini) },
    { name: 'CHAIN-APPLIED', ir },
  ]
}

/**
 * The final tree with each top-level Track's body swapped for its recorded one.
 *
 * ⚠ A tree with no top-level Tracks (an empty document, a parse that threw)
 * recorded no bodies, and is shown as it is in every view. A count that does
 * not match cannot come from `parseStrudelRecorded`; the tree is returned
 * unchanged rather than pairing a body with the wrong track, and the corpus
 * arm in `parseStrudelStages.test.ts` holds the counts equal over the archive.
 */
function withBodies(
  ir: PatternIR,
  bodies: readonly TopLevelBody[],
  pick: (b: TopLevelBody) => PatternIR,
): PatternIR {
  if (ir.tag === 'Track') {
    return bodies.length === 1 ? { ...ir, body: pick(bodies[0]) } : ir
  }
  if (
    ir.tag === 'Stack' &&
    ir.tracks.length === bodies.length &&
    ir.tracks.every((t) => t.tag === 'Track')
  ) {
    return {
      ...ir,
      tracks: ir.tracks.map((t, i) => ({ ...(t as PatternIR & { tag: 'Track' }), body: pick(bodies[i]) })),
    }
  }
  return ir
}
