/**
 * A `$:`-declared track resolves the document's bindings (#1392).
 *
 * ── WHY THESE ARMS ARE ABSOLUTE, NEVER DIFFERENTIAL ─────────────────────────
 * This defect survived a corpus gate that compares `parseStrudel` against the
 * staged pipeline, because BOTH left every reference opaque. The two agreed,
 * and agreement is all a differential gate can see. So every arm below asserts
 * what the tree must actually CONTAIN — no `Code` nodes, the sample really
 * reached — rather than that two producers match each other.
 *
 * ── WHAT WAS BROKEN ─────────────────────────────────────────────────────────
 * What an identifier means is a property of the DOCUMENT, but binding
 * resolution was a property of one branch of the track dispatch. `parseStrudel`
 * ran `buildBindingMap` only when the source had no `$:` at all; both `$:`
 * branches passed `undefined`, and the staged pipeline mirrored that gate on
 * purpose to preserve parity. `$:` is the ordinary way to declare a track, so
 * the ordinary document lost its bindings — and downstream that is not cosmetic:
 * an opaque arm yields no leaves, so no `armIndex`, so the timeline drew NO
 * CLIPS at all for an arranged song.
 *
 * Measured on `76e42d9e`, opaque `Code` nodes left in the tree:
 *
 *   arrange([4, a], [8, b])      0     $: arrange([4, a], [8, b])     2
 *   stack(a, b)                  0     $: stack(a, b)                 2
 *                                      $: a                           1
 *                                      drums: stack(a, b)             2
 */
import { describe, it, expect } from 'vitest'
import { parseStrudel } from '../parseStrudel'
import { IR, type PatternIR } from '../PatternIR'
import { parseStrudelStages } from '../parseStrudelStages'


/** `parseStrudel` through its recording path — the Inspector's CHAIN-APPLIED view (#1387). */
const staged = (code: string): PatternIR => {
  const stages = parseStrudelStages(code)
  return stages[stages.length - 1].ir
}

/** Every unresolved `Code` node left in a tree. Empty is the whole claim. */
function opaqueCode(node: unknown): string[] {
  if (!node || typeof node !== 'object') return []
  const n = node as Record<string, unknown>
  const here =
    n.tag === 'Code' && n.via === undefined ? [String(n.code ?? '')] : []
  const kids = Object.values(n).flatMap((v) =>
    Array.isArray(v)
      ? v.flatMap((e) =>
          opaqueCode((e as { pattern?: unknown })?.pattern ?? e),
        )
      : opaqueCode(v),
  )
  return [...here, ...kids]
}

/** Every sample name the tree actually plays — proof the RHS really arrived. */
function samples(node: unknown): string[] {
  if (!node || typeof node !== 'object') return []
  const n = node as Record<string, unknown>
  const here =
    n.tag === 'Play' && typeof n.note === 'string' ? [n.note as string] : []
  const kids = Object.values(n).flatMap((v) =>
    Array.isArray(v)
      ? v.flatMap((e) =>
          samples((e as { pattern?: unknown })?.pattern ?? e),
        )
      : samples(v),
  )
  return [...here, ...kids]
}

const DECL = 'const intro = s("bd")\nconst verse = s("hh")\n'

/** Every shape a musician declares a track in. Both parsers must agree with
 *  REALITY on each — which is a different claim from agreeing with each other. */
const SHAPES: Record<string, string> = {
  'bare arrange': `${DECL}arrange([4, intro], [8, verse])`,
  '$: arrange': `${DECL}$: arrange([4, intro], [8, verse])`,
  'bare stack': `${DECL}stack(intro, verse)`,
  '$: stack': `${DECL}$: stack(intro, verse)`,
  '$: bare identifier': 'const intro = s("bd")\n$: intro',
  '$: chained identifier': 'const intro = s("bd")\n$: intro.fast(2)',
  'named label': `${DECL}drums: stack(intro, verse)`,
  'two $: blocks': `${DECL}$: intro\n$: verse`,
}

describe('#1392 — bindings resolve for every way a track is declared', () => {
  for (const [shape, code] of Object.entries(SHAPES)) {
    it(`leaves nothing opaque: ${shape}`, () => {
      expect(opaqueCode(parseStrudel(code))).toEqual([])
      // The recording path (#1387) is asserted separately too: the Inspector's
      // views come from it, and it must not change the parse.
      expect(opaqueCode(staged(code))).toEqual([])
    })
  }

  it('the bound pattern really arrives — not merely a non-Code node', () => {
    // The opaque-count arms above would pass on a tree that resolved `intro` to
    // the WRONG pattern, or to an empty one. This one names what must be heard.
    for (const code of [
      `${DECL}$: arrange([4, intro], [8, verse])`,
      `${DECL}$: stack(intro, verse)`,
      `${DECL}drums: stack(intro, verse)`,
    ]) {
      expect(samples(parseStrudel(code)).sort()).toEqual(['bd', 'hh'])
      expect(samples(staged(code)).sort()).toEqual(['bd', 'hh'])
    }
  })

  it('each of two `$:` tracks keeps its OWN binding', () => {
    // A document-level map is shared by every track, so the failure mode worth
    // pinning is not "no binding" but "the same binding twice".
    const ir = parseStrudel(`${DECL}$: intro\n$: verse`)
    expect(samples(ir)).toEqual(['bd', 'hh'])
    expect(samples(staged(`${DECL}$: intro\n$: verse`))).toEqual(['bd', 'hh'])
  })

  it('a document that declares NO bindings is untouched', () => {
    // The map is `undefined` here, exactly as it was before #1392, so these
    // documents must parse byte-identically rather than merely still work.
    for (const code of ['$: s("bd")\n$: s("hh")', 's("bd*4")', '$: s("bd").fast(2)']) {
      expect(opaqueCode(parseStrudel(code))).toEqual([])
      expect(staged(code)).toEqual(parseStrudel(code))
    }
  })

  it('an unresolvable reference stays opaque rather than guessing', () => {
    // `missing` is never bound. The honest result is an opaque node — a fix
    // that invented a pattern for it would pass every arm above.
    const ir = parseStrudel('const intro = s("bd")\n$: stack(intro, missing)')
    expect(opaqueCode(ir).length).toBeGreaterThan(0)
  })

  it('the binding map never leaks into the FINAL tree', () => {
    // `trackBindings` is stage-meta: RAW attaches it, MINI-EXPANDED consumes
    // it, `stripStageMeta` removes it. A leak would put a live Map on a node
    // body, where serialize and every snapshot comparison would carry it.
    const json = JSON.stringify(staged(`${DECL}$: arrange([4, intro], [8, verse])`))
    expect(json).not.toContain('trackBindings')
    expect(json).not.toContain('unresolvedBindings')
  })
})
