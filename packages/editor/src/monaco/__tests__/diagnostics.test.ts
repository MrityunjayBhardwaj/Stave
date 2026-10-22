import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  setEvalError,
  clearEvalErrors,
  setLineMarker,
  clearLineMarkers,
  refreshStrudelLintMarkers,
  clearStrudelLintMarkers,
  errorColumns,
} from '../diagnostics'
import type * as Monaco from 'monaco-editor'

// ---------------------------------------------------------------------------
// Minimal Monaco mock
// ---------------------------------------------------------------------------

function makeModel(lineCount: number, maxCol = 80): Monaco.editor.ITextModel {
  return {
    getLineCount: () => lineCount,
    getLineMaxColumn: (_line: number) => maxCol,
  } as unknown as Monaco.editor.ITextModel
}

/**
 * Make a text-bearing model for the Strudel lint tests. Translates absolute
 * char offsets to line/column the same way Monaco does (1-indexed, line
 * number relative to \n boundaries). Sufficient for the regex-driven lint
 * which only needs `getValue` + `getPositionAt`.
 */
function makeTextModel(text: string): Monaco.editor.ITextModel {
  return {
    getValue: () => text,
    getPositionAt: (offset: number) => {
      let line = 1
      let col = 1
      for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') {
          line++
          col = 1
        } else {
          col++
        }
      }
      return { lineNumber: line, column: col }
    },
    getLineCount: () => text.split('\n').length,
    getLineMaxColumn: () => 80,
  } as unknown as Monaco.editor.ITextModel
}

function makeMonaco(setModelMarkers = vi.fn()) {
  return {
    editor: {
      setModelMarkers,
    },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2 },
  } as unknown as typeof Monaco
}

// ---------------------------------------------------------------------------
// setEvalError
// ---------------------------------------------------------------------------

describe('setEvalError', () => {
  it('marks the correct line when stack has V8 eval location', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    const model = makeModel(10, 50)

    const error = new Error('Unexpected token')
    error.stack = `SyntaxError: Unexpected token\n    at eval (<anonymous>:3:12)\n    at foo (bar.js:1:1)`

    setEvalError(monaco, model, error)

    expect(spy).toHaveBeenCalledOnce()
    const [, owner, markers] = spy.mock.calls[0]
    expect(owner).toBe('stave')
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({
      severity: 8,
      message: 'Unexpected token',
      startLineNumber: 3,
      startColumn: 12,
      endLineNumber: 3,
    })
  })

  it('skips the marker (empty set) when stack has no eval location (#532)', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    const model = makeModel(5, 40)

    // A runtime/library throw — bundle-only stack, no `at eval` frame.
    const error = new Error('no soundfont zone found for preset ')
    error.stack = 'Error: …\n    at Object.<anonymous> (chunk.js:1:1)'

    setEvalError(monaco, model, error)

    const [, owner, markers] = spy.mock.calls[0]
    expect(owner).toBe('stave')
    // No whole-document squiggle: the marker set is empty (and any prior
    // eval marker is retired).
    expect(markers).toEqual([])
  })

  it('skips the marker (empty set) when stack is empty (#532)', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    const model = makeModel(3, 20)

    const error = new Error('oops')
    error.stack = ''

    setEvalError(monaco, model, error)

    const [, , markers] = spy.mock.calls[0]
    expect(markers).toEqual([])
  })

  it('uses error.message in the marker (with a parseable location)', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    const model = makeModel(2)

    const error = new Error('foo is not defined')
    error.stack = `ReferenceError: foo is not defined\n    at eval (<anonymous>:1:1)`
    setEvalError(monaco, model, error)

    const [, , markers] = spy.mock.calls[0]
    expect(markers[0].message).toBe('foo is not defined')
  })

  // --- P37 regression cases (now: skip, not whole-document clamp) ---

  it('skips the marker when stack reports a line past EOF (#532, P37)', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    const model = makeModel(4, 30)

    // Strudel transpiler wraps user code; stack points at a synthetic line
    // past the visible document → treated as locationless (skip), never
    // clamped to the whole file. Must still not throw (P37).
    const error = new Error('notes is not defined')
    error.stack = `ReferenceError: notes is not defined\n    at eval (<anonymous>:42:7)`

    expect(() => setEvalError(monaco, model, error)).not.toThrow()

    const [, , markers] = spy.mock.calls[0]
    expect(markers).toEqual([])
  })

  it('skips the marker when stack reports line 0 (#532, P37)', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    const model = makeModel(5, 20)

    const error = new Error('bad')
    error.stack = `Error: bad\n    at eval (<anonymous>:0:0)`

    expect(() => setEvalError(monaco, model, error)).not.toThrow()

    const [, , markers] = spy.mock.calls[0]
    expect(markers).toEqual([])
  })

  it('never throws when Monaco.setModelMarkers itself throws', () => {
    const throwing = vi.fn(() => {
      throw new Error('Illegal value for lineNumber')
    })
    const monaco = makeMonaco(throwing)
    const model = makeModel(3)

    const error = new Error('oops')
    expect(() => setEvalError(monaco, model, error)).not.toThrow()
  })

  it('never throws when model.getLineMaxColumn throws', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    const model = {
      getLineCount: () => 3,
      getLineMaxColumn: () => {
        throw new Error('bad line')
      },
    } as unknown as Monaco.editor.ITextModel

    expect(() => setEvalError(monaco, model, new Error('x'))).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// clearEvalErrors
// ---------------------------------------------------------------------------

describe('clearEvalErrors', () => {
  it('calls setModelMarkers with empty array', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    const model = makeModel(5)

    clearEvalErrors(monaco, model)

    expect(spy).toHaveBeenCalledOnce()
    const [, owner, markers] = spy.mock.calls[0]
    expect(owner).toBe('stave')
    expect(markers).toEqual([])
  })

  it('never throws when setModelMarkers throws', () => {
    const monaco = makeMonaco(
      vi.fn(() => {
        throw new Error('boom')
      })
    )
    expect(() => clearEvalErrors(monaco, makeModel(3))).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// setLineMarker / clearLineMarkers
// ---------------------------------------------------------------------------

describe('setLineMarker', () => {
  it('places a marker on a valid line with the given severity + owner', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    const model = makeModel(10, 50)

    setLineMarker(monaco, model, {
      line: 3,
      column: 7,
      message: 'hint',
      severity: 'warn',
      owner: 'stave-log',
    })

    const [, owner, markers] = spy.mock.calls[0]
    expect(owner).toBe('stave-log')
    expect(markers[0]).toMatchObject({
      severity: 4,
      message: 'hint',
      startLineNumber: 3,
      startColumn: 7,
      endLineNumber: 3,
    })
  })

  it('falls back to full-document range when line is out of bounds', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    const model = makeModel(4, 30)

    setLineMarker(monaco, model, {
      line: 99,
      message: 'x',
    })

    const [, , markers] = spy.mock.calls[0]
    expect(markers[0]).toMatchObject({
      startLineNumber: 1,
      endLineNumber: 4,
      endColumn: 30,
    })
  })

  it('defaults to error severity + stave owner when unspecified', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)

    setLineMarker(monaco, makeModel(2), { line: 1, message: 'boom' })

    const [, owner, markers] = spy.mock.calls[0]
    expect(owner).toBe('stave')
    expect(markers[0].severity).toBe(8)
  })

  it('never throws when Monaco rejects the marker', () => {
    const monaco = makeMonaco(
      vi.fn(() => {
        throw new Error('Illegal value for lineNumber')
      })
    )
    expect(() =>
      setLineMarker(monaco, makeModel(3), { line: 1, message: 'x' }),
    ).not.toThrow()
  })
})

