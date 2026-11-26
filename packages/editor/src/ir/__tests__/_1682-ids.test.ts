import { it } from 'vitest'
import { buildStripModels } from '../../visualEdit/mixer/stripModel'
import { detectAllChunks } from '../../visualEdit/chunkDetect'
it('ids', () => {
  for (const d of ['s("cp")\n$: s("bd")', 's("cp")\n_$: s("bd")', 's("cp")\n$: s("bd")\n_$: s("hh")', 's("cp")\n_$: s("bd")\n_$: s("hh")'])
    console.log('IDS', JSON.stringify(d), buildStripModels(detectAllChunks(d), d).map((s) => `${s.id}${s.muted ? '(m)' : ''}`).join(' '))
})
