import { describe, it, expect } from 'vitest'
import { startsTopLevelBlock, startsTopLevelBlockRaw } from '../blockScan'

describe('startsTopLevelBlock', () => {
  it('recognizes an audible anonymous track', () => {
    expect(startsTopLevelBlock('$: note("c e g")')).toBe(true)
  })

  it('recognizes a soloed-out / muted anonymous track (`_$:`) — the #569 case', () => {
    // The solo overlay silences non-soloed tracks with a `_` prefix. Without
    // recognizing this form, a soloed track absorbs the following `_$:` lines.
    expect(startsTopLevelBlock('_$: note("c e g")')).toBe(true)
  })

  it('recognizes a SUFFIX-muted anonymous track (`$_:`) — Strudel mutes `x_` too (#1679)', () => {
    // Trimmed, so this is the INDENTED case: at column 0 the named-track rule
    // already catches `$_:`, but indented it fell through both and the block
    // above absorbed it — while an indented `_$:` did not.
    expect(startsTopLevelBlock('$_: note("c e g")')).toBe(true)
    expect(startsTopLevelBlock('_$_: note("c e g")')).toBe(true)
  })

  it('recognizes the transport statement', () => {
    expect(startsTopLevelBlock('setcps(90/240).gain(0.3)')).toBe(true)
  })

  it('recognizes every name Strudel gives the tempo setter, by whole name (#1927)', () => {
    // `repl.mjs` registers one setter as `setcps`/`setCps` and `setcpm`/`setCpm`.
    // Only `setcps` ended a block, so a viz zone above `setcpm(30)` anchored below it.
    for (const line of ['setcps(0.5)', 'setCps(0.5)', 'setcpm(30)', 'setCpm(30)', 'setcpm (30)']) {
      expect(startsTopLevelBlock(line), line).toBe(true)
      expect(startsTopLevelBlockRaw(line), line).toBe(true)
    }
    // A name that only begins with a setter's name is not one (was a bare startsWith).
    expect(startsTopLevelBlock('setcpsfoo(1)')).toBe(false)
    expect(startsTopLevelBlock('setcps')).toBe(false) // no call
    // Controls, unchanged.
    expect(startsTopLevelBlockRaw('$: s("bd")')).toBe(true)
    expect(startsTopLevelBlockRaw('s("bd")')).toBe(false)
  })

  it('recognizes a bare expression wrapped by the solo overlay (`/* … */`)', () => {
    expect(startsTopLevelBlock('/* setcps(0.5).gain(0.3)')).toBe(true)
  })

  it('recognizes the master-bus statement (`all(x=>…)`) — the #797 case', () => {
    // A master `all()` line below a `$:`-with-inline-viz block must end that
    // block; else the block absorbs it and the zone anchors below (#797).
    expect(startsTopLevelBlock('all(x => x.gain(0.089))')).toBe(true)
    expect(startsTopLevelBlock('all(x => x.viz("wordfall", { backdrop: true }))')).toBe(true)
    expect(startsTopLevelBlock('all (x => x.gain(1))')).toBe(true) // spacing-tolerant
  })

  it('does NOT mistake an `all`-prefixed identifier (e.g. `allpass(`) for the master bus', () => {
    // `/^all\s*\(/` requires `(` right after `all` — `allpass(` has `pass` between.
    expect(startsTopLevelBlock('allpass(0.5)')).toBe(false)
  })

  it('does NOT treat a method-chain continuation line as a boundary', () => {
    expect(startsTopLevelBlock('.s("sawtooth")')).toBe(false)
    expect(startsTopLevelBlock('.lpf(sine.range(300, 900).slow(8))')).toBe(false)
    expect(startsTopLevelBlock('.pan(0.5).viz(\'Prism\')')).toBe(false)
  })

  it('does NOT treat a stack(...) member line as a boundary', () => {
    expect(startsTopLevelBlock('s("bd ~ ~ ~ bd ~ bd ~").gain(0.19),')).toBe(false)
  })

  it('does NOT treat a line comment as a boundary', () => {
    expect(startsTopLevelBlock('// ── the bass pulse ──')).toBe(false)
  })

  it('does NOT treat a blank line as a boundary', () => {
    expect(startsTopLevelBlock('')).toBe(false)
  })
})
