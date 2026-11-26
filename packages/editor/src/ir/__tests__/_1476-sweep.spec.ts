/**
 * #1476 PROBE — corpus digest, for a genuine BEFORE/AFTER diff.
 *
 * Emits one line per document: name, leaf count, track count, and a hash of
 * the monolithic IR, plus a PARITY flag when the staged parser disagrees.
 * Written to a file so the two sides are compared by CONTENT, not by memory.
 *
 * ⚠ No "control" arm here. De-labelling a commented `$:` is NOT equivalent to
 * the interior rule — it also deletes the legitimate ghost track a
 * non-interior commented label is supposed to produce (#1384). The only
 * honest control is the same probe run against the unpatched parser.
 *
 * Run: OUT=<path> npx vitest run --config vitest.probe.config.ts \
 *        src/ir/__tests__/_1476-sweep.spec.ts
 */
import { describe, it } from 'vitest'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { parseStrudel } from '../parseStrudel'
import { pipeline, stripStageMeta } from './helpers/stagesParity'
import {
  hasCorpusArchive,
  loadCorpus,
  loadEveryCorpusDocument,
} from '../../visualEdit/miniSource/__tests__/evalHarness'

function countTag(n: unknown, pred: (t: string) => boolean): number {
  let c = 0
  const visit = (x: unknown): void => {
    if (x === null || typeof x !== 'object') return
    if (Array.isArray(x)) return void x.forEach(visit)
    const r = x as Record<string, unknown>
    if (typeof r.tag === 'string' && pred(r.tag)) c++
    for (const [k, v] of Object.entries(r)) { if (k === 'loc') continue; visit(v) }
  }
  visit(n)
  return c
}

function digest(docs: { name: string; code: string }[]): string {
  const lines: string[] = []
  for (const d of docs) {
    let mono: unknown, monoJson: string, parity: string
    try {
      mono = stripStageMeta(parseStrudel(d.code))
      monoJson = JSON.stringify(mono)
    } catch (e) {
      lines.push(`${d.name}\tTHREW\t${String(e).slice(0, 120)}`)
      continue
    }
    try {
      parity = JSON.stringify(stripStageMeta(pipeline(d.code))) === monoJson ? 'ok' : 'BROKE'
    } catch (e) {
      parity = `STAGED-THREW:${String(e).slice(0, 80)}`
    }
    const leaves = countTag(mono, (t) => t === 'Play' || t === 'Sound')
    const trackN = countTag(mono, (t) => t === 'Track')
    const bareCode = countTag(mono, (t) => t === 'Code')
    const h = createHash('sha256').update(monoJson).digest('hex').slice(0, 12)
    lines.push(`${d.name}\tleaves=${leaves}\ttracks=${trackN}\tcode=${bareCode}\tparity=${parity}\tir=${h}`)
  }
  return lines.join('\n')
}

describe('#1476 digest', () => {
  it.skipIf(!hasCorpusArchive())('writes a digest of both populations', async () => {
    const out = process.env.OUT
    if (!out) throw new Error('set OUT=<path>')
    const narrow = await loadCorpus()
    const wide = await loadEveryCorpusDocument()
    writeFileSync(
      out,
      `# narrow loadCorpus: ${narrow.length} rows\n${digest(narrow)}\n` +
        `# wide loadEveryCorpusDocument: ${wide.length} documents\n${digest(wide)}\n`,
    )
    // eslint-disable-next-line no-console
    console.log(`wrote ${out}: narrow=${narrow.length} wide=${wide.length}`)
  })
})
