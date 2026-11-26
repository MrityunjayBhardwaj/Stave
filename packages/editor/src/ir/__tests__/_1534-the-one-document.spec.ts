/**
 * #1534 — the ONE archive document the change touches, read as rows.
 *
 * The differential says 8 → 7. A count cannot say WHICH row left, so this
 * prints every row's text on both sides of the change.
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { parseStrudel } from '../parseStrudel'

const CORPUS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../app/tests/parity-corpus/.bakery-runs',
)
const TARGET = '500/3peRsLXHwJW7'

function findDoc(): string {
  const isOutput = (f: string): boolean =>
    f.startsWith('result-') || f.startsWith('edit-result-') || f.startsWith('ir-support-result')
  for (const f of fs.readdirSync(CORPUS_DIR).filter((x) => x.endsWith('.json') && !isOutput(x)).sort()) {
    let j: { offset?: unknown; samples?: { hash?: string; code?: unknown }[] }
    try {
      j = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8'))
    } catch {
      continue
    }
    for (const s of j.samples ?? []) {
      if (typeof s.code === 'string' && `${j.offset}/${s.hash}` === TARGET) return s.code
    }
  }
  throw new Error(`document ${TARGET} not found`)
}

describe('#1534 — the one document', () => {
  it('names every row it declares', () => {
    const code = findDoc()
    console.log(`sha256=${crypto.createHash('sha256').update(code).digest('hex').slice(0, 12)}  chars=${code.length}`)
    const ir = parseStrudel(code) as unknown as {
      tag: string
      tracks?: { loc?: { start: number; end: number }[] }[]
    }
    const rows = (ir.tracks ?? []).map((t) =>
      t.loc?.[0] ? code.slice(t.loc[0].start, t.loc[0].end).split('\n')[0].slice(0, 60) : 'no-loc',
    )
    console.log(`rows=${rows.length}`)
    rows.forEach((r, i) => console.log(`   ${i + 1}. ${JSON.stringify(r)}`))
    expect(rows.some((r) => /^(?:let|const|var)\s/.test(r))).toBe(false)
  })
})
