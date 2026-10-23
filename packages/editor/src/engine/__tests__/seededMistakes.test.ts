/**
 * Golden-output tests for the curated `commonMistakes` shipped with each
 * runtime's DocsIndex. One assertion per seeded hint — protects against
 * regressions when the docs JSON regen scripts roll through (the JSON
 * regen wipes `globalMistakes` on the JSON side, but our `p5.ts` /
 * `hydra.ts` overlays splice them back in; this test catches the case
 * where someone deletes the overlay).
 */

import { describe, it, expect } from 'vitest'
import { formatFriendlyError } from '../friendlyErrors'
import { STRUDEL_DOCS_INDEX } from '../../monaco/strudelDocs'
import { P5_DOCS_INDEX } from '../../monaco/docs/p5'
import { HYDRA_DOCS_INDEX } from '../../monaco/docs/hydra'

describe('seeded commonMistakes — Strudel', () => {
  it('bare note name → "wrap in a string" hint', () => {
    const r = formatFriendlyError(
      new ReferenceError('c4 is not defined'),
      'strudel',
      { index: STRUDEL_DOCS_INDEX },
    )
    expect(r.message).toContain('Looks like a note name')
    expect(r.message).toContain('note("c4")')
  })

  it('note name with sharp → still matches', () => {
    const r = formatFriendlyError(
      new ReferenceError('eb3 is not defined'),
      'strudel',
      { index: STRUDEL_DOCS_INDEX },
    )
    expect(r.message).toContain('Looks like a note name')
  })

  it('bare drum shorthand → "wrap in s(...)" hint', () => {
    const r = formatFriendlyError(
      new ReferenceError('bd is not defined'),
      'strudel',
      { index: STRUDEL_DOCS_INDEX },
    )
    expect(r.message).toContain('Looks like a drum name')
    expect(r.message).toContain('s("bd")')
  })

  it('every-as-free-fn → chain-after-Pattern hint', () => {
    // Real Strudel error when the user writes `$: every(4, rev)` and
    // the autoplay path tries to extract `.p` from the partial
    // application. The shape `every(...).p is not a function` is what
    // observation captured during the friendly-errors-console branch.
    const r = formatFriendlyError(
      new TypeError('every(...).p is not a function'),
      'strudel',
      { index: STRUDEL_DOCS_INDEX },
    )
    expect(r.message).toContain('chain it after `note(...)`')
    expect(r.suggestion?.name).toBe('every')
  })

  it('every-shadowed → same hint catches the simpler shape', () => {
    const r = formatFriendlyError(
      new TypeError('every is not a function'),
      'strudel',
      { index: STRUDEL_DOCS_INDEX },
    )
    expect(r.message).toContain('chain it after `note(...)`')
  })

  it('non-curated reference still falls through to fuzzy', () => {
    // `nots` typo for `note` is a fuzzy neighbour — should land on the
    // "Did you mean note?" path, not on either curated hint.
    const r = formatFriendlyError(
      new ReferenceError('nots is not defined'),
      'strudel',
      { index: STRUDEL_DOCS_INDEX },
    )
    expect(r.message).toContain('Did you mean')
  })
})

describe('seeded commonMistakes — p5', () => {
  // No seed hints yet for p5 — its own FES handles most p5-API
  // mistakes inside the runtime. The schema slot is wired so a future
  // CommonMistake added to P5_GLOBAL_MISTAKES picks up the cascade
  // without further plumbing. This test guards that wiring.
  it('schema slot is wired (globalMistakes is an array)', () => {
    expect(Array.isArray(P5_DOCS_INDEX.globalMistakes)).toBe(true)
  })
})

describe('seeded commonMistakes — Hydra', () => {
  it('bare out() → "render with .out()" hint', () => {
    const r = formatFriendlyError(
      new ReferenceError('out is not defined'),
      'hydra',
      { index: HYDRA_DOCS_INDEX },
    )
    // a `.hydra` file reaches Hydra's functions through `s` (#2211)
    expect(r.message).toContain('`s.osc().out()`')
    expect(r.suggestion?.example).toBe('s.osc(20, 0.1, 1.0).out()')
  })

  it("a bare Hydra function says it is on `s`, not \"Did you mean\" the same word (#2211)", () => {
    const r = formatFriendlyError(new ReferenceError('osc is not defined'), 'hydra', { index: HYDRA_DOCS_INDEX })
    expect(r.message).toBe('`osc` is on `s` here — write `s.osc(…)`.')
    expect(r.suggestion?.name).toBe('osc')
  })

  it('a misspelt Hydra function still gets "Did you mean"', () => {
    const r = formatFriendlyError(new ReferenceError('osd is not defined'), 'hydra', { index: HYDRA_DOCS_INDEX })
    expect(r.message).toContain('Did you mean `osc`?')
  })
})
