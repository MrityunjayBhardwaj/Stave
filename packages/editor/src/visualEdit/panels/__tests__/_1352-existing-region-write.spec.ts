/**
 * PROBE (#1352 Phase 4) — WHAT ALREADY SHIPS?
 *
 * Before building a write path for `.begin`/`.end`, ask whether one is already
 * there and merely unreachable. `knobRanges.ts` carries `begin`/`end` entries,
 * and `knobsFromChunk` surfaces EVERY numeric chain arg except pan/gain — which
 * reads as "an existing `.begin(0.1)` is already a knob, already writable".
 * That is an inference from reading. This runs it.
 *
 * NEGATIVE CONTROL: `pan`, which the same function documents as always skipped.
 * If `pan` also came back as a knob the function would not be discriminating
 * and a `begin` hit would mean nothing.
 */
import { describe, it, expect } from 'vitest'
import { detectChunk } from '../../chunkDetect'
import { knobsFromChunk } from '../MixerBody'
import { EFFECTS } from '../effectCatalog'

const knobsFor = (code: string) => {
  const chunk = detectChunk(code, code.length - 1)
  expect(chunk, `no chunk for ${JSON.stringify(code)}`).not.toBeNull()
  return knobsFromChunk(chunk!)
}

describe('#1352 — what the existing controls already do with a region', () => {
  it('an EXISTING numeric .begin/.end already surfaces as an editable knob', () => {
    const knobs = knobsFor('$: s("take_1").begin(0.1).end(0.6)')
    const names = knobs.map((k) => `${k.method}=${k.value}`)
    console.log(`knobs: ${names.join(', ')}`)
    expect(names).toContain('begin=0.1')
    expect(names).toContain('end=0.6')
  })

  it('CONTROL — pan is skipped by the same function, so a hit above discriminates', () => {
    const knobs = knobsFor('$: s("take_1").pan(0.2).begin(0.1)')
    const names = knobs.map((k) => k.method)
    console.log(`knobs with a pan present: ${names.join(', ')}`)
    expect(names).toContain('begin')
    expect(names).not.toContain('pan')
  })

  it('a PATTERNED .begin surfaces NO knob — the refusal is already correct', () => {
    const knobs = knobsFor('$: s("take_1").begin("<0 0.5>")')
    console.log(`knobs for a patterned begin: ${JSON.stringify(knobs.map((k) => k.method))}`)
    expect(knobs.map((k) => k.method)).not.toContain('begin')
  })

  it('there is NO WAY TO ADD begin/end — neither is in the add-effect catalog', () => {
    const methods = EFFECTS.map((e) => e.method)
    console.log(`catalog has ${methods.length} effects; begin present = ${methods.includes('begin')}`)
    expect(methods).not.toContain('begin')
    expect(methods).not.toContain('end')
    // CONTROL: a control that IS addable, so "not in the catalog" is a fact
    // about begin/end rather than about how this list is read.
    expect(methods).toContain('room')
  })
})
