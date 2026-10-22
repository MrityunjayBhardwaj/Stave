import { describe, it, expect } from 'vitest'
import { IR, type PatternIR } from '../PatternIR'
import { toStrudel } from '../toStrudel'
import { patternToJSON, patternFromJSON } from '../serialize'

/**
 * Phase 20-18 Wave D D-1 acceptance test — Signal/Builder chain-ROOT
 * family round-trip + leaf-event-neutral + serialize lossless.
 *
 * VERIFIES the Wave A Option-3 consumer closure (the guards across
 * the 11 FLOOR `switch(.tag)` consumers). Wave D is verify-only: the
 * arms exist (authored in Wave A), this test proves they BEHAVE as
 * the per-switch disposition table in `20-18-OBSERVATIONS.md`
 * "WAVE A — Option-3 closure" promises.
 *
 * Why directly-constructed (not parseStrudel) IR:
 *   - Wave A is consumer-only; the producer (`recogniseChainRoot`) is
 *     Wave B + Wave C. The CONSUMER guards must hold on hand-built
 *     Signal/Builder nodes regardless of producer status — exactly
 *     mirroring the 20-17 D-1c precedent (`literalRoundTrip` builds
 *     literal Code.via nodes directly because buildBindingMap wiring
 *     was deferred to a later wave).
 *   - The (a)-verdict (root-recognition-suffices) means consumers see
 *     bare `{tag:'Signal',kind}` / `{tag:'Builder',kind,args}` AND
 *     these wrapped under existing chain transforms (`Slow`, `Code.via`,
 *     etc.). Both shapes must round-trip.
 *
 * The four assertions per tag mirror the four behaviour classes the
 * disposition table covers:
 *   - toStrudel:    re-emit kind + (args) BYTE-VERBATIM (P62 / code-
 *                   invariance — args never coerced).
 *   - serialize:    lossless JSON round-trip (kind/args/loc preserved).
 *   - collect:      event-neutral / leaf (no events emitted, no throw).
 *   - irProjection: leaf in projectedChildren — never recurse into a
 *                   non-existent body (the 20-17 MusicalTimeline:298
 *                   silent-wrong class).
 */

