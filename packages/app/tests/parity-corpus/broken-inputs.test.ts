/**
 * broken-inputs.test.ts — the edit-coverage output carries the patterns behind
 * each refusal reason, not only the count (#2152).
 *
 * #903 could only audit the reason histogram by adding temporary logging to
 * see which strings were refused. These arms pin that the inputs are in the
 * output: one list per reason, as long as its count, each entry a string that
 * really is in the tune it names.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measureDocs, resultJson } from './editCoverage'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const docs = fs
  .readdirSync(corpusDir)
  .filter((f) => f.endsWith('.strudel'))
  .sort()
  .map((f) => ({ name: f, code: fs.readFileSync(path.join(corpusDir, f), 'utf8') }))

describe('edit-coverage — the inputs behind each refusal reason', () => {
  const m = measureDocs(docs)

  it('the corpus has refusals to record (otherwise every arm below is vacuous)', () => {
    expect(m.brokenReasons.size).toBeGreaterThan(0)
  })

  it('every reason lists exactly as many inputs as its count', () => {
    expect([...m.brokenInputs.keys()].sort()).toEqual([...m.brokenReasons.keys()].sort())
    for (const [reason, count] of m.brokenReasons) {
      expect(m.brokenInputs.get(reason)?.length, reason).toBe(count)
    }
  })

  it('each input is a pattern string found in the tune it names', () => {
    const byName = new Map(docs.map((d) => [d.name, d.code]))
    for (const [reason, inputs] of m.brokenInputs) {
      for (const input of inputs) {
        expect(input.mini.length, `${reason}: empty mini string`).toBeGreaterThan(0)
        expect(byName.get(input.file), `${reason}: ${input.file}`).toContain(input.mini)
      }
    }
  })

  it('the JSON output carries the inputs under the same keys, in the same order, as the counts', () => {
    const json = resultJson(m)
    expect(Object.keys(json.brokenInputs)).toEqual(Object.keys(json.brokenReasons))
    for (const [reason, count] of Object.entries(json.brokenReasons)) {
      expect(json.brokenInputs[reason]).toHaveLength(count)
    }
  })

  it('a tune with nothing refused records no inputs', () => {
    const clean = measureDocs([{ name: 'clean', code: 's("bd sd hh sd")\n' }])
    expect(clean.brokenReasons.size).toBe(0)
    expect(clean.brokenInputs.size).toBe(0)
  })
})
