/** #1686 census — main vs fix over every archived document. Inert probe. */
import { it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { parseStrudel as parseMain } from '../_parseStrudelMain'
import { buildStripModels, bareCaptureIdFor, isTrackChunk } from '../../visualEdit/mixer/stripModel'
import { buildStripModels as stripsMain, bareCaptureIdFor as bareMain } from '../../visualEdit/mixer/_stripModelMain'
import { detectAllChunks } from '../../visualEdit/chunkDetect'
import { extractTracks } from '../parseStrudel'
import { isMutedLabel } from '../trackId'
import { loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'

const sig = (ir: any) => (ir?.tag === 'Stack' ? ir.tracks : [ir]).map((t: any) => `${t?.trackId}@${t?.loc?.[0]?.start}-${t?.loc?.[0]?.end}`).join(' ')
const ids = (ir: any) => new Map<number, string>((ir?.tag === 'Stack' ? ir.tracks : [ir]).filter((t: any) => typeof t?.loc?.[0]?.start === 'number').map((t: any) => [t.loc[0].start, t.trackId]))
function lineStart(doc: string, at: number) { while (at > 0 && (doc[at - 1] === ' ' || doc[at - 1] === '\t')) at--; return at }
function rowless(doc: string, ir: any, strips: any[]) {
  const m = ids(ir)
  return strips.filter((s) => !m.has(lineStart(doc, s.statementRange[0])) && !m.has(s.statementRange[0])).length
}
it('census', async () => {
  const docs = await loadEveryCorpusDocument()
  // positive control: the issue's shape MUST register as changed
  docs.unshift({ name: 'CONTROL', code: 'n("c")\n// $: s("a")\n// $: s("b")' } as any)
  let n = 0, changed = 0, liveChanged = 0, noLive = 0
  const cls: Record<string, number> = {}; const rows: string[] = []
  let rowlessBefore = 0, rowlessAfter = 0, bareChanged = 0, nameChanged = 0
  for (const { name, code } of docs) {
    n++
    const tr = extractTracks(code)
    const live = tr.some((t) => !t.commented && !isMutedLabel(t.label))
    const kind = tr.length === 0 ? 'noLabels' : live ? 'live' : tr.every((t) => t.commented) ? 'allCommented' : tr.every((t) => !t.commented) ? 'allMuted' : 'commented+muted'
    if (kind !== 'noLabels' && kind !== 'live') noLive++
    const a = parseMain(code), b = parseStrudel(code)
    const chunks = detectAllChunks(code)
    const sa = stripsMain(chunks, code), sb = buildStripModels(chunks, code)
    const tc = chunks.filter(isTrackChunk)
    const ba = bareMain(tc), bb = bareCaptureIdFor(tc)
    const rA = rowless(code, a, sa), rB = rowless(code, b, sb)
    rowlessBefore += rA; rowlessAfter += rB
    const names = sa.map((s) => s.name).join(',') !== sb.map((s) => s.name).join(',')
    if (names) nameChanged++
    if (ba !== bb) bareChanged++
    const ch = sig(a) !== sig(b)
    if (ch || ba !== bb || names) {
      if (ch) changed++
      if (kind === 'live' || kind === 'noLabels') liveChanged++
      cls[kind] = (cls[kind] ?? 0) + 1
      rows.push(`${name} [${kind}] irChanged=${ch} rowless ${rA}->${rB} bare ${ba}->${bb} names ${sa.map((s) => s.name).join(',')} -> ${sb.map((s) => s.name).join(',')}\n    main: ${sig(a)}\n    fix:  ${sig(b)}`)
    } else if (kind !== 'noLabels' && kind !== 'live') {
      cls[kind + '/UNMOVED'] = (cls[kind + '/UNMOVED'] ?? 0) + 1
      rows.push(`${name} [${kind}] UNMOVED strips=${sb.map((s) => s.name).join(',')} rowless=${rB} bare=${bb}`)
    }
  }
  console.log(`examined=${n} (incl. 1 control) noLiveLabelDocs=${noLive} changed(IR)=${changed} changed-in-live-or-bare-docs=${liveChanged} bareIdChanged=${bareChanged} stripNameChanged=${nameChanged}`)
  console.log(`strips with no row at their statement: before=${rowlessBefore} after=${rowlessAfter}`)
  console.log('CLASSES', JSON.stringify(cls))
  for (const r of rows) console.log(r)
}, 900000)
