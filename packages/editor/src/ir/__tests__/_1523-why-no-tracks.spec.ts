/**
 * SIDE FINDING from #1523's partition — `0/32BM8hiYiJkS` declares SIX labelled
 * tracks (`_vox_chop:`, `_vox_end:`, `_notes:`, `_bassline1:`, `_bassline2:`,
 * `drums:`) and reaches the IR wholly opaque. `extractTracks` produces SIX raw
 * regex candidates and admits NONE of them, so one of its three guards
 * (`depth > 0`, `inString`, reserved word) is rejecting all six.
 *
 * This file scans the document prefix by prefix and prints every line at which
 * a KNOWN-GOOD label flips between admitted and rejected. The LAST such flip is
 * the mechanism.
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { extractTracks, parseStrudel } from '../parseStrudel'
import type { PatternIR } from '../PatternIR'

const CORPUS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../app/tests/parity-corpus/.bakery-runs',
)

function findDoc(target: string): string {
  const isOutput = (f: string): boolean =>
    f.startsWith('result-') || f.startsWith('edit-result-') || f.startsWith('ir-support-result')
  const files = fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.json') && !isOutput(f))
    .sort()
  const seen = new Set<string>()
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
      if (`${j.offset}/${s.hash}` === target) return s.code
    }
  }
  throw new Error(`document ${target} not in archive`)
}

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
    for (const sm of j.samples ?? []) {
      if (typeof sm.code !== 'string') continue
      const sha = crypto.createHash('sha256').update(sm.code).digest('hex')
      if (seen.has(sha)) continue
      seen.add(sha)
      out.push({ name: `${j.offset}/${sm.hash}`, code: sm.code })
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

/** Is a known-good label admitted after this prefix? */
const PROBE_LABEL = '\nzzprobe: s("bd")\n'
function labelAdmittedAfter(prefix: string): boolean {
  return extractTracks(prefix + PROBE_LABEL).some((t) => t.label === 'zzprobe')
}

