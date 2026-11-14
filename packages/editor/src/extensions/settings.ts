/**
 * The settings extensions declare (#2556), and the values the person gives them.
 *
 * An extension lists its settings in its manifest (`provides.settings`), the way a VS Code
 * extension lists `contributes.configuration`. Stave draws them in Settings › Extensions;
 * the extension reads them through its host (`host.settings`, in `host.ts`). Two things
 * follow from that list, both here:
 *
 *  - CHECKED WHEN THE LIST IS READ (`checkExtensionSettings`): a setting without an id, a
 *    label or a description, an id given twice, an unknown type, a default of the wrong
 *    kind, a choice with no options or a default that is not one of them, a number whose
 *    default is outside its own range. Unlike a bad key, a bad setting does not refuse the
 *    extension: it is left out (`declaredSettings` gives only the well-formed ones) and the
 *    runtime reports it on the Console under the extension's name (`settingProblems`).
 *  - THE PERSON'S VALUES: per extension and per setting, kept in localStorage under
 *    `stave:extension-settings`, the same way the handed-back keys are (`keys.ts`). Only a
 *    value that differs from the default is stored: a value the person never changed (or
 *    put back) follows the manifest's default, so a new default reaches them. A stored
 *    value that no longer fits its setting (a choice since removed, a number now out of
 *    range, a different type) reads as the default.
 *
 * Every change is heard by `onExtensionSettingsChange`: made in this page, or in another
 * tab (its `storage` event).
 */
import type { ExtensionManifest, ExtensionSetting, ExtensionSettingValue } from './types'

const STORAGE = 'stave:extension-settings'

const TYPES = new Set(['boolean', 'choice', 'number', 'text'])
const ID = /^[A-Za-z][A-Za-z0-9_.-]*$/

// ── checked when the list is read ──────────────────────────────────────────────────────

/** The well-formed settings of a manifest, and a sentence for each one that is not. */
export interface CheckedSettings {
  readonly settings: readonly ExtensionSetting[]
  readonly problems: readonly string[]
}

const checked = new WeakMap<ExtensionManifest, CheckedSettings>()

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/** What is wrong with one declared setting, or null when nothing is. */
function problemOf(m: ExtensionManifest, s: Record<string, unknown>): string | null {
  const id = s.id
  const name = `The ${m.name} extension's setting "${String(id)}"`
  if (typeof id !== 'string' || !ID.test(id)) {
    return `The ${m.name} extension declares a setting with the id "${String(id)}"; an id starts with a letter and has only letters, digits, "_", "." or "-".`
  }
  if (!isText(s.label)) return `${name} has no label.`
  if (typeof s.description !== 'string') return `${name} has no description.`
  const type = s.type
  if (typeof type !== 'string' || !TYPES.has(type)) {
    return `${name} has the type "${String(type)}"; a setting is "boolean", "choice", "number" or "text".`
  }
  const d = s.default
  switch (type) {
    case 'boolean':
      return typeof d === 'boolean' ? null : `${name} is on/off, so its default must be true or false.`
    case 'text':
      return typeof d === 'string' ? null : `${name} is text, so its default must be text.`
    case 'choice': {
      const options = s.options
      if (!Array.isArray(options) || options.length === 0) return `${name} is a choice with no options.`
      const values = new Set<string>()
      for (const o of options as unknown[]) {
        const opt = o as { value?: unknown; label?: unknown } | null
        if (!opt || typeof opt.value !== 'string' || !isText(opt.label)) {
          return `${name} has an option without a value and a label.`
        }
        if (values.has(opt.value)) return `${name} lists the option "${opt.value}" twice.`
        values.add(opt.value)
      }
      return typeof d === 'string' && values.has(d) ? null : `${name} has the default "${String(d)}", which is not one of its options.`
    }
    case 'number': {
      for (const k of ['min', 'max', 'step'] as const) {
        if (s[k] !== undefined && !isFiniteNumber(s[k])) return `${name} has a ${k} that is not a number.`
      }
      if (s.step !== undefined && (s.step as number) <= 0) return `${name} has a step that is not above zero.`
      if (s.min !== undefined && s.max !== undefined && (s.min as number) > (s.max as number)) {
        return `${name} has a min above its max.`
      }
      if (!isFiniteNumber(d)) return `${name} is a number, so its default must be a number.`
      if ((s.min !== undefined && d < (s.min as number)) || (s.max !== undefined && d > (s.max as number))) {
        return `${name} has the default ${d}, outside its own range.`
      }
      return null
    }
  }
  return null
}

