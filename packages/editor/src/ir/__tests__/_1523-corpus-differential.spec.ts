/**
 * #1523 / #1532 — the whole-archive differential.
 *
 * Two questions, over all 558 documents (deduped by sha256 of the `code` field):
 *
 *   1. Did the two parsers stay in agreement? The staged-vs-monolithic
 *      invariant is the one thing these changes could break wholesale, because
 *      both changes had to be made twice.
 *   2. What moved? Documents rescued from total opacity, and the track-count
 *      census — in BOTH directions. A change that only ever adds is a claim,
 *      not a measurement.
 *
 * ⚠ Recorded BEFORE these two fixes, by this same probe on this same tree:
 *      wholly opaque                     35
 *      labels all rejected               28   (7 of them wholly opaque)
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { parseStrudel, extractTracks } from '../parseStrudel'
import type { PatternIR } from '../PatternIR'
import { pipeline, stripStageMeta } from './helpers/stagesParity'

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
    const tracks = (n as unknown as { tracks: PatternIR[] }).tracks
    return tracks.length > 0 && tracks.every(isWhollyOpaque)
  }
  return n.tag === 'Code' && (n as unknown as { via?: unknown }).via === undefined
}

function trackCount(n: PatternIR): number {
  if (n.tag === 'Stack') return (n as unknown as { tracks: PatternIR[] }).tracks.length
  return n.tag === 'Track' ? 1 : 0
}

describe('#1523 / #1532 — the whole-archive differential', () => {
  it('counts opacity, track counts, and staged-vs-monolithic agreement', () => {
    const docs = loadEveryDocument()
    expect(docs.length).toBeGreaterThan(500)

    let opaque = 0
    let labelsAllRejected = 0
    let labelsAllRejectedAndOpaque = 0
    const disagree: string[] = []
    const counts: Record<number, number> = {}
    for (const d of docs) {
      let mono: PatternIR
      try {
        mono = parseStrudel(d.code)
      } catch {
        continue
      }
      if (isWhollyOpaque(mono)) opaque++
      counts[trackCount(mono)] = (counts[trackCount(mono)] ?? 0) + 1

      const cands = [...d.code.matchAll(/^[ \t]*(\/\/[ \t]*)?([A-Za-z_$][\w$]*)\s*:/gm)].filter(
        (m) => !['let', 'const', 'var', 'default', 'case'].includes(m[2]),
      )
      if (cands.length > 0 && extractTracks(d.code).length === 0) {
        labelsAllRejected++
        if (isWhollyOpaque(mono)) labelsAllRejectedAndOpaque++
      }

      // The parity question. `stripStageMeta` is the SAME comparison the
      // staged-parity gate makes, reused rather than re-derived.
      let staged: PatternIR
      try {
        staged = stripStageMeta(pipeline(d.code))
      } catch (e) {
        disagree.push(`${d.name} :: staged THREW ${(e as Error).message.slice(0, 60)}`)
        continue
      }
      if (JSON.stringify(staged) !== JSON.stringify(stripStageMeta(mono))) {
        disagree.push(d.name)
      }
    }

    console.log(
      [
        `archive documents (sha256 of code) : ${docs.length}`,
        `wholly opaque                      : ${opaque}   (was 35 before these two fixes)`,
        `labels all rejected                : ${labelsAllRejected}   (was 28)`,
        `  …and wholly opaque               : ${labelsAllRejectedAndOpaque}   (was 7)`,
        `track-count histogram              : ${JSON.stringify(counts)}`,
        `staged != monolithic               : ${disagree.length}`,
        ...disagree.slice(0, 20).map((n) => `    ${n}`),
      ].join('\n'),
    )

    // ⚠ THE POINT OF THE ARM, most-discriminating first. Both parsers had to
    // learn both changes; the only way to know they learned the SAME thing is
    // to compare their output on every document in the archive.
    expect(disagree).toEqual([])
    // …and the changes moved the census in the direction claimed.
    expect(opaque).toBeLessThan(35)
    expect(labelsAllRejected).toBe(27)
  })
})
