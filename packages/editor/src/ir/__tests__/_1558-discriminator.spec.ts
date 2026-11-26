/** #1558 PROBE — is the staged FINAL tree distinguishable from parseStrudel's? */
import { describe, it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { hasCorpusArchive, loadEveryCorpusDocument } from '../../visualEdit/miniSource/__tests__/evalHarness'
import { pipeline } from './helpers/stagesParity'

const STAGE_ONLY = ['unresolvedChain', 'chainOffset', 'dollarStart', 'dollarEnd', 'trackLabel']

function fieldsPresent(n: unknown, found = new Set<string>()): Set<string> {
  if (n === null || typeof n !== 'object') return found
  if (Array.isArray(n)) { n.forEach((x) => fieldsPresent(x, found)); return found }
  for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
    if (STAGE_ONLY.includes(k)) found.add(k)
    fieldsPresent(v, found)
  }
  return found
}

const DOCS = [
  '$: s("bd, cp").gain(.5)',
  '$: s("bd")\n$: s("hh")',
  'let a = s("bd")\narrange([4, a])',
  '$: note("c e g").sound("piano").room(1)',
]

describe('#1558 discriminator', () => {
  it.skipIf(!hasCorpusArchive())('sweeps the whole archive', async () => {
    const docs = await loadEveryCorpusDocument()
    let stagedCarry = 0
    let directCarry = 0
    const names: string[] = []
    for (const d of docs) {
      let st: Set<string>
      try { st = fieldsPresent(pipeline(d.code)) } catch { continue }
      const di = fieldsPresent(parseStrudel(d.code))
      if (st.size) { stagedCarry++; if (names.length < 8) names.push(`${d.name}:[${[...st].join(',')}]`) }
      if (di.size) directCarry++
    }
    // eslint-disable-next-line no-console
    console.log(
      `SWEEP examined=${docs.length} stagedFinalCarriesStageFields=${stagedCarry} ` +
      `parseStrudelCarries=${directCarry}\n  e.g. ${names.join('  ') || '(none)'}`,
    )
  })

  it('prints which stage-only fields survive to each final tree', () => {
    for (const code of DOCS) {
      const staged = [...fieldsPresent(pipeline(code))].sort()
      const direct = [...fieldsPresent(parseStrudel(code))].sort()
      // eslint-disable-next-line no-console
      console.log(
        `${JSON.stringify(code.slice(0, 32))}\n` +
        `   staged final : [${staged.join(', ')}]\n` +
        `   parseStrudel : [${direct.join(', ')}]`,
      )
    }
  })
})