/**
 * Check a manifest's `provides.settings`: the well-formed settings, in order, and one
 * sentence per problem, naming the extension and the setting. Never throws. Kept per
 * manifest, so asking again costs nothing.
 */
export function checkExtensionSettings(m: ExtensionManifest): CheckedSettings {
  const known = checked.get(m)
  if (known) return known
  const declared = m.provides?.settings as unknown
  const settings: ExtensionSetting[] = []
  const problems: string[] = []
  if (declared !== undefined) {
    if (!Array.isArray(declared)) {
      problems.push(`The ${m.name} extension lists its settings, but not as a list.`)
    } else {
      const seen = new Set<string>()
      for (const s of declared as unknown[]) {
        const problem = s && typeof s === 'object' ? problemOf(m, s as Record<string, unknown>) : `The ${m.name} extension declares a setting that is not one.`
        if (problem) {
          problems.push(problem)
          continue
        }
        const setting = s as ExtensionSetting
        if (seen.has(setting.id)) {
          problems.push(`The ${m.name} extension declares the setting "${setting.id}" twice; the second is left out.`)
          continue
        }
        seen.add(setting.id)
        settings.push(setting)
      }
    }
  }
  const out = { settings, problems }
  checked.set(m, out)
  return out
}

/** The manifest's well-formed settings (a setting that is not well formed is left out). */
export function declaredSettings(m: ExtensionManifest): readonly ExtensionSetting[] {
  return checkExtensionSettings(m).settings
}

/** What is wrong with the manifest's settings, one sentence each; empty when nothing is. */
export function settingProblems(m: ExtensionManifest): readonly string[] {
  return checkExtensionSettings(m).problems
}

/** Does `value` fit `setting`: the right kind, one of its choices, inside its range? */
export function fitsSetting(setting: ExtensionSetting, value: unknown): value is ExtensionSettingValue {
  switch (setting.type) {
    case 'boolean':
      return typeof value === 'boolean'
    case 'text':
      return typeof value === 'string'
    case 'choice':
      return typeof value === 'string' && setting.options.some((o) => o.value === value)
    case 'number':
      return (
        isFiniteNumber(value) &&
        (setting.min === undefined || value >= setting.min) &&
        (setting.max === undefined || value <= setting.max)
      )
  }
}

// ── the person's values ────────────────────────────────────────────────────────────────

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    if (typeof window.localStorage?.getItem !== 'function') return null
    return window.localStorage
  } catch {
    return null
  }
}

/** extension id → setting id → the person's value. Only values they changed. */
type Values = Record<string, Record<string, ExtensionSettingValue>>

/** Values that could not be saved (storage full or blocked): they hold for this page only. */
let unsaved: Values | null = null

/** The last stored text and what it parsed to, so a read costs a string compare. */
let parsedFrom: { raw: string | null; values: Values } | null = null

function read(): Values {
  if (unsaved) return unsaved
  let raw: string | null = null
  try {
    raw = storage()?.getItem(STORAGE) ?? null
  } catch {
    return {}
  }
  if (parsedFrom && parsedFrom.raw === raw) return parsedFrom.values
  const values = parse(raw)
  parsedFrom = { raw, values }
  return values
}

