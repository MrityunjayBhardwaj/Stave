import { describe, it } from 'vitest'
import fs from 'node:fs'
import { clearStringParser, installMiniStringParser } from '../../engine/stringParser'
/* eslint-disable @typescript-eslint/no-explicit-any */
describe('#1463 L6', () => {
  it('does the two-loop song repeat at 4?', async () => {
    const core: any = await import('@strudel/core')
    const mini: any = await import('@strudel/mini')
    await core.evalScope(core, mini)
    installMiniStringParser({ core, mini })
    try {
      const { transpiler }: any = await import('@strudel/transpiler')
      const code = 'stack(s("<bd sd cp hh>"), s("hh*4").gain("<0.2 0.8 0.5>"))'
      const out = await core.evaluate(code, transpiler)
      const pat = out.pattern ?? out
      const sig = (c: number) => pat.queryArc(c, c + 1).filter((h: any) => h.hasOnset?.() ?? true)
        .map((h: any) => `${(h.whole.begin.valueOf() - c).toFixed(3)}:${h.value.s}:${h.value.gain ?? '-'}`).sort().join(' ')
      const rows = Array.from({ length: 13 }, (_, c) => sig(c))
      const lines = rows.map((r, c) => `c${c} ${r}`)
      lines.push(`cycle4==cycle0 ${rows[4] === rows[0]} · cycle12==cycle0 ${rows[12] === rows[0]}`)
      fs.writeFileSync(process.env.PROBE_OUT ?? '/dev/stdout', lines.join('\n') + '\n')
    } finally {
      clearStringParser({ core })
    }
  }, 60_000)
})
