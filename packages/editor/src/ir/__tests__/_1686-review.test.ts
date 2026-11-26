import { it } from 'vitest'
import { parseStrudel, splitTopLevelStatements, extractTracks } from '../parseStrudel'
it('review', () => {
  for (const doc of ['// $: s("a");\n/* x */\n  .fast(2)', 'await x();\n// $: s("a")\n/* x */\n  .fast(2)', 's("q");\n// $: s("a")\n\n/* x */ .fast(2)']) {
    const ir: any = parseStrudel(doc)
    console.log('R', JSON.stringify(doc), (ir.tag === 'Stack' ? ir.tracks : [ir]).map((t: any) => `${t.trackId}@${t.loc?.[0]?.start}`).join(' '), JSON.stringify(splitTopLevelStatements(doc, 0)), JSON.stringify(extractTracks(doc).map((t) => t.dollarStart)))
  }
})
