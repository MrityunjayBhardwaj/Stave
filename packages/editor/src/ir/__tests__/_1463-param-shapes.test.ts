/**
 * PROBE (#1463) — what `parseStrudel` actually emits for stepped Param arguments,
 * printed with the SOURCE TEXT under every span so a span claim is read, not
 * inferred. Asserts nothing.
 */
import { describe, it } from 'vitest'
import { parseStrudel } from '../parseStrudel'

const SKIP = new Set(['body'])

function show(src: string): string {
  const ir = parseStrudel(src) as unknown
  const lines: string[] = [`SRC ${JSON.stringify(src)}`]
  const walk = (n: unknown, depth: number, trackId: string | null): void => {
    if (Array.isArray(n)) return n.forEach((x) => walk(x, depth, trackId))
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    const tag = o.tag as string | undefined
    const tid = tag === 'Track' ? (o.trackId as string) : trackId
    if (tag === 'Param') {
      const loc = (o.loc as { start: number; end: number }[] | undefined)?.[0]
      lines.push(`  PARAM track=${tid} key=${o.key} userMethod=${o.userMethod} rawArgs=${JSON.stringify(o.rawArgs)} valueType=${typeof o.value}${o.value && typeof o.value === 'object' ? ':' + (o.value as { tag: string }).tag : '=' + JSON.stringify(o.value)} loc=${loc ? JSON.stringify(src.slice(loc.start, loc.end)) : 'none'}`)
      const dump = (v: unknown, d: number): void => {
        if (!v || typeof v !== 'object') return
        const vo = v as Record<string, unknown>
        const l = (vo.loc as { start: number; end: number }[] | undefined) ?? []
        const spans = l.map((s) => `${s.start}-${s.end}:${JSON.stringify(src.slice(s.start, s.end))}`).join(' ')
        const extra = vo.tag === 'Play' ? ` note=${JSON.stringify(vo.note)}` : vo.tag === 'Elongate' ? ` factor=${vo.factor}` : vo.tag === 'Sleep' ? ` dur=${vo.duration}` : ''
        lines.push(`${'    '.repeat(d)}${vo.tag}${extra} [${spans}]`)
        if (Array.isArray(vo.items)) vo.items.forEach((it) => dump(it, d + 1))
        if (vo.body && typeof vo.body === 'object' && vo.tag !== 'Param') dump(vo.body, d + 1)
      }
      if (o.value && typeof o.value === 'object') dump(o.value, 2)
    }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'loc' || k === 'keyLoc' || k === 'callSiteRange') continue
      if (tag === 'Param' && k === 'value') continue
      walk(v, depth + 1, tid)
    }
  }
  walk(ir, 0, null)
  return lines.join('\n')
}

const SRCS = [
  '$: s("bd*2").gain("<0.2 0.8>", 1)',
  '$: s("bd*2").gain("<0.2 0.8>" )',
  '$: s("bd*2").gain("<0.2 0.8>" + "")',
  '$: s("bd*2").gain("<0.2 0.8>".add(0.1))',
  '$: s("bd*2").gain(("<0.2 0.8>"))',
  '$: s("bd*2").gain("<0.2 0.8>")',
  '$: s("bd*2").gain("<0.2@2 0.8>")',
  "$: s(\"bd*2\").gain('<0.2 0.8>')",
  '$: s("bd*2").gain(`<0.2 0.8>`)',
  '$: s("bd*2").pan("<-1 .5 1>")',
  '$: s("bd*2").gain("< 0.2  0.8 >")',
  '$: s("bd*2").lpf("<200 2000>")',
  '$: s("bd*2").velocity("<.2 .8>").room("<0 0.5>")',
  'lead: arrange([1, s("bd*2").gain("<0.2 0.8>")], [2, s("hh*2")])',
  '$: stack(s("bd*2").gain("<0.2 0.8>"), s("hh*4"))',
  '$: s("bd*2").gain("<0.2 0.8>").gain(0.5)',
  '$: s("bd*2").gain("<0.2 ~ 0.8>")',
  '$: s("bd*2").gain("<0.2 0.8>/2")',
  '$: note("c e").s("sine").gain("<0.2 0.8>")',
]

describe('#1463 probe — Param shapes', () => {
  it('prints', () => {
    console.log('\n' + SRCS.map(show).join('\n\n'))
  })
})
