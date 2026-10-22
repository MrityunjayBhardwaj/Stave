import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { toStrudel } from '../toStrudel'
import type { PatternIR } from '../PatternIR'

/** Test-local recursive walker — find first node matching predicate.
 *  Mirrors the inline walker in parseStrudel.test.ts (no shared helper yet). */
function findNode(
  node: PatternIR,
  pred: (n: PatternIR) => boolean,
): PatternIR | undefined {
  if (pred(node)) return node
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = node as any
  const kids: PatternIR[] = []
  if (n.body && typeof n.body === 'object' && 'tag' in n.body) kids.push(n.body)
  if (n.value && typeof n.value === 'object' && 'tag' in n.value) kids.push(n.value)
  if (n.via?.inner) kids.push(n.via.inner)
  if (Array.isArray(n.tracks)) kids.push(...n.tracks.filter((c: unknown) => c && typeof c === 'object' && 'tag' in (c as object)))
  if (Array.isArray(n.children)) kids.push(...n.children.filter((c: unknown) => c && typeof c === 'object' && 'tag' in (c as object)))
  for (const k of kids) {
    const found = findNode(k, pred)
    if (found) return found
  }
  return undefined
}

const paramNode = (code: string, key: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findNode(parseStrudel(code), (n) => n.tag === 'Param' && (n as any).key === key)
const opaqueNode = (code: string, method: string) =>
  findNode(
    parseStrudel(code),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n) => n.tag === 'Code' && (n as any).via?.method === method,
  )

describe('#928 — classify off-list controls from the registry (deny-list, Tier 2)', () => {
  // These are genuine @strudel/core controls that the ~24-entry whitelist
  // omitted → today they wrap as opaque Code and starve the structural views.
  it('.clip(1) → Param (was opaque)', () => {
    const p = paramNode('s("bd").clip(1)', 'clip')
    expect(p).toBeDefined()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).value).toBe(1)
  })

  it('.sustain(0.3) → Param (was opaque)', () => {
    expect(paramNode('s("bd").sustain(0.3)', 'sustain')).toBeDefined()
  })

  it('.attack(0.01) → Param (was opaque)', () => {
    expect(paramNode('s("bd").attack(0.01)', 'attack')).toBeDefined()
  })

  it('an aliased control keeps the USER token (round-trip fidelity, not canonical)', () => {
    // rlp → roomlp canonically: the node is KEYED canonically (so downstream
    // reads one field per control), but userMethod + round-trip must preserve
    // the user's own `rlp` spelling — never rewrite it to `.roomlp(...)`.
    const p = paramNode('s("bd").rlp(0.5)', 'roomlp')
    expect(p).toBeDefined()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).userMethod).toBe('rlp')
    expect(toStrudel(parseStrudel('s("bd").rlp(0.5)'))).toContain('.rlp(0.5)')
  })

  it('an ALIAS classifies under its CANONICAL key so downstream reads it', () => {
    // `sound` is an alias of `s`. collect maps params.s → evt.s; keying the
    // node by the alias would leave every `evt.s` consumer blind (a modelled
    // control the views cannot read — a false affordance). Key = canonical,
    // userMethod = the user's token.
    const p = paramNode('note("c").sound("bd sd")', 's')
    expect(p).toBeDefined()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((p as any).userMethod).toBe('sound')
    // …and the alias still round-trips to the user's own bytes.
    expect(toStrudel(parseStrudel('note("c").sound("bd sd")'))).toContain('.sound("bd sd")')
  })

  it('an aliased sample-key control parses its mini as SAMPLES, not notes', () => {
    // isSampleKey must follow the CANONICAL name (sound→s), else `bd sd`
    // parses as note names with the wrong per-event duration.
    const p = paramNode('note("c").sound("bd sd")', 's')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (p as any).value
    expect(typeof v === 'object' ? JSON.stringify(v) : v).toContain('bd')
  })

  it('a pattern-arg control classifies via the universal parser', () => {
    // parseParamArg handles mini-notation strings → the control still models.
    expect(paramNode('s("bd").velocity("0.5 1")', 'velocity')).toBeDefined()
  })

  // --- Regression guards: curated arms must NOT regress under the fallback ---
  it('scale (a @strudel/tonal fn, isControlName=false) STILL classifies as Param', () => {
    expect(paramNode('s("bd").scale("major")', 'scale')).toBeDefined()
  })

  it('reverb (not a core control) STILL classifies as Param under its own key', () => {
    // #967 — reverb is not in the registry; the FX-tag deletion rehomed its
    // numeric arm to Param (key 'reverb', userMethod 'reverb'), not opaque
    // (PV201). Pre-#967 it tagged FX.
    expect(paramNode('s("bd").reverb(0.5)', 'reverb')).toBeDefined()
  })

  // --- PV37 wrap-never-drop: the genuine residual STILL opaques ---
  it('an unknown method still wraps as opaque Code', () => {
    expect(opaqueNode('s("bd").bogusxyz(1)', 'bogusxyz')).toBeDefined()
    expect(paramNode('s("bd").bogusxyz(1)', 'bogusxyz')).toBeUndefined()
  })

  it('a control with a lambda/unmodellable arg still opaques (PV37)', () => {
    // parseParamArg returns null for a non-number/string/mini shape → opaque.
    expect(opaqueNode('s("bd").clip(x => x)', 'clip')).toBeDefined()
  })

  // --- #935: a CURATED FX control must not be narrower than an off-list one ---
  describe('#935 — pattern args on the curated FX arms', () => {
    it('a pattern arg on a curated FX control classifies instead of opaquing', () => {
      // Before #935 the FX arms parsed with `parseFloat` only, so the COMMON
      // control was the more limited one: `.roomsize("0.3 0.5")` modelled while
      // `.room("0.3 0.5")` went opaque. Both are controls; both must classify.
      expect(paramNode('note("c").room("0.3 0.5")', 'room')).toBeDefined()
      expect(paramNode('note("c").roomsize("0.3 0.5")', 'roomsize')).toBeDefined()
      expect(opaqueNode('note("c").room("0.3 0.5")', 'room')).toBeUndefined()
    })

    it('a NUMERIC arg on the same control now also classifies as Param (#944)', () => {
      // #944 (the FX→Param collapse) retired the arg-shape split #935 left
      // behind: both numeric and pattern args on a curated control take the
      // registry path and classify as Param under the canonical key. Pre-#944
      // the numeric arm tagged FX (a typed Record), which filed one control
      // under two tags — see controlClassificationGuards.test.ts.
      expect(paramNode('note("c").room(0.3)', 'room')).toBeDefined()
      expect(paramNode('note("c").crush(4)', 'crush')).toBeDefined()
    })

    it('keys by the canonical control name but round-trips the user token', () => {
      // `lpf` is an alias of `cutoff`; collect reads the canonical key, while
      // toStrudel re-emits what the user actually typed.
      expect(paramNode('note("c").lpf("400 800")', 'cutoff')).toBeDefined()
      expect(toStrudel(parseStrudel('note("c").lpf("400 800")'))).toBe(
        'note("c").lpf("400 800")',
      )
    })

    it('reverb, not a core control, still opaques on a pattern arg', () => {
      // isControlName('reverb') is false — there is no registry entry to model
      // it, so PV37 wrap-never-drop still applies rather than a guess.
      expect(opaqueNode('note("c").reverb("0.3 0.5")', 'reverb')).toBeDefined()
    })
  })
})
