/**
 * #1553 PROBE — the OBSERVABLE the move must preserve: lane keys and their
 * containment anchors, as the timeline actually derives them.
 *
 * Run this on BOTH sides of the parser change (save-patch / revert / measure /
 * re-apply). Anything that differs is a user-visible change in the timeline,
 * not an internal reshuffle.
 */
import { describe, it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { pipeline, stripStageMeta } from './helpers/stagesParity'
import { walkLeafItems } from '../structuralWalk'
import { hasCorpusArchive, loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'

/** Distinct lane keys, in first-seen order, with each lane's smallest loc start. */
function lanes(ir: unknown): string {
  let items: Array<Record<string, unknown>>
  try {
    items = walkLeafItems(ir as never, 4) as unknown as Array<Record<string, unknown>>
  } catch (e) {
    return `THREW ${String(e).slice(0, 80)}`
  }
  const first = new Map<string, number | undefined>()
  for (const it of items) {
    const k = String(it.laneKey)
    const loc = (it.loc as Array<{ start?: number }> | undefined)?.[0]?.start
    if (!first.has(k)) first.set(k, loc)
    else {
      const prev = first.get(k)
      if (typeof loc === 'number' && (prev === undefined || loc < prev)) first.set(k, loc)
    }
  }
  return [...first.entries()].map(([k, v]) => `${k}@${v}`).join(' ')
}

const CASES: [string, string][] = [
  ['comma, no chain', '$: s("bd, cp")'],
  ['comma + chain', '$: s("bd, cp").gain(0.5)'],
  ['comma + 2 chain', '$: s("bd, cp").slow(2).room(0.3)'],
  ['bracketed stack', '$: s("[bd,cp]")'],
  ['3 arms', '$: s("bd*2, ~ sd, hh*4")'],
  ['bare comma', 's("bd, cp")'],
  ['two statements', '$: s("bd")\n$: s("cp")'],
  ['two statements, first comma', '$: s("bd, cp")\n$: s("hh")'],
  ['named', 'drums: s("bd, cp")\nbass: s("hh")'],
  ['no comma', '$: s("bd").gain(0.5)'],
]

describe('#1553 lanes', () => {
  for (const [name, code] of CASES) {
    it(name, () => {
      // eslint-disable-next-line no-console
      console.log(
        `LANES  ${name.padEnd(26)} | staged: ${lanes(stripStageMeta(pipeline(code)))}` +
          ` | mono: ${lanes(stripStageMeta(parseStrudel(code)))}`,
      )
    })
  }

  it.skipIf(!hasCorpusArchive())('corpus lane digest', async () => {
    const corpus = await loadEveryCorpusDocument()
    const out: string[] = []
    for (const { name, code } of corpus) {
      let l: string
      try { l = lanes(stripStageMeta(pipeline(code))) } catch { l = 'ERR' }
      out.push(`${name}\t${l}`)
    }
    const fs = await import('node:fs')
    const p = process.env.LANE_OUT
    if (p) fs.writeFileSync(p, out.join('\n') + '\n')
    // eslint-disable-next-line no-console
    console.log(`corpus lanes: ${corpus.length} documents${p ? ` → ${p}` : ''}`)
  })
})
