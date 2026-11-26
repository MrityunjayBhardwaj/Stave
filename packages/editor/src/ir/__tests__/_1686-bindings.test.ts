import { it } from 'vitest'
import { parseStrudel, extractTracks, splitTopLevelStatements, BINDING_RE } from '../parseStrudel'
import { isMutedLabel } from '../trackId'
import { loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'
it('bindings', async () => {
  const docs = await loadEveryCorpusDocument()
  docs.unshift({ name: 'CONTROL', code: 'const p = s("bd")\n// $: s("a")\np' } as any)
  let n = 0, noLive = 0, withBare = 0, withBinding = 0
  for (const { name, code } of docs) {
    n++
    const tr = extractTracks(code)
    if (tr.length === 0 || tr.some((t) => !t.commented && !isMutedLabel(t.label))) continue
    noLive++
    const ir: any = parseStrudel(code)
    const labelStarts = new Set(tr.map((t) => t.dollarStart))
    const bare = (ir.tag === 'Stack' ? ir.tracks : [ir]).filter((t: any) => !labelStarts.has(t.loc?.[0]?.start))
    if (!bare.length) continue
    withBare++
    const b = splitTopLevelStatements(code, 0).filter((s) => BINDING_RE.test(s.text)).length
    if (b) withBinding++
    console.log('D', name, 'bareRows', bare.length, 'bindings', b)
  }
  console.log(`examined=${n} noLive=${noLive} withBareRows=${withBare} withBinding=${withBinding}`)
}, 600000)
