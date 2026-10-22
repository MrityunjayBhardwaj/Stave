/**
 * timelineMarks structural-map regression gate (#974, part of the collect.ts split #945).
 *
 * The timeline's five per-lane STRUCTURE maps (`sourceByLane` / `labelOffsetByLane` /
 * `arrangeByLane` / `armByCycleByLane` / `armLabelByLane`) are derived by `collectNoteMarks` from
 * `structuralWalk` → `LaneSkeleton[]`. This gate previously proved that derivation equals the
 * DELETED inline collect reduction; with collect retired, the maps `structuralWalk` produces are
 * FROZEN as a committed snapshot over the whole corpus — the same collect-equivalent structure the
 * gate used to compare against, now pinned directly. A moved structure verdict turns the snapshot
 * RED and must be explained, not `-u`'d.
 *
 * Run at integer N: the pre-eval mark path and the fractional `displayCycles` filter boundary both
 * coincide at integer N, so the snapshot is the shipped structure.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStrudel } from '../../../editor/src/codeView/ir/parseStrudel'
import { structuralWalk, wholeWalkWindow } from '../../../editor/src/codeView/ir/structuralWalk'

const N = 4
const corpusDir = path.dirname(fileURLToPath(import.meta.url))
const corpusFiles = fs
  .readdirSync(corpusDir)
  .filter((f) => f.endsWith('.strudel'))
  .sort()

/** The maps `collectNoteMarks` derives from `structuralWalk` (same code path, lifted), rendered
 *  as an order-independent plain object keyed by lane for a stable snapshot. */
function walkMapsSnapshot(ir: Parameters<typeof structuralWalk>[0], nCycles: number): Record<string, unknown> {
  const byLane: Record<string, unknown> = {}
  for (const lane of structuralWalk(ir, wholeWalkWindow(nCycles))) {
    byLane[lane.laneKey] = {
      sourceOffset: lane.sourceOffset ?? null,
      labelOffset: lane.dollarPos ?? null,
      arrangeOffset: lane.arrangeOffset ?? null,
      armByCycle: lane.armByCycle ? lane.armByCycle.map((x) => x ?? null) : null,
      armLabels: lane.armLabels ? [...lane.armLabels.entries()].sort((a, b) => a[0] - b[0]) : null,
    }
  }
  return byLane
}

describe('collectNoteMarks structure maps are frozen (structuralWalk snapshot, #974)', () => {
  it('corpus is non-empty (sanity gate)', () => {
    expect(corpusFiles.length).toBeGreaterThan(0)
  })

  for (const fileName of corpusFiles) {
    const tuneName = fileName.replace(/\.strudel$/, '')
    it(`${tuneName}: every lane's structural anchors match the committed snapshot`, () => {
      const code = fs.readFileSync(path.join(corpusDir, fileName), 'utf8')
      expect(walkMapsSnapshot(parseStrudel(code), N)).toMatchSnapshot()
    })
  }
})
