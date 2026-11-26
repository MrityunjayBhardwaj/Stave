/**
 * PROBE (#1352 Phase 4 write half) — is a `.begin`/`.end` call REACHABLE by the
 * chunk detector on real documents, and what shape is its argument?
 *
 * The question this answers is P786's: before building a serializer, is it ever
 * CALLED with something it can act on? A pure write function that always
 * refuses is indistinguishable from a feature that does not apply.
 *
 * ⚠ TWO ARMS, AND THE FIRST ONE IS THE WRONG INSTRUMENT — kept deliberately.
 * `detectAllChunks` is documented top-level-only ("Always false for
 * detectAllChunks — every chunk there is top-level"), so a `.begin` inside a
 * `stack(...)` arm is invisible to it BY CONSTRUCTION. It reported 9 of 21
 * `.begin` sites and 3 of 20 `.end` sites, which reads as "the vocabulary does
 * not reach" and would have been a wrong conclusion about the detector rather
 * than about the documents. `detectChunk(doc, pos)` — which descends to the
 * innermost chain under an offset, and is what a gesture holding a source
 * offset actually calls — is arm two. The gap between the arms IS the finding.
 *
 * Population: the 558-document archive (#1524's denominator, sha256 of `code`),
 * NOT the `edit-samples-*` family alone.
 */
import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { detectAllChunks, detectChunk } from '../chunkDetect'

const DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../app/tests/parity-corpus/.bakery-runs',
)
const NARROW = [
  'edit-samples-2026-07-24T17-49-00-172Z.json',
  'edit-samples-offset250-2026-07-24T17-49-04-301Z.json',
  'edit-samples-offset500-2026-07-24T17-49-08-639Z.json',
]
const isOutput = (f: string) =>
  f.startsWith('result-') || f.startsWith('edit-result-') || f.startsWith('ir-support-result')

function docs(): { name: string; code: string }[] {
  const rest = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.json') && !isOutput(f) && !NARROW.includes(f))
    .sort()
  const seen = new Set<string>()
  const out: { name: string; code: string }[] = []
  for (const f of [...NARROW, ...rest]) {
    let j: { offset?: unknown; samples?: { hash?: string; code?: unknown }[] }
    try {
      j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
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

/** Every offset at which `.name(` is written, textually. */
function siteOffsets(code: string, name: string): number[] {
  const out: number[] = []
  const needle = `.${name}(`
  let i = 0
  for (;;) {
    const at = code.indexOf(needle, i)
    if (at === -1) break
    out.push(at)
    i = at + needle.length
  }
  return out
}

describe('#1352 — region controls, reach', () => {
  it('reports how many `.begin`/`.end` call sites each detector entry point exposes', () => {
    const all = docs()
    console.log(`examined=${all.length} documents`)

    for (const name of ['begin', 'end', 'gain'] as const) {
      const written = all.filter((d) => d.code.includes(`.${name}(`))
      let textualSites = 0
      let topLevelReached = 0
      let byOffsetReached = 0
      let numericArgs = 0
      let refusedArgs = 0
      const shapes = new Map<string, number>()
      const missed: string[] = []

      for (const d of written) {
        const offs = siteOffsets(d.code, name)
        textualSites += offs.length

        // ARM 1 — top-level only (the wrong instrument, kept as the contrast).
        try {
          for (const c of detectAllChunks(d.code)) {
            for (const call of c.chain) if (call.name === name) topLevelReached++
          }
        } catch {
          /* a document the parser refuses is not this probe's subject */
        }

        // ARM 2 — what a gesture holding a source offset actually calls.
        for (const off of offs) {
          let chunk
          try {
            chunk = detectChunk(d.code, off)
          } catch {
            continue
          }
          const call = chunk?.chain.find((c) => c.name === name)
          if (!call) {
            if (missed.length < 6) {
              missed.push(`${d.name}@${off}: ${JSON.stringify(d.code.slice(off, off + 34))}`)
            }
            continue
          }
          byOffsetReached++
          const a = call.args[0]
          if (a && a.numeric !== null) numericArgs++
          else refusedArgs++
          const raw = (a?.raw ?? '').trim()
          const shape =
            a?.numeric !== null && a !== undefined
              ? 'numeric-literal'
              : /^["'`]/.test(raw)
                ? 'quoted-mini'
                : /^[A-Za-z_$][\w$]*$/.test(raw)
                  ? 'bare-identifier'
                  : 'expression'
          shapes.set(shape, (shapes.get(shape) ?? 0) + 1)
        }
      }

      console.log(
        `\n=== .${name}( — ${written.length}/${all.length} docs, ${textualSites} textual sites\n` +
          `    arm1 detectAllChunks (top-level only): ${topLevelReached}\n` +
          `    arm2 detectChunk(doc, offset):         ${byOffsetReached}` +
          `  (${numericArgs} numeric / ${refusedArgs} refuse)`,
      )
      for (const [k, v] of [...shapes].sort((a, b) => b[1] - a[1])) console.log(`      ${k}: ${v}`)
      for (const m of missed) console.log(`    UNREACHED ${m}`)
    }
  })
})
