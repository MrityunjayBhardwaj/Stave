/** THROWAWAY — the one document whose late binding names a Strudel function. */
import { describe, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import crypto from 'node:crypto'

const CORPUS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../app/tests/parity-corpus/.bakery-runs',
)
const TARGET = '0pgpJRZHpnEi'

describe('#1468 hazard doc', () => {
  it('prints it', () => {
    const isOutput = (f: string): boolean =>
      f.startsWith('result-') || f.startsWith('edit-result-') || f.startsWith('ir-support-result')
    for (const f of fs.readdirSync(CORPUS_DIR).filter((x) => x.endsWith('.json') && !isOutput(x)).sort()) {
      let j: { samples?: { hash?: string; code?: unknown }[] }
      try { j = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8')) } catch { continue }
      for (const s of j.samples ?? []) {
        if (typeof s.code === 'string' && String(s.hash) === TARGET) {
          console.log(`chars=${s.code.length}`)
          s.code.split('\n').forEach((l, i) => console.log(`${String(i + 1).padStart(3)}| ${l}`))
          return
        }
      }
    }
    console.log('NOT FOUND')
  })
})
