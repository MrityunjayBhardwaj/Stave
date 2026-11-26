/**
 * #1476 PROBE — WHERE do mono and staged disagree on the two documents the
 * interior rule newly breaks parity on?
 */
import { describe, it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { pipeline, stripStageMeta } from './helpers/stagesParity'
import { hasCorpusArchive, loadCorpus, loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'

function shape(n: unknown): string {
  if (n === null || typeof n !== 'object') return String(n)
  const r = n as Record<string, unknown>
  const tag = r.tag as string | undefined
  if (!tag) return '?'
  if (tag === 'Stack' && Array.isArray(r.tracks)) return `Stack[${r.tracks.map(shape).join(', ')}]`
  if (tag === 'Seq' && Array.isArray(r.children)) return `Seq(${r.children.length})`
  if (tag === 'Cycle' && Array.isArray(r.items)) return `Cycle(${r.items.length})`
  if (tag === 'Track') return `Track#${r.trackId}[${r.body ? shape(r.body) : 'EMPTY'}]`
  if (tag === 'Param') return `Param:${r.key}[${shape(r.body)}]`
  if (tag === 'Code') {
    const via = r.via as Record<string, unknown> | undefined
    return via ? `Code(via .${via.method})[${shape(via.inner)}]` : `Code(${JSON.stringify(String(r.code).slice(0, 60))})`
  }
  return tag
}

/** First byte offset at which two JSON strings differ, with context. */
function firstDiff(a: string, b: string): string {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return `at ${i}:\n  mono:   …${a.slice(Math.max(0, i - 80), i + 140)}\n  staged: …${b.slice(Math.max(0, i - 80), i + 140)}`
}

describe('#1476 parity', () => {
  it.skipIf(!hasCorpusArchive())('names the disagreement', async () => {
    const all = [...(await loadCorpus()), ...(await loadEveryCorpusDocument())]
    for (const name of ['0/-7zrPK5Bii8_', '500/3_ht9FPtBU5l']) {
      const d = all.find((x) => x.name === name)
      if (!d) { console.log(`MISSING ${name}`); continue }
      const mono = stripStageMeta(parseStrudel(d.code))
      const staged = stripStageMeta(pipeline(d.code))
      const mj = JSON.stringify(mono)
      const sj = JSON.stringify(staged)
      // eslint-disable-next-line no-console
      console.log(
        `\n##### ${name} (${d.code.length} bytes) #####\n${d.code}\n` +
          `\n-- mono   -- ${shape(mono)}\n-- staged -- ${shape(staged)}\n` +
          `-- equal? ${mj === sj}\n${mj === sj ? '' : firstDiff(mj, sj)}`,
      )
    }
  })
})
