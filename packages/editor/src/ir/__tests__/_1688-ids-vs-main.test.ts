import { it } from 'vitest'
import { buildStripModels } from '../../visualEdit/mixer/stripModel'
import * as mainMod from '../../visualEdit/mixer/_stripModelMain'
import { detectAllChunks } from '../../visualEdit/chunkDetect'
import { loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'
it('ids vs main', async () => {
  const mainBuild = (mainMod as any).buildStripModels as (c: any, d?: string) => any[]
  let n = 0, cmp = 0, idDiff = 0, capDiff = 0; const ex: string[] = []
  for (const { name, code } of await loadEveryCorpusDocument()) {
    n++
    const chunks = detectAllChunks(code)
    const m = new Map(mainBuild(chunks, code).map((s: any) => [s.statementRange[0], s]))
    for (const s of buildStripModels(chunks, code)) {
      const o: any = m.get(s.statementRange[0]); if (!o) continue
      cmp++
      if (o.id !== s.id) { idDiff++; ex.length < 6 && ex.push(`${name} id ${o.id}->${s.id}`) }
      if (o.captureId !== s.captureId) { capDiff++; ex.length < 6 && ex.push(`${name} cap ${o.captureId}->${s.captureId}`) }
    }
  }
  console.log(`VSMAIN examined=${n} compared=${cmp} idDiff=${idDiff} captureIdDiff=${capDiff}`)
  for (const e of ex) console.log('  ' + e)
  // control: main draws a strip for the bare line, the branch does not
  const d = 's("cp")\n$: s("bd")'
  console.log('VSMAIN control main', mainBuild(detectAllChunks(d), d).length, 'branch', buildStripModels(detectAllChunks(d), d).length)
}, 600000)