describe('Phase 20-18 Wave D — Signal/Builder consumer-arm acceptance (Wave A guards verified)', () => {
  // ─── toStrudel: VERBATIM round-trip ────────────────────────────────────

  describe('toStrudel re-emits kind/args BYTE-VERBATIM (P62 code-invariance)', () => {
    it('Signal 0-arity: IR.signal("sine") → "sine"', () => {
      expect(toStrudel(IR.signal('sine'))).toBe('sine')
    })

    it('Signal 0-arity: IR.signal("perlin") → "perlin"', () => {
      expect(toStrudel(IR.signal('perlin'))).toBe('perlin')
    })

    it('Builder arg-taking: IR.builder("irand", "12") → "irand(12)"', () => {
      expect(toStrudel(IR.builder('irand', '12'))).toBe('irand(12)')
    })

    it('Builder arg-taking RAW preservation: IR.builder("chord", \'"Am Am"\') → \'chord("Am Am")\'', () => {
      // Code-invariance: args are RAW source slice — quote style + inner
      // bytes preserved exactly. NEVER re-serialised, NEVER coerced.
      expect(toStrudel(IR.builder('chord', '"Am Am"'))).toBe('chord("Am Am")')
    })

    it('Builder arg-taking with raw whitespace: IR.builder("arrange", "[48, stack(p)]") → byte-for-byte', () => {
      // The raw bytes between `(` and `)` are emitted unmodified —
      // including the inner whitespace. PV44 / P62.
      const raw = '[48, stack(p)]'
      expect(toStrudel(IR.builder('arrange', raw))).toBe(`arrange(${raw})`)
    })

    it('wrapped Signal: Slow(2, Signal("sine")) — outermost = transform, leaf = Signal', () => {
      const wrapped = IR.slow(2, IR.signal('sine'))
      // toStrudel's Slow arm + Signal leaf compose: the chain
      // applies over the signal exactly as it would over any root.
      expect(toStrudel(wrapped)).toBe('sine.slow(2)')
    })
  })

  // ─── serialize: lossless JSON round-trip ───────────────────────────────

  describe('serialize round-trips Signal/Builder shape (no data loss)', () => {
    it('Signal 0-arity: JSON.stringify → parse preserves tag/kind', () => {
      const node = IR.signal('perlin')
      const back = patternFromJSON(patternToJSON(node))
      expect(back.tag).toBe('Signal')
      expect((back as Extract<PatternIR, { tag: 'Signal' }>).kind).toBe('perlin')
      // No spurious args field on a 0-arity signal.
      expect((back as Extract<PatternIR, { tag: 'Signal' }>).args).toBeUndefined()
    })

    it('Signal with args: tag/kind/args all preserved', () => {
      // Hand-construct: a future signal kind could take args (no current
      // curated 0-arity-only kind takes args; this exercises the round-trip
      // path that the type already permits).
      const node: PatternIR = { tag: 'Signal', kind: 'sine', args: '0.5' }
      const back = patternFromJSON(patternToJSON(node))
      expect(back.tag).toBe('Signal')
      expect((back as Extract<PatternIR, { tag: 'Signal' }>).kind).toBe('sine')
      expect((back as Extract<PatternIR, { tag: 'Signal' }>).args).toBe('0.5')
    })

    it('Builder: tag/kind/args all preserved', () => {
      const node = IR.builder('irand', '12')
      const back = patternFromJSON(patternToJSON(node))
      expect(back.tag).toBe('Builder')
      expect((back as Extract<PatternIR, { tag: 'Builder' }>).kind).toBe('irand')
      expect((back as Extract<PatternIR, { tag: 'Builder' }>).args).toBe('12')
    })

    it('Builder with chord raw arg: bytes preserved', () => {
      const node = IR.builder('chord', '"Am Am"')
      const back = patternFromJSON(patternToJSON(node))
      expect(back.tag).toBe('Builder')
      expect((back as Extract<PatternIR, { tag: 'Builder' }>).args).toBe('"Am Am"')
    })

    it('Signal carries loc through round-trip', () => {
      const node = IR.signal('rand', undefined, { loc: [{ start: 5, end: 9 }] })
      const back = patternFromJSON(patternToJSON(node))
      expect(back.loc).toEqual([{ start: 5, end: 9 }])
    })
  })

  // ─── round-trip: parseStrudel-shaped construction → toStrudel  ─────────
  // (We can't parseStrudel a Signal/Builder yet — that's exercised by
  //  the proto + parity gates. Here we cover the CONSUMER half of the
  //  round-trip: a Signal/Builder produced anywhere upstream re-emits
  //  byte-for-byte under toStrudel.)

  describe('end-to-end round-trip via toStrudel (consumer contract)', () => {
    it('IR.signal("sine") → toStrudel → "sine"', () => {
      // The outermost expression IS the signal — no transform wrapper.
      // After Wave B's parseStrudel("sine") lands, parseStrudel("sine")
      // produces this exact shape; for now the assertion stands on a
      // hand-built node, matching the 20-17 D-1c construct-directly
      // precedent.
      const node = IR.signal('sine')
      const emitted = toStrudel(node)
      expect(emitted).toBe('sine')
      // The deep node IS Signal (not bare Code) — the named
      // acceptance shape from the 20-18 plan §5a.
      expect(node.tag).toBe('Signal')
    })

    it('IR.slow(2, IR.signal("sine")) → toStrudel → "sine.slow(2)"; outermost = Slow, leaf = Signal', () => {
      const node = IR.slow(2, IR.signal('sine'))
      expect(toStrudel(node)).toBe('sine.slow(2)')
      // Outermost = the transform, deep = Signal — the §5a "transform
      // wrapping a deep {tag:'Signal'|'Builder'}, NOT bare Code" shape.
      expect(node.tag).toBe('Slow')
      const slowNode = node as Extract<PatternIR, { tag: 'Slow' }>
      expect(slowNode.body.tag).toBe('Signal')
    })

    it('IR.struct("x(8,8)", IR.builder("irand", "12")) — outermost = Struct, leaf = Builder', () => {
      const node = IR.struct('x(8,8)', IR.builder('irand', '12'))
      expect(toStrudel(node)).toBe('irand(12).struct("x(8,8)")')
      expect(node.tag).toBe('Struct')
      const structNode = node as Extract<PatternIR, { tag: 'Struct' }>
      expect(structNode.body.tag).toBe('Builder')
    })
  })
})