function parse(raw: string | null): Values {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    const out: Values = {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [ext, own] of Object.entries(parsed as Record<string, unknown>)) {
        if (!own || typeof own !== 'object' || Array.isArray(own)) continue
        const kept: Record<string, ExtensionSettingValue> = {}
        for (const [id, v] of Object.entries(own as Record<string, unknown>)) {
          if (typeof v === 'boolean' || typeof v === 'string' || isFiniteNumber(v)) kept[id] = v
        }
        out[ext] = kept
      }
    }
    return out
  } catch {
    // unreadable reads as "nothing changed": every setting at its default
    return {}
  }
}

const listeners = new Set<() => void>()

function find(m: ExtensionManifest, id: string): ExtensionSetting | undefined {
  return declaredSettings(m).find((s) => s.id === id)
}

/**
 * The current value of one of the manifest's settings: the person's own if they changed it
 * and it still fits the setting, else the default. `undefined` for a setting the manifest
 * does not declare (or declares badly).
 */
export function extensionSettingValue(m: ExtensionManifest, id: string): ExtensionSettingValue | undefined {
  const setting = find(m, id)
  if (!setting) return undefined
  const stored = read()[m.id]?.[id]
  return stored !== undefined && fitsSetting(setting, stored) ? stored : setting.default
}

/**
 * Change one of the manifest's settings. `null`, or the default itself, puts it back to
 * the default: the stored value is deleted, so the setting follows the default from now
 * on. Returns false, changing nothing, for an undeclared setting or a value that does not
 * fit it. Listeners hear about it only if what is stored changed.
 */
export function setExtensionSetting(m: ExtensionManifest, id: string, value: ExtensionSettingValue | null): boolean {
  const setting = find(m, id)
  if (!setting) return false
  if (value !== null && !fitsSetting(setting, value)) return false
  const all = read()
  const own = { ...(all[m.id] ?? {}) }
  const next = value === null || value === setting.default ? undefined : value
  if (own[id] === next) return true
  if (next === undefined) delete own[id]
  else own[id] = next
  const values: Values = { ...all }
  if (Object.keys(own).length) values[m.id] = own
  else delete values[m.id]
  try {
    const ls = storage()
    if (!ls) throw new Error('no storage')
    if (Object.keys(values).length) ls.setItem(STORAGE, JSON.stringify(values))
    else ls.removeItem(STORAGE)
    unsaved = null
  } catch {
    // Storage full or blocked: the value holds for this page, and a reload forgets it.
    unsaved = values
  }
  for (const fn of [...listeners]) fn()
  return true
}

/**
 * Hear about every change to extension settings: made in this page, or in another tab of
 * this browser (its `storage` event, for this setting's key or a cleared storage). Returns
 * the unsubscribe.
 */
export function onExtensionSettingsChange(fn: () => void): () => void {
  listeners.add(fn)
  const fromAnotherTab = (e: StorageEvent) => {
    if (e.key === STORAGE || e.key === null) fn()
  }
  const win = typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null
  win?.addEventListener('storage', fromAnotherTab)
  return () => {
    listeners.delete(fn)
    win?.removeEventListener('storage', fromAnotherTab)
  }
}

/** One declared setting with its value now: what Settings and the extension's page show. */
export interface ExtensionSettingState {
  readonly setting: ExtensionSetting
  /** the value now (the person's, else the default) */
  readonly value: ExtensionSettingValue
  /** true when it follows the default: nothing of the person's is stored for it (or what is no longer fits) */
  readonly isDefault: boolean
}

/** Every well-formed setting `m` declares, with its value now. Reads nothing but the store. */
export function extensionSettings(m: ExtensionManifest): ExtensionSettingState[] {
  const own = read()[m.id] ?? {}
  return declaredSettings(m).map((setting) => {
    const stored = own[setting.id]
    const mine = stored !== undefined && fitsSetting(setting, stored)
    return { setting, value: mine ? stored : setting.default, isDefault: !mine }
  })
}
