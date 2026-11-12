/**
 * #2557 — `attachVim`'s wiring, with the real monaco-vim on a stand-in editor (no browser):
 * the keys go through monaco-vim as they do in the page, so taking a fix out of `attachVim`
 * turns one of these red. The full behaviour, on a real Monaco, is the browser spec's
 * (`vim-extension.spec.ts`).
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error Monaco's ESM internals ship no typings (plain enums and value classes)
import { KeyCode, EditorOption, SelectionDirection } from 'monaco-editor/esm/vs/editor/common/standalone/standaloneEnums.js'
// @ts-expect-error Monaco's ESM internals ship no typings (plain enums and value classes)
import { Range } from 'monaco-editor/esm/vs/editor/common/core/range.js'
// @ts-expect-error Monaco's ESM internals ship no typings (plain enums and value classes)
import { Position } from 'monaco-editor/esm/vs/editor/common/core/position.js'
// @ts-expect-error Monaco's ESM internals ship no typings (plain enums and value classes)
import { Selection } from 'monaco-editor/esm/vs/editor/common/core/selection.js'
import { attachVim } from '../vim/module'
import { PAST_VERSION } from '../vim/edges'
import { FakeUndoModel } from './fakeUndoModel'

type Listener<T> = (e: T) => void
function emitter<T>() {
  const fns: Listener<T>[] = []
  return {
    on: (fn: Listener<T>) => {
      fns.push(fn)
      return { dispose: () => fns.splice(fns.indexOf(fn) >>> 0, 1) }
    },
    fire: (e: T) => [...fns].forEach((fn) => fn(e)),
  }
}

/** A one-line model with Monaco's undo steps (`FakeUndoModel`) and what monaco-vim reads. */
class LineModel extends FakeUndoModel {
  getLineCount = () => 1
  getLineContent = () => this.text
  getLineMaxColumn = () => this.text.length + 1
  getLineFirstNonWhitespaceColumn = () => (this.text.length ? 1 : 0)
  getValue = () => this.text
  getValueInRange = (r: { startColumn: number; endColumn: number }) => this.text.slice(r.startColumn - 1, r.endColumn - 1)
  getOptions = () => ({ insertSpaces: true, tabSize: 2, indentSize: 2 })
  getOffsetAt = (p: { column: number }) => p.column - 1
  getPositionAt = (o: number) => new Position(1, o + 1)
  validatePosition = (p: { lineNumber: number; column: number }) =>
    new Position(1, Math.max(1, Math.min(p.column, this.text.length + 1)))
}

function setup(opts: { readOnly?: boolean } = {}) {
  const model = new LineModel()
  const keyDown = emitter<unknown>()
  const content = emitter<unknown>()
  const cursor = emitter<unknown>()
  const modelChange = emitter<unknown>()
  model.listeners.push((e) => content.fire({ ...e, changes: [] }))
  let pos = new Position(1, 1)
  let focus = true
  const contextKeys = new Map<string, unknown>()
  const triggered: string[] = []
  const dom = document.createElement('div')
  const options: Record<string, unknown> = {}
  const editor = {
    onKeyDown: keyDown.on,
    onDidChangeModelContent: content.on,
    onDidChangeCursorPosition: cursor.on,
    onDidChangeModel: modelChange.on,
    onDidDispose: () => ({ dispose() {} }),
    createContextKey(key: string, value: unknown) {
      if (value === undefined) contextKeys.delete(key)
      else contextKeys.set(key, value)
      return { set: (v: unknown) => contextKeys.set(key, v), get: () => contextKeys.get(key), reset() {} }
    },
    getOption(id: number) {
      if (id === EditorOption.readOnly) return !!opts.readOnly
      if (id === EditorOption.fontInfo) return { typicalFullwidthCharacterWidth: 8 }
      return 0
    },
    getRawOptions: () => options,
    updateOptions: (o: object) => Object.assign(options, o),
    getModel: () => model,
    getPosition: () => pos,
    setPosition: (p: Position) => {
      pos = new Position(1, p.column)
    },
    getSelection: () => Selection.fromPositions(pos, pos),
    getSelections: () => [Selection.fromPositions(pos, pos)],
    setSelection: (s: Selection) => {
      pos = new Position(1, s.positionColumn ?? s.endColumn)
    },
    setSelections: (s: Selection[]) => {
      pos = new Position(1, s[0].positionColumn ?? s[0].endColumn)
    },
    revealPosition() {},
    deltaDecorations: () => [],
    executeEdits(_src: string, edits: { range: Range; text: string }[]) {
      if (opts.readOnly) return false
      for (const ed of edits) {
        const t = model.text
        model.set(t.slice(0, ed.range.startColumn - 1) + ed.text + t.slice(ed.range.endColumn - 1))
      }
      return true
    },
    pushUndoStop: () => model.pushStackElement(),
    focus() {},
    hasTextFocus: () => focus,
    getDomNode: () => dom,
    trigger: (_s: string, id: string) => triggered.push(id),
    getVisibleRanges: () => [new Range(1, 1, 1, 1)],
    getTopForLineNumber: () => 0,
    setScrollTop() {},
    getScrollTop: () => 0,
    getAction: () => null,
    getId: () => 'fake',
  }
  const bar = document.createElement('div')
  document.body.appendChild(bar)
  const monaco = { KeyCode, Range, Position, Selection, SelectionDirection, editor: { EditorOption } }
  const closeOff = attachVim(
    { editor: editor as never, monaco: monaco as never, readOnly: !!opts.readOnly, language: 'strudel', bar, close() {} },
    { keyOf: () => null, takesKey: () => true, closeAllEditors() {} },
  )
  /** Press one key, as Monaco hands it to its key listeners; true when it stopped there. */
  const press = (key: string, code = /^\d$/.test(key) ? `Digit${key}` : key.length === 1 ? `Key${key.toUpperCase()}` : key) => {
    const browserEvent = new KeyboardEvent('keydown', { key, code, cancelable: true })
    let stopped = false
    keyDown.fire({
      browserEvent,
      keyCode: code === 'Escape' ? KeyCode.Escape : (KeyCode as unknown as Record<string, number>)[code],
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      preventDefault: () => browserEvent.preventDefault(),
      stopPropagation: () => {
        stopped = true
      },
    })
    return stopped
  }
  const mode = () => bar.querySelector('[data-vim-mode]')?.textContent
  return { model, press, mode, contextKeys, triggered, dom, bar, closeOff, setFocus: (f: boolean) => (focus = f) }
}

