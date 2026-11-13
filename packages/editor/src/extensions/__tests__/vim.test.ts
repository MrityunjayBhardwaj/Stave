/**
 * #2148 — the Vim extension's parts that need no live Monaco: its manifest (keys, handed
 * back by default), the bar it draws, the `>>`/`<<` edit, and the key filter that leaves a
 * handed-back key alone. Vim on a real editor is the browser spec's (`vim-extension.spec.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { VIM, VIM_ID } from '../vim/manifest'
import { VimBar, modeLabel, VIM_MESSAGE_MS } from '../vim/bar'
import { shiftEdit } from '../vim/shiftCommand'
import { bindEditorActions, EX_COMMANDS, keyFilteredEditor, leaveAloneFor, runExAction, SAVES_AS_YOU_TYPE, vimModule, type ExAction } from '../vim/module'
import { hasPendingInput, InsertUndo, isVimEsc, removeContextKeys, suggestListOpen, VIM_CONTEXT_KEYS } from '../vim/edges'
import { FakeUndoModel } from './fakeUndoModel'
import { checkExtensionKeys, keyId } from '../keys'
import { BUILTIN_EXTENSIONS } from '../builtin'

describe('the Vim manifest', () => {
  it('is listed, for every language, with a common part only', async () => {
    expect(BUILTIN_EXTENSIONS).toContain(VIM)
    expect(VIM.id).toBe(VIM_ID)
    expect(VIM.languages).toBe('*')
    expect(VIM.provides?.strudel).toBeUndefined()
    const mod = await VIM.load()
    expect(mod).toBe(vimModule)
    expect(typeof mod.activate).toBe('function')
    expect(mod.strudel).toBeUndefined()
  })

  it('declares exactly the Ctrl keys monaco-vim’s keymap uses, read from the package itself', () => {
    // monaco-vim's own keymap, from the installed package: every `<C-…>` it maps
    const file = createRequire(import.meta.url).resolve('monaco-vim')
    const mapped = new Set(
      [...readFileSync(file, 'utf8').matchAll(/keys: "<C-([^>]+)>"/g)].map(([, k]) =>
        `ctrl+${{ BS: 'backspace', Space: 'space' }[k] ?? k.toLowerCase()}`,
      ),
    )
    expect(mapped.size).toBeGreaterThan(15)
    const declared = new Set((VIM.provides?.keys ?? []).map((k) => keyId(k.key)))
    expect([...declared].sort()).toEqual([...mapped].sort())
  })

  it('so Stave’s Play, Stop, palette and Ctrl+Z are never Vim’s; Ctrl+P (quick open) is handed back', () => {
    expect(() => checkExtensionKeys(VIM)).not.toThrow()
    const declared = (VIM.provides?.keys ?? []).map((k) => keyId(k.key))
    for (const k of ['ctrl+enter', 'ctrl+.', 'ctrl+shift+p', 'ctrl+z']) expect(declared).not.toContain(k)
    const back = (VIM.provides?.keys ?? []).filter((k) => k.givenBack).map((k) => keyId(k.key))
    expect(back).toEqual(['ctrl+p'])
    // everything else Vim uses goes to Vim, Ctrl+C, Ctrl+V, Ctrl+R, Ctrl+D and Ctrl+U included
    const vims = (VIM.provides?.keys ?? []).filter((k) => !k.givenBack).map((k) => keyId(k.key))
    for (const k of ['ctrl+c', 'ctrl+v', 'ctrl+r', 'ctrl+d', 'ctrl+u']) expect(vims).toContain(k)
    // all spelled with Vim's Ctrl, never Stave's `mod` (on a Mac that is Cmd, which stays Stave's)
    expect((VIM.provides?.keys ?? []).every((k) => keyId(k.key)!.startsWith('ctrl+'))).toBe(true)
  })
})

describe('the bar', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  function bar() {
    const node = document.createElement('div')
    document.body.appendChild(node)
    const focus = vi.fn()
    const editor = { focus, model: {} as object | null, getModel() { return this.model } }
    const b = new VimBar(node, editor as never)
    return { node, b, focus, editor, q: (sel: string) => node.querySelector(sel) as HTMLElement }
  }

  it('says the mode the way Vim does', () => {
    expect(modeLabel({ mode: 'normal' })).toBe('-- NORMAL --')
    expect(modeLabel({ mode: 'insert' })).toBe('-- INSERT --')
    expect(modeLabel({ mode: 'visual' })).toBe('-- VISUAL --')
    expect(modeLabel({ mode: 'visual', subMode: 'linewise' })).toBe('-- VISUAL LINE --')
    expect(modeLabel({ mode: 'visual', subMode: 'blockwise' })).toBe('-- VISUAL BLOCK --')
  })

  it('mode on the left, keys typed on the right; hidden until Vim shows it', () => {
    const { node, b, q } = bar()
    expect(node.style.display).toBe('none')
    b.toggleVisibility(true)
    expect(node.style.display).toBe('flex')
    b.setMode({ mode: 'normal' })
    b.setKeyBuffer('2d')
    expect(q('[data-vim-mode]').textContent).toBe('-- NORMAL --')
    expect(q('[data-vim-keys]').textContent).toBe('2d')
    const order = [...node.children].map((c) => [...c.attributes].map((a) => a.name).find((n) => n.startsWith('data-vim')) ?? 'spacer')
    expect(order).toEqual(['data-vim-mode', 'data-vim-command', 'data-vim-message', 'spacer', 'data-vim-keys'])
  })

  it('the : line opens in place of the mode; Enter runs it and closes it, Esc closes it', () => {
    const { b, q, focus } = bar()
    b.toggleVisibility(true)
    b.setMode({ mode: 'normal' })
    const prompt = () => {
      const span = document.createElement('span')
      span.append(':', document.createElement('input'))
      return span
    }
    const ran: string[] = []
    b.setSec(prompt(), (v) => ran.push(v))
    const input = q('[data-vim-input]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(document.activeElement).toBe(input)
    expect(q('[data-vim-mode]').style.display).toBe('none')
    input.value = 's/bd/sd/g'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(ran).toEqual(['s/bd/sd/g'])
    expect(q('[data-vim-input]')).toBeNull()
    expect(q('[data-vim-mode]').style.display).toBe('')
    expect(focus).toHaveBeenCalled()

    b.setSec(prompt(), (v) => ran.push(v))
    const again = q('[data-vim-input]') as HTMLInputElement
    again.value = 'w'
    again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(ran).toEqual(['s/bd/sd/g'])
    expect(q('[data-vim-input]')).toBeNull()
  })

  it('closing with no : line open (Vim switching off) leaves the keyboard where it is', () => {
    const { b, focus, editor } = bar()
    b.closeInput()
    expect(focus).not.toHaveBeenCalled()
    // with a : line open it goes back to the editor, but not to one that has gone
    const prompt = () => {
      const span = document.createElement('span')
      span.append(':', document.createElement('input'))
      return span
    }
    b.setSec(prompt())
    b.closeInput()
    expect(focus).toHaveBeenCalledTimes(1)
    b.setSec(prompt())
    editor.model = null
    b.closeInput()
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('a message shows for a few seconds; a newer one keeps its own time', () => {
    vi.useFakeTimers()
    const { b, q } = bar()
    b.showNotification('first')
    expect(q('[data-vim-message]').textContent).toBe('first')
    vi.advanceTimersByTime(VIM_MESSAGE_MS - 1000)
    b.showNotification(SAVES_AS_YOU_TYPE)
    vi.advanceTimersByTime(1500)
    // the first message's timer must not clear the second
    expect(q('[data-vim-message]').textContent).toBe(SAVES_AS_YOU_TYPE)
    vi.advanceTimersByTime(VIM_MESSAGE_MS)
    expect(q('[data-vim-message]').textContent).toBe('')
  })

  it("Vim's errors are marked as errors", () => {
    const { b, q } = bar()
    const pre = document.createElement('pre')
    pre.className = 'cm-vim-message'
    pre.textContent = 'Not an editor command ":zz"'
    b.showNotification(pre)
    expect(q('[data-vim-message]').hasAttribute('data-vim-error')).toBe(true)
    b.showNotification('fine')
    expect(q('[data-vim-message]').hasAttribute('data-vim-error')).toBe(false)
  })
})

describe('>> and <<', () => {
  const spaces = { tabSize: 2, indentSize: 2, insertSpaces: true }
  it('indents by one indent, leaving an empty line alone', () => {
    expect(shiftEdit('note("c")', { ...spaces, isUnshift: false })).toEqual({ from: 1, to: 1, text: '  ' })
    expect(shiftEdit('note("c")', { ...spaces, insertSpaces: false, isUnshift: false })).toEqual({ from: 1, to: 1, text: '\t' })
    expect(shiftEdit('', { ...spaces, isUnshift: false })).toBeNull()
  })
  it('outdents by one tab or up to one indent of spaces', () => {
    expect(shiftEdit('    x', { ...spaces, isUnshift: true })).toEqual({ from: 1, to: 3, text: '' })
    expect(shiftEdit(' x', { ...spaces, isUnshift: true })).toEqual({ from: 1, to: 2, text: '' })
    expect(shiftEdit('\t\tx', { ...spaces, isUnshift: true })).toEqual({ from: 1, to: 2, text: '' })
    expect(shiftEdit('x', { ...spaces, isUnshift: true })).toBeNull()
  })
})

describe('a handed-back key never reaches Vim', () => {
  it('leaves alone a declared key that is handed back, and only that', () => {
    const back = new Set(['ctrl+p'])
    const host = {
      keyOf: (e: KeyboardEvent) => (e.ctrlKey ? `ctrl+${e.key}` : null),
      takesKey: (k: string) => !back.has(k),
    }
    const leave = leaveAloneFor(host)
    const press = (key: string, ctrlKey = true) => new KeyboardEvent('keydown', { key, ctrlKey })
    expect(leave(press('p'))).toBe(true) // handed back: Stave's
    expect(leave(press('r'))).toBe(false) // Vim's
    expect(leave(press('j', false))).toBe(false) // not a declared key: Vim's to read
    back.delete('ctrl+p') // given to Vim, at once
    expect(leave(press('p'))).toBe(false)
  })

  function fakeEditor() {
    const listeners: ((e: { browserEvent: KeyboardEvent }) => void)[] = []
    return {
      onKeyDown(fn: (e: { browserEvent: KeyboardEvent }) => void) {
        listeners.push(fn)
        return { dispose: () => undefined }
      },
      fire(e: KeyboardEvent) {
        for (const fn of listeners) fn({ browserEvent: e })
      },
      getValue() {
        return this === editor ? 'bound' : 'unbound'
      },
      plain: 7,
    }
  }
  let editor: ReturnType<typeof fakeEditor>

  it('filters only the key events, and leaves everything else the editor itself', () => {
    editor = fakeEditor()
    const seen: string[] = []
    const view = keyFilteredEditor(editor as never, (e) => e.key === 'p')
    ;(view as unknown as typeof editor).onKeyDown((e) => seen.push(e.browserEvent.key))
    editor.fire(new KeyboardEvent('keydown', { key: 'r' }))
    editor.fire(new KeyboardEvent('keydown', { key: 'p' }))
    expect(seen).toEqual(['r'])
    const v = view as unknown as typeof editor
    // methods run on the real editor, so monaco-vim can call them detached
    const getValue = v.getValue
    expect(getValue()).toBe('bound')
    expect(v.plain).toBe(7)
  })
})

/**
 * Which command a name runs, the way Vim's command table finds it: the longest prefix of
 * what was typed that is a command's short name, whose full name starts with what was
 * typed. (Vim's own `matchCommand_`, over Stave's commands only.)
 */