describe('why does a six-track document report zero tracks?', () => {
  it('bisects to the line that stops labels being admitted', () => {
    const code = findDoc('0/32BM8hiYiJkS')
    const found = extractTracks(code)
    console.log(`extractTracks on the whole document : ${found.length} tracks`)

    const lines = code.split('\n')
    // Control both ends BEFORE bisecting (a bisection with an untested end is
    // a bisection of an assumption).
    expect(labelAdmittedAfter('')).toBe(true)
    expect(labelAdmittedAfter(code)).toBe(false)

    // ⚠ A BISECTION HERE IS INVALID AND THE FIRST VERSION OF THIS FILE RAN ONE.
    // Admission is NOT monotonic in the prefix: this document opens with a
    // block comment, so every prefix cut between `/*` and `*/` leaves it
    // unterminated and rejects the probe label for a reason that has nothing to
    // do with the defect. The bisection duly reported line 3 — inside that
    // comment — which is an artefact of the instrument, not a finding.
    // Scan every prefix and print every TRANSITION instead.
    const transitions: string[] = []
    let prev = true
    for (let n = 1; n <= lines.length; n++) {
      const now = labelAdmittedAfter(lines.slice(0, n).join('\n'))
      if (now !== prev) {
        transitions.push(
          `  line ${n} : ${prev ? 'ADMITTED → REJECTED' : 'REJECTED → ADMITTED'}  ${JSON.stringify(lines[n - 1])}`,
        )
        prev = now
      }
    }
    console.log(
      `\nevery transition in label admission, prefix by prefix (final state: ${prev ? 'ADMITTED' : 'REJECTED'}):\n` +
        transitions.join('\n'),
    )

    // ── Which ingredient? One property varied at a time ─────────────────────
    const minimal: [string, string][] = [
      ['plain paren in a LINE comment', '// (x)'],
      ['URL in a LINE comment, no paren', '// see https://example.com/a/b'],
      ['paren + URL in a LINE comment', '// (https://example.com/a/b)'],
      ['paren + URL in a BLOCK comment', '/* (https://example.com/a/b) */'],
      ['plain paren in a BLOCK comment', '/* (x) */'],
      ['bare paren in a BLOCK comment, unclosed by //', '/* ( // */'],
      ['a `//` in a BLOCK comment, NO paren at all', '/* // */'],
      ['a `//` in a BLOCK comment, on its own line', '/*\n// x\n*/'],
      ['the same URL in a $: document', '/* (https://example.com/a) */\n$: s("bd")'],
      ['a LONE open paren inside a BLOCK comment', '/* ( */'],
      ['a LONE open paren inside a LINE comment', '// ('],
    ]
    console.log(
      '\nminimal documents — is a label admitted after each?\n' +
        minimal
          .map(([name, prefix]) => `  ${labelAdmittedAfter(prefix) ? 'ADMITTED' : 'REJECTED'}  ${name}\n            ${prefix}`)
          .join('\n'),
    )

    // The claim, most-discriminating first: a document that declares six
    // labelled tracks reports none.
    expect(found.length).toBe(0)
    // ⚠ TWO GUESSES DIED HERE BEFORE THE MEASUREMENT AGREED WITH ANYTHING.
    // First guess: "an unbalanced paren" — refuted, `/* (x) */` is fine.
    // Second guess: "a `//` inside a block comment" — refuted, `/* // */` is
    // fine. What survives all ten arms is ONE statement:
    //
    //   `lexStateAt` DOES NOT MODEL `/* */` BLOCK COMMENTS. It counts brackets
    //   and it honours `//` line comments and strings — so a paren written
    //   inside a block comment is counted like code, and a `//` inside that
    //   same comment (a URL's `//` is the ordinary way) hides the closer.
    //
    // Depth is then stuck above zero for the whole rest of the document and
    // `extractTracks` rejects every label after it as "inside brackets".
    // Ordered most-discriminating first (PV423): the lone-paren arm separates
    // "block comments are not modelled" from every weaker story.
    expect(labelAdmittedAfter('/* ( */')).toBe(false) // ← parens in a comment are COUNTED
    expect(labelAdmittedAfter('// (')).toBe(true) //    ← …but LINE comments are modelled
    expect(labelAdmittedAfter('/* (x) */')).toBe(true) // balanced, so it works by accident
    expect(labelAdmittedAfter('/* // */')).toBe(true) // a `//` alone is harmless
    expect(labelAdmittedAfter('/* (https://example.com/a/b) */')).toBe(false) // both → dead
    expect(labelAdmittedAfter('// (https://example.com/a/b)')).toBe(true)
    expect(transitions.length).toBe(1)
  })

  it('sizes the defect across the whole archive', () => {
    const docs = loadEveryDocument()
    expect(docs.length).toBeGreaterThan(500)

    const re = () => /^[ \t]*(\/\/[ \t]*)?([A-Za-z_$][\w$]*)\s*:/gm
    let withCandidates = 0
    const allRejected: string[] = []
    const allRejectedAndOpaque: string[] = []
    let blockCommentDocs = 0
    const recoveredByBlanking: string[] = []
    for (const d of docs) {
      if (/\/\*/.test(d.code)) blockCommentDocs++
      const cands = [...d.code.matchAll(re())]
      // Reserved words are legitimately rejected — exclude them from the
      // candidate count or the population is padded with correct refusals.
      const real = cands.filter((m) => !['let', 'const', 'var', 'default', 'case'].includes(m[2]))
      if (real.length === 0) continue
      withCandidates++
      if (extractTracks(d.code).length === 0) {
        allRejected.push(d.name)
        if (isWhollyOpaque(parseStrudel(d.code))) allRejectedAndOpaque.push(d.name)
        // THE CONTROL. "All labels rejected" is a symptom with several possible
        // causes — prose that reads like a label, a genuine unbalanced bracket
        // in code. Blank out every `/* … */` and ask again: a document whose
        // labels COME BACK was killed by its block comment and nothing else.
        const blanked = d.code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        if (blanked !== d.code && extractTracks(blanked).length > 0) {
          recoveredByBlanking.push(d.name)
        }
      }
    }

    console.log(
      [
        `archive documents (sha256 of code)          : ${docs.length}`,
        `  …containing a /* block comment            : ${blockCommentDocs}`,
        `documents with a non-reserved label candidate: ${withCandidates}`,
        `  …where extractTracks admits NONE of them  : ${allRejected.length}`,
        `  …and which reach the IR wholly opaque     : ${allRejectedAndOpaque.length}`,
        `  …whose labels COME BACK when every /* … */ is blanked (the control) : ${recoveredByBlanking.length}`,
        '',
        'every document whose labels are all rejected:',
        ...allRejected.map((n) => `  ${n}${allRejectedAndOpaque.includes(n) ? '   (wholly opaque)' : ''}`),
      ].join('\n'),
    )
    console.log(
      '\nrecovered by blanking block comments:\n' +
        recoveredByBlanking.map((n) => `  ${n}`).join('\n'),
    )
    expect(withCandidates).toBeGreaterThan(0)
    expect(recoveredByBlanking.length).toBeGreaterThan(0)
  })
})
