import { describe, it, expect, vi } from 'vitest'
import {
  generateNoteNames,
  NOTE_NAMES,
  registerStrudelDotCompletions,
  registerStrudelNoteCompletions,
} from '../strudelCompletions'
import type * as Monaco from 'monaco-editor'

// ---------------------------------------------------------------------------
// Minimal Monaco mock factory
// ---------------------------------------------------------------------------

/**
 * Typed factory for the `registerCompletionItemProvider` spy. Returns a
 * `vi.fn` whose `mock.calls` tuple is `[languageId, provider]` so the
 * tests can destructure the registered provider without `as unknown`
 * casts at every extraction site.
 */
function makeRegisterSpy() {
  return vi.fn<
    (language: string, provider: Monaco.languages.CompletionItemProvider) => Monaco.IDisposable
  >(() => ({ dispose: vi.fn() }))
}

function makeMonaco(registerCompletionItemProvider = makeRegisterSpy()) {
  return {
    languages: {
      registerCompletionItemProvider,
      CompletionItemKind: { Method: 0, Value: 1 },
    },
  } as unknown as typeof Monaco
}

/**
 * Invoke `provideCompletionItems` synchronously. The real Monaco
 * signature takes `(model, position, context, token)` and returns a
 * `CompletionList | Thenable<…>`; our tests only use providers that
 * return synchronously, so cast the result down to a bare
 * `CompletionList`. Dummy context/token stay typed as `any` because
 * none of our providers inspect them.
 */
function invokeCompletion(
  provider: Monaco.languages.CompletionItemProvider,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): Monaco.languages.CompletionList {
  return provider.provideCompletionItems(
    model,
    position,
    {} as Monaco.languages.CompletionContext,
    {} as Monaco.CancellationToken,
  ) as Monaco.languages.CompletionList
}

function makeModel(lineContent: string): Monaco.editor.ITextModel {
  return {
    getLineContent: () => lineContent,
    getWordUntilPosition: () => ({ word: '', startColumn: 1, endColumn: 1 }),
  } as unknown as Monaco.editor.ITextModel
}

function makePosition(col: number): Monaco.Position {
  return { lineNumber: 1, column: col } as Monaco.Position
}

// ---------------------------------------------------------------------------
// generateNoteNames
// ---------------------------------------------------------------------------

describe('generateNoteNames', () => {
  it('includes c4', () => {
    expect(NOTE_NAMES).toContain('c4')
  })

  it('includes flats like eb3', () => {
    expect(NOTE_NAMES).toContain('eb3')
  })

  it('includes sharps like f#5', () => {
    expect(NOTE_NAMES).toContain('f#5')
  })

  it('covers octaves 0 through 7', () => {
    expect(NOTE_NAMES).toContain('c0')
    expect(NOTE_NAMES).toContain('b7')
  })

  it('generates more than 100 names', () => {
    expect(generateNoteNames().length).toBeGreaterThan(100)
  })
})

// ---------------------------------------------------------------------------
// registerStrudelDotCompletions
// ---------------------------------------------------------------------------

describe('registerStrudelDotCompletions', () => {
  it('registers a completion provider for strudel language', () => {
    const spy = makeRegisterSpy()
    const monaco = makeMonaco(spy)
    registerStrudelDotCompletions(monaco)
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toBe('strudel')
  })

  it('returns a disposable', () => {
    const dispose = vi.fn()
    const spy = makeRegisterSpy()
    spy.mockImplementation(() => ({ dispose }))
    const monaco = makeMonaco(spy)
    const d = registerStrudelDotCompletions(monaco)
    d.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('provides suggestions after closing paren dot', () => {
    const spy = makeRegisterSpy()
    const monaco = makeMonaco(spy)
    registerStrudelDotCompletions(monaco)

    const provider = spy.mock.calls[0][1]
    // "note("c4")." — cursor is at col 12 (after the dot, 1-indexed)
    const model = makeModel('note("c4").')
    const result = invokeCompletion(provider, model, makePosition(12))
    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(result.suggestions.some((s) => s.label === 'fast')).toBe(true)
  })

  it('returns empty suggestions when no dot context', () => {
    const spy = makeRegisterSpy()
    const monaco = makeMonaco(spy)
    registerStrudelDotCompletions(monaco)

    const provider = spy.mock.calls[0][1]
    const model = makeModel('const x = ')
    const result = invokeCompletion(provider, model, makePosition(11))
    expect(result.suggestions).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// registerStrudelNoteCompletions
// ---------------------------------------------------------------------------

describe('registerStrudelNoteCompletions', () => {
  it('registers a completion provider for strudel language', () => {
    const spy = makeRegisterSpy()
    const monaco = makeMonaco(spy)
    registerStrudelNoteCompletions(monaco)
    expect(spy.mock.calls[0][0]).toBe('strudel')
  })

  it('provides note name suggestions inside note("...")', () => {
    const spy = makeRegisterSpy()
    const monaco = makeMonaco(spy)
    registerStrudelNoteCompletions(monaco)

    const provider = spy.mock.calls[0][1]
    const model = makeModel('note("c')
    const result = invokeCompletion(provider, model, makePosition(8))
    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(result.suggestions.some((s) => s.label === 'c4')).toBe(true)
  })

  it('returns empty suggestions outside note() context', () => {
    const spy = makeRegisterSpy()
    const monaco = makeMonaco(spy)
    registerStrudelNoteCompletions(monaco)

    const provider = spy.mock.calls[0][1]
    const model = makeModel('s("bd')
    const result = invokeCompletion(provider, model, makePosition(6))
    expect(result.suggestions).toHaveLength(0)
  })

  it('matches .note( chained call', () => {
    const spy = makeRegisterSpy()
    const monaco = makeMonaco(spy)
    registerStrudelNoteCompletions(monaco)

    const provider = spy.mock.calls[0][1]
    // 's("bd").note("e' is 15 chars, cursor at col 16
    const model = makeModel('s("bd").note("e')
    const result = invokeCompletion(provider, model, makePosition(16))
    expect(result.suggestions.length).toBeGreaterThan(0)
  })
})
