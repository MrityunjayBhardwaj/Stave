/** #1476 PROBE — why `0/-HB2AUFfae4D` moved loop → arranged. */
import { describe, it } from 'vitest'
import { parseStrudel, extractTracks } from '../parseStrudel'
import { songExtent } from '../songExtent'
import { hasCorpusArchive, loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'

function shape(n: unknown): string {
  if (n === null || typeof n !== 'object') return String(n)
  const r = n as Record<string, unknown>
  const tag = r.tag as string | undefined
  if (!tag) return '?'
  if (tag === 'Stack' && Array.isArray(r.tracks)) return `Stack[${r.tracks.map(shape).join(', ')}]`
  if (tag === 'Seq' && Array.isArray(r.children)) return `Seq(${(r.children as unknown[]).map(shape).join(',')})`
  if (tag === 'Cycle' && Array.isArray(r.items)) return `Cycle(${(r.items as unknown[]).length})`
  if (tag === 'Track') return `Track#${r.trackId}[${r.body ? shape(r.body) : 'EMPTY'}]`
  if (tag === 'Param') return `Param:${r.key}[${shape(r.body)}]`
  if (tag === 'Arrange' && Array.isArray(r.parts)) return `Arrange(${(r.parts as unknown[]).length})`
  if (tag === 'Code') {
    const via = r.via as Record<string, unknown> | undefined
    return via ? `Code(via .${via.method})[${shape(via.inner)}]` : `Code(${JSON.stringify(String(r.code).slice(0, 40))})`
  }
  return tag
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
  visit(n); return c
}

describe('#1476 HB2 verdict', () => {
  it.skipIf(!hasCorpusArchive())('prints the before/after verdict', async () => {
    const docs = await loadEveryCorpusDocument()
    const d = docs.find((x) => x.name === '0/-HB2AUFfae4D')!
    const ir = parseStrudel(d.code)
    // eslint-disable-next-line no-console
    console.log(`tracks=${extractTracks(d.code).length}`)
    // eslint-disable-next-line no-console
    console.log(`shape = ${shape(ir)}`)
    // eslint-disable-next-line no-console
    console.log(`leaves = ${leaves(ir)}`)
    // eslint-disable-next-line no-console
    console.log(`songExtent = ${JSON.stringify(songExtent(ir))}`)
  })
})