function actionOf(typed: string): ExAction | null {
  const byPrefix = new Map(EX_COMMANDS.map(([name, prefix, action]) => [prefix, { name, action }]))
  for (let i = typed.length; i > 0; i--) {
    const hit = byPrefix.get(typed.slice(0, i))
    if (hit && hit.name.startsWith(typed)) return hit.action
  }
  return null
}

describe('the build (#2148): Vim is its own file, in each format', () => {
  it('the ESM build loads vim.js and the CommonJS build loads vim.cjs, and both are there', () => {
    const dist = path.resolve(__dirname, '../../../dist')
    const esm = readFileSync(path.join(dist, 'index.js'), 'utf8')
    const cjs = readFileSync(path.join(dist, 'index.cjs'), 'utf8')
    expect(esm).toMatch(/load: .*import\('\.\/vim\.js'\)/)
    expect(cjs).toMatch(/load: .*import\('\.\/vim\.cjs'\)/)
    // and neither main file carries monaco-vim itself
    expect(esm).not.toMatch(/defaultKeymap/)
    expect(cjs).not.toMatch(/defaultKeymap/)
    expect(existsSync(path.join(dist, 'vim.js'))).toBe(true)
    expect(existsSync(path.join(dist, 'vim.cjs'))).toBe(true)
  })
})

