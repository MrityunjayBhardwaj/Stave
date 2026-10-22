/**
 * Integration test for the parse → snapshot chain that backs the IR Inspector.
 * Drives the production `buildStrudelPasses` without going through the
 * React/runtime layer: the three intermediate views come from
 * `parseStrudelStages` (#1387) and the FINAL `Parsed` tab is `parseStrudel`
 * itself (#1558), four tabs in all. Onset events come from Strudel's eval
 * (queryArc) in production; here the structural walk (walkLeafItems) covers the
 * loc-propagation contract.
 *
 * The FINAL tab name remains 'Parsed' for IRInspectorPanel persistence
 * backward-compat (RESEARCH §3.2). The PV27 alias contract holds via
 * snap.ir === snap.passes[passes.length - 1].ir.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { parseStrudel, buildStrudelPasses } from '../../codeView/ir'
import { walkLeafItems } from '../../codeView/ir/structuralWalk'
import { publishIRSnapshot, clearIRSnapshot, type IRSnapshotInput } from '../irInspector'
import { getCaptureBuffer, __resetCaptureForTest } from '../timelineCapture'

/** The four tabs, built by the function the app calls (#1940; it used to be a copy). */
const strudelPasses = (code: string) => buildStrudelPasses(code)

describe('irInspector integration — parse → run', () => {
  it('produces a 4-pass snapshot whose FINAL IR equals parseStrudel output', () => {
    const code = 'note("c3 e3 g3")'
    const passes = strudelPasses(code)

    // Four entries with locked stage names.
    expect(passes.map((p) => p.name)).toEqual(['RAW', 'MINI-EXPANDED', 'CHAIN-APPLIED', 'Parsed'])

    // PV27 — `snap.ir` MUST track passes[passes.length - 1].ir. The FINAL tab is
    // the parser's tree, and CHAIN-APPLIED is the same tree through the
    // recording path (#1387), so both equal a plain parse.
    const finalIR = passes[passes.length - 1].ir
    const direct = parseStrudel(code)
    expect(finalIR).toEqual(direct)
    expect(passes[2].ir).toEqual(direct)
  })

  it('leaf items flow from passes[last].ir and carry loc (PV24, PV25)', () => {
    const code = 'note("c3 e3 g3")'
    const passes = strudelPasses(code)
    const finalIR = passes[passes.length - 1].ir
    const items = walkLeafItems(finalIR, 1)

    expect(items.length).toBeGreaterThan(0)
    // PV24: every leaf must carry loc.
    for (const it of items) {
      expect(it.loc).toBeDefined()
      expect(Array.isArray(it.loc)).toBe(true)
      expect(it.loc!.length).toBeGreaterThan(0)
    }
  })

  it('purity: running the pipeline twice on the same code yields deep-equal IR', () => {
    const code = 'note("c3 e3 g3")'
    const run1 = strudelPasses(code)[3].ir
    const run2 = strudelPasses(code)[3].ir
    expect(run2).toEqual(run1)
  })
})

// ---------------------------------------------------------------------------
// Phase 19-08 — publishIRSnapshot also captures into timelineCapture (PK9 §8a)
// ---------------------------------------------------------------------------
//
// PR-A boundary probe: confirm the cross-module hook (irInspector
// publish → timelineCapture push) lands on every publish. Future
// refactors that accidentally break the fan-out trip a clear test
// here, separate from the unit-level coverage in timelineCapture.test.ts.

function buildSnap(code: string = 'note("c3")'): IRSnapshotInput {
  const passes = strudelPasses(code)
  const finalIR = passes[passes.length - 1].ir
  return {
    ts: 1234,
    source: 'integration.strudel',
    runtime: 'strudel',
    code,
    passes,
    ir: finalIR, // PV27 alias: passes[last].ir
    // Onsets come from Strudel's eval (queryArc) in production; this fan-out
    // plumbing test only asserts the events ARRAY REFERENCE flows through, so an
    // empty stand-in suffices.
    events: [],
  }
}

describe('publishIRSnapshot also captures into timelineCapture (PK9 step 8a)', () => {
  beforeEach(() => {
    clearIRSnapshot()
    __resetCaptureForTest()
  })

  it('every publish pushes one entry into the capture buffer', () => {
    expect(getCaptureBuffer()).toHaveLength(0)
    const snap = buildSnap()
    publishIRSnapshot(snap, { cycleCount: 1.5 })
    expect(getCaptureBuffer()).toHaveLength(1)
    // PV27-cousin: snapshot stored without deep-cloning. Phase 20-05: the
    // publisher now wraps the input via `enrichWithLookups` (PV38 clause 1)
    // — a shallow spread that adds `irNodeIdLookup` + `irNodeLocLookup`
    // and preserves all inner references (events, passes, ir). The
    // captured snapshot is the enriched object; inner refs equal the
    // input's inner refs (no deep clone, only a shallow wrap).
    const captured = getCaptureBuffer()[0].snapshot
    expect(captured.events).toBe(snap.events)
    expect(captured.passes).toBe(snap.passes)
    expect(captured.ir).toBe(snap.ir)
    expect(captured.irNodeIdLookup).toBeInstanceOf(Map)
    expect(captured.irNodeLocLookup).toBeInstanceOf(Map)
    expect(getCaptureBuffer()[0].cycleCount).toBe(1.5)
  })

  it('publish without meta records cycleCount: null (existing callers stay source-compatible)', () => {
    publishIRSnapshot(buildSnap())
    expect(getCaptureBuffer()).toHaveLength(1)
    expect(getCaptureBuffer()[0].cycleCount).toBeNull()
  })

  it('publish forwards snap.ts onto the capture entry by default', () => {
    const snap = buildSnap()
    publishIRSnapshot(snap)
    expect(getCaptureBuffer()[0].ts).toBe(1234)
  })
})
