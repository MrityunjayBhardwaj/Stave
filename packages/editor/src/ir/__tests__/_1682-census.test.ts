/** #1682 probe — which Mixer strips have NO IR track for their statement, and what are they? Inert. */
import { it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { buildStripModels } from '../../visualEdit/mixer/stripModel'
import { detectAllChunks } from '../../visualEdit/chunkDetect'
import { loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'

function lineStart(doc: string, at: number) {
  while (at > 0 && (doc[at - 1] === ' ' || doc[at - 1] === '\t')) at--
  return at
}
export function unmatched(doc: string) {
  const ir: any = parseStrudel(doc)
  const roots: any[] = ir?.tag === 'Stack' ? ir.tracks : ir ? [ir] : []
  const located = new Set<number>()
  for (const t of roots) if (t?.tag === 'Track' && typeof t.loc?.[0]?.start === 'number') located.add(t.loc[0].start)
  const chunks = detectAllChunks(doc)
  const strips = buildStripModels(chunks, doc)
  const out = strips.filter((s) => !located.has(lineStart(doc, s.statementRange[0])))
  return { strips: strips.length, located: located.size, out }
}

it('census', () => {
  const ctl = 'await initHydra()\ncpm = 110\n$: s("bd*4")\n$: s("hh*8")'
  const c = unmatched(ctl)
  console.log('CONTROL must be 2 out:', c.out.length, c.out.map((s) => s.name).join(','))
}, 600000)

it('archive', async () => {
  const docs = await loadEveryCorpusDocument()
  let n = 0, strips = 0, out = 0, docsOut = 0
  const cls: Record<string, number> = {}; const ex: Record<string, string[]> = {}
  for (const { name, code } of docs) {
    n++
    const r = unmatched(code); strips += r.strips
    if (!r.out.length) continue
    docsOut++; out += r.out.length
    for (const s of r.out) {
      const text = code.slice(s.statementRange[0], s.statementRange[1])
      const key = [
        s.label !== null ? 'LABELLED' : 'unlabelled',
        r.located === 0 ? 'irNoLocated' : 'irHasTracks',
        detectAllChunks(code).some((c) => c.label !== null && !c.label.startsWith('_')) ? 'docRegisters' : 'docNoLiveLabel',
        detectAllChunks(code).some((c) => c.label !== null) ? '' : 'docNoLabelAtAll',
        /\.p\s*\(/.test(text) ? 'HAS.p(' : '',
        s.muteable ? 'muteable' : '',
      ].filter(Boolean).join('/')
      cls[key] = (cls[key] ?? 0) + 1
      ;(ex[key] ??= []).length < 6 && ex[key].push(`${name} ${s.name} ${JSON.stringify(text.slice(0, 70))}`)
    }
  }
  console.log(`examined=${n} strips=${strips} strips-without-IR-track=${out} in docs=${docsOut}`)
  console.log('CLASSES', JSON.stringify(cls, null, 1))
  for (const [k, v] of Object.entries(ex)) for (const e of v) console.log('  ' + k + ' | ' + e)
}, 600000)

it('agreement', async () => {
  // In a doc with a live label: does ANY unlabelled strip have an IR track? (rule "IR decides" vs rule "live label ⇒ unlabelled plays nothing")
  let n = 0, docsLive = 0, unl = 0, unlWithIR = 0, allMuted = 0; const ex: string[] = []
  for (const { name, code } of await loadEveryCorpusDocument()) {
    n++
    const chunks = detectAllChunks(code)
    if (chunks.some((c) => c.label !== null) && !chunks.some((c) => c.label !== null && !c.label.startsWith('_'))) allMuted++
    if (!chunks.some((c) => c.label !== null && !c.label.startsWith('_'))) continue
    docsLive++
    const r = unmatched(code)
    const outSet = new Set(r.out)
    for (const s of buildStripModels(chunks, code)) {
      if (s.label !== null) continue
      unl++
      if (!r.out.some((o) => o.statementRange[0] === s.statementRange[0])) { unlWithIR++; if (ex.length < 8) ex.push(`${name} ${s.name} ${JSON.stringify(code.slice(s.statementRange[0], s.statementRange[0] + 60))}`) }
    }
    void outSet
  }
  console.log(`AGREE examined=${n} docsWithLiveLabel=${docsLive} unlabelledStrips=${unl} unlabelledWithIRTrack=${unlWithIR} docsAllLabelsMuted=${allMuted}`)
  for (const e of ex) console.log('   ' + e)
}, 600000)

it('agreement2', async () => {
  let n = 0, docsLive = 0, unl = 0, unlWithIR = 0, labelledNoIR = 0, bareNoIR = 0; const ex: string[] = [], ex2: string[] = [], ex3: string[] = []
  for (const { name, code } of await loadEveryCorpusDocument()) {
    n++
    const chunks = detectAllChunks(code)
    const live = chunks.some((c) => c.label !== null && !c.label.startsWith('_'))
    const r = unmatched(code)
    const noIR = new Set(r.out.map((o) => o.statementRange[0]))
    const labelOf = new Map(chunks.map((c) => [c.statementRange[0], c.label]))
    if (live) docsLive++
    for (const s of buildStripModels(chunks, code)) {
      const lab = labelOf.get(s.statementRange[0])
      const t = JSON.stringify(code.slice(s.statementRange[0], s.statementRange[0] + 60))
      if (lab !== null) { if (noIR.has(s.statementRange[0])) { labelledNoIR++; ex2.length < 8 && ex2.push(`${name} ${lab} ${t}`) } continue }
      if (!live) { if (noIR.has(s.statementRange[0]) && r.located > 0) { bareNoIR++; ex3.length < 12 && ex3.push(`${name} ${s.name} ${t}`) } continue }
      unl++
      if (!noIR.has(s.statementRange[0])) { unlWithIR++; ex.length < 8 && ex.push(`${name} ${s.name} ${t}`) }
    }
  }
  console.log(`AGREE2 examined=${n} docsWithLiveLabel=${docsLive} unlabelledStripsInLiveDocs=${unl} ofWhichHaveIRTrack=${unlWithIR} labelledStripsWithoutIR=${labelledNoIR} bareDocStripsWithoutIR(IR has located)=${bareNoIR}`)
  for (const e of ex) console.log('  UNL-WITH-IR ' + e)
  for (const e of ex2) console.log('  LAB-NO-IR ' + e)
  for (const e of ex3) console.log('  BARE-NO-IR ' + e)
}, 600000)

it('bare9', async () => {
  const { extractTracks } = await import('../parseStrudel')
  const want = new Set(['250/0tY5XMDEgMTq', '250/1FR3g6BbXIFT', '500/3OGQAQ5-jyOE', '0/0T1ttaI3Xk5b', '0/0rtidgQOuC0G', '0/2XqklUBptw63', '0/2bw7dPVusM84', '0/2k344VRdOlIf'])
  let seen = 0
  for (const { name, code } of await loadEveryCorpusDocument()) {
    if (!want.has(name)) continue
    seen++
    const et = extractTracks(code)
    const ir: any = parseStrudel(code)
    const roots: any[] = ir?.tag === 'Stack' ? ir.tracks : [ir]
    const strips = buildStripModels(detectAllChunks(code), code)
    const last = strips[strips.length - 1]
    console.log(`B9 ${name} extractTracks=${et.length}[${et.map((t: any) => (t.commented ? '//' : '') + t.label).join(' ')}] IR=${ir?.tag}:${roots.map((t) => `${t.trackId}@${t.loc?.[0]?.start}`).join(' ')} strips=${strips.map((s) => `${s.name}@${s.statementRange[0]}`).join(' ')} lastStrip=${JSON.stringify(code.slice(last.statementRange[0], last.statementRange[0] + 40))}`)
  }
  console.log('B9 seen', seen)
}, 600000)

it('indent', async () => {
  const both = (doc: string) => {
    const ir: any = parseStrudel(doc)
    const roots: any[] = ir?.tag === 'Stack' ? ir.tracks : ir ? [ir] : []
    const at = new Map<number, string>()
    for (const t of roots) if (t?.tag === 'Track' && typeof t.loc?.[0]?.start === 'number') at.set(t.loc[0].start, t.trackId)
    let cmp = 0; const bad: string[] = []
    for (const s of buildStripModels(detectAllChunks(doc), doc)) {
      const id = at.get(lineStart(doc, s.statementRange[0])) ?? at.get(s.statementRange[0])
      if (id === undefined) continue
      cmp++; if (id !== s.name) bad.push(`mixer ${s.name} vs timeline ${id} @${s.statementRange[0]}`)
    }
    return { cmp, bad }
  }
  console.log('IND minimal', JSON.stringify(both('s("bd")\n  s("hh")')), JSON.stringify(buildStripModels(detectAllChunks('s("bd")\n  s("hh")'), 's("bd")\n  s("hh")').map((s) => s.name)))
  let n = 0, cmp = 0, docs = 0, strips = 0; const ex: string[] = []
  for (const { name, code } of await loadEveryCorpusDocument()) {
    n++; const r = both(code); cmp += r.cmp
    if (r.bad.length) { docs++; strips += r.bad.length; ex.length < 10 && ex.push(`${name}: ${r.bad.join(' ; ')}`) }
  }
  console.log(`IND examined=${n} compared=${cmp} docsDisagree=${docs} stripsDisagree=${strips}`)
  for (const e of ex) console.log('   ' + e)
}, 600000)