describe(':w, :q and friends, as VS Code’s Vim does them', () => {
  it('writing says Stave saves as you type; quitting closes this tab; quitting all closes every tab', () => {
    const expected: Record<string, ExAction> = {
      w: 'message', write: 'message', wa: 'message', wall: 'message', up: 'message', update: 'message',
      q: 'close', qu: 'close', quit: 'close', wq: 'close', x: 'close', xit: 'close', exi: 'close', exit: 'close',
      qa: 'closeAll', qall: 'closeAll', quita: 'closeAll', quitall: 'closeAll',
      wqa: 'closeAll', wqall: 'closeAll', xa: 'closeAll', xall: 'closeAll',
    }
    for (const [typed, action] of Object.entries(expected)) expect([typed, actionOf(typed)]).toEqual([typed, action])
    // each short name is a prefix of its name, as Vim's command table needs
    for (const [name, prefix] of EX_COMMANDS) expect(name.startsWith(prefix)).toBe(true)
    expect(SAVES_AS_YOU_TYPE).toBe('Stave saves as you type')
  })

  it('runs the action on the editor whose Vim ran it, and on no other', () => {
    vi.useFakeTimers()
    const log: string[] = []
    const actions = (id: string) => ({
      message: (t: string) => log.push(`${id} message ${t}`),
      close: () => log.push(`${id} close`),
      closeAll: () => log.push(`${id} closeAll`),
    })
    const a = {}
    const b = {}
    bindEditorActions(a, actions('a'))
    bindEditorActions(b, actions('b'))
    runExAction('message', a)
    runExAction('close', b)
    runExAction('closeAll', a)
    // the closes wait until Vim has finished handling the command
    expect(log).toEqual([`a message ${SAVES_AS_YOU_TYPE}`])
    vi.runAllTimers()
    expect(log).toEqual([`a message ${SAVES_AS_YOU_TYPE}`, 'b close', 'a closeAll'])
    // an untied Vim (its editor gone, or Vim switched off) does nothing
    bindEditorActions(b, null)
    runExAction('close', b)
    vi.runAllTimers()
    expect(log).toHaveLength(3)
    vi.useRealTimers()
  })
})

