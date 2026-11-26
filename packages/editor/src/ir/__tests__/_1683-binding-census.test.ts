/** #1683 follow-up — how many archive docs bind a name the ASCII binding regexes cannot read? Inert probe. */
import { it } from 'vitest'
import { BINDING_RE } from '../parseStrudel'
import { loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'
const UNI = /(?:^|[\s;])(?:let|const|var)\s+([\p{ID_Start}$_][\p{ID_Continue}$‌‍]*)\s*=/gmu
it('binding census', async () => {
  const docs = await loadEveryCorpusDocument()
  docs.unshift({ name: 'CONTROL+', code: 'let 節奏 = s("bd")\n節奏' } as any, { name: 'CONTROL-', code: 'let beat = s("bd")\nbeat' } as any)
  let n = 0, hit = 0
  for (const { name, code } of docs) {
    n++
    const names = [...code.matchAll(UNI)].map((m) => m[1]).filter((id) => /[^\x00-\x7F]/.test(id))
    if (!names.length) continue
    hit++
    const asciiReads = names.map((id) => `${id}:${BINDING_RE.test(`let ${id} = x`) ? 'read' : 'MISSED'}`)
    console.log(`B ${name} ${asciiReads.join(' ')}`)
  }
  console.log(`examined=${n} (incl. 2 controls) docsWithNonAsciiBinding=${hit}`)
}, 900000)
