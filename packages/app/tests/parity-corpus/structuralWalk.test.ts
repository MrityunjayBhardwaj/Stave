/**
 * structuralWalk corpus regression gate (#973, part of the collect.ts split #945).
 *
 * `structuralWalk` derives lane anchors (dollarPos / sourceOffset / arrangeOffset / leafIndex /
 * armByCycle / armLabels) from source structure alone. This gate previously compared it against
 * `collect`'s behaviour engine; with collect retired, the walk's per-tune output is FROZEN as a
 * committed snapshot — the same collect-equivalent anchors that gate proved, now pinned directly.
 * A change to the walk's anchoring over any corpus tune turns the snapshot RED and must be
 * explained, not `-u`'d.
 *
 * The snapshot captures EVERY lane the walk reports, including the resilience lanes a
 * syntactically-valid-but-semantically-invalid sub-node contributes (the property collect's
 * onset/window logic could not give) — so lane coverage is pinned too.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStrudel } from '../../../editor/src/codeView/ir/parseStrudel'
import { structuralWalk, wholeWalkWindow, type LaneSkeleton } from '../../../editor/src/codeView/ir/structuralWalk'

const N = 4
const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpusFiles = fs
  .readdirSync(corpusDir)
  .filter((f) => f.endsWith('.strudel'))
  .sort()

/** Canonical string of a lane's ANCHORS (not the key) for a stable snapshot. */
function canon(l: LaneSkeleton): string {
  return JSON.stringify({
    dollarPos: l.dollarPos ?? null,
    sourceOffset: l.sourceOffset ?? null,
    arrangeOffset: l.arrangeOffset ?? null,
    leafIndex: l.leafIndex ?? null,
    armByCycle: l.armByCycle ?? null,
    armLabels: l.armLabels ? [...l.armLabels.entries()].sort((a, b) => a[0] - b[0]) : null,
  })
}

/** Per-tune snapshot payload: lane key → canonical anchors, order-independent. */
function walkSnapshot(code: string): Record<string, string> {
  const lanes = structuralWalk(parseStrudel(code), wholeWalkWindow(N))
  return Object.fromEntries(lanes.map((l) => [l.laneKey, canon(l)]))
}

describe('structuralWalk anchors are frozen over the corpus (#973)', () => {
  it('corpus is non-empty (sanity gate)', () => {
    expect(corpusFiles.length).toBeGreaterThan(0)
  })

  for (const fileName of corpusFiles) {
    const tuneName = fileName.replace(/\.strudel$/, '')
    it(`${tuneName}: lane anchors match the committed snapshot`, () => {
      const code = fs.readFileSync(path.join(corpusDir, fileName), 'utf8')
      expect(walkSnapshot(code)).toMatchSnapshot()
    })
  }
})
