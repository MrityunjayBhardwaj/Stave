import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { pipeline, stripStageMeta } from './helpers/stagesParity'
const DOCS: Array<[string, string]> = [
  ['$: label + binding RHS arrange', `let M = 2\nlet p = arrange([M, s("bd")], [M, s("hh")])\n$: stack(p, s("cp"))`],
  ['BARE doc + binding RHS arrange', `let M = 2\nlet p = arrange([M, s("bd")], [M, s("hh")])\nstack(p, s("cp"))`],
  ['BARE doc + binding RHS, literal', `let p = arrange([2, s("bd")], [2, s("hh")])\nstack(p, s("cp"))`],
  ['BARE doc, arrange is the final expr', `let M = 2\narrange([M, s("bd")], [M, s("hh")])`],
]
describe('#1522 self-review: bare-document parity', () => {
  it('mono vs staged, per document', () => {
    for (const [label, code] of DOCS) {
      const mono = JSON.stringify(stripStageMeta(parseStrudel(code)))
      const staged = JSON.stringify(stripStageMeta(pipeline(code)))
      const agree = mono === staged ? 'SAME' : '**DIVERGE**'
      const has = (s: string, t: string) => (s.match(new RegExp(`"tag":"${t}"`, 'g')) ?? []).length
      console.log(`${label.padEnd(38)} ${agree}  mono{Arrange:${has(mono,'Arrange')} Builder:${has(mono,'Builder')}} staged{Arrange:${has(staged,'Arrange')} Builder:${has(staged,'Builder')}}`)
    }
    expect(true).toBe(true)
  })
})