describe('Vim’s edges with Monaco (#2557)', () => {
  /** A model and the insert undo on it; `focus` says whether the editor has the keyboard. */
  function setup() {
    const model = new FakeUndoModel()
    const undo = new InsertUndo(() => model)
    const state = { focus: true }
    model.listeners.push((e) => undo.changed(e, state.focus))
    return { model, undo, state }
  }

  it('one u undoes one whole insert, and Ctrl+R puts it all back; Monaco’s own steps are kept', () => {
    const { model, undo } = setup()
    model.bracketed('x') // an earlier edit
    undo.enter()
    model.type('one two three')
    undo.exit()
    expect(model.steps).toBe(4) // Monaco's own steps are all still there
    undo.undo()
    expect(model.text).toBe('x')
    undo.redo()
    expect(model.text).toBe('xone two three')
    undo.undo()
    undo.undo() // no insert ends here: one step, the earlier edit
    expect(model.text).toBe('')
  })

  it('an insert begun by a command that edited (cw, o) undoes with that edit', () => {
    const { model, undo } = setup()
    model.bracketed('kick')
    const atKey = model.alt
    model.bracketed('-') // the `c` of `cw`, in the same key as the insert begins
    undo.enter(atKey)
    model.type('snare drum')
    undo.exit()
    undo.undo()
    expect(model.text).toBe('kick')
  })

  it('an edit from somewhere else in the middle of an insert stays a step of its own', () => {
    const { model, undo, state } = setup()
    undo.enter()
    model.type('typed')
    state.focus = false // a grid step clicked: the editor has lost the keyboard, insert mode stays
    model.bracketed('GRID')
    state.focus = true
    model.type(' typed2')
    undo.exit()
    undo.undo()
    expect(model.text).toBe('typedGRID') // the typing after the grid edit
    undo.undo()
    expect(model.text).toBe('typed') // the grid edit alone
    undo.undo()
    expect(model.text).toBe('') // the typing before it
    undo.redo()
    expect(model.text).toBe('typed')
    undo.redo()
    expect(model.text).toBe('typedGRID')
    undo.redo()
    expect(model.text).toBe('typedGRID typed2')
  })

  it('the grid’s own undo (Monaco’s) still takes back just the grid edit', () => {
    const { model, undo, state } = setup()
    undo.enter()
    model.type('typed')
    state.focus = false
    model.bracketed('GRID')
    model.undo() // Ctrl+Z from the grid: Monaco's undo, one step
    expect(model.text).toBe('typed')
  })

  it('redo after a new edit, or u where no insert ended, is one step', () => {
    const { model, undo } = setup()
    undo.enter()
    model.type('ab cd')
    undo.exit()
    undo.undo()
    expect(model.text).toBe('')
    model.bracketed('z') // a new edit: nothing to redo any more
    undo.redo()
    expect(model.text).toBe('z')
  })

  it('switching models forgets every insert', () => {
    const { model, undo } = setup()
    undo.enter()
    model.type('ab cd')
    undo.exit()
    undo.forget()
    undo.undo()
    expect(model.text).toBe('ab') // one of Monaco's steps, not the whole insert
  })

  it('a half-typed command is pending; nothing typed is not', () => {
    expect(hasPendingInput(undefined)).toBe(false)
    expect(hasPendingInput({ keyBuffer: [], prefixRepeat: [], motionRepeat: [], operator: null, registerName: null })).toBe(false)
    expect(hasPendingInput({ keyBuffer: '', operator: 'delete' })).toBe(true) // d
    expect(hasPendingInput({ keyBuffer: '2' })).toBe(true) // 2
    expect(hasPendingInput({ keyBuffer: 'g' })).toBe(true) // g
    expect(hasPendingInput({ prefixRepeat: ['3'] })).toBe(true) // 3 then an operator's count
    expect(hasPendingInput({ registerName: 'a' })).toBe(true) // "a
  })

  it('Esc, Ctrl+[ and Ctrl+C are Esc to Vim; nothing else is', () => {
    const k = (key: string, o: Partial<KeyboardEvent> = {}) => new KeyboardEvent('keydown', { key, ...o })
    expect(isVimEsc(k('Escape'))).toBe(true)
    expect(isVimEsc(k('[', { ctrlKey: true, code: 'BracketLeft' } as never))).toBe(true)
    expect(isVimEsc(k('c', { ctrlKey: true }))).toBe(true)
    expect(isVimEsc(k('c'))).toBe(false)
    expect(isVimEsc(k('[', { metaKey: true }))).toBe(false)
    expect(isVimEsc(k('c', { ctrlKey: true, metaKey: true }))).toBe(false)
    expect(isVimEsc(k('r', { ctrlKey: true }))).toBe(false)
  })

  it('the suggestion list is open only while Monaco shows it', () => {
    const root = document.createElement('div')
    const editor = { getDomNode: () => root }
    expect(suggestListOpen(editor as never)).toBe(false)
    const widget = document.createElement('div')
    widget.className = 'editor-widget suggest-widget'
    widget.style.display = 'none'
    widget.style.visibility = 'hidden'
    root.appendChild(widget)
    expect(suggestListOpen(editor as never)).toBe(false) // made, never shown
    widget.style.display = 'block'
    widget.style.visibility = 'inherit'
    expect(suggestListOpen(editor as never)).toBe(true)
    widget.style.visibility = 'hidden'
    expect(suggestListOpen(editor as never)).toBe(false) // shown, then hidden
    expect(suggestListOpen({ getDomNode: () => null } as never)).toBe(false)
  })

  it('switched off, each context key monaco-vim made is made again with no default, which removes it', () => {
    const made: [string, unknown][] = []
    removeContextKeys({ createContextKey: (k: string, v: unknown) => made.push([k, v]) } as never)
    expect(made).toEqual([['insertMode', undefined]])
    // the list is every key monaco-vim makes, read from the package itself
    const file = createRequire(import.meta.url).resolve('monaco-vim')
    const keys = [...readFileSync(file, 'utf8').matchAll(/createContextKey\(\s*"([^"]+)"/g)].map(([, k]) => k)
    expect(keys.length).toBeGreaterThan(0)
    expect([...VIM_CONTEXT_KEYS].sort()).toEqual([...new Set(keys)].sort())
  })

  it('the editor Vim is given: edits in a read-only editor say so first, and the model’s undo and redo are Vim’s', () => {
    const calls: string[] = []
    const model = { undo: () => calls.push('model.undo'), redo: () => calls.push('model.redo'), getValue: () => 'text' }
    const editor = {
      onKeyDown: () => ({ dispose: () => undefined }),
      executeEdits: () => (calls.push('executeEdits'), false),
      executeCommand: () => calls.push('executeCommand'),
      executeCommands: () => calls.push('executeCommands'),
      getModel: () => model,
    }
    type V = typeof editor
    const view = keyFilteredEditor(editor as never, () => false, { onEdit: () => calls.push('said') }) as unknown as V
    expect(view.executeEdits()).toBe(false) // the editor still answers (and refuses)
    view.executeCommand()
    view.executeCommands()
    expect(calls).toEqual(['said', 'executeEdits', 'said', 'executeCommand', 'said', 'executeCommands'])
    // undo and redo through the model Vim is given; everything else on it is the model's own
    calls.length = 0
    const hooked = keyFilteredEditor(editor as never, () => false, {
      undo: () => calls.push('vim.undo'),
      redo: () => calls.push('vim.redo'),
    }) as unknown as V
    const m = hooked.getModel()
    m.undo()
    m.redo()
    expect(m.getValue()).toBe('text')
    expect(hooked.getModel()).toBe(m) // the same model each time
    expect(calls).toEqual(['vim.undo', 'vim.redo'])
    // the real model, and an editor with no hooks, are untouched
    calls.length = 0
    model.undo()
    const plain = keyFilteredEditor(editor as never, () => false) as unknown as V
    plain.executeEdits()
    plain.getModel().undo()
    expect(calls).toEqual(['model.undo', 'executeEdits', 'model.undo'])
  })
})