describe('clearLineMarkers', () => {
  it('clears the given owner with an empty array', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    clearLineMarkers(monaco, makeModel(3), 'stave-log')
    expect(spy).toHaveBeenCalledWith(expect.anything(), 'stave-log', [])
  })
})

// ---------------------------------------------------------------------------
// F-2 — refreshStrudelLintMarkers (.p("...") double-quote lint)
// ---------------------------------------------------------------------------

describe('refreshStrudelLintMarkers (F-2)', () => {
  it('flags a single .p("name") double-quoted call with a Warning marker', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    const model = makeTextModel('$: s("bd*4").p("kick")')

    refreshStrudelLintMarkers(monaco, model)

    expect(spy).toHaveBeenCalledOnce()
    const [, owner, markers] = spy.mock.calls[0]
    expect(owner).toBe('stave-strudel-lint')
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({
      severity: 4,
      code: 'strudel/p-double-quoted',
      source: 'stave',
    })
    expect(markers[0].message).toMatch(/single quotes/)
    expect(markers[0].message).toContain("kick")
  })

  it('does NOT flag single-quoted .p(\'kick\') — the working idiom', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    const model = makeTextModel("$: s(\"bd*4\").p('kick')")

    refreshStrudelLintMarkers(monaco, model)

    expect(spy).toHaveBeenCalledOnce()
    const markers = spy.mock.calls[0][2]
    expect(markers).toEqual([])
  })

  it('flags multiple .p("...") sites in the same buffer', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    const model = makeTextModel(
      [
        '$: s("hh*8").p("hats")',
        '$: s("bd*4").p("kick")',
        "$: s(\"sd*2\").p('snare')", // already correct — should NOT add marker
      ].join('\n'),
    )

    refreshStrudelLintMarkers(monaco, model)

    const markers = spy.mock.calls[0][2]
    expect(markers).toHaveLength(2)
    expect(markers[0].startLineNumber).toBe(1)
    expect(markers[1].startLineNumber).toBe(2)
  })

  it('clears markers when content goes from .p("name") to .p(\'name\')', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)

    const bad = makeTextModel('$: s("bd*4").p("kick")')
    refreshStrudelLintMarkers(monaco, bad)
    expect(spy.mock.calls[0][2]).toHaveLength(1)

    spy.mockClear()
    const good = makeTextModel("$: s(\"bd*4\").p('kick')")
    refreshStrudelLintMarkers(monaco, good)
    expect(spy.mock.calls[0][2]).toEqual([])
  })

  it('does not flag double-quoted args to OTHER methods (s, note, etc.)', () => {
    // Double-quoted strings ARE the right idiom for s() / note() — they
    // genuinely want mini-notation. Only .p() is the case where mini
    // isn't what the user wants.
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    const model = makeTextModel(
      's("bd*4").note("c d e f").every(2, fast(2)).color("red")',
    )

    refreshStrudelLintMarkers(monaco, model)

    expect(spy.mock.calls[0][2]).toEqual([])
  })

  it('survives a Monaco throw (hetvabhasa P37 — never crash the editor)', () => {
    const monaco = makeMonaco(
      vi.fn(() => {
        throw new Error('Illegal value')
      }),
    )
    const model = makeTextModel('$: s("bd*4").p("kick")')

    expect(() => refreshStrudelLintMarkers(monaco, model)).not.toThrow()
  })
})

