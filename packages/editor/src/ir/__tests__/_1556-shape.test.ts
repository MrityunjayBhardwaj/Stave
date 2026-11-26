import { it } from 'vitest'
import { splitTopLevelStatements, extractTracks } from '../parseStrudel'
it('shape', () => {
  const docs = {
    ghostRun: '//$:note("c").sound("piano")\n  .delay(.2)\n  ._pianoroll()\n//$:note("e").sound("piano")\n  .mask("<0 1>")\n  .pan(0.3)\n//$:s("bd")\n  .gain(.5)',
    liveAlt: '$: note("c")\n  .room(1)\n  // $: note("F")\n  .slow(2)\n$: s("bd")',
    commentAboveLive: '// $: s("hh")\n$: note("c")\n  // $: note("F")\n  .slow(2)',
    commentAboveLiveDangling: '// $: s("hh")\n  .gain(1)\n$: note("c")',
  }
  for (const [k, d] of Object.entries(docs)) {
    console.log('SHAPE', k, 'stmts=', JSON.stringify(splitTopLevelStatements(d, 0).map((s) => [s.offset, s.text.slice(0, 30)])))
    console.log('     tracks=', JSON.stringify(extractTracks(d).map((t) => `${t.commented ? '//' : ''}${t.label}@${t.dollarStart}`)))
  }
})
