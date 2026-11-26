/** #1678 probe — does each mixer strip carry the SAME name as the IR track for its statement? Inert. */
import { it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { buildStripModels } from '../../visualEdit/mixer/stripModel'
import { detectAllChunks } from '../../visualEdit/chunkDetect'
import { extractTracks } from '../parseStrudel'
import { isTrackChunk } from '../../visualEdit/mixer/stripModel'
import { loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'
export function compare(doc: string) {
  const ir: any = parseStrudel(doc)
  const roots: any[] = ir?.tag === 'Stack' ? ir.tracks : ir ? [ir] : []
  const byOffset = new Map<number, string>()
  for (const t of roots) if (t?.tag === 'Track' && typeof t.loc?.[0]?.start === 'number') byOffset.set(t.loc[0].start, t.trackId)
  let matched = 0, agree = 0, unmatched = 0; const bad: string[] = []
  for (const s of buildStripModels(detectAllChunks(doc), doc)) {
    let line = s.statementRange[0]; while (line > 0 && (doc[line - 1] === ' ' || doc[line - 1] === '\t')) line--
    const id = byOffset.get(line)
    if (id === undefined) { unmatched++; continue }
    matched++
    if (id === s.name) agree++; else bad.push(`mixer '${s.name}' vs timeline '${id}' @${s.statementRange[0]}`)
  }
  return { matched, agree, unmatched, bad }
}
it('census', async () => {
  // controls: the #1678 document must disagree on main; a plain one must agree
  console.log('CONTROL bug  ', JSON.stringify(compare('//$: s("hh*4")\n$: s("bd*2")')))
  console.log('CONTROL clean', JSON.stringify(compare('$: s("hh*4")\ndrums: s("bd*2")\n$: s("cp")')))
  const docs = await loadEveryCorpusDocument()
  let M = 0, A = 0, U = 0, docsBad = 0, docsWithCommented = 0; const ex: string[] = []
  for (const { name, code } of docs) {
    const r = compare(code); M += r.matched; A += r.agree; U += r.unmatched
    if (/^\s*\/\/\s*[_$A-Za-z][\w$]*\s*:/m.test(code)) docsWithCommented++
    if (r.bad.length) { docsBad++; if (ex.length < 8) ex.push(name + ': ' + r.bad.slice(0, 2).join(' ; ')) }
  }
  console.log(`docs=${docs.length} strips matched to an IR track=${M} agree=${A} DISAGREE=${M - A} unmatched strips=${U}`)
  console.log(`docs with a disagreement=${docsBad} · docs with a commented label line=${docsWithCommented}`)
  for (const e of ex) console.log('  ' + e)
}, 600000)

it('classify', async () => {
  const docs = await loadEveryCorpusDocument()
  const cls: Record<string, number> = {}; const ex: Record<string, string[]> = {}
  for (const { name, code } of docs) {
    const r = compare(code); if (!r.bad.length) continue
    const parserTracks = extractTracks(code)
    const commented = parserTracks.filter((t) => t.commented).length
    const chunks = detectAllChunks(code).filter(isTrackChunk)
    const parserStarts = new Set(parserTracks.map((t) => t.dollarStart))
    // mixer strips that are NOT a parser track (the mixer counts them, the parser does not)
    const extra = chunks.filter((c) => !parserStarts.has(c.statementRange[0]))
    const extraKinds = [...new Set(extra.map((c) => c.label !== null ? 'labelled-unmatched' : 'bare:' + (c.headFn ?? '?')))].slice(0, 4)
    const key = `${commented > 0 ? 'COMMENTED' : ''}${extra.length ? (commented ? '+' : '') + 'MIXER-EXTRA' : ''}` || 'OTHER'
    cls[key] = (cls[key] ?? 0) + 1
    ;(ex[key] ??= []).length < 3 && ex[key].push(`${name} commented=${commented} extra=${extra.length} [${extraKinds.join(',')}] first extra: ${JSON.stringify(extra[0]?.statementText.slice(0, 60) ?? '')}`)
  }
  console.log('CLASSES', JSON.stringify(cls))
  for (const [k, v] of Object.entries(ex)) for (const e of v) console.log('  ' + k + ' | ' + e)
}, 600000)

it('example', () => {
  const doc = 'await initHydra()\ncpm = 110\n$: s("bd*4")\n$: s("hh*8")'
  const strips = buildStripModels(detectAllChunks(doc), doc).map((s) => `${s.name}@${s.statementRange[0]}`)
  const ir: any = parseStrudel(doc)
  const ids = (ir.tag === 'Stack' ? ir.tracks : [ir]).map((t: any) => `${t.trackId}@${t.loc?.[0]?.start}`)
  console.log('EXAMPLE strips', strips.join(' '), '| IR', ids.join(' '))
})

it('residual', async () => {
  const want = new Set(['250/15HNhhmgIzUr', '500/3OGQAQ5-jyOE', '500/3s_GRSjRh32K', '0/0SL-WdBbtC2s', '0/2k344VRdOlIf'])
  for (const { name, code } of await loadEveryCorpusDocument()) {
    if (!want.has(name)) continue
    const parsed = extractTracks(code)
    const ir: any = parseStrudel(code)
    const roots: any[] = ir?.tag === 'Stack' ? ir.tracks : [ir]
    console.log(`RES ${name}: extractTracks=${parsed.length} [${parsed.map((t) => `${t.commented ? '//' : ''}${t.label}@${t.dollarStart}`).join(' ')}]`)
    console.log(`    IR root=${ir?.tag} tracks=[${roots.map((t) => `${t.trackId}@${t.loc?.[0]?.start}`).join(' ')}]`)
    const bad = compare(code).bad
    console.log(`    bad: ${bad.join(' ; ')}`)
    const at = Number(/@(\d+)/.exec(bad[0] ?? '')?.[1])
    if (Number.isFinite(at)) console.log(`    text@${at}: ${JSON.stringify(code.slice(Math.max(0, at - 40), at + 50))}`)
  }
}, 600000)

it('cost', async () => {
  const docs = await loadEveryCorpusDocument()
  for (const { code } of docs.slice(0, 20)) { parseStrudel(code); detectAllChunks(code); extractTracks(code) } // warm
  const time = (f: (c: string) => unknown) => { const ts: number[] = []; for (const { code } of docs) { const t = performance.now(); f(code); ts.push(performance.now() - t) } ts.sort((a, b) => a - b); return { median: ts[ts.length >> 1].toFixed(2), p95: ts[Math.floor(ts.length * 0.95)].toFixed(2), max: ts[ts.length - 1].toFixed(1) } }
  console.log('COST detectAllChunks ms', JSON.stringify(time(detectAllChunks)))
  console.log('COST extractTracks  ms', JSON.stringify(time(extractTracks)))
  console.log('COST parseStrudel   ms', JSON.stringify(time((c) => parseStrudel(c))))
  const big = docs.reduce((a, b) => (b.code.length > a.code.length ? b : a))
  console.log('biggest doc chars', big.code.length)
}, 600000)

it('unicode', async () => {
  let n = 0, docs = 0, labels = 0; const ex: string[] = []
  for (const { name, code } of await loadEveryCorpusDocument()) {
    n++
    const odd = detectAllChunks(code).map((c) => c.label).filter((l): l is string => l !== null && !/^[A-Za-z_$][\w$]*$/.test(l))
    if (odd.length) { docs++; labels += odd.length; if (ex.length < 6) ex.push(`${name}: ${odd.slice(0, 4).join(', ')}`) }
  }
  console.log(`UNICODE examined=${n} docs with a label the parser's pattern rejects=${docs} labels=${labels}`)
  for (const e of ex) console.log('   ' + e)
  // control: the pattern accepts an ASCII label and rejects a CJK one
  console.log('UNICODE control', /^[A-Za-z_$][\w$]*$/.test('drums'), /^[A-Za-z_$][\w$]*$/.test('節奏'))
}, 600000)

it('bareprobe', () => {
  for (const src of ["setcps(0.75)\nawait samples('github:x/y')\nlet a = 1\ns(\"bd\")\ns(\"hh\")", "await samples('github:x/y')\nsetcps(.75)\nlet c = 1\nstack(s(\"bd\"), s(\"hh\"))\ns(\"cp\")"]) {
    const ir: any = parseStrudel(src)
    const roots: any[] = ir?.tag === 'Stack' ? ir.tracks : [ir]
    console.log('BARE IR', ir?.tag, roots.map((t) => `${t.tag}:${t.trackId}@${t.loc?.[0]?.start}`).join(' '), '| strips', buildStripModels(detectAllChunks(src), src).map((s) => `${s.name}@${s.statementRange[0]}`).join(' '))
  }
})

it('realbare', async () => {
  for (const { name, code } of await loadEveryCorpusDocument()) {
    if (name !== '500/3OGQAQ5-jyOE' && name !== '0/2k344VRdOlIf') continue
    const chunks = detectAllChunks(code).filter(isTrackChunk)
    const ir: any = parseStrudel(code)
    const roots: any[] = ir?.tag === 'Stack' ? ir.tracks : [ir]
    console.log('REAL', name, '| IR', roots.map((t) => `${t.trackId}@${t.loc?.[0]?.start}`).join(' '))
    console.log('     mixer track chunks:', chunks.map((c) => `@${c.statementRange[0]}:${JSON.stringify(c.statementText.slice(0, 28))}`).join(' | '))
  }
}, 600000)
