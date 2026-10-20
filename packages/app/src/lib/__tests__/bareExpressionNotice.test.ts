import { describe, it, expect } from 'vitest'

import { bareExpressionMessage, noticeBareExpression, storedTold } from '../bareExpressionNotice'

function harness() {
  const shown: Array<{ message: string; line: number }> = []
  const told = new Set<string>()
  return { shown, deps: { show: (message: string, line: number) => shown.push({ message, line }), told } }
}

describe('the bare-expression notice (#2067)', () => {
  it('a song that plays a bare expression is told, with its line', () => {
    const h = harness()
    noticeBareExpression('song', '// my song\n\ns("bd*4")\n', h.deps)
    expect(h.shown).toEqual([{ message: bareExpressionMessage(3), line: 3 }])
  })

  it('once per song', () => {
    const h = harness()
    noticeBareExpression('song', 's("bd*4")\n', h.deps)
    noticeBareExpression('song', 's("bd*4")\n', h.deps)
    noticeBareExpression('other', 's("hh*8")\n', h.deps)
    expect(h.shown.map((s) => s.line)).toEqual([1, 1])
  })

  it('a song of $: tracks is not told, and can still be told later', () => {
    const h = harness()
    noticeBareExpression('song', '$: s("bd*4")\n', h.deps)
    noticeBareExpression('song', '$: s("bd*4")\ns("hh")\n_$: s("x")\n', h.deps)
    noticeBareExpression('song', 's("bd*4")\n', h.deps)
    expect(h.shown.map((s) => s.line)).toEqual([1])
  })

  it('a song ending in a setup call is not told', () => {
    const h = harness()
    noticeBareExpression('song', 's("bd")\nsetcps(1)\n', h.deps)
    expect(h.shown).toEqual([])
  })

  it('the message names the line and says how to make it a track', () => {
    expect(bareExpressionMessage(7)).toMatch(/^Line 7 is a bare expression.*Put \$: in front/)
  })
})

// This jsdom ships a `localStorage` whose methods do nothing (see the sibling
// tests); each test here installs a working one, or one that throws.
function installStorage(setItem?: () => never): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
  const map = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: setItem ?? ((k: string, v: string) => void map.set(k, v)),
    },
  })
  return () => {
    if (original) Object.defineProperty(window, 'localStorage', original)
  }
}

describe('storedTold', () => {
  it('remembers a song across instances (a page reload)', () => {
    const restore = installStorage()
    try {
      storedTold().add('song')
      expect([storedTold().has('song'), storedTold().has('other')]).toEqual([true, false])
    } finally {
      restore()
    }
  })

  it('remembers in memory when storage throws', () => {
    const restore = installStorage(() => {
      throw new Error('blocked')
    })
    try {
      const told = storedTold()
      told.add('song')
      expect([told.has('song'), storedTold().has('song')]).toEqual([true, false])
    } finally {
      restore()
    }
  })
})
