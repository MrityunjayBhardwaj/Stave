import { describe, it, expect } from 'vitest'
import { detectAllChunks } from '../../chunkDetect'
import { buildStripModels } from '../stripModel'
import { stemFileNames } from '../stemNames'
import { parseStrudel } from '../../../ir/parseStrudel'

const DOC = `d2: s("bd*2")\n$: s("hh*4")\n`

function irTrackNames(code: string): string[] {
  const out: string[] = []
  const seen = new Set<any>()
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object' || seen.has(n)) return
    seen.add(n)
    const tag = n.tag ?? n.type ?? n._tag ?? n.kind
    if (typeof tag === 'string' && /track/i.test(tag)) {
      out.push(JSON.stringify({ tag, id: n.id ?? n.trackId ?? n.name }))
    }
    for (const k of Object.keys(n)) {
      const v = (n as any)[k]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') walk(v)
    }
  }
  walk(parseStrudel(code) as any)
  return out
}

describe('#1667 probe — positional name collision', () => {
  it('mixer strips', () => {
    const strips = buildStripModels(detectAllChunks(DOC))
    console.log('STRIPS', strips.map((s) => ({ id: s.id, name: s.name, cap: s.captureId, label: s.label, color: s.color })))
    console.log('STEMS', stemFileNames(DOC, strips.map((s) => s.captureId)))
  })
  it('ir tracks', () => {
    console.log('IR TRACK IDS', irTrackNames(DOC))
  })
  it('three-way', () => {
    const doc2 = `d3: s("bd*2")\n$: s("hh*4")\n$: s("cp")\n`
    const strips = buildStripModels(detectAllChunks(doc2))
    console.log('STRIPS2', strips.map((s) => s.name))
    console.log('IR2', irTrackNames(doc2))
  })
})
