/**
 * SELF-REVIEW PASS 2 — four things the first pass did not look at.
 *
 * A. A trailing BINDING statement lands in `collected.tail`, so `let b = 2`
 *    after the first expression becomes a silent track. Is that a wart, and how
 *    many archive documents have the shape?
 * B. Does `toStrudel(parseStrudel(code))` still round-trip the new shape, or
 *    does the split lose the binding lines?
 * C. A `/*` inside a STRING must not open a comment.
 * D. A `name:` inside a TERMINATED block comment — what happens now, and what
 *    happened before?
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import crypto from 'node:crypto'
import {
  parseStrudel,
  extractTracks,
  collectTopLevelBindings,
  stripParserPrelude,
  BINDING_RE,
} from '../parseStrudel'
import { toStrudel } from '../toStrudel'
import { pipeline, stripStageMeta } from './helpers/stagesParity'
import type { PatternIR } from '../PatternIR'

const CORPUS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../app/tests/parity-corpus/.bakery-runs',
)

function loadEveryDocument(): { name: string; code: string }[] {
  const isOutput = (f: string): boolean =>
    f.startsWith('result-') || f.startsWith('edit-result-') || f.startsWith('ir-support-result')
  const files = fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.json') && !isOutput(f))
    .sort()
  const seen = new Set<string>()
  const out: { name: string; code: string }[] = []
  for (const f of files) {
    let j: { offset?: unknown; samples?: { hash?: string; code?: unknown }[] }
    try {
      j = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8'))
    } catch {
      continue
    }
    for (const s of j.samples ?? []) {
      if (typeof s.code !== 'string') continue
      const sha = crypto.createHash('sha256').update(s.code).digest('hex')
      if (seen.has(sha)) continue
      seen.add(sha)
      out.push({ name: `${j.offset}/${s.hash}`, code: s.code })
    }
  }
  return out
}

function isWhollyOpaque(n: PatternIR): boolean {
  if (n.tag === 'Track') return isWhollyOpaque((n as unknown as { body: PatternIR }).body)
  if (n.tag === 'Stack') {
    const ts = (n as unknown as { tracks: PatternIR[] }).tracks
    return ts.length > 0 && ts.every(isWhollyOpaque)
  }
  return n.tag === 'Code' && (n as unknown as { via?: unknown }).via === undefined
}

const tracksOf = (ir: PatternIR) =>
  ir.tag === 'Stack' ? ir.tracks : ir.tag === 'Track' ? [ir] : []

describe('self-review pass 2', () => {
  it('A — how often does a BINDING land in the tail, and what does it draw?', () => {
    const code = 'let a = s("bd*4")\na.fast(2)\nlet b = 2\ns("hh*8")'
    const ir = parseStrudel(code)
    const ts = tracksOf(ir)
    console.log(
      `constructed: ${ts.length} tracks\n` +
        ts
          .map((t, i) => `  d${i + 1}: ${JSON.stringify(code.slice(t.loc![0].start, t.loc![0].end))}`)
          .join('\n'),
    )

    // …and across the archive: bare documents whose TAIL contains a binding.
    const docs = loadEveryDocument()
    let population = 0
    const withTrailingBinding: string[] = []
    for (const d of docs) {
      if (extractTracks(d.code).length > 0) continue
      const collected = collectTopLevelBindings(d.code, 0)
      if (!collected || collected.tail.length < 2) continue
      population++
      if (collected.tail.some((s) => BINDING_RE.test(s.text))) withTrailingBinding.push(d.name)
    }
    console.log(
      `archive: ${population} documents take the new branch; ` +
        `${withTrailingBinding.length} of them have a binding in the tail` +
        (withTrailingBinding.length ? `\n  ${withTrailingBinding.join('\n  ')}` : ''),
    )
    expect(population).toBeGreaterThan(0)
  })

  it('B — does the new shape still round-trip through toStrudel?', () => {
    const cases = [
      'let M = 2\ns("cp")\narrange([2, s("bd")], [2, s("hh")])',
      'let riff = s("bd*4")\nriff.fast(2)\ns("hh*8")',
      // Controls: shapes that already existed.
      's("cp")\ns("hh")',
      'let M = 2\narrange([M, s("bd")], [M, s("hh")])',
    ]
    for (const code of cases) {
      const back = toStrudel(parseStrudel(code))
      console.log(`IN :\n${code}\nOUT:\n${back}\n---`)
    }
    expect(cases.length).toBe(4)
  })

  it('C — a `/*` inside a STRING must not open a comment', () => {
    expect(extractTracks('const s = "/*"\nfoo: s("bd")').map((t) => t.label)).toEqual(['foo'])
    expect(extractTracks("const s = '/*'\nfoo: s(\"bd\")").map((t) => t.label)).toEqual(['foo'])
  })

  it('E — does stripParserPrelude share the block-comment gap? (#1532 asked)', () => {
    // It is a LINE scanner whose only comment rule is `trimmed.startsWith("//")`,
    // so a `/* … */` header should stop the strip early and leave the boot calls
    // in the body. Measured rather than read off the source.
    const cases: [string, string][] = [
      ['line-comment header', '// header\nsamples("x")\ns("bd")'],
      ['block-comment header, one line', '/* header */\nsamples("x")\ns("bd")'],
      ['block-comment header, multi-line', '/* a\nb\n*/\nsamples("x")\ns("bd")'],
      ['no header at all', 'samples("x")\ns("bd")'],
    ]
    for (const [name, code] of cases) {
      const r = stripParserPrelude(code)
      console.log(`  ${name.padEnd(34)} body=${JSON.stringify(r.body.trim().slice(0, 34))}`)
    }
    // The control: with NO header the boot call is stripped, so the strip works.
    expect(stripParserPrelude('samples("x")\ns("bd")').body.trim()).toBe('s("bd")')
  })

  it('F — WHAT DOES E COST? does a block-comment header make a document opaque?', () => {
    const pairs: [string, string][] = [
      ['line header + boot + one pattern', '// h\nsamples("x")\ns("bd")'],
      ['BLOCK header + boot + one pattern', '/* h */\nsamples("x")\ns("bd")'],
      ['BLOCK header + one pattern, no boot', '/* h */\ns("bd")'],
      ['BLOCK header + boot + TWO patterns', '/* h */\nsamples("x")\ns("bd")\ns("hh")'],
      ['line header + boot + TWO patterns', '// h\nsamples("x")\ns("bd")\ns("hh")'],
    ]
    for (const [name, code] of pairs) {
      const ir = parseStrudel(code)
      const c: Record<string, number> = {}
      const walk = (n: unknown): void => {
        if (n === null || typeof n !== 'object') return
        if (Array.isArray(n)) return void n.forEach(walk)
        const r = n as Record<string, unknown>
        if (typeof r.tag === 'string') c[r.tag] = (c[r.tag] ?? 0) + 1
        for (const [k, v] of Object.entries(r)) if (k !== 'loc' && k !== 'tag') walk(v)
      }
      walk(ir)
      console.log(`  ${name.padEnd(38)} ${ir.tag.padEnd(6)} census=${JSON.stringify(c)}`)
    }
    // The control: the LINE-header form is known good and must stay good.
    expect(parseStrudel('// h\nsamples("x")\ns("bd")').tag).toBe('Track')
  })

  it('G — SIZE the prelude gap over the archive, with a control', () => {
    const docs = loadEveryDocument()
    let withBlockHeader = 0
    const opaqueAndRescued: string[] = []
    const opaqueNotRescued: string[] = []
    for (const d of docs) {
      // A BLOCK comment before the first non-comment code — the header shape.
      if (!/^\s*\/\*/.test(d.code)) continue
      withBlockHeader++
      if (!isWhollyOpaque(parseStrudel(d.code))) continue
      // THE CONTROL: blank the leading block comment (keeping byte offsets) and
      // ask again. A document that becomes readable was killed by its header.
      const blanked = d.code.replace(/^\s*\/\*[\s\S]*?\*\//, (m) => m.replace(/[^\n]/g, ' '))
      if (!isWhollyOpaque(parseStrudel(blanked))) opaqueAndRescued.push(d.name)
      else opaqueNotRescued.push(d.name)
    }
    console.log(
      `documents opening with a /* block header : ${withBlockHeader} of ${docs.length}\n` +
        `  wholly opaque, and READABLE once the header is blanked : ${opaqueAndRescued.length}` +
        (opaqueAndRescued.length ? `\n    ${opaqueAndRescued.join('\n    ')}` : '') +
        `\n  wholly opaque for some OTHER reason : ${opaqueNotRescued.length}`,
    )
    expect(withBlockHeader).toBeGreaterThan(0)
  })

  it('H — do the staged/monolithic divergences have the SAME NAMES, not just the same count?', () => {
    // ⚠ THIS IS THE CLAIM I WROTE INTO A PR BODY HAVING COMPARED ONLY COUNTS.
    // 9 before and 9 after is not evidence that the nine are the same nine.
    const docs = loadEveryDocument()
    const disagree: string[] = []
    for (const d of docs) {
      let mono: PatternIR
      try {
        mono = parseStrudel(d.code)
      } catch {
        continue
      }
      let staged: PatternIR
      try {
        staged = stripStageMeta(pipeline(d.code))
      } catch {
        disagree.push(`${d.name} (staged threw)`)
        continue
      }
      if (JSON.stringify(staged) !== JSON.stringify(stripStageMeta(mono))) disagree.push(d.name)
    }
    console.log(`staged != monolithic, ${disagree.length} documents:\n  ${disagree.join('\n  ')}`)
    expect(disagree.length).toBe(9)
  })

  it('D — a label inside a TERMINATED block comment', () => {
    const code = '/*\nfoo: s("bd")\n*/\n$: s("hh")'
    const labels = extractTracks(code).map((t) => t.label)
    console.log(`labels for a block-commented track: ${JSON.stringify(labels)}`)
    expect(labels.length).toBeGreaterThanOrEqual(1)
  })
})
