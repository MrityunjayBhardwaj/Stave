import { it } from 'vitest'
import { parseStrudel } from '../parseStrudel'
const locs = (n: any, out: number[] = []): number[] => {
  if (!n || typeof n !== 'object') return out
  if (n.tag === 'Play' && n.loc?.[0]) out.push(n.loc[0].start)
  for (const v of Object.values(n)) if (v && typeof v === 'object') Array.isArray(v) ? v.forEach((x) => locs(x, out)) : locs(v, out)
  return out
}
it('clip', () => {
  for (const doc of ['_$: s("bd*4")\nn("c e g").s("ptest")', '_$: s("bd*4")\n\nn("c e g")\n_x: s("hh")']) {
    const ir: any = parseStrudel(doc)
    for (const t of ir.tracks) console.log(JSON.stringify(doc), t.trackId, t.loc?.[0], 'playLocs', locs(t.body).join(','), 'bodyTag', t.body.tag)
  }
})
