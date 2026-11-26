import { describe, it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { hasCorpusArchive, loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'

const WANT = ['0/-D3D3jXo_jWm', '0/-uRRR4hcrP0_']

describe('#1667 — duplicate track ids: source or parser?', () => {
  it.skipIf(!hasCorpusArchive())('counts label occurrences against IR tracks', async () => {
    const corpus = await loadEveryCorpusDocument()
    for (const { name, code } of corpus) {
      if (!WANT.includes(name)) continue
      const ir: any = parseStrudel(code)
      const roots = ir?.tag === 'Stack' ? ir.tracks : [ir]
      const tracks = roots.filter((n: any) => n?.tag === 'Track')
      console.log(`\n===== ${name} =====`)
      console.log('  IR tracks:', tracks.map((t: any) => `${t.trackId}@${t.loc?.[0]?.start}`).join(' '))
      for (const id of new Set<string>(tracks.map((t: any) => t.trackId))) {
        const occ = [...code.matchAll(new RegExp(`(^|\\n)[^\\S\\n]*_?${id}\\s*:`, 'g'))].map((m) => m.index)
        console.log(`  source label "${id}:" occurrences:`, occ.length, occ)
      }
      // what sits at each track's own loc
      for (const t of tracks) {
        const st = t.loc?.[0]?.start ?? -1
        console.log(`    track ${t.trackId} loc=${st} :: ${JSON.stringify(code.slice(st, st + 44))}`)
      }
    }
  })
})
