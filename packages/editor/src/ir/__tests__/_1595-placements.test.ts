/**
 * _1595-placements.test.ts — THROWAWAY. Print the placements and IR shape the walk
 * records for a slow under a visualiser (the reversed-order rival ran, so there were
 * two steps where one was expected).
 * Run: cd packages/editor && npx vitest run --config vitest.probe.config.ts src/ir/__tests__/_1595-placements.test.ts
 */
import { it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { signalAutomations } from '../signalAutomation'

const SKIP = new Set(['loc', 'keyLoc', 'callSiteRange'])
const shape = (n: unknown, d = 0): string => {
  if (!n || typeof n !== 'object' || d > 8) return ''
  const o = n as Record<string, unknown>
  if (typeof o.tag !== 'string') return Object.entries(o).filter(([k]) => !SKIP.has(k)).map(([k, v]) => `${k}:${shape(v, d + 1)}`).join(' ')
  const kids = Object.entries(o)
    .filter(([k, v]) => !SKIP.has(k) && v && typeof v === 'object')
    .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.map((x) => shape(x, d + 1)).join(', ')}]` : shape(v, d + 1)}`)
  const extra = ['factor', 'offset', 'key'].filter((k) => k in o).map((k) => `${k}:${String(o[k])}`)
  const via = (o.via as { method?: string } | undefined)?.method
  return `${o.tag}${via ? `<${via}>` : ''}(${[...extra, ...kids].join(' ')})`
}

it('prints', () => {
  for (const code of ['s("bd*8").gain(saw.slow(3)).slow(2)._scope()', 's("bd*8").gain(saw.slow(3)).slow(2)']) {
    const ir = parseStrudel(code)
    console.log(`\n${code}\n  placements=${JSON.stringify(signalAutomations(ir as never).map((a) => a.placements))}\n  ir=${shape(ir)}`)
  }
})
