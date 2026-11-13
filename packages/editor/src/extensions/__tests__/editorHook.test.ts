/**
 * #2513 — `host.onEditor`: every live code editor, once each, undone on the editor's own
 * dispose event and on switch-off; each extension's own strip in the bar under the editor.
 *
 * Driven through the manager with a test-only editor extension (never in the shipped
 * list) over a list of stub editors: a stub editor is what `offer` needs, an object with
 * `onDidDispose`, and `dispose()` fires it, as Monaco's does.
 */
import { describe, it, expect, vi } from 'vitest'
import { createCodeEditorList, type CodeEditorList, type CodeEditorSite } from '../editors'
import { createExtensionManager } from '../manager'
import { createCommonHost } from '../host'
import type { CodeEditor, ExtensionManifest, ExtensionModule } from '../types'

/** A Monaco editor as far as the list cares: its own dispose event. */
function stubEditor() {
  const listeners = new Set<() => void>()
  return {
    onDidDispose(fn: () => void) {
      listeners.add(fn)
      return { dispose: () => listeners.delete(fn) }
    },
    dispose() {
      for (const fn of [...listeners]) fn()
      listeners.clear()
    },
    listeners,
  }
}

type Stub = ReturnType<typeof stubEditor>

/** Offer one editor: a stub, its bar in the document, and the site. */
function openEditor(list: CodeEditorList, over: Partial<CodeEditorSite> = {}) {
  const editor = stubEditor()
  const bar = document.createElement('div')
  bar.setAttribute('data-editor-bar', '')
  document.body.appendChild(bar)
  const site: CodeEditorSite = {
    editor: editor as unknown as CodeEditorSite['editor'],
    monaco: {} as CodeEditorSite['monaco'],
    readOnly: false,
    bar,
    language: () => 'strudel',
    ...over,
  }
  const withdraw = list.offer(site)
  return { editor, bar, site, withdraw }
}

/** A test-only editor extension that counts what happens to each editor. */
function editorExtension(log: { attach: number; detach: number; seen: CodeEditor[] }, opts: { useBar?: boolean } = {}): ExtensionManifest {
  const mod: ExtensionModule = {
    activate(host) {
      host.onEditor((ed) => {
        log.attach++
        log.seen.push(ed)
        if (opts.useBar) ed.bar.textContent = '-- NORMAL --'
        return () => {
          log.detach++
        }
      })
    },
  }
  return {
    id: 'zzedit',
    name: 'Editor test',
    description: 'follows code editors',
    languages: '*',
    load: async () => mod,
  }
}

const freshLog = () => ({ attach: 0, detach: 0, seen: [] as CodeEditor[] })

describe('the live code editor list', () => {
  it('pairs every call with one cleanup: on the editor\'s own dispose, and on stop', () => {
    const list = createCodeEditorList()
    const a = openEditor(list)
    const calls: string[] = []
    const stop = list.watch((site) => {
      const name = site === a.site ? 'a' : 'b'
      calls.push(`+${name}`)
      return () => calls.push(`-${name}`)
    })
    const b = openEditor(list)
    expect(calls).toEqual(['+a', '+b'])
    b.editor.dispose()
    expect(calls).toEqual(['+a', '+b', '-b'])
    expect(list.size()).toBe(1)
    stop()
    expect(calls).toEqual(['+a', '+b', '-b', '-a'])
    stop()
    a.editor.dispose()
    expect(calls).toEqual(['+a', '+b', '-b', '-a'])
    expect(list.size()).toBe(0)
  })

  it('withdrawing twice, or after dispose, undoes once, and lets go of the dispose listener', () => {
    const list = createCodeEditorList()
    const a = openEditor(list)
    let undone = 0
    list.watch(() => () => void undone++)
    a.withdraw()
    a.withdraw()
    a.editor.dispose()
    expect(undone).toBe(1)
    expect(a.editor.listeners.size).toBe(0)
  })

  it('offering the same editor twice follows it once', () => {
    const list = createCodeEditorList()
    const a = openEditor(list)
    let calls = 0
    list.watch(() => void calls++)
    expect(list.offer(a.site)).toBe(a.withdraw)
    expect(calls).toBe(1)
  })

  it('a watcher that throws is reported; the other watchers and editors still go on', () => {
    const errors: unknown[] = []
    const list = createCodeEditorList({ onError: (e) => errors.push(e) })
    let good = 0
    list.watch(() => {
      throw new Error('boom')
    })
    list.watch(() => void good++)
    openEditor(list)
    openEditor(list)
    expect(good).toBe(2)
    expect(errors).toHaveLength(2)
  })
})

