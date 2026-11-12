/**
 * #2513 — declared keys: checked when the list is read, handed back per extension (kept
 * apart from the person's shortcuts), and the keys switched-on extensions take in the code.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  keyId,
  checkExtensionKeys,
  isExtensionKeyGivenBack,
  setExtensionKeyGivenBack,
  onExtensionKeysChange,
  extensionKeys,
  keysTakenBy,
} from '../keys'
import { createExtensionManager } from '../manager'
import { createExtensionRuntime, extensionKeysInCode, hasActiveExtensions } from '../runtime'
import { createCommonHost } from '../host'
import { createCodeEditorList } from '../editors'
import type { ExtensionKey, ExtensionManifest } from '../types'

// a Map-backed localStorage per test, as enablement.test.ts does; `refuse` makes writes throw
let store: Map<string, string>
let refuse = false
beforeEach(() => {
  store = new Map()
  refuse = false
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return store.size
      },
      clear: () => store.clear(),
      getItem: (k: string) => store.get(k) ?? null,
      key: (i: number) => [...store.keys()][i] ?? null,
      removeItem: (k: string) => void store.delete(k),
      setItem: (k: string, v: string) => {
        if (refuse) throw new Error('quota')
        store.set(k, String(v))
      },
    },
  })
})

/** A test-only Vim-like manifest: Ctrl+R its own, Ctrl+Z handed back by default. */
function vimLike(keys: readonly ExtensionKey[] = [
  { key: 'ctrl+r', name: 'Redo', where: 'code' },
  { key: 'ctrl+z', name: 'Undo', where: 'code', givenBack: true },
]): ExtensionManifest {
  return { id: 'zzvim', name: 'Vim test', description: '', languages: '*', provides: { keys }, load: async () => ({}) }
}

describe('keyId', () => {
  it('resolves aliases and orders modifiers', () => {
    expect(keyId('R+Ctrl')).toBe('ctrl+r')
    expect(keyId('control+r')).toBe('ctrl+r')
    expect(keyId('shift+cmd+p')).toBe('mod+shift+p')
    expect(keyId('option+meta+k')).toBe('mod+alt+k')
    expect(keyId('escape')).toBe('escape')
  })
  it('is null for what is not one chord', () => {
    for (const bad of ['', '  ', 'mod+k z', 'ctrl+', '+r', 'ctrl+shift', 'a+b', 'ctrl+ctrl+r', 'ctrl+control+r']) {
      expect(keyId(bad), bad).toBeNull()
    }
  })
})

describe('declared keys are checked when the list is read', () => {
  const refused = (keys: unknown, msg: RegExp) =>
    expect(() =>
      createExtensionManager({ manifests: [vimLike(keys as ExtensionKey[])] }),
    ).toThrow(msg)

  it('a well-formed list is accepted, and `keys` needs no language', () => {
    expect(() => createExtensionManager({ manifests: [vimLike()] })).not.toThrow()
  })
  it('refuses a key that is not one chord', () => refused([{ key: 'mod+k z', name: 'X', where: 'code' }], /not one key/))
  it('refuses a key declared twice, however it is spelled', () =>
    refused([{ key: 'ctrl+r', name: 'A', where: 'code' }, { key: 'R+control', name: 'B', where: 'code' }], /twice/))
  it('refuses a key without a name', () => refused([{ key: 'ctrl+r', name: ' ', where: 'code' }], /without saying what it does/))
  it('refuses a place other than the code', () => refused([{ key: 'ctrl+r', name: 'Redo', where: 'everywhere' }], /only be declared for the code/))
  it('refuses a givenBack that is not true or false', () => refused([{ key: 'ctrl+r', name: 'Redo', where: 'code', givenBack: 'yes' }], /true or false/))
  it('refuses keys that are not a list', () => refused({ key: 'ctrl+r' }, /not as a list/))
  it('checkExtensionKeys accepts a manifest with no keys', () => {
    expect(() => checkExtensionKeys({ ...vimLike(), provides: {} })).not.toThrow()
  })
})

