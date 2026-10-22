/**
 * _1241-nonsound-lanes.spec.ts — INSTRUMENT for #1241.
 *
 * WHICH units actually open the step grid with lanes that are NOT sample names,
 * under the routing as it SHIPS — and what the lanes are called.
 *
 * Run:
 *   SWEEP=tests/parity-corpus/_1241-nonsound-lanes.spec.ts \
 *     pnpm --filter @stave/app exec vitest run --config vitest.sweep.config.ts
 *
 * ⚠ #1241 SIZES ITSELF AT "16 of the 25 grid-only units", AND THAT FIGURE IS
 * ABOUT A DIFFERENT SYSTEM. It was measured in #1238 under a both-surfaces ask
 * ("open whichever accepts"), which is not the rule that shipped: #1240 routes
 * head-first and only asks the content when the head is silent. So a `note(...)`
 * chord progression does NOT reach the grid today — it is refused by the roll
 * and gets code (that is #1243, measured and left alone). The population that
 * really lands on the grid with non-sound lanes is therefore a different set,
 * and it is what this probe counts.
 *
 * THE DISCRIMINATOR, stated because it is the design question: a lane holds a
 * SAMPLE NAME exactly when the head said so. `s(...)`/`sound(...)` means the
 * tokens are sample ids by construction. A span the resolver named on a silent
 * head reaches the grid through the content fallback, where the tokens are
 * whatever the document meant them to be — so the grid's sound chrome is a
 * claim it has not earned. Both readings come from `chunkSurface`/`patternKind`
 * directly, never a copy.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unitsWithStatus } from './editCoverage'
import { parseStepGrid } from '../../../editor/src/codeView/notation/parse'
import { chunkSurface } from '../../../editor/src/codeView/surface/surfaceRoute'
import { isStepChunk } from '../../../editor/src/codeView/patternKind'
import { sampleVoice } from '../../../editor/src/codeView/surface/drumVoices'
import { loadCorpus } from '../../../editor/src/codeView/miniSource/__tests__/evalHarness'

function report(label: string, docs: { name: string; code: string }[]) {
  let stepUnits = 0
  let viaHead = 0
  const viaContent: {
    doc: string
    head: string
    mini: string
    statement: string
    lanes: string[]
    relabelled: string[]
  }[] = []

  for (const doc of docs) {
    const seen = new Set<string>()
    for (const { unit, status } of unitsWithStatus(doc.code)) {
      if (status.status !== 'note' || status.kind !== 'step') continue
      const key = `${unit.miniRange?.join(':') ?? unit.exprRange.join(':')}`
      if (seen.has(key)) continue
      seen.add(key)
      stepUnits++
      if (isStepChunk(unit)) {
        viaHead++
        continue
      }
      // Reached the grid through the content fallback. Assert it, rather than
      // inferring it from "not head" — the two could drift.
      expect(chunkSurface(unit)).toBe('step')
      const parsed = parseStepGrid(unit.miniString!)
      const lanes = parsed.ok ? parsed.model.lanes.map((l) => l.sound) : []
      viaContent.push({
        doc: doc.name,
        head: unit.headFn ?? '(none)',
        mini: unit.miniString!,
        statement: doc.code.slice(unit.statementRange[0], Math.min(unit.statementRange[1], unit.statementRange[0] + 160)),
        lanes,
        // What the gutter PRINTS today. A chord symbol that happens to collide
        // with a drum token is relabelled into a drum voice, which is the
        // loudest form of the defect and the one no reader would suspect.
        relabelled: lanes.filter((l) => sampleVoice(l).label !== l),
      })
    }
  }

  console.log(`\n════ ${label} — ${docs.length} documents ════`)
  console.log(`units opening the STEP GRID            : ${stepUnits}`)
  console.log(`  via an s()/sound() head (lanes ARE sounds): ${viaHead}`)
  console.log(`  via the content fallback  ← #1241's set   : ${viaContent.length}`)
  for (const r of viaContent) {
    console.log(`\n  ── ${r.doc}  head=${r.head}`)
    console.log(`     statement : ${JSON.stringify(r.statement)}`)
    console.log(`     mini      : ${JSON.stringify(r.mini)}`)
    console.log(`     lanes     : ${JSON.stringify(r.lanes)}`)
    if (r.relabelled.length) console.log(`     ⚠ RELABELLED AS DRUM VOICES: ${JSON.stringify(r.relabelled.map((l) => `${l} → ${sampleVoice(l).label}`))}`)
  }
  return { stepUnits, viaHead, viaContent }
}

describe('#1241 — which grid lanes are not sample names', () => {
  it('vendored corpus', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.strudel')).sort()
    const r = report('VENDORED CORPUS', files.map((f) => ({ name: f, code: fs.readFileSync(path.join(dir, f), 'utf8') })))
    expect(r.stepUnits).toBeGreaterThan(0)
  })
  it('150 real Bakery tunes', async () => {
    const r = report('150 REAL TUNES', await loadCorpus())
    expect(r.stepUnits).toBeGreaterThan(0)
  })
})
