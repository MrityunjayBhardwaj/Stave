/**
 * loc-fidelity.test.ts — the Phase 20-15 pre-mortem detector.
 *
 * THE phase pre-mortem (20-15-PLAN.md §PRE-MORTEM): a walker-migration
 * (α-3 applyChain reroute onto the shared `skipWhitespaceAndLineComments`
 * primitive, and the later G4/G5 reroutes) that passes the 16-corpus
 * IR-SHAPE snapshot + the 1551 editor tests but SILENTLY shifts absolute
 * `loc` offsets — so runtime click-to-source / highlight-on-event breaks
 * while every structural test stays green.
 *
 * Why parity.test.ts cannot catch this: `normalize.ts` STRIPS `loc`
 * (it documents this — loc drifts with file framing, so the IR-shape
 * rung deliberately ignores it). That makes the IR-shape snapshot blind
 * to offset drift by construction. This harness is the complementary
 * gate: it asserts the SUBSTANCE of every `loc` — for each `*.strudel`
 * in this directory, parse it, walk the IR, and for every node that
 * carries `loc:[{start,end}]`, slice that exact `[start,end]` range out
 * of the ORIGINAL source string and snapshot the resulting token text
 * per file. An offset that consumes the right *tokens* but returns a
 * wrong absolute *index* leaves IR shape identical (parity green) but
 * changes the sliced substring here → this snapshot breaks. Run before
 * AND after every walker reroute; the diff must be empty.
 *
 * This converts an observation-only runtime property (loc fidelity is
 * normally verified by clicking in the live editor) into a deterministic
 * CI check for the corpus. It is the regression oracle the IR-shape
 * snapshot alone cannot provide.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Same deep-path import rationale as parity.test.ts:31-38 (the @stave/editor
// barrel pulls @strudel/draw → gifenc CJS → ESM crash under vite-node).
import { parseStrudel } from '../../../editor/src/codeView/ir/parseStrudel'

const corpusDir = path.dirname(fileURLToPath(import.meta.url))

const corpusFiles = fs
  .readdirSync(corpusDir)
  .filter((f) => f.endsWith('.strudel'))
  .sort()

interface LeafLoc {
  /** Node tag the loc was attached to (Play / Seq / Fast / Code / …). */
  tag: unknown
  /** [start,end] sliced verbatim out of the ORIGINAL source. */
  text: string
  /** Degenerate / out-of-bounds flag — must always be false. */
  bad: boolean
}

/**
 * Walk any nested object/array, collecting every `loc:[{start,end}]`
 * entry with the source substring it points at. Order is a deterministic
 * pre-order traversal so the snapshot is stable across runs.
 */
function collectLeafLocs(node: unknown, src: string, out: LeafLoc[], depth = 0): void {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (depth > 64) return
  if (Array.isArray(node)) {
    for (const child of node) collectLeafLocs(child, src, out, depth + 1)
    return
  }
  const rec = node as Record<string, unknown>
  const loc = rec.loc
  if (Array.isArray(loc)) {
    for (const l of loc) {
      if (
        l &&
        typeof (l as any).start === 'number' &&
        typeof (l as any).end === 'number'
      ) {
        const { start, end } = l as { start: number; end: number }
        const bad =
          start < 0 ||
          end < start ||
          end > src.length ||
          !Number.isInteger(start) ||
          !Number.isInteger(end)
        out.push({ tag: rec.tag, text: src.slice(start, end), bad })
      }
    }
  }
  for (const key of Object.keys(rec)) {
    if (key === 'loc') continue
    collectLeafLocs(rec[key], src, out, depth + 1)
  }
}

describe('loc-fidelity — every IR loc slices to its source token (20-15 pre-mortem gate)', () => {
  it('vendored corpus is non-empty (sanity gate)', () => {
    expect(corpusFiles.length).toBeGreaterThan(0)
  })

  for (const fileName of corpusFiles) {
    const tuneName = fileName.replace(/\.strudel$/, '')
    it(`${tuneName} — loc→source-slice map is stable & in-bounds`, () => {
      const code = fs.readFileSync(path.join(corpusDir, fileName), 'utf8')
      const ir = parseStrudel(code)
      const locs: LeafLoc[] = []
      collectLeafLocs(ir, code, locs)

      // INVARIANT: no loc is ever degenerate or out of bounds. A walker
      // reroute that returns a wrong absolute index typically trips this
      // (end > src.length, or end < start) even before the snapshot diff.
      const badOnes = locs.filter((l) => l.bad)
      expect(badOnes).toEqual([])

      // ORACLE: the full per-file loc→token map is snapshotted. Any
      // offset drift (right tokens, wrong absolute index) changes a
      // sliced substring here and breaks this snapshot, even when the
      // IR-shape snapshot (loc-stripped) stays green.
      expect(locs.map((l) => ({ tag: l.tag, text: l.text }))).toMatchSnapshot()
    })
  }
})
