/**
 * chainRootDrift — the chain-root recogniser vs Strudel's own signal.mjs (#953).
 *
 * `CHAIN_ROOT_RECOGNISER` is a hand-maintained map, and a hand-maintained map
 * drifts SILENTLY: a root Strudel gained is not an error, it is an opaque lane;
 * a root Strudel never had is not an error either, it is a structured lane for
 * code that would throw. Both were live before this test existed — 17 missing
 * roots and one phantom (`pulse`, actually a superdough waveform).
 *
 * So this asks the module rather than restating it. Nothing below transcribes
 * Strudel's answer into a literal list; a transcription would be a second
 * oracle, free to drift exactly like the map it is checking.
 *
 * ── The filter that matters ───────────────────────────────────────────────────
 * "Root-capable" over-approximates. `choose`, `degrade`, `keyDown` and
 * `undegrade` all return a Pattern when called, but they are chain METHODS
 * (present on `Pattern.prototype`). Admitting them as chain ROOTS would be a
 * new bug, so root-capable AND not-on-the-prototype is the real predicate.
 *
 * Deep imports throughout: the `@strudel/core` barrel does not load under node
 * (a transitive `@kabelsalat/web` export error), while the submodules do.
 */
import { describe, it, expect } from 'vitest'
import { Pattern } from '@strudel/core/pattern.mjs'
import * as signals from '@strudel/core/signal.mjs'
import { isControlName } from '@strudel/core/controls.mjs'
import { CHAIN_ROOT_RECOGNISER } from '../parseStrudel'

/**
 * Entries deliberately NOT sourced from signal.mjs. Each needs a reason, not an
 * exemption — an unexplained entry here would re-open the hole this closes.
 */
const OFF_MODULE = new Map<string, string>([
  // A control (controls.mjs registerControl), not a chain root. It belongs to
  // the control-registry axis; it lives here for historical reasons only.
  ['chord', 'control, not a signal — isControlName(chord) === true'],
  // Lives in pattern.mjs, and the map entry is unreachable for well-formed
  // source because parseTimeSequenceRoot claims `arrange` first.
  ['arrange', 'pattern.mjs combinator, superseded by parseTimeSequenceRoot'],
])

const isPattern = (v: unknown): boolean => {
  try {
    return v instanceof Pattern
  } catch {
    return false
  }
}

/** Root-capable: already a Pattern, or a function that yields one. */
const isRootCapable = (v: unknown): boolean => {
  if (isPattern(v)) return true
  if (typeof v !== 'function') return false
  try {
    return isPattern((v as (n: number) => unknown)(1))
  } catch {
    return false
  }
}

const PROTO = new Set(Object.getOwnPropertyNames(Pattern.prototype))
const exported = Object.keys(signals)

/** What signal.mjs says a chain root is — derived, never transcribed. */
const derivedRoots = exported.filter(
  (name) =>
    !name.startsWith('_') && // private helpers (_irand, _brandBy)
    isRootCapable((signals as Record<string, unknown>)[name]) &&
    !PROTO.has(name), // …and not a chain METHOD wearing a root's clothes
)

describe('chain-root recogniser vs @strudel/core/signal.mjs (#953)', () => {
  it('recognises no phantom — every entry exists in Strudel', () => {
    const phantoms = [...CHAIN_ROOT_RECOGNISER.keys()].filter(
      (k) => !(k in signals) && !OFF_MODULE.has(k),
    )
    // `pulse` was exactly this: in the map, nowhere in Strudel.
    expect(phantoms).toEqual([])
  })

  it('agrees with signal.mjs on Signal vs Builder', () => {
    const disagreements: string[] = []
    for (const [name, descriptor] of CHAIN_ROOT_RECOGNISER) {
      if (OFF_MODULE.has(name)) continue
      const value = (signals as Record<string, unknown>)[name]
      const derived = isPattern(value) ? 'Signal' : 'Builder'
      if (derived !== descriptor.tag) {
        disagreements.push(`${name}: map=${descriptor.tag} strudel=${derived}`)
      }
    }
    expect(disagreements).toEqual([])
  })

  it('keeps kind identical to the key (the descriptor carries no extra fact)', () => {
    const mismatched = [...CHAIN_ROOT_RECOGNISER.entries()]
      .filter(([key, d]) => d.kind !== key)
      .map(([key, d]) => `${key} -> ${d.kind}`)
    expect(mismatched).toEqual([])
  })

  it('covers every root-capable export that is not a chain method', () => {
    const missing = derivedRoots.filter((name) => !CHAIN_ROOT_RECOGNISER.has(name))
    // A failure here is Strudel having grown a root we do not draw: the symptom
    // is an opaque lane, never an exception, which is why it needs a test.
    expect(missing).toEqual([])
  })

  it('excludes chain methods that merely look root-capable', () => {
    // Regression fence for the filter itself. These four return a Pattern when
    // called, so a coverage rule written without the prototype check would have
    // pulled them in as roots.
    for (const method of ['choose', 'degrade', 'keyDown', 'undegrade']) {
      expect(isRootCapable((signals as Record<string, unknown>)[method])).toBe(true)
      expect(PROTO.has(method)).toBe(true)
      expect(CHAIN_ROOT_RECOGNISER.has(method)).toBe(false)
    }
  })

  it('documents why each off-module entry is not sourced from signal.mjs', () => {
    for (const [name, reason] of OFF_MODULE) {
      expect(CHAIN_ROOT_RECOGNISER.has(name)).toBe(true)
      expect(reason.length).toBeGreaterThan(0)
    }
    // The claim `chord` is a control, asserted rather than trusted.
    expect(isControlName('chord')).toBe(true)
  })
})
