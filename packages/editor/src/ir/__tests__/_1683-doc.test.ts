import { it } from 'vitest'
import { loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'
it('doc', async () => {
  for (const { name, code } of await loadEveryCorpusDocument()) if (name === '0/1wZis6SXtWoZ') console.log('DOC\n' + code.split('\n').map((l, i) => `${String(i + 1).padStart(3)}| ${l.slice(0, 90)}`).join('\n'))
}, 600000)