describe('handing keys back', () => {
  it('defaults to the manifest, and the person\'s choice wins; null goes back to the default', () => {
    const m = vimLike()
    expect(isExtensionKeyGivenBack(m, 'ctrl+r')).toBe(false)
    expect(isExtensionKeyGivenBack(m, 'ctrl+z')).toBe(true)
    setExtensionKeyGivenBack('zzvim', 'ctrl+r', true)
    setExtensionKeyGivenBack('zzvim', 'Control+Z', false)
    expect(isExtensionKeyGivenBack(m, 'ctrl+r')).toBe(true)
    expect(isExtensionKeyGivenBack(m, 'ctrl+z')).toBe(false)
    setExtensionKeyGivenBack('zzvim', 'ctrl+r', null)
    expect(isExtensionKeyGivenBack(m, 'ctrl+r')).toBe(false)
  })

  it('an undeclared key reads as handed back: never the extension\'s', () => {
    expect(isExtensionKeyGivenBack(vimLike(), 'ctrl+d')).toBe(true)
    setExtensionKeyGivenBack('zzvim', 'ctrl+d', false)
    expect(isExtensionKeyGivenBack(vimLike(), 'ctrl+d')).toBe(true)
  })

  it('is stored under its own key, never in the person\'s shortcuts', () => {
    store.set('stave:keybindings', '{"stave.sidebar":"mod+b"}')
    setExtensionKeyGivenBack('zzvim', 'ctrl+r', true)
    expect(JSON.parse(store.get('stave:extension-keys')!)).toEqual({ zzvim: { 'ctrl+r': true } })
    expect(store.get('stave:keybindings')).toBe('{"stave.sidebar":"mod+b"}')
    setExtensionKeyGivenBack('zzvim', 'ctrl+r', null)
    expect(JSON.parse(store.get('stave:extension-keys')!)).toEqual({})
  })

  it('listeners hear a change, and only a change', () => {
    const fn = vi.fn()
    const off = onExtensionKeysChange(fn)
    setExtensionKeyGivenBack('zzvim', 'ctrl+r', true)
    setExtensionKeyGivenBack('zzvim', 'ctrl+r', true)
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    setExtensionKeyGivenBack('zzvim', 'ctrl+r', false)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('unreadable storage reads as the defaults', () => {
    store.set('stave:extension-keys', 'not json')
    expect(isExtensionKeyGivenBack(vimLike(), 'ctrl+z')).toBe(true)
    store.set('stave:extension-keys', '{"zzvim":{"ctrl+z":"no"}}')
    expect(isExtensionKeyGivenBack(vimLike(), 'ctrl+z')).toBe(true)
  })

  it('parses the stored text once while it is unchanged, and again when it changes (another tab)', () => {
    store.set('stave:extension-keys', '{"zzvim":{"ctrl+r":true}}')
    const parse = vi.spyOn(JSON, 'parse')
    try {
      for (let i = 0; i < 20; i++) expect(isExtensionKeyGivenBack(vimLike(), 'ctrl+r')).toBe(true)
      expect(parse.mock.calls.length).toBeLessThanOrEqual(1)
      store.set('stave:extension-keys', '{"zzvim":{"ctrl+r":false}}')
      expect(isExtensionKeyGivenBack(vimLike(), 'ctrl+r')).toBe(false)
    } finally {
      parse.mockRestore()
    }
  })

  it('extensionKeys lists each key with where it goes now and its default', () => {
    setExtensionKeyGivenBack('zzvim', 'ctrl+z', false)
    expect(extensionKeys(vimLike())).toEqual([
      { key: 'ctrl+r', name: 'Redo', where: 'code', givenBack: false, givenBackByDefault: false },
      { key: 'ctrl+z', name: 'Undo', where: 'code', givenBack: false, givenBackByDefault: true },
    ])
  })
})

describe('the keys taken in the code', () => {
  it('keysTakenBy lists the declared keys not handed back', () => {
    expect(keysTakenBy([vimLike()])).toEqual([{ extensionId: 'zzvim', extensionName: 'Vim test', key: 'ctrl+r', name: 'Redo' }])
    setExtensionKeyGivenBack('zzvim', 'ctrl+r', true)
    expect(keysTakenBy([vimLike()])).toEqual([])
  })

  it('only while the extension is on: switched off, it takes no keys', async () => {
    let ids = new Set<string>()
    const subs = new Set<(ids: ReadonlySet<string>) => void>()
    const runtime = createExtensionRuntime({
      manifests: [vimLike()],
      enabled: () => ids,
      subscribe: (fn) => {
        subs.add(fn)
        return () => subs.delete(fn)
      },
    })
    await runtime.start({ report: () => undefined })
    expect(hasActiveExtensions(runtime)).toBe(false)
    expect(extensionKeysInCode(runtime)).toEqual([])
    ids = new Set(['zzvim'])
    for (const fn of subs) fn(ids)
    await runtime.start({ report: () => undefined })
    expect(hasActiveExtensions(runtime)).toBe(true)
    expect(extensionKeysInCode(runtime).map((k) => k.key)).toEqual(['ctrl+r'])
    ids = new Set()
    for (const fn of subs) fn(ids)
    await runtime.start({ report: () => undefined })
    expect(extensionKeysInCode(runtime)).toEqual([])
  })

  it('host.takesKey: declared and not handed back, asked at the moment, false once switched off', () => {
    const rec = createCommonHost('zzvim', { manifest: vimLike(), editors: createCodeEditorList() })
    expect(rec.host.takesKey('ctrl+r')).toBe(true)
    expect(rec.host.takesKey('control+R')).toBe(true)
    expect(rec.host.takesKey('ctrl+z')).toBe(false)
    expect(rec.host.takesKey('ctrl+d')).toBe(false)
    setExtensionKeyGivenBack('zzvim', 'ctrl+r', true)
    expect(rec.host.takesKey('ctrl+r')).toBe(false)
    setExtensionKeyGivenBack('zzvim', 'ctrl+r', null)
    rec.undo()
    expect(rec.host.takesKey('ctrl+r')).toBe(false)
  })

  it('host.keyOf (#2148): the declared key a keystroke is, through the matcher the entry hands in', async () => {
    const { setKeyEventMatcher } = await import('../keys')
    const { chordFromEvent, chordMatches } = await import('../../keys/chord')
    const rec = createCommonHost('zzvim', { manifest: vimLike(), editors: createCodeEditorList() })
    const press = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init)
    // no matcher handed in yet: no keystroke is any declared key
    setKeyEventMatcher(null)
    expect(rec.host.keyOf(press({ key: 'r', code: 'KeyR', ctrlKey: true }))).toBeNull()
    // off a Mac, Ctrl+R is the declared `ctrl+r`; on a Mac it is Control+R, and ⌘R is not it
    setKeyEventMatcher((e, k) => chordMatches(chordFromEvent(e, { isMac: false }), k, { isMac: false }))
    expect(rec.host.keyOf(press({ key: 'r', code: 'KeyR', ctrlKey: true }))).toBe('ctrl+r')
    expect(rec.host.keyOf(press({ key: 'z', code: 'KeyZ', ctrlKey: true }))).toBe('ctrl+z')
    expect(rec.host.keyOf(press({ key: 'r', code: 'KeyR' }))).toBeNull()
    expect(rec.host.keyOf(press({ key: 'x', code: 'KeyX', ctrlKey: true }))).toBeNull()
    setKeyEventMatcher((e, k) => chordMatches(chordFromEvent(e, { isMac: true }), k, { isMac: true }))
    expect(rec.host.keyOf(press({ key: 'r', code: 'KeyR', ctrlKey: true }))).toBe('ctrl+r')
    expect(rec.host.keyOf(press({ key: 'r', code: 'KeyR', metaKey: true }))).toBeNull()
    // a matcher that throws for one key skips that key only: the keys after it still match
    setKeyEventMatcher((e, k) => {
      if (k === 'ctrl+r') throw new Error('cannot read this one')
      return chordMatches(chordFromEvent(e, { isMac: false }), k, { isMac: false })
    })
    expect(rec.host.keyOf(press({ key: 'z', code: 'KeyZ', ctrlKey: true }))).toBe('ctrl+z')
    expect(rec.host.keyOf(press({ key: 'r', code: 'KeyR', ctrlKey: true }))).toBeNull()
    // a matcher that throws is no key, never a throw into the extension
    setKeyEventMatcher(() => {
      throw new Error('broken')
    })
    expect(rec.host.keyOf(press({ key: 'r', code: 'KeyR', ctrlKey: true }))).toBeNull()
    setKeyEventMatcher(null)
    rec.undo()
  })

  // last: a refused save leaves its choice held in this page only
  it('a choice that cannot be saved holds for this page', () => {
    refuse = true
    setExtensionKeyGivenBack('zzvim', 'ctrl+r', true)
    expect(isExtensionKeyGivenBack(vimLike(), 'ctrl+r')).toBe(true)
    expect(store.has('stave:extension-keys')).toBe(false)
    refuse = false
    setExtensionKeyGivenBack('zzvim', 'ctrl+r', null)
    expect(isExtensionKeyGivenBack(vimLike(), 'ctrl+r')).toBe(false)
  })
})
