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
import { hasPendingInput, oneUndoPerInsert, removeContextKeys, suggestListOpen, VIM_CONTEXT_KEYS } from '../vim/edges'
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
  /** A model whose undo stack is a list of steps, closed by `pushStackElement` as Monaco's is. */
  class FakeModel {
    steps: string[][] = []
    open = false
    pushStackElement() {
      this.open = false
    }
    popStackElement() {
      if (this.steps.length) this.open = true
    }
    /** What Monaco's typing does: close the step at a word/space boundary, then edit. */
    type(text: string) {
      for (const ch of text) {
        if (ch === ' ' || ch === '\n') this.pushStackElement()
        this.edit(ch)
      }
    }
    edit(ch: string) {
      if (!this.open) {
        this.steps.push([])
        this.open = true
      }
      this.steps[this.steps.length - 1].push(ch)
    }
  }

  it('one insert is one undo step, however Monaco closes steps while it is typed', () => {
    const model = new FakeModel()
    const undo = oneUndoPerInsert({ getModel: () => model as never })
    model.type('x') // an earlier edit
    undo.enter(false)
    model.type('one two\nthree')
    undo.exit()
    expect(model.steps).toEqual([['x'], [...'one two\nthree']])
    // the model's own pushStackElement is back
    expect(Object.prototype.hasOwnProperty.call(model, 'pushStackElement')).toBe(false)
    // and the insert's step is closed: the next edit, even with no boundary, is a step of its own
    model.edit('z')
    expect(model.steps).toEqual([['x'], [...'one two\nthree'], ['z']])
  })

  it('an insert begun by a command that edited (cw, o) joins that edit', () => {
    const model = new FakeModel()
    const undo = oneUndoPerInsert({ getModel: () => model as never })
    model.edit('-') // the `c` of `cw` deleting a word
    model.pushStackElement() // monaco-vim closes it
    undo.enter(true)
    model.type('new word')
    undo.exit()
    expect(model.steps).toEqual([['-', ...'new word']])
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

  it('in a read-only editor, each edit Vim sends says so first; nothing else does', () => {
    const calls: string[] = []
    const editor = {
      onKeyDown: () => ({ dispose: () => undefined }),
      executeEdits: () => (calls.push('executeEdits'), false),
      executeCommand: () => calls.push('executeCommand'),
      executeCommands: () => calls.push('executeCommands'),
      getValue: () => 'text',
    }
    const view = keyFilteredEditor(editor as never, () => false, () => calls.push('said')) as unknown as typeof editor
    expect(view.executeEdits()).toBe(false) // the editor still answers (and refuses)
    view.executeCommand()
    view.executeCommands()
    view.getValue()
    expect(calls).toEqual(['said', 'executeEdits', 'said', 'executeCommand', 'said', 'executeCommands'])
    // an editor that can be edited is left as it is
    calls.length = 0
    const plain = keyFilteredEditor(editor as never, () => false) as unknown as typeof editor
    plain.executeEdits()
    expect(calls).toEqual(['executeEdits'])
  })
})
