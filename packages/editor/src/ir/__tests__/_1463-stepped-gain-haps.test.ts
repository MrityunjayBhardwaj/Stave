// @vitest-environment node
/**
 * PROBE (#1463) — what the REAL Strudel evaluator does with a stepped parameter,
 * before a lane is designed on top of it. Prints; asserts nothing load-bearing.
 */
import { describe, it, beforeAll } from 'vitest'
import { evalScope, evaluate } from '@strudel/core/evaluate.mjs'
import * as strudelCore from '@strudel/core'
import { mini, miniAllStrings } from '@strudel/mini/mini.mjs'

beforeAll(async () => {
  await evalScope(Promise.resolve(strudelCore), Promise.resolve({ mini }))
  miniAllStrings()
})

type Hap = {
  value?: Record<string, unknown>
  whole?: { begin: { valueOf(): number }; end: { valueOf(): number } }
  part?: { begin: { valueOf(): number } }
}

async function perCycle(code: string, cycles: number, keys: string[]) {
  const { pattern } = (await evaluate(code)) as { pattern: { queryArc: (a: number, b: number) => Hap[] } }
  const rows: string[] = []
  for (let c = 0; c < cycles; c++) {
    const haps = pattern
      .queryArc(c, c + 1)
      .filter((h) => h.whole && h.whole.begin.valueOf() === h.part?.begin.valueOf())
    const cells = haps.map(
      (h) =>
        `@${(+h.whole!.begin.valueOf()).toFixed(3)}{${keys.map((k) => `${k}=${JSON.stringify(h.value?.[k])}`).join(',')}}`,
    )
    rows.push(`  c${c} n=${haps.length} ${cells.join(' ')}`)
  }
  return rows.join('\n')
}

const CASES: [string, string, number, string[]][] = [
  ['A stepped 2', 's("bd*2").gain("<0.2 0.8>")', 4, ['gain']],
  ['B scalar', 's("bd*2").gain(0.8)', 2, ['gain']],
  ['C last wins', 's("bd*2").gain("<0.2 0.8>").gain(0.5)', 2, ['gain']],
  ['D weighted @2', 's("bd*2").gain("<0.2@2 0.8>")', 6, ['gain']],
  ['E subdivided step', 's("bd*2").gain("<0.2 [0.4 0.8]>")', 2, ['gain']],
  ['F not stepped', 's("bd*2").gain("0.2 0.8")', 1, ['gain']],
  ['G rest step', 's("bd*2").gain("<0.2 ~ 0.8>")', 3, ['gain']],
  ['H coprime w/ arrange 3', 'arrange([1, s("bd*2")], [2, s("hh*2")]).gain("<0.2 0.8>")', 6, ['s', 'gain']],
  ['H2 inside arm', 'arrange([1, s("bd*2").gain("<0.2 0.8>")], [2, s("hh*2")])', 6, ['s', 'gain']],
  ['I no leading zero', 's("bd*2").gain("<.2 .8>")', 2, ['gain']],
  ['K pan', 's("bd*2").pan("<0 1>")', 2, ['pan']],
  ['K lpf', 's("bd*2").lpf("<200 2000>")', 2, ['cutoff', 'lpf']],
  ['L long note', 's("bd").slow(2).gain("<0.2 0.8>")', 4, ['gain']],
  ['M string scalar', 's("bd*2").gain("0.8")', 1, ['gain']],
  ['N single-step angle', 's("bd*2").gain("<0.8>")', 2, ['gain']],
]

describe('#1463 probe — stepped parameters in the real evaluator', () => {
  it('prints per-cycle values', async () => {
    const out: string[] = []
    for (const [label, code, cycles, keys] of CASES) {
      try {
        out.push(`${label}: ${code}\n${await perCycle(code, cycles, keys)}`)
      } catch (e) {
        out.push(`${label}: ${code}\n  THREW ${(e as Error).message}`)
      }
    }
    console.log('\n' + out.join('\n'))
  })
})
