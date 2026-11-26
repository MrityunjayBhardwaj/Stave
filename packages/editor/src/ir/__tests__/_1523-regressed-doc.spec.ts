/**
 * `250/1XPvM8oELW_r` had all its labels admitted before the #1532 change and has
 * none admitted after. Its block comment IS terminated, so `inComment` should
 * not be firing. Print every candidate and where it sits.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { extractTracks } from '../parseStrudel'

const CORPUS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../app/tests/parity-corpus/.bakery-runs',
)

function findDoc(target: string): string {
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
      if (typeof s.code !== 'string') continue
      if (`${j.offset}/${s.hash}` === target) return s.code
    }
  }
  throw new Error(`document ${target} not in archive`)
}

describe('the document that regressed', () => {
  it('prints every label candidate and its surroundings', () => {
    const code = findDoc('250/1XPvM8oELW_r')
    console.log(`extractTracks: ${extractTracks(code).length}`)
    const re = /^[ \t]*(\/\/[ \t]*)?([A-Za-z_$][\w$]*)\s*:/gm
    let m: RegExpExecArray | null
    while ((m = re.exec(code))) {
      const line = code.slice(0, m.index).split('\n').length
      console.log(
        `  candidate ${JSON.stringify(m[2])} at line ${line} @${m.index}` +
          `  match=${JSON.stringify(m[0])}` +
          `\n      source: ${JSON.stringify(code.slice(m.index, m.index + 70))}`,
      )
    }
    // Where do the block comment delimiters actually sit?
    console.log(`  /* at ${code.indexOf('/*')}   */ at ${code.indexOf('*/')}`)
    expect(code).toContain('/*')
  })
})
