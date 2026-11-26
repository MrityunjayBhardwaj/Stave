/**
 * _1595-negative-time.test.ts — THROWAWAY. What does the engine play where a `.late`
 * hands a pattern NEGATIVE time? `saw = signal(t => t % 1)` (signal.mjs:35), and JS `%`
 * keeps the sign. Print, don't assert.
 * Run: cd packages/editor && npx vitest run --config vitest.probe.config.ts src/ir/__tests__/_1595-negative-time.test.ts
 */
import { it } from 'vitest'
import { clearStringParser, installMiniStringParser } from '../../engine/stringParser'

/* eslint-disable @typescript-eslint/no-explicit-any */
async function haps(code: string, from: number, to: number) {
  const core: any = await import('@strudel/core')
  const mini: any = await import('@strudel/mini')
  await core.evalScope(core, mini)
  installMiniStringParser({ core, mini })
  try {
    const { transpiler }: any = await import('@strudel/transpiler')
    const out = await core.evaluate(code, transpiler)
    return (out.pattern ?? out).queryArc(from, to).filter((h: any) => h.hasOnset?.() ?? true)
  } finally {
    clearStringParser({ core })
  }
}

it('prints', async () => {
  const lines: string[] = []
  for (const code of [
    's("bd*8").gain(saw.slow(3)).late(0.5)',
    's("bd*8").gain(saw.slow(3))',
    's("bd*8").gain(sine.slow(3)).late(0.5)',
    's("bd*8").gain(isaw.slow(3)).late(0.5)',
  ]) {
    const hs = await haps(code, 0, 1)
    lines.push(`${code}\n  ` + hs.map((h: any) => `${h.whole.begin.valueOf().toFixed(3)}:${Number(h.value.gain).toFixed(4)}`).join(' '))
  }
  for (const code of ['s("bd*2").gain("<0.2 0.8>").late(1)', 's("bd*2").gain("<0.2 0.8 0.5>").late(1)']) {
    const rows: string[] = []
    for (let c = 0; c < 4; c++) rows.push(`c${c}=[${(await haps(code, c, c + 1)).map((h: any) => h.value.gain).join(',')}]`)
    lines.push(`${code}\n  ${rows.join(' ')}`)
  }
  console.log('\n' + lines.join('\n'))
}, 60_000)
