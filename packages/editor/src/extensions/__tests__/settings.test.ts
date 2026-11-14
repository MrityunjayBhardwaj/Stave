/**
 * #2556 — the settings extensions declare: checked when the list is read (a bad one is left
 * out and reported, not a crash), stored per person only where they differ from the
 * default, put back by deleting, heard through the host at once, and released on switch-off.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  checkExtensionSettings,
  declaredSettings,
  extensionSettings,
  extensionSettingValue,
  onExtensionSettingsChange,
  setExtensionSetting,
  settingProblems,
} from '../settings'
import { createCommonHost } from '../host'
import { createExtensionManager } from '../manager'
import { createExtensionRuntime } from '../runtime'
import { setCodeEditorErrorReport } from '../editors'
import { E2E_TONE } from '../e2eTone'
import type { ExtensionManifest, ExtensionSetting } from '../types'

const STORAGE = 'stave:extension-settings'

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

const ONE_OF_EACH: readonly ExtensionSetting[] = [
  { id: 'on', label: 'On', description: 'a switch', type: 'boolean', default: false },
  {
    id: 'mode',
    label: 'Mode',
    description: 'a choice',
    type: 'choice',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
    default: 'a',
  },
  { id: 'size', label: 'Size', description: 'a number', type: 'number', default: 12, min: 8, max: 32 },
  { id: 'word', label: 'Word', description: 'some text', type: 'text', default: 'hello' },
]

function manifest(settings: unknown = ONE_OF_EACH, id = 'zzset'): ExtensionManifest {
  return {
    id,
    name: 'Settings test',
    description: '',
    languages: '*',
    provides: { settings: settings as ExtensionSetting[] },
    load: async () => ({}),
  }
}

const stored = () => (store.has(STORAGE) ? JSON.parse(store.get(STORAGE)!) : null)

describe('declared settings are checked when the list is read', () => {
  it('a well-formed list of one of each type is kept whole, with no problems', () => {
    const m = manifest()
    expect(declaredSettings(m).map((s) => s.id)).toEqual(['on', 'mode', 'size', 'word'])
    expect(settingProblems(m)).toEqual([])
  })

  const bad: [string, unknown, RegExp][] = [
    ['an id that is not one', { id: '1x', label: 'L', description: '', type: 'boolean', default: true }, /id "1x"/],
    ['no label', { id: 'x', label: ' ', description: '', type: 'boolean', default: true }, /no label/],
    ['no description', { id: 'x', label: 'L', type: 'boolean', default: true }, /no description/],
    ['an unknown type', { id: 'x', label: 'L', description: '', type: 'colour', default: 'red' }, /type "colour"/],
    ['a boolean with a text default', { id: 'x', label: 'L', description: '', type: 'boolean', default: 'yes' }, /true or false/],
    ['text with a number default', { id: 'x', label: 'L', description: '', type: 'text', default: 3 }, /must be text/],
    ['a choice with no options', { id: 'x', label: 'L', description: '', type: 'choice', options: [], default: 'a' }, /no options/],
    ['a choice whose default is not an option', { id: 'x', label: 'L', description: '', type: 'choice', options: [{ value: 'a', label: 'A' }], default: 'b' }, /not one of its options/],
    ['a choice listing a value twice', { id: 'x', label: 'L', description: '', type: 'choice', options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }], default: 'a' }, /twice/],
    ['a number with a text default', { id: 'x', label: 'L', description: '', type: 'number', default: '3' }, /must be a number/],
    ['a number whose default is out of range', { id: 'x', label: 'L', description: '', type: 'number', default: 40, max: 32 }, /outside its own range/],
    ['a number with min above max', { id: 'x', label: 'L', description: '', type: 'number', default: 1, min: 5, max: 2 }, /min above its max/],
    ['something that is not a setting', 'nope', /not one/],
  ]
  for (const [what, setting, msg] of bad) {
    it(`leaves out ${what}, keeps the rest, and says why by name`, () => {
      const m = manifest([setting, ONE_OF_EACH[0]])
      expect(declaredSettings(m).map((s) => s.id)).toEqual(['on'])
      const problems = settingProblems(m)
      expect(problems).toHaveLength(1)
      expect(problems[0]).toMatch(msg)
      expect(problems[0]).toMatch(/Settings test extension/)
    })
  }

  it('keeps the first of two settings with one id', () => {
    const m = manifest([ONE_OF_EACH[0], { ...ONE_OF_EACH[0], label: 'Again' }])
    expect(declaredSettings(m)).toHaveLength(1)
    expect(declaredSettings(m)[0].label).toBe('On')
    expect(settingProblems(m)[0]).toMatch(/"on" twice/)
  })

  it('a list that is not a list is one problem and no settings', () => {
    const m = manifest({ on: true })
    expect(checkExtensionSettings(m)).toEqual({ settings: [], problems: [expect.stringMatching(/not as a list/)] })
  })

  it('the manager accepts `settings` as belonging to no language, and a bad one refuses nothing', () => {
    expect(() => createExtensionManager({ manifests: [manifest([{ id: 'x', type: 'nope' }])] })).not.toThrow()
  })

  it('the runtime reports each bad setting once, as a warning, when it starts', async () => {
    const report = vi.fn()
    const runtime = createExtensionRuntime({
      manifests: [manifest([{ id: 'x', label: 'L', description: '', type: 'boolean', default: 'no' }, ONE_OF_EACH[0]])],
      enabled: () => new Set(),
      subscribe: () => () => undefined,
    })
    await runtime.start({ report })
    await runtime.start({ report })
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0][0]).toBe('warn')
    expect(report.mock.calls[0][1]).toMatch(/Settings test extension's setting "x".*left out of Settings/)
  })

  it('the test extension declares one setting of each type, all well formed', () => {
    expect(declaredSettings(E2E_TONE).map((s) => s.type).sort()).toEqual(['boolean', 'choice', 'number', 'text'])
    expect(settingProblems(E2E_TONE)).toEqual([])
  })
})

describe('the person’s values', () => {
  it('an unset setting reads as its default, and nothing is stored', () => {
    const m = manifest()
    expect(extensionSettingValue(m, 'on')).toBe(false)
    expect(extensionSettingValue(m, 'mode')).toBe('a')
    expect(extensionSettingValue(m, 'size')).toBe(12)
    expect(extensionSettingValue(m, 'word')).toBe('hello')
    expect(extensionSettingValue(m, 'missing')).toBeUndefined()
    expect(extensionSettings(m).every((s) => s.isDefault)).toBe(true)
    expect(stored()).toBeNull()
  })

  it('only a value that differs from the default is stored', () => {
    const m = manifest()
    expect(setExtensionSetting(m, 'on', true)).toBe(true)
    expect(setExtensionSetting(m, 'size', 12)).toBe(true) // the default: nothing to store
    expect(setExtensionSetting(m, 'word', 'hello')).toBe(true)
    expect(stored()).toEqual({ zzset: { on: true } })
    expect(extensionSettingValue(m, 'on')).toBe(true)
    const states = Object.fromEntries(extensionSettings(m).map((s) => [s.setting.id, s]))
    expect(states.on).toMatchObject({ value: true, isDefault: false })
    expect(states.size).toMatchObject({ value: 12, isDefault: true })
  })

  it('setting a value back to the default deletes it, the same as reset', () => {
    const m = manifest()
    setExtensionSetting(m, 'mode', 'b')
    setExtensionSetting(m, 'word', 'bye')
    setExtensionSetting(m, 'mode', 'a')
    expect(stored()).toEqual({ zzset: { word: 'bye' } })
    setExtensionSetting(m, 'word', null)
    expect(stored()).toBeNull()
    expect(extensionSettingValue(m, 'word')).toBe('hello')
  })

  it('an unchanged value follows a changed default; a changed one keeps the person’s value', () => {
    const v1 = manifest()
    setExtensionSetting(v1, 'word', 'mine')
    // a new version of the extension changes both defaults
    const v2 = manifest(ONE_OF_EACH.map((s) => (s.id === 'size' ? { ...s, default: 16 } : s.id === 'word' ? { ...s, default: 'hi' } : s)))
    expect(extensionSettingValue(v2, 'size')).toBe(16)
    expect(extensionSettingValue(v2, 'word')).toBe('mine')
  })

  it('refuses a value that does not fit: the wrong kind, not an option, out of range; and an undeclared setting', () => {
    const m = manifest()
    expect(setExtensionSetting(m, 'on', 'yes')).toBe(false)
    expect(setExtensionSetting(m, 'mode', 'c')).toBe(false)
    expect(setExtensionSetting(m, 'size', 40)).toBe(false)
    expect(setExtensionSetting(m, 'size', Number.NaN)).toBe(false)
    expect(setExtensionSetting(m, 'nope', true)).toBe(false)
    expect(stored()).toBeNull()
  })

  it('a stored value that no longer fits its setting reads as the default', () => {
    store.set(STORAGE, JSON.stringify({ zzset: { mode: 'gone', size: 99, on: 'x', word: 5 } }))
    const m = manifest()
    expect(extensionSettingValue(m, 'mode')).toBe('a')
    expect(extensionSettingValue(m, 'size')).toBe(12)
    expect(extensionSettingValue(m, 'on')).toBe(false)
    expect(extensionSettingValue(m, 'word')).toBe('hello')
    expect(extensionSettings(m).every((s) => s.isDefault)).toBe(true)
  })

  it('unreadable storage reads as the defaults', () => {
    store.set(STORAGE, '{not json')
    expect(extensionSettingValue(manifest(), 'size')).toBe(12)
  })

  it('a value that cannot be saved holds for this page', () => {
    refuse = true
    const m = manifest()
    setExtensionSetting(m, 'size', 20)
    expect(extensionSettingValue(m, 'size')).toBe(20)
    expect(stored()).toBeNull()
    refuse = false
    setExtensionSetting(m, 'size', null)
  })

  it('two extensions keep their values apart', () => {
    const a = manifest(ONE_OF_EACH, 'zza')
    const b = manifest(ONE_OF_EACH, 'zzb')
    setExtensionSetting(a, 'on', true)
    expect(extensionSettingValue(b, 'on')).toBe(false)
    expect(stored()).toEqual({ zza: { on: true } })
  })

  it('listeners hear a change made here and in another tab, and not after unsubscribing', () => {
    const m = manifest()
    const fn = vi.fn()
    const off = onExtensionSettingsChange(fn)
    setExtensionSetting(m, 'on', true)
    expect(fn).toHaveBeenCalledTimes(1)
    setExtensionSetting(m, 'on', true) // no change: no call
    expect(fn).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE }))
    expect(fn).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new StorageEvent('storage', { key: 'stave:keybindings' }))
    expect(fn).toHaveBeenCalledTimes(2)
    off()
    setExtensionSetting(m, 'on', false)
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE }))
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('through the host', () => {
  it('get reads the current value; an undeclared setting throws by name', () => {
    const m = manifest()
    const rec = createCommonHost(m.id, { manifest: m })
    expect(rec.host.settings.get('size')).toBe(12)
    setExtensionSetting(m, 'size', 20)
    expect(rec.host.settings.get('size')).toBe(20)
    expect(() => rec.host.settings.get('nope')).toThrow(/Settings test extension reads the setting "nope", which it does not declare/)
    setExtensionSetting(m, 'size', null)
  })

  it('onChange hears each setting whose value moved, with the new value, at once', () => {
    const m = manifest()
    const rec = createCommonHost(m.id, { manifest: m })
    const heard: [string, unknown][] = []
    rec.host.settings.onChange((id, v) => heard.push([id, v]))
    setExtensionSetting(m, 'mode', 'b')
    setExtensionSetting(m, 'size', 30)
    setExtensionSetting(m, 'size', null)
    expect(heard).toEqual([
      ['mode', 'b'],
      ['size', 30],
      ['size', 12],
    ])
    // another extension's change is not this one's
    setExtensionSetting(manifest(ONE_OF_EACH, 'zzother'), 'on', true)
    expect(heard).toHaveLength(3)
    rec.undo()
  })

  it('onChange hears a change from another tab', () => {
    const m = manifest()
    const rec = createCommonHost(m.id, { manifest: m })
    const fn = vi.fn()
    rec.host.settings.onChange(fn)
    store.set(STORAGE, JSON.stringify({ zzset: { word: 'from the other tab' } }))
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE }))
    expect(fn).toHaveBeenCalledWith('word', 'from the other tab')
    rec.undo()
  })

  it('switching off releases every listener; registering after is refused', () => {
    const m = manifest()
    const rec = createCommonHost(m.id, { manifest: m })
    const fn = vi.fn()
    rec.host.settings.onChange(fn)
    expect(rec.undo()).toEqual([])
    setExtensionSetting(m, 'on', true)
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE }))
    expect(fn).not.toHaveBeenCalled()
    expect(() => rec.host.settings.onChange(fn)).toThrow(/switched off/)
    setExtensionSetting(m, 'on', null)
  })

  it('the returned release stops one listener early', () => {
    const m = manifest()
    const rec = createCommonHost(m.id, { manifest: m })
    const fn = vi.fn()
    const release = rec.host.settings.onChange(fn)
    release()
    setExtensionSetting(m, 'on', true)
    expect(fn).not.toHaveBeenCalled()
    rec.undo()
    setExtensionSetting(m, 'on', null)
  })

  it('a listener that throws is reported by name; the change still lands and the others still hear', () => {
    const errors: unknown[] = []
    setCodeEditorErrorReport((e) => errors.push(e))
    try {
      const m = manifest()
      const rec = createCommonHost(m.id, { manifest: m })
      const after = vi.fn()
      rec.host.settings.onChange(() => {
        throw new Error('boom')
      })
      rec.host.settings.onChange(after)
      expect(setExtensionSetting(m, 'on', true)).toBe(true)
      expect(extensionSettingValue(m, 'on')).toBe(true)
      expect(after).toHaveBeenCalledWith('on', true)
      expect(String((errors[0] as Error).message)).toMatch(/Settings test extension could not take the new value of its setting "on": boom/)
      rec.undo()
      setExtensionSetting(m, 'on', null)
    } finally {
      setCodeEditorErrorReport(null)
    }
  })

  it('through the manager: the extension’s own listener runs while on, and is gone once switched off', async () => {
    const heard: unknown[] = []
    const m: ExtensionManifest = {
      ...manifest(),
      load: async () => ({
        activate(host) {
          host.settings.onChange((id, v) => heard.push([id, v]))
        },
      }),
    }
    const manager = createExtensionManager({ manifests: [m] })
    await manager.activate(m.id)
    setExtensionSetting(m, 'word', 'on now')
    expect(heard).toEqual([['word', 'on now']])
    manager.deactivate(m.id)
    setExtensionSetting(m, 'word', 'off now')
    expect(heard).toHaveLength(1)
    setExtensionSetting(m, 'word', null)
  })
})