describe('attachVim’s wiring (#2557)', () => {
  it('u undoes a whole insert, and leaves an edit from elsewhere in the middle its own step', async () => {
    const { model, press, mode, setFocus } = setup()
    press('i')
    expect(mode()).toBe('-- INSERT --')
    model.type('one two') // Monaco's typing, with its own step at the space
    setFocus(false)
    model.pushStackElement()
    model.edit('|GRID|') // the grid writes into the code (its own step)
    model.pushStackElement()
    setFocus(true)
    model.type(' three')
    press('Escape')
    await Promise.resolve()
    expect(mode()).toBe('-- NORMAL --')
    press('u')
    expect(model.text).toBe('one two|GRID|')
    press('u')
    expect(model.text).toBe('one two')
    press('u')
    expect(model.text).toBe('')
  })

  it('an Esc that cancels d is Vim’s alone; an Esc with nothing to cancel goes on', async () => {
    const { press } = setup()
    press('d')
    expect(press('Escape')).toBe(true)
    await Promise.resolve()
    expect(press('Escape')).toBe(false)
  })

  it('Esc with the suggestion list open closes the list, and insert mode stays', () => {
    const { press, mode, dom, triggered } = setup()
    const list = document.createElement('div')
    list.className = 'suggest-widget'
    dom.appendChild(list)
    press('i')
    expect(press('Escape')).toBe(true)
    expect(triggered).toEqual(['hideSuggestWidget'])
    expect(mode()).toBe('-- INSERT --')
    list.style.visibility = 'hidden'
    press('Escape')
    expect(mode()).toBe('-- NORMAL --')
  })

  it('in a past version, u and an insert say why nothing happens', async () => {
    const { press, bar } = setup({ readOnly: true })
    const message = () => bar.querySelector('[data-vim-message]')?.textContent
    expect(message()).toBe('')
    press('u')
    expect(message()).toBe(PAST_VERSION)
  })

  it('cw and what is typed after it are one change for u', async () => {
    const { model, press, mode } = setup()
    model.bracketed('kick snare')
    press('0')
    press('c')
    press('w')
    expect(mode()).toBe('-- INSERT --')
    model.type('hat') // replaces the word cw deleted
    press('Escape')
    await Promise.resolve()
    expect(model.text).not.toBe('kick snare')
    press('u')
    expect(model.text).toBe('kick snare')
  })

  it('in a past version, x says why nothing happens', async () => {
    const { model, press, bar } = setup({ readOnly: true })
    model.bracketed('abc')
    press('x')
    expect(model.text).toBe('abc')
    expect(bar.querySelector('[data-vim-message]')?.textContent).toBe(PAST_VERSION)
  })

  it('in a past version, i says why nothing happens', async () => {
    const { press, bar } = setup({ readOnly: true })
    press('i')
    await Promise.resolve()
    expect(bar.querySelector('[data-vim-message]')?.textContent).toBe(PAST_VERSION)
  })

  it('switched off, monaco-vim’s context key is gone', () => {
    const { contextKeys, closeOff } = setup()
    expect(contextKeys.has('insertMode')).toBe(true)
    closeOff()
    expect(contextKeys.has('insertMode')).toBe(false)
  })
})
