import { describe, it, expect } from 'vitest'

import {
  planSoundAssignment,
  type SoundAssignPlan,
} from '../soundAssign'

// Apply a plan the same way WorkspaceShell's Writeback does — a `replace`
// swaps the range, an `insert` is a zero-width edit — so the tests assert the
// observable document outcome, not internal offsets.
function apply(doc: string, plan: SoundAssignPlan | null): string {
  if (!plan) return doc
  if (plan.kind === 'replace') {
    return doc.slice(0, plan.range[0]) + plan.text + doc.slice(plan.range[1])
  }
  return doc.slice(0, plan.offset) + plan.text + doc.slice(plan.offset)
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
      expect(apply(doc, plan)).toBe('foobar\ns("piano")')
    })

    it('prefixes a newline only when the cursor line has content', () => {
      const doc = 'setcps(1)\n\ns("bd")'
      // cursor on line 1 (`setcps(1)`), offset 4
      const plan = planSoundAssignment(doc, 4, 'piano')
      expect(apply(doc, plan)).toBe('setcps(1)\ns("piano")\n\ns("bd")')
    })

    it('adds no newline prefix on a blank line between content lines', () => {
      const doc = 'a\n\nb' // blank middle line at offset 2
      const plan = planSoundAssignment(doc, 2, 'piano')
      expect(apply(doc, plan)).toBe('a\ns("piano")\nb')
    })

    it('handles the last line with no trailing newline', () => {
      const doc = 'setcps(1)\nhello'
      const plan = planSoundAssignment(doc, doc.length, 'piano')
      expect(apply(doc, plan)).toBe('setcps(1)\nhello\ns("piano")')
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
      expect(apply(doc, plan)).toBe('s("bd*4")\ns("piano")')
    })
  })
})