describe('host.onEditor through the manager', () => {
  it('an extension switched on while editors are open gets them at once, and later ones too', async () => {
    const editors = createCodeEditorList()
    openEditor(editors)
    openEditor(editors)
    const log = freshLog()
    const m = createExtensionManager({ manifests: [editorExtension(log)], editors })
    await m.activate('zzedit')
    expect(log.attach).toBe(2)
    openEditor(editors)
    expect(log.attach).toBe(3)
  })

  it('attach and detach pair up across tab switches, splits and the history view, never more than the live editors', async () => {
    const editors = createCodeEditorList()
    const log = freshLog()
    const m = createExtensionManager({ manifests: [editorExtension(log)], editors })
    await m.activate('zzedit')
    const live = () => log.attach - log.detach
    const open: Stub[] = []
    const check = () => expect(live()).toBe(editors.size())
    // a tab: open, then switch tabs (the editor is disposed and a new one made) five times
    let tab = openEditor(editors).editor
    for (let i = 0; i < 5; i++) {
      tab.dispose()
      tab = openEditor(editors).editor
      check()
    }
    // a split: a second editor of the SAME file is its own editor here
    open.push(openEditor(editors).editor)
    check()
    expect(live()).toBe(2)
    // the history view opens (read-only), then closes
    const history = openEditor(editors, { readOnly: true }).editor
    expect(log.seen.at(-1)!.readOnly).toBe(true)
    check()
    history.dispose()
    check()
    for (const e of open) e.dispose()
    tab.dispose()
    expect(live()).toBe(0)
    expect(log.attach).toBe(log.detach)
    expect(log.attach).toBe(8)
  })

  it('switching off undoes every editor, removes its bar strips, and leaves no dispose listener', async () => {
    const editors = createCodeEditorList()
    const a = openEditor(editors)
    const b = openEditor(editors)
    const listenersBefore = a.editor.listeners.size
    const log = freshLog()
    const m = createExtensionManager({ manifests: [editorExtension(log, { useBar: true })], editors })
    await m.activate('zzedit')
    expect(a.bar.querySelectorAll('[data-extension-bar="zzedit"]')).toHaveLength(1)
    expect(a.bar.textContent).toBe('-- NORMAL --')
    expect(m.deactivate('zzedit')).toEqual([])
    expect(log.detach).toBe(2)
    expect(a.bar.childNodes).toHaveLength(0)
    expect(b.bar.childNodes).toHaveLength(0)
    // the list's own dispose listener stays (the editor is still live); the extension added none
    expect(a.editor.listeners.size).toBe(listenersBefore)
    // a new editor after switch-off is not followed
    openEditor(editors)
    expect(log.attach).toBe(2)
  })

  it('the bar stays empty until an extension reads it, and an editor that closes takes its strip', async () => {
    const editors = createCodeEditorList()
    const quiet = openEditor(editors)
    const log = freshLog()
    const m = createExtensionManager({ manifests: [editorExtension(log)], editors })
    await m.activate('zzedit')
    expect(quiet.bar.childNodes).toHaveLength(0)
    const strip = log.seen[0].bar
    expect(quiet.bar.contains(strip)).toBe(true)
    expect(log.seen[0].bar).toBe(strip)
    quiet.editor.dispose()
    expect(quiet.bar.childNodes).toHaveLength(0)
    // a late read after the cleanup gets an element that is not in the bar
    expect(quiet.bar.contains(log.seen[0].bar)).toBe(false)
  })

  it('gives the editor, the namespace, read-only, and the language read when asked', async () => {
    const editors = createCodeEditorList()
    let lang: 'strudel' | 'hydra' = 'strudel'
    const a = openEditor(editors, { language: () => lang })
    const log = freshLog()
    const m = createExtensionManager({ manifests: [editorExtension(log)], editors })
    await m.activate('zzedit')
    const ed = log.seen[0]
    expect(ed.editor).toBe(a.site.editor)
    expect(ed.monaco).toBe(a.site.monaco)
    expect(ed.readOnly).toBe(false)
    expect(ed.language).toBe('strudel')
    lang = 'hydra'
    expect(ed.language).toBe('hydra')
  })

  it('a cleanup may be a disposable', () => {
    const editors = createCodeEditorList()
    const a = openEditor(editors)
    const rec = createCommonHost('zzd', { editors })
    const dispose = vi.fn()
    rec.host.onEditor(() => ({ dispose }))
    a.editor.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
    rec.undo()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('a callback that throws on one editor is reported under the extension\'s name; others still get it', () => {
    const errors: unknown[] = []
    const editors = createCodeEditorList({ onError: (e) => errors.push(e) })
    const bad = openEditor(editors)
    const good = openEditor(editors)
    const rec = createCommonHost('zzthrow', { editors, manifest: { id: 'zzthrow', name: 'Thrower', description: '', languages: '*', load: async () => ({}) } })
    const got: unknown[] = []
    rec.host.onEditor((ed) => {
      if (ed.editor === bad.site.editor) {
        void ed.bar
        throw new Error('no')
      }
      got.push(ed.editor)
    })
    expect(got).toEqual([good.site.editor])
    expect(String((errors[0] as Error).message)).toBe('The Thrower extension could not set up a code editor: no')
    // the strip it made before throwing is gone
    expect(bad.bar.childNodes).toHaveLength(0)
  })

  it('onEditor after switch-off is refused', () => {
    const rec = createCommonHost('zzoff', { editors: createCodeEditorList() })
    rec.undo()
    expect(() => rec.host.onEditor(() => undefined)).toThrow(/switched off/)
  })
})
