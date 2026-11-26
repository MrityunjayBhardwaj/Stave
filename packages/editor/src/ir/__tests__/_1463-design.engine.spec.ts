/**
 * PROBE (#1463 design questions, untracked). Through the real transpiler:
 *  E1 `.gain(0.8)`, `.gain("<0.8>")`, `.gain("<0.8 0.8>")` play identical values; what the readers see for each.
 *  E2 an edit to step 1 of `<0.8 0.8>` — which cycles the engine changes.
 *  E3 a step-count change inside a 4-bar arrangement section — what each bar plays.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import { parseStrudel } from '../parseStrudel'
import { steppedAutomations, stepValueEdit } from '../steppedAutomation'
import { signalAutomations } from '../signalAutomation'
import { clearStringParser, installMiniStringParser } from '../../engine/stringParser'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function valuesPerCycle(code: string, key: string, cycles: number): Promise<unknown[][]> {
  const core: any = await import('@strudel/core')
  const mini: any = await import('@strudel/mini')
  await core.evalScope(core, mini)
  installMiniStringParser({ core, mini })
  try {
    const { transpiler }: any = await import('@strudel/transpiler')
    const out = await core.evaluate(code, transpiler)
    const pat = out.pattern ?? out
    const rows: unknown[][] = []
    for (let c = 0; c < cycles; c++) {
      const haps = pat.queryArc(c, c + 1).filter((h: any) => h.hasOnset?.() ?? true)
      rows.push(haps.map((h: any) => (key === 's+gain' ? `${h.value?.s}:${h.value?.gain}` : h.value?.[key])))
    }
    return rows
  } finally {
    clearStringParser({ core })
  }
}
const apply = (src: string, e: { range: [number, number]; text: string }) => src.slice(0, e.range[0]) + e.text + src.slice(e.range[1])

describe('#1463 design probe', () => {
  it('measures', async () => {
    const lines: string[] = []
    // E1
    for (const code of ['s("bd*2").gain(0.8)', 's("bd*2").gain("<0.8>")', 's("bd*2").gain("<0.8 0.8>")', 's("bd*2").gain("<0.2 0.8>")']) {
      const ir = parseStrudel(code) as never
      const st = steppedAutomations(ir)
      lines.push(`E1 ${code} | engine c0..3 ${JSON.stringify(await valuesPerCycle(code, 'gain', 4))} | stepped ${st.map((a) => `steps=[${a.steps.map((s) => s.value)}] period=${a.periodCycles}`).join(';') || 'none'} | signal ${signalAutomations(ir).length}`)
    }
    // E2
    const two = 's("bd*2").gain("<0.8 0.8>")'
    const [a] = steppedAutomations(parseStrudel(two) as never)
    const edited = apply(two, stepValueEdit(a, 1, 0.3)!)
    lines.push(`E2 edit step 1 → ${edited} | engine c0..5 ${JSON.stringify(await valuesPerCycle(edited, 'gain', 6))}`)
    // E3
    for (const steps of ['<0.2 0.8>', '<0.2 0.8 0.5>', '<0.2 0.8 0.5 1>']) {
      const code = `arrange([4, s("bd").gain("${steps}")], [4, s("hh")])`
      lines.push(`E3 ${steps} in a 4-bar section | engine c0..11 ${JSON.stringify(await valuesPerCycle(code, 's+gain', 12))}`)
    }
    fs.writeFileSync(process.env.PROBE_OUT ?? '/dev/stdout', lines.join('\n') + '\n')
  }, 120_000)
})
