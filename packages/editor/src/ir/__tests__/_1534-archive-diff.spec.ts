/**
 * #1534 archive differential — what MOVED across the 558-document archive.
 *
 * Writes a JSON fingerprint of every document (row count, opacity, staged-vs-
 * mono agreement) so the two sides can be diffed BY NAME. An unmoved count is
 * the dangerous reading: it cannot tell "nothing changed" from "two changes
 * cancelled" from "the metric cannot reach the change".
 *
 * Run once on the pre-fix tree with SNAP=before, once after with SNAP=after,
 * then again with SNAP=diff to print the member-level delta.
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { parseStrudel } from '../parseStrudel'
import { pipeline, stripStageMeta } from './helpers/stagesParity'
import type { PatternIR } from '../PatternIR'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CORPUS_DIR = path.resolve(HERE, '../../../../app/tests/parity-corpus/.bakery-runs')
const OUT_DIR = process.env.SNAP_DIR ?? '/tmp'
const MODE = process.env.SNAP ?? 'before'

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

function isBareCode(n: unknown): boolean {
  const r = n as { tag?: string; via?: unknown }
  return r?.tag === 'Code' && r.via === undefined
}

/** Wholly opaque = a lone d1 Track whose body is a bare Code node. */
function whollyOpaque(ir: PatternIR): boolean {
  const r = ir as unknown as { tag: string; body?: unknown }
  return r.tag === 'Track' && isBareCode(r.body)
}

function rowCount(ir: PatternIR): number {
  const r = ir as unknown as { tag: string; tracks?: unknown[] }
  return r.tag === 'Stack' ? (r.tracks?.length ?? 0) : 1
}

describe('#1534 archive differential', () => {
  it(`snapshot mode=${MODE}`, () => {
    if (MODE === 'diff') {
      const a = JSON.parse(fs.readFileSync(path.join(OUT_DIR, '1534-before.json'), 'utf8'))
      const b = JSON.parse(fs.readFileSync(path.join(OUT_DIR, '1534-after.json'), 'utf8'))
      const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
      const moved: string[] = []
      for (const n of names) {
        if (JSON.stringify(a[n]) !== JSON.stringify(b[n])) {
          moved.push(`${n}\n     before ${JSON.stringify(a[n])}\n     after  ${JSON.stringify(b[n])}`)
        }
      }
      const count = (o: Record<string, { opaque: boolean; agree: boolean }>, k: 'opaque' | 'agree') =>
        Object.entries(o).filter(([, v]) => (k === 'opaque' ? v.opaque : !v.agree)).map(([n]) => n).sort()
      const opaqueA = count(a, 'opaque'), opaqueB = count(b, 'opaque')
      const disA = count(a, 'agree'), disB = count(b, 'agree')
      console.log(`examined=${names.length} documents`)
      console.log(`wholly opaque : ${opaqueA.length} → ${opaqueB.length}`)
      console.log(`  left  : ${JSON.stringify(opaqueA.filter((n) => !opaqueB.includes(n)))}`)
      console.log(`  joined: ${JSON.stringify(opaqueB.filter((n) => !opaqueA.includes(n)))}`)
      console.log(`staged≠mono   : ${disA.length} → ${disB.length}`)
      console.log(`  left  : ${JSON.stringify(disA.filter((n) => !disB.includes(n)))}`)
      console.log(`  joined: ${JSON.stringify(disB.filter((n) => !disA.includes(n)))}`)
      let codeDown = 0, codeUp = 0, codeSame = 0
      for (const n of names) {
        const x = a[n]?.codes ?? 0, y = b[n]?.codes ?? 0
        if (y < x) codeDown += 1; else if (y > x) codeUp += 1
        else if (JSON.stringify(a[n]) !== JSON.stringify(b[n])) codeSame += 1
      }
      console.log(`opaque Code nodes — documents where the count FELL: ${codeDown}`)
      console.log(`⚠ opaque Code nodes — documents where it ROSE     : ${codeUp}`)
      console.log(`   moved but Code count unchanged                 : ${codeSame}`)
      console.log(`documents whose FINGERPRINT moved at all: ${moved.length}`)
      for (const m of moved) console.log(`   ${m}`)
      return
    }
    const docs = loadEveryDocument()
    const snap: Record<string, unknown> = {}
    for (const d of docs) {
      let mono: PatternIR | null = null
      let staged: PatternIR | null = null
      try {
        mono = parseStrudel(d.code)
      } catch {
        /* threw */
      }
      try {
        staged = pipeline(d.code)
      } catch {
        /* threw */
      }
      const countCode = (n: unknown): number => {
        let k = 0
        const walk = (x: unknown): void => {
          if (x === null || typeof x !== 'object') return
          if (Array.isArray(x)) return void x.forEach(walk)
          const r = x as Record<string, unknown>
          if (r.tag === 'Code' && r.via === undefined) k += 1
          for (const [key, v] of Object.entries(r)) { if (key === 'loc' || key === 'tag') continue; walk(v) }
        }
        walk(n)
        return k
      }
      snap[d.name] = {
        codes: mono ? countCode(mono) : -1,
        rows: mono ? rowCount(mono) : -1,
        opaque: mono ? whollyOpaque(mono) : true,
        agree:
          mono && staged
            ? JSON.stringify(stripStageMeta(staged)) === JSON.stringify(stripStageMeta(mono))
            : false,
        sha: mono
          ? crypto.createHash('sha256').update(JSON.stringify(mono)).digest('hex').slice(0, 12)
          : 'threw',
      }
    }
    fs.writeFileSync(path.join(OUT_DIR, `1534-${MODE}.json`), JSON.stringify(snap, null, 1))
    console.log(`wrote ${Object.keys(snap).length} documents to 1534-${MODE}.json`)
    expect(Object.keys(snap).length).toBe(558)
  })
})