describe('clearStrudelLintMarkers', () => {
  it('clears the lint owner with an empty array', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    clearStrudelLintMarkers(monaco, makeTextModel('whatever'))
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      'stave-strudel-lint',
      [],
    )
  })
})

// ---------------------------------------------------------------------------
// errorColumns (#2180) — a squiggle covers the word or symbol at fault
// ---------------------------------------------------------------------------

/**
 * A model over real text whose `getWordAtPosition` behaves like Monaco's: it uses
 * Monaco's default word pattern and, like Monaco, also returns the word that ENDS
 * at the position (touching it from the left), which `errorColumns` must not take.
 */
function makeWordModel(lines: string[]): Monaco.editor.ITextModel {
  const WORD = /(-?\d*\.\d\w*)|([^`~!@#$%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g
  return {
    getLineCount: () => lines.length,
    getLineMaxColumn: (l: number) => lines[l - 1].length + 1,
    getLineFirstNonWhitespaceColumn: (l: number) => {
      const i = lines[l - 1].search(/\S/)
      return i < 0 ? 0 : i + 1
    },
    getWordAtPosition: ({ lineNumber, column }: { lineNumber: number; column: number }) => {
      for (const m of lines[lineNumber - 1].matchAll(WORD)) {
        const start = (m.index ?? 0) + 1
        const end = start + m[0].length
        if (start <= column && column <= end) return { word: m[0], startColumn: start, endColumn: end }
      }
      return null
    },
  } as unknown as Monaco.editor.ITextModel
}

const underlined = (line: string, column?: number) => {
  const { startColumn, endColumn } = errorColumns(makeWordModel([line]), 1, column)
  return line.slice(startColumn - 1, endColumn - 1)
}

describe('errorColumns (#2180)', () => {
  it('underlines the misspelled name, not the rest of the line', () => {
    expect(underlined('$: s("cp").fooo().gain(0.8)', 12)).toBe('fooo')
  })

  it('takes the whole word from a column inside it', () => {
    expect(underlined('$: s("hh").gain(undefinedThing)', 20)).toBe('undefinedThing')
  })

  it('underlines punctuation as one character, not the word just before it', () => {
    expect(underlined('s("bd").gain(0.5]', 17)).toBe(']')
  })

  it('a column at or past the end of the line is its last character', () => {
    expect(underlined('  .s("piano" .lpf(800)', 23)).toBe(')')
    expect(underlined('  .s("piano" .lpf(800)', 99)).toBe(')')
  })

  it('with no column, underlines the line’s code from its first non-blank character', () => {
    expect(underlined('    .lpf(800)')).toBe('.lpf(800)')
    expect(underlined('    .lpf(800)', 0)).toBe('.lpf(800)')
  })

  it('an empty line gets an empty range rather than a bad one', () => {
    expect(errorColumns(makeWordModel(['']), 1, 3)).toEqual({ startColumn: 1, endColumn: 1 })
  })

  it('both drawing paths use it', () => {
    const spy = vi.fn()
    const monaco = makeMonaco(spy)
    const model = makeWordModel(['$: s("bd")', '$: s("cp").fooo().gain(0.8)'])
    setLineMarker(monaco, model, { line: 2, column: 12, message: 'x', owner: 'stave-log' })
    expect(spy.mock.calls[0][2][0]).toMatchObject({ startLineNumber: 2, startColumn: 12, endColumn: 16 })
    const err = new Error('fooo is not a function')
    err.stack = 'TypeError: fooo is not a function\n    at eval (<anonymous>:2:12)'
    setEvalError(monaco, model, err)
    expect(spy.mock.calls[1][2][0]).toMatchObject({ startLineNumber: 2, startColumn: 12, endColumn: 16 })
  })
})
