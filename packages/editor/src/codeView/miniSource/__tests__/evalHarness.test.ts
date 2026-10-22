/**
 * The harness's own gates (#1008).
 *
 * The measurement that produced this phase's predecessor passed while 148 of
 * 150 documents failed to evaluate: its only assertion was on the document
 * count, which held. An assertion on a run's SHAPE says nothing about its
 * coverage, so every mechanism that buys coverage here is proved load-bearing
 * by BREAKING it — never by reading it.
 *
 * Each test below is a red-test in both directions: it asserts the document
 * evaluates with the mechanism, and fails without it. If a future change makes
 * a mechanism unnecessary, the "without" half starts passing and says so.
 */
import { describe, it, expect } from 'vitest'
import { evalLocations } from './evalHarness'

/** A hydra tune in the shape the corpus actually uses: visuals beside a pattern. */
const HYDRA_DOC = `
initHydra()
osc(10, 0.1).diff(osc(2, 0.2)).out(o0)
$: s("bd sd")
`

/** A single-quoted string that is NOT mini notation — a real corpus shape. */
const LABEL_DOC = `$: s("bd sd").label('🍕')`

describe('evalHarness coverage mechanisms', () => {
  it('the hydra shim is LOAD-BEARING: the document evaluates with it and not without', async () => {
    const withShim = await evalLocations(HYDRA_DOC, 4)
    expect(withShim.ok).toBe(true)
    // and it really produced the pattern's span, not merely "no error"
    expect(withShim.declared.length).toBeGreaterThan(0)
    expect(withShim.seen.length).toBeGreaterThan(0)

    const without = await evalLocations(HYDRA_DOC, 4, { hydra: false })
    expect(without.ok).toBe(false)
    expect(without.error).toMatch(/osc is not defined/)
  }, 60_000)

  it('installing hydra does not leak into the documents that never asked for it', async () => {
    // `shape`, `noise` and `a` are strudel controls until hydra overwrites them,
    // which is why the shim is installed per document rather than at boot. If
    // the restore ever breaks, every later document in a sweep silently gets a
    // no-op where a control should be — and nothing throws.
    await evalLocations(HYDRA_DOC, 4)
    const after = await evalLocations(`$: s("bd sd").shape(0.3)`, 4)
    expect(after.ok).toBe(true)
    expect(after.seen.length).toBeGreaterThan(0)
    expect((globalThis as Record<string, unknown>).osc).toBeUndefined()
  }, 60_000)

  it('a BARE miniAllStrings is still a divergence: turning it on breaks a real document', async () => {
    // ⚠ The engine DOES install a string parser — `StrudelEngine.ts` has called
    // `miniAllStrings()` for a long time, and the comment that used to sit here
    // claiming otherwise was simply wrong (#1018). Removing the call from this
    // harness did not close that divergence, it flipped it: the harness became
    // MORE permissive than the engine and scored documents the live app threw on.
    //
    // Both now install the same fallback rule, so the mirrored run is the default
    // and what is still a divergence is the BARE call — which remains worth
    // pinning, because a single-quoted label is not mini notation and bare `mini`
    // will not have it.
    const mirrored = await evalLocations(LABEL_DOC, 4)
    expect(mirrored.ok).toBe(true)

    const diverged = await evalLocations(LABEL_DOC, 4, { bareMiniAllStrings: true })
    expect(diverged.ok).toBe(false)
    expect(diverged.error).toMatch(/parse error/)

    // And it must be put BACK. The string parser is a module-global in
    // @strudel/core, so a restore that quietly no-ops would leave every
    // subsequent document in the process running the divergence — with no
    // error anywhere, only a coverage figure that is a little too low.
    const afterwards = await evalLocations(LABEL_DOC, 4)
    expect(afterwards.ok).toBe(true)
  }, 60_000)
})
