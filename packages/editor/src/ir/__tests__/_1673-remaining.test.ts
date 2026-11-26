/** #1673 PROBE — inert in gates. Prints the label lines of the documents still colliding. */
import { it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'
it('remaining', async () => {
  let n = 0, colliding = 0
  for (const { name, code } of await loadEveryCorpusDocument()) {
    n++
    const ir: any = parseStrudel(code)
    const ids: string[] = ir?.tag === 'Stack' ? ir.tracks.filter((t: any) => t.tag === 'Track').map((t: any) => t.trackId) : []
    if (new Set(ids).size === ids.length) continue
    colliding++
    console.log('DOC', name, ids.join(','))
    code.split('\n').forEach((l: string, i: number) => { if (/^\s*(\/\/)?\s*[_$\w]+\s*:/.test(l)) console.log('   ', i, l.slice(0, 80)) })
  }
  console.log(`examined=${n} colliding=${colliding}`)
}, 600000)
