/** #1667 PROBE — collision census before vs after, across the archive. */
import { describe, it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { hasCorpusArchive, loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'

function idsNow(code: string): string[] {
  const ir: any = parseStrudel(code)
  const roots = ir?.tag === 'Stack' ? ir.tracks : [ir]
  return roots.filter((n: any) => n?.tag === 'Track').map((n: any) => n.trackId)
}

/** what the OLD per-track rule would have produced for the same track list. */
function idsBefore(now: string[], code: string): string[] {
  // A positional id under the old rule was exactly `d{i+1}`; a label-derived id
  // is whatever it is now (the fix never moves a label). A track is positional
  // now iff its id is `d\d+` AND the source carries no such label.
  return now.map((id, i) => (/^d\d+$/.test(id) && !new RegExp(`(^|\\n)\\s*_?${id}\\s*:`).test(code) ? `d${i + 1}` : id))
}

const dup = (a: string[]): boolean => new Set(a).size !== a.length

describe('#1667 census — before vs after', () => {
  it.skipIf(!hasCorpusArchive())('counts colliding documents each way', async () => {
    const corpus = await loadEveryCorpusDocument()
    let docs = 0, multi = 0, before = 0, after = 0
    const fixed: string[] = [], remaining: string[] = []
    for (const { name, code } of corpus) {
      docs++
      let now: string[]
      try { now = idsNow(code) } catch { continue }
      if (now.length < 2) continue
      multi++
      const old = idsBefore(now, code)
      const b = dup(old), a = dup(now)
      if (b) before++
      if (a) { after++; remaining.push(`${name}: ${now.join(',')}`) }
      if (b && !a) fixed.push(`${name}: ${old.join(',')}  ->  ${now.join(',')}`)
    }
    console.log(`[#1667 census] docs=${docs} multiTrack=${multi} collidingBEFORE=${before} collidingAFTER=${after}`)
    console.log('FIXED by this change:')
    for (const h of fixed) console.log('  ', h)
    console.log('STILL colliding (a different class — duplicate explicit labels):')
    for (const h of remaining) console.log('  ', h)
  })
})
