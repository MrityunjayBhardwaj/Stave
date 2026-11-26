import { it } from 'vitest'
import { extractTracks, parseStrudel } from '../parseStrudel'
import * as M from '../_parseStrudelMain'
import { loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'
const fmt = (ts: any[]) => ts.map((t) => `${t.commented ? '//' : ''}${t.label}@${t.dollarStart}:${t.end}`).join(' ')
const ids = (ir: any) => (ir?.tag === 'Stack' ? ir.tracks : [ir]).map((t: any) => `${t.trackId}@${t.loc?.[0]?.start}`).join(' ')
it('radius', async () => {
  let n = 0, changed = 0, irChanged = 0
  for (const { name, code } of await loadEveryCorpusDocument()) {
    n++
    const a = fmt((M as any).extractTracks(code)), b = fmt(extractTracks(code))
    const ia = ids((M as any).parseStrudel(code)), ib = ids(parseStrudel(code))
    if (a !== b) { changed++; console.log(`RAD ${name}\n   main:   ${a.slice(0, 300)}\n   branch: ${b.slice(0, 300)}`) }
    if (ia !== ib) { irChanged++; console.log(`RADIR ${name}\n   main:   ${ia.slice(0, 300)}\n   branch: ${ib.slice(0, 300)}`) }
  }
  const ghost = '//$:note("c")\n  .delay(.2)\n//$:note("e")\n  .pan(0.3)\n//$:s("bd")\n  .gain(.5)'
  console.log(`RADSUM examined=${n} extractTracksChanged=${changed} irChanged=${irChanged} control main=${fmt((M as any).extractTracks(ghost))} branch=${fmt(extractTracks(ghost))}`)
}, 600000)
