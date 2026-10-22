import { describe, it, expect } from 'vitest'

import {
  assignmentEdit,
  cyclesToPlayThrough,
  planSoundAssignment,
  type SoundAssignPlan,
} from '../soundAssign'

// Apply a plan the way WorkspaceShell does — `assignmentEdit` gives the edits, all
// in the document's offsets before any of them, applied as one — so the tests
// assert the observable document outcome, not internal offsets.
function apply(doc: string, plan: SoundAssignPlan | null): string {
  if (!plan) return doc
  const edits = [assignmentEdit(plan)].flat().sort((a, b) => b.range[0] - a.range[0])
  for (const e of edits) doc = doc.slice(0, e.range[0]) + e.text + doc.slice(e.range[1])
  return doc
}

describe('planSoundAssignment (#830)', () => {
  it('returns null for an empty sound name (nothing to write)', () => {
    expect(planSoundAssignment('s("bd")', 0, '')).toBeNull()
  })

  describe('note/roll chunk under the cursor → set/replace `.sound()`', () => {
    it('appends `.sound()` (single-quoted) when the roll chunk has none', () => {
      const doc = 'note("c4 e4 g4")'
      const plan = planSoundAssignment(doc, 5, 'piano')
      expect(apply(doc, plan)).toBe(`note("c4 e4 g4").sound('piano')`)
    })

    it('replaces an existing `.sound()` argument in place', () => {
      const doc = `note("c4").sound('bd')`
      const plan = planSoundAssignment(doc, 5, 'piano')
      expect(apply(doc, plan)).toBe(`note("c4").sound('piano')`)
    })

    it('also matches the `.s()` alias', () => {
      const doc = `note("c4").s('bd')`
      const plan = planSoundAssignment(doc, 5, 'piano')
      expect(apply(doc, plan)).toBe(`note("c4").s('piano')`)
    })
  })

  describe('no roll chunk → drop a fresh `s("…")` on its own line', () => {
    it('inserts a `$:` pattern into an empty document (no newline prefix; #2057 — was bare)', () => {
      const plan = planSoundAssignment('', 0, 'piano')
      expect(plan).toEqual({ kind: 'insert', offset: 0, text: '$: s("piano")' })
      expect(apply('', plan)).toBe('$: s("piano")')
    })

    it('drops onto its OWN line below a comment — never mid-token', () => {
      // The regression this branch exists for: a raw-offset insert would land
      // inside the comment (`// scratchs("…")`, commented out).
      const doc = '// scratch'
      const plan = planSoundAssignment(doc, doc.length, 'piano')
      expect(apply(doc, plan)).toBe('// scratch\n$: s("piano")')
    })

    it('inserts at the END of the cursor line, not at the cursor column', () => {
      // Cursor mid-word (offset 3 of "foobar") must still write at line end.
      const doc = 'foobar'
      const plan = planSoundAssignment(doc, 3, 'piano')
      expect(apply(doc, plan)).toBe('$: foobar\n$: s("piano")')
    })

    it('prefixes a newline only when the cursor line has content', () => {
      const doc = 'setcps(1)\n\ns("bd")'
      // cursor on line 1 (`setcps(1)`), offset 4
      const plan = planSoundAssignment(doc, 4, 'piano')
      expect(apply(doc, plan)).toBe('setcps(1)\n$: s("piano")\n\n$: s("bd")')
    })

    it('adds no newline prefix on a blank line between content lines', () => {
      const doc = 'a\n\nb' // blank middle line at offset 2
      const plan = planSoundAssignment(doc, 2, 'piano')
      expect(apply(doc, plan)).toBe('a\n$: s("piano")\n$: b')
    })

    it('handles the last line with no trailing newline', () => {
      const doc = 'setcps(1)\nhello'
      const plan = planSoundAssignment(doc, doc.length, 'piano')
      expect(apply(doc, plan)).toBe('setcps(1)\n$: hello\n$: s("piano")')
    })

    it('in a song of `$:` patterns, the new line is a `$:` pattern too — a bare one never plays (#2057)', () => {
      const doc = '// my song\n$: s("bd*4")\n'
      const plan = planSoundAssignment(doc, 3, 'kick')
      expect(apply(doc, plan)).toBe('// my song\n$: s("kick")\n$: s("bd*4")\n')
    })

    it('a cursor inside a multi-line `$:` pattern writes after the WHOLE pattern, not inside its arguments (#2057)', () => {
      const doc = '$: stack(\n  s("hh*8"),\n  s("bd")\n).gain(0.5)\n\n$: note("c")'
      // cursor on `  s("hh*8"),`
      const plan = planSoundAssignment(doc, doc.indexOf('hh'), 'kick')
      expect(apply(doc, plan)).toBe('$: stack(\n  s("hh*8"),\n  s("bd")\n).gain(0.5)\n$: s("kick")\n\n$: note("c")')
    })

    it('a document with no code yet gets a `$:` pattern (#2057)', () => {
      const doc = '// scratch'
      const plan = planSoundAssignment(doc, doc.length, 'kick')
      expect(apply(doc, plan)).toBe('// scratch\n$: s("kick")')
    })

    it('a cursor on a blank line inside a `$:` song still writes a `$:` pattern (#2057)', () => {
      const doc = '$: s("bd")\n\n$: s("hh")'
      const plan = planSoundAssignment(doc, doc.indexOf('\n\n') + 1, 'kick')
      expect(apply(doc, plan)).toBe('$: s("bd")\n$: s("kick")\n$: s("hh")')
    })

    it('treats a step (drum) chunk as no-roll → new line, leaves it untouched', () => {
      // s()/sound() is a step pattern, not a roll — the picker assigns by
      // dropping a fresh source line rather than editing the drum pattern.
      const doc = 's("bd*4")'
      const plan = planSoundAssignment(doc, 4, 'piano')
      expect(apply(doc, plan)).toBe('$: s("bd*4")\n$: s("piano")')
    })
  })

  describe('a song that plays a bare expression keeps playing it (#2066)', () => {
    // Strudel plays the LAST statement when no live label is registered, and only
    // the live labels when there is one; a muted label (`_$:`, `x_:`) registers
    // nothing. So a new line of either form silences a song that plays a bare
    // expression — Insert labels that expression too, and both play.
    it('muted labels and a bare expression: the bare one is labelled, the new line is `$:`', () => {
      const doc = '_$: s("hh*2")\ns("bare")\n'
      const plan = planSoundAssignment(doc, doc.indexOf('bare'), 'kick')
      expect(apply(doc, plan)).toBe('_$: s("hh*2")\n$: s("bare")\n$: s("kick")\n')
    })

    it('a muted label written as `name_:` counts as muted too', () => {
      const doc = 'drums_: s("hh*2")\ns("bare")'
      const plan = planSoundAssignment(doc, doc.length, 'kick')
      expect(apply(doc, plan)).toBe('drums_: s("hh*2")\n$: s("bare")\n$: s("kick")')
    })

    it('a song that is one bare expression: it is labelled, the new line is `$:`', () => {
      const doc = '// song\ns("bare")\n'
      const plan = planSoundAssignment(doc, 0, 'kick')
      expect(apply(doc, plan)).toBe('// song\n$: s("kick")\n$: s("bare")\n')
    })

    it('only the LAST bare expression is labelled — it is the one that plays', () => {
      const doc = 'samples("github:x/y")\ns("bare")'
      const plan = planSoundAssignment(doc, doc.length, 'kick')
      expect(apply(doc, plan)).toBe('samples("github:x/y")\n$: s("bare")\n$: s("kick")')
    })

    it('a multi-line bare expression is labelled once, at its start', () => {
      const doc = 'stack(\n  s("a"),\n  s("b")\n)'
      const plan = planSoundAssignment(doc, doc.length, 'kick')
      expect(apply(doc, plan)).toBe('$: stack(\n  s("a"),\n  s("b")\n)\n$: s("kick")')
    })

    it('a song whose last statement is a muted label plays nothing: only the new line is written', () => {
      const doc = 's("a")\n_$: s("b")'
      const plan = planSoundAssignment(doc, doc.length, 'kick')
      expect(apply(doc, plan)).toBe('s("a")\n_$: s("b")\n$: s("kick")')
    })

    it('a live label anywhere: nothing else is touched', () => {
      const doc = '$: s("hh")\ns("bare")'
      const plan = planSoundAssignment(doc, doc.length, 'kick')
      expect(apply(doc, plan)).toBe('$: s("hh")\ns("bare")\n$: s("kick")')
    })

    it('the two edits are one write, so one undo takes both back', () => {
      const plan = planSoundAssignment('s("bare")', 0, 'kick')
      const edits = assignmentEdit(plan!)
      expect(Array.isArray(edits) ? edits.length : 1).toBe(2)
    })
  })

  it('a song ending in a setup call plays nothing, so nothing is labelled', () => {
    const doc = 's("bd")\nsamples("github:x/y")\n'
    expect(apply(doc, planSoundAssignment(doc, doc.length, 'inserted'))).toBe(
      's("bd")\nsamples("github:x/y")\n$: s("inserted")',
    )
  })

  describe('a clip longer than a cycle plays through before it starts again (#2070)', () => {
    it('writes `.slow(N)` on the new line', () => {
      const doc = '$: s("hh*2")\n'
      expect(apply(doc, planSoundAssignment(doc, 0, 'take', 10))).toBe('$: s("hh*2")\n$: s("take").slow(10)\n')
    })

    it('without a length, writes the plain line', () => {
      const doc = '$: s("hh*2")\n'
      expect(apply(doc, planSoundAssignment(doc, 0, 'take'))).toBe('$: s("hh*2")\n$: s("take")\n')
    })

    it('a note pattern under the cursor gets its sound and keeps its own rhythm', () => {
      const doc = 'note("c4 e4 g4")'
      expect(apply(doc, planSoundAssignment(doc, 5, 'take', 10))).toBe(`note("c4 e4 g4").sound('take')`)
    })
  })
})

describe('cyclesToPlayThrough (#2070)', () => {
  it('a 20 s clip at 0.5 cycles a second is 10 cycles', () => {
    expect(cyclesToPlayThrough(20, 0.5)).toBe(10)
  })

  it('rounds up to a whole cycle, so the clip starts again on the bar', () => {
    expect(cyclesToPlayThrough(5, 0.5)).toBe(3)
  })

  it('a clip of one cycle or less needs no slowing', () => {
    expect([cyclesToPlayThrough(2, 0.5), cyclesToPlayThrough(1.37, 0.5)]).toEqual([null, null])
  })

  it("a hair over a whole cycle (a decoder's padding) counts as that cycle", () => {
    expect([cyclesToPlayThrough(2.001, 0.5), cyclesToPlayThrough(8.001, 0.5)]).toEqual([null, 4])
  })

  it('an unknown or broken length or tempo writes the plain line', () => {
    expect([
      cyclesToPlayThrough(undefined, 0.5),
      cyclesToPlayThrough(Number.NaN, 0.5),
      cyclesToPlayThrough(20, 0),
    ]).toEqual([null, null, null])
  })
})
