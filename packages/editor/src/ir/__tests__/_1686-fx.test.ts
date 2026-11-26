import { it } from 'vitest'
import { parseStrudel, splitTopLevelStatements } from '../parseStrudel'
it('fx', () => {
  for (const doc of ['await initHydra();\n//$: note("c a")\n  .delay(.2)\n\n//$: s("bd")\n  .bank("x")', 'await initHydra()\n\n//$: note("c a")\n  .delay(.2)\n//$: s("bd")\n  .bank("x")']) {
    const ir: any = parseStrudel(doc)
    console.log('FX', JSON.stringify(doc), (ir.tag === 'Stack' ? ir.tracks : [ir]).map((t: any) => `${t.trackId}@${t.loc?.[0]?.start}`).join(' '), JSON.stringify(splitTopLevelStatements(doc, 0).map((s) => s.offset)))
  }
})
