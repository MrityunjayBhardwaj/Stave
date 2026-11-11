/**
 * #2148 — the Vim extension's parts that need no live Monaco: its manifest (keys, handed
 * back by default), the bar it draws, the `>>`/`<<` edit, and the key filter that leaves a
 * handed-back key alone. Vim on a real editor is the browser spec's (`vim-extension.spec.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VIM, VIM_ID } from '../vim/manifest'
import { VimBar, modeLabel, VIM_MESSAGE_MS } from '../vim/bar'
import { shiftEdit } from '../vim/shiftCommand'
import { keyFilteredEditor, SAVE_COMMANDS, SAVES_AS_YOU_TYPE, vimModule } from '../vim/module'
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

  it('declares well-formed keys, Play, Stop, the palette, quick open and Ctrl+Z handed back by default', () => {
    expect(() => checkExtensionKeys(VIM)).not.toThrow()
    const back = (VIM.provides?.keys ?? []).filter((k) => k.givenBack).map((k) => keyId(k.key))
    expect(back.sort()).toEqual(['ctrl+.', 'ctrl+enter', 'ctrl+p', 'ctrl+shift+p', 'ctrl+z'].sort())
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
    const b = new VimBar(node, { focus } as never)
    return { node, b, focus, q: (sel: string) => node.querySelector(sel) as HTMLElement }
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

describe(':w and friends', () => {
  it('say that Stave saves as you type', () => {
    const names = SAVE_COMMANDS.map(([n]) => n)
    for (const n of ['write', 'quit', 'wq', 'xit', 'wall', 'qall']) expect(names).toContain(n)
    // each short name is a prefix of its name, as Vim's command table needs
    for (const [name, prefix] of SAVE_COMMANDS) expect(name.startsWith(prefix)).toBe(true)
    expect(SAVES_AS_YOU_TYPE).toBe('Stave saves as you type')
  })
})
