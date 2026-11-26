/** #1553 PROBE — the 3 documents whose LANES move. Judge each on its source. */
import { describe, it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { pipeline, stripStageMeta } from './helpers/stagesParity'
import { walkLeafItems, rootStackArms } from '../structuralWalk'
import { hasCorpusArchive, loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'

function lanes(ir: unknown): string {
  const items = walkLeafItems(ir as never, 4) as unknown as Array<Record<string, unknown>>
  const first = new Map<string, number | undefined>()
  for (const it of items) {
    const k = String(it.laneKey)
    const loc = (it.loc as Array<{ start?: number }> | undefined)?.[0]?.start
    if (!first.has(k)) first.set(k, loc)
  }
  return [...first.entries()].map(([k, v]) => `${k}@${v}`).join(' ')
}
function shape(n: unknown, d = 0): string {
  if (!n || typeof n !== 'object' || d > 4) return '…'
  const r = n as Record<string, unknown>
  const t = r.tag as string
  if (t === 'Stack') return `Stack(${(r.tracks as unknown[]).length})[${(r.tracks as unknown[]).map((x) => shape(x, d + 1)).join(',')}]`
  if (t === 'Track') return `Track#${r.trackId}[${shape(r.body, d + 1)}]`
  if (t === 'Param') return `Param:${r.key}[${shape(r.body, d + 1)}]`
  if (t === 'Code') {
    const via = r.via as Record<string, unknown> | undefined
    return via ? `Code(via .${via.method})[${shape(via.inner, d + 1)}]` : `CodeBARE`
  }
  return t
}

/** The tag chain from a Track's body down, with why the walk stopped. */
function trace(ir: unknown): string {
  const r = ir as Record<string, unknown>
  if (r.tag !== 'Track') return 'not a Track'
  let node = r.body as Record<string, unknown>
  const path: string[] = []
  for (let i = 0; i < 20; i++) {
    const t = String(node.tag)
    if (t === 'Stack') {
      path.push(`Stack(${(node.tracks as unknown[]).length}, userMethod=${JSON.stringify(node.userMethod)})`)
      break
    }
    const via = node.via as Record<string, unknown> | undefined
    if (t === 'Code' && via && !('literal' in via) && via.inner) {
      path.push(`Code(.${via.method})`)
      node = via.inner as Record<string, unknown>
      continue
    }
    if (node.body) { path.push(t); node = node.body as Record<string, unknown>; continue }
    path.push(`${t} STOP(no body)`)
    break
  }
  return path.join(' -> ')
}

describe('#1553 three movers', () => {
  it.skipIf(!hasCorpusArchive())('prints each', async () => {
    const corpus = await loadEveryCorpusDocument()
    for (const name of ['500/3w3DjsHVahXe', '500/3yoSJQxQFTFj', '0/31kSvIr8QxJx']) {
      const d = corpus.find((x) => x.name === name)!
      const st = stripStageMeta(pipeline(d.code))
      // eslint-disable-next-line no-console
      console.log(
        `\n##### ${name} #####\n${d.code.slice(0, 420)}\n` +
          `  shape:  ${shape(st)}\n  lanes:  ${lanes(st)}\n` +
          `  arms:   ${JSON.stringify(rootStackArms(st as never)?.map((a) => a.laneId) ?? null)}\n` +
          `  mono==staged: ${JSON.stringify(stripStageMeta(parseStrudel(d.code))) === JSON.stringify(st)}\n` +
          `  descent: ${trace(st)}`,
      )
    }
  })
})
