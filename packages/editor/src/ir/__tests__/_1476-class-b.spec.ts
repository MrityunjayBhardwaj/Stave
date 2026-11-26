/**
 * #1476 PROBE — does the pinned `B-track-count` class conflate TWO mechanisms?
 *
 * The baseline calls all of them #950's deliberate comma-arm lane split. A
 * lane split re-parents arms; it does not DELETE methods. So for each class-B
 * document, count the Param/Code-via nodes on each side: equal counts = a pure
 * lane split (deliberate), fewer on the staged side = chain content silently
 * dropped (not deliberate, and audible — gain/room/lpf/slow all vanish).
 */
import { describe, it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { pipeline, stripStageMeta } from './helpers/stagesParity'
import {
  hasCorpusArchive,
  loadEveryCorpusDocument,
} from '../../visualEdit/miniSource/__tests__/evalHarness'

/** Every method application surviving in the tree: Param keys + Code.via methods. */
function methods(n: unknown): string[] {
  const out: string[] = []
  const visit = (x: unknown): void => {
    if (x === null || typeof x !== 'object') return
    if (Array.isArray(x)) return void x.forEach(visit)
    const r = x as Record<string, unknown>
    if (r.tag === 'Param' && typeof r.key === 'string') out.push(String(r.userMethod ?? r.key))
    if (r.tag === 'Code' && r.via && typeof (r.via as Record<string, unknown>).method === 'string') {
      out.push(String((r.via as Record<string, unknown>).method))
    }
    for (const [k, v] of Object.entries(r)) { if (k === 'loc') continue; visit(v) }
  }
  visit(n)
  return out.sort()
}

function leaves(n: unknown): number {
  let c = 0
  const visit = (x: unknown): void => {
    if (x === null || typeof x !== 'object') return
    if (Array.isArray(x)) return void x.forEach(visit)
    const r = x as Record<string, unknown>
    if (r.tag === 'Play' || r.tag === 'Sound') c++
    for (const [k, v] of Object.entries(r)) { if (k === 'loc') continue; visit(v) }
  }
  visit(n)
  return c
}

describe('#1476 class-B mechanism', () => {
  it.skipIf(!hasCorpusArchive())('splits lane-split from chain-drop', async () => {
    const corpus = await loadEveryCorpusDocument()
    let diverging = 0
    let pureLaneSplit = 0
    let chainDropped = 0
    const lines: string[] = []
    for (const { name, code } of corpus) {
      let mono: unknown, staged: unknown
      try {
        mono = stripStageMeta(parseStrudel(code))
        staged = stripStageMeta(pipeline(code))
      } catch { continue }
      if (JSON.stringify(mono) === JSON.stringify(staged)) continue
      diverging++
      const mm = methods(mono)
      const sm = methods(staged)
      const lost = mm.filter((x, i) => sm.indexOf(x) < 0 || mm.slice(0, i + 1).filter((y) => y === x).length > sm.filter((y) => y === x).length)
      if (lost.length === 0) {
        pureLaneSplit++
        lines.push(`LANE-SPLIT-ONLY  ${name}  methods=${mm.length} leaves=${leaves(mono)}/${leaves(staged)}`)
      } else {
        chainDropped++
        lines.push(`CHAIN-DROPPED    ${name}  lost=[${[...new Set(lost)].join(',')}]  methods ${mm.length}->${sm.length}  leaves=${leaves(mono)}/${leaves(staged)}`)
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n===== ${corpus.length} documents =====\n` +
        `diverging: ${diverging}\n  pure lane split (deliberate): ${pureLaneSplit}\n  CHAIN CONTENT DROPPED: ${chainDropped}\n\n` +
        lines.sort().join('\n'),
    )
  })
})
