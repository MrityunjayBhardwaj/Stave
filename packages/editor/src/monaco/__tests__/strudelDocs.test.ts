import { describe, it, expect, vi } from 'vitest'
import { STRUDEL_DOCS, registerStrudelHover } from '../strudelDocs'
import type * as Monaco from 'monaco-editor'

// ---------------------------------------------------------------------------
// STRUDEL_DOCS
// ---------------------------------------------------------------------------

describe('STRUDEL_DOCS', () => {
  it('has at least 20 entries', () => {
    expect(Object.keys(STRUDEL_DOCS).length).toBeGreaterThanOrEqual(20)
  })

  it('every entry has signature, description, and example', () => {
    for (const [name, doc] of Object.entries(STRUDEL_DOCS)) {
      expect(doc.signature, `${name}.signature`).toBeTruthy()
      expect(doc.description, `${name}.description`).toBeTruthy()
      expect(doc.example, `${name}.example`).toBeTruthy()
    }
  })

  it('includes core functions: note, s, stack, fast, slow', () => {
    expect(STRUDEL_DOCS).toHaveProperty('note')
    expect(STRUDEL_DOCS).toHaveProperty('s')
    expect(STRUDEL_DOCS).toHaveProperty('stack')
    expect(STRUDEL_DOCS).toHaveProperty('fast')
    expect(STRUDEL_DOCS).toHaveProperty('slow')
  })

  // The pick family is added as a whole, not one member at a time — this
  // guards against the incomplete-enumeration gap that left pickRestart (and
  // its siblings) without a hover doc.
  it('covers the pick family (@strudel/core/pick.mjs)', () => {
    for (const name of [
      'pick',
      'pickmod',
      'pickF',
      'pickmodF',
      'pickOut',
      'pickmodOut',
      'pickRestart',
      'pickmodRestart',
      'pickReset',
      'pickmodReset',
      'inhabit',
      'inhabitmod',
      'squeeze',
    ]) {
      expect(STRUDEL_DOCS, `${name} missing from STRUDEL_DOCS`).toHaveProperty(
        name,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// registerStrudelHover
// ---------------------------------------------------------------------------

/**
 * Typed factory for the `registerHoverProvider` spy. Returns a
 * `vi.fn` whose `mock.calls` tuple is `[languageId, provider]` so
 * tests can destructure the registered hover provider without
 * `as unknown` casts at every extraction site.
 */
function makeHoverSpy() {
  return vi.fn<
    (language: string, provider: Monaco.languages.HoverProvider) => Monaco.IDisposable
  >(() => ({ dispose: vi.fn() }))
}

function makeMonaco(registerHoverProvider = makeHoverSpy()) {
  return {
    languages: { registerHoverProvider },
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number
      ) {}
    },
  } as unknown as typeof Monaco
}

/**
 * Invoke `provideHover` synchronously. Real signature is
 * `(model, position, token)` returning `Hover | Thenable<Hover …>`;
 * our provider is synchronous, so cast down and pass a dummy token.
 */
function invokeHover(
  provider: Monaco.languages.HoverProvider,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): Monaco.languages.Hover | null {
  return provider.provideHover(
    model,
    position,
    {} as Monaco.CancellationToken,
  ) as Monaco.languages.Hover | null
}

describe('registerStrudelHover', () => {
  it('registers a hover provider for strudel language', () => {
    const spy = makeHoverSpy()
    const monaco = makeMonaco(spy)
    registerStrudelHover(monaco)
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toBe('strudel')
  })

  it('returns a disposable', () => {
    const dispose = vi.fn()
    const spy = makeHoverSpy()
    spy.mockImplementation(() => ({ dispose }))
    const monaco = makeMonaco(spy)
    const d = registerStrudelHover(monaco)
    d.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('returns hover content for a known function', () => {
    const spy = makeHoverSpy()
    const monaco = makeMonaco(spy)
    registerStrudelHover(monaco)

    const provider = spy.mock.calls[0][1]
    const model = {
      getWordAtPosition: () => ({ word: 'fast', startColumn: 1, endColumn: 5 }),
    } as unknown as Monaco.editor.ITextModel
    const position = { lineNumber: 1, column: 3 } as Monaco.Position

    const result = invokeHover(provider, model, position)
    expect(result).not.toBeNull()
    // Signature + description + example + Reference link (per-function permalink)
    expect(result!.contents).toHaveLength(4)
    expect((result!.contents[0] as { value: string }).value).toContain('fast')
    expect(
      (result!.contents[result!.contents.length - 1] as { value: string }).value,
    ).toContain('strudel.cc/learn/time-modifiers/#fast')
  })

  it('returns null for unknown word', () => {
    const spy = makeHoverSpy()
    const monaco = makeMonaco(spy)
    registerStrudelHover(monaco)

    const provider = spy.mock.calls[0][1]
    const model = {
      getWordAtPosition: () => ({ word: 'unknownFn', startColumn: 1, endColumn: 9 }),
    } as unknown as Monaco.editor.ITextModel

    const result = invokeHover(provider, model, { lineNumber: 1, column: 1 } as Monaco.Position)
    expect(result).toBeNull()
  })

  it('returns null when no word at position', () => {
    const spy = makeHoverSpy()
    const monaco = makeMonaco(spy)
    registerStrudelHover(monaco)

    const provider = spy.mock.calls[0][1]
    const model = {
      getWordAtPosition: () => null,
    } as unknown as Monaco.editor.ITextModel

    const result = invokeHover(provider, model, { lineNumber: 1, column: 1 } as Monaco.Position)
    expect(result).toBeNull()
  })
})
