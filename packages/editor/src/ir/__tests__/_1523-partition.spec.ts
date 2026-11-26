/**
 * #1523 PARTITION PROBE — how many of the wholly-opaque documents are THIS shape?
 *
 * The issue measured "22 wholly opaque, 13 of them bare-with-a-binding" over the
 * 329-document `edit-samples-*` slice and said plainly that the extra ingredient
 * — more than one trailing statement — was NOT counted, because "counting
 * top-level statements by regex is exactly the unreliable reading this issue
 * should not rest on. The next step is to partition those 13 with the parser's
 * own statement splitter."
 *
 * That is this file. Two changes from the issue's own measurement:
 *   - the population is the WHOLE archive (558 documents by sha256 of `code`),
 *     not the `edit-samples-*` filename family (329) — the slice is a naming
 *     convention, not the corpus.
 *   - the split is `splitTopLevelStatements` + `stripSideEffectStatements`,
 *     the parser's own, called exactly as the bare branch calls them.
 *
 * ⚠ Quote the dedup KEY with the number: sha256 of the `code` field.
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import crypto from 'node:crypto'
import {
  parseStrudel,
  buildBindingMap,
  collectTopLevelBindings,
  splitTopLevelStatements,
  stripSideEffectStatements,
  extractTracks,
  BINDING_RE,
} from '../parseStrudel'
import type { PatternIR } from '../PatternIR'

const CORPUS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../app/tests/parity-corpus/.bakery-runs',
)

/** Every document in the archive, deduped by sha256 of `code`. */
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

/**
 * "Wholly opaque" — the document reached the IR as nothing but a give-up `Code`
 * node. Synthetic `Track`/`Stack` wrappers are transparent here: a Track whose
 * body is bare Code is exactly the shape #1523 reproduces.
 */
function isWhollyOpaque(n: PatternIR): boolean {
  if (n.tag === 'Track') return isWhollyOpaque((n as unknown as { body: PatternIR }).body)
  if (n.tag === 'Stack') {
    const tracks = (n as unknown as { tracks: PatternIR[] }).tracks
    return tracks.length > 0 && tracks.every(isWhollyOpaque)
  }
  return n.tag === 'Code' && (n as unknown as { via?: unknown }).via === undefined
}

/**
 * Does the document declare a `$:` / `name:` track?
 *
 * ⚠ THIS ASKS THE PARSER, and the first version of this probe did not — it used
 * a regex requiring the expression on the SAME LINE as the label, so a document
 * written
 *
 *     hater:
 *       s("drumloop_170:2 …")
 *
 * read as BARE. Six labelled documents entered the bare population that way, and
 * their labels came back as separate "statements" that then parsed "musically",
 * which is the only reason the miscount was visible at all. The dispatch this
 * probe partitions is `extractTracks`; nothing else is entitled to answer for it.
 */
function hasTrackLabel(code: string): boolean {
  return extractTracks(code).length > 0
}

describe('#1523 — partition the wholly-opaque documents with the parser\'s own splitter', () => {
  it('counts the archive, the opaque set, and the bare-binding-multi-statement shape', () => {
    const docs = loadEveryDocument()
    // P761 — assert a positive artefact before reading anything off it.
    expect(docs.length).toBeGreaterThan(500)

    const opaque: { name: string; code: string }[] = []
    for (const d of docs) {
      let ir: PatternIR
      try {
        ir = parseStrudel(d.code)
      } catch {
        continue
      }
      if (isWhollyOpaque(ir)) opaque.push(d)
    }

    // Partition the opaque set by the two gate predicates the bare branch runs.
    const buckets = {
      hasTrackLabel: 0,
      /** THE #1523 SHAPE: bare, ≥1 leading binding, ≥2 trailing statements. */
      bareBindingMultiTail: [] as string[],
      /** Bare, has a binding, exactly ONE trailing statement — G1's own population. */
      bareBindingSingleTail: [] as string[],
      /** Bare, no binding at all — neither gate is about this document. */
      bareNoBinding: [] as string[],
      /** Bare with a binding that the ENGINE itself declines (cycle, dup, all-opaque RHS). */
      bareBindingEngineDeclines: [] as string[],
    }

    const declineReasons: Record<string, number> = {}
    for (const d of opaque) {
      if (hasTrackLabel(d.code)) {
        buckets.hasTrackLabel++
        continue
      }
      const stmts = stripSideEffectStatements(splitTopLevelStatements(d.code, 0))
      if (!stmts.some((s) => BINDING_RE.test(s.text))) {
        buckets.bareNoBinding.push(d.name)
        continue
      }
      const engine = collectTopLevelBindings(d.code, 0)
      if (engine === null) {
        // WHY did the engine decline? Re-run its own four terminals by hand.
        const seen = new Set<string>()
        let reason = 'no binding resolved (cycle / opaque RHS)'
        if (stmts.length < 2) reason = 'fewer than 2 statements'
        else {
          let tailIdx = -1
          for (let s = 0; s < stmts.length; s++) {
            const bm = stmts[s].text.match(BINDING_RE)
            if (!bm) {
              tailIdx = s
              break
            }
            if (seen.has(bm[1])) {
              reason = `duplicate binding name (${bm[1]})`
              tailIdx = -2
              break
            }
            seen.add(bm[1])
          }
          if (tailIdx === -1) reason = 'every statement is a binding (nothing to play)'
          else if (tailIdx === 0) reason = 'no LEADING binding (first statement is an expression)'
        }
        declineReasons[reason] = (declineReasons[reason] ?? 0) + 1
        buckets.bareBindingEngineDeclines.push(`${d.name} :: ${reason}`)
        continue
      }
      if (engine.tail.length > 1) buckets.bareBindingMultiTail.push(d.name)
      else buckets.bareBindingSingleTail.push(d.name)
    }

    console.log(
      [
        `archive documents (sha256 of code) : ${docs.length}`,
        `wholly opaque                      : ${opaque.length}`,
        `  with a $:/name: track            : ${buckets.hasTrackLabel}`,
        `  bare, NO binding                 : ${buckets.bareNoBinding.length}`,
        `  bare, binding, engine DECLINES   : ${buckets.bareBindingEngineDeclines.length}`,
        `  bare, binding, ONE trailing stmt : ${buckets.bareBindingSingleTail.length}`,
        `  bare, binding, ≥2 trailing stmts : ${buckets.bareBindingMultiTail.length}   ← THE #1523 SHAPE`,
        '',
        'the #1523 shape, by name:',
        ...buckets.bareBindingMultiTail.map((n) => `  ${n}`),
        '',
        'why the ENGINE declines (the LARGEST bare-with-a-binding bucket):',
        ...Object.entries(declineReasons).map(([r, n]) => `  ${n}  ${r}`),
      ].join('\n'),
    )

    // Print one, whole, so the shape can be read rather than trusted.
    const first = opaque.find((d) => buckets.bareBindingMultiTail.includes(d.name))
    if (first) {
      const engine = collectTopLevelBindings(first.code, 0)
      console.log(
        `\n--- ${first.name} — bindings=[${[...(engine?.bindings.keys() ?? [])].join(',')}] ` +
          `tail=${engine?.tail.length} G1=${buildBindingMap(first.code, 0) === null ? 'DECLINED' : 'applied'}\n` +
          first.code,
      )
    }

    // The partition must be total — every opaque document lands in exactly one bucket.
    expect(
      buckets.hasTrackLabel +
        buckets.bareNoBinding.length +
        buckets.bareBindingEngineDeclines.length +
        buckets.bareBindingSingleTail.length +
        buckets.bareBindingMultiTail.length,
    ).toBe(opaque.length)
  })
})
