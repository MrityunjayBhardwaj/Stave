/**
 * The keys extensions declare (#2513), and which of them the person has handed back.
 *
 * An extension lists the keys it uses in its manifest (`provides.keys`), the way a VS Code
 * extension lists `contributes.keybindings`. Two things follow from that list, both here:
 *
 *  - CHECKED WHEN THE LIST IS READ (`checkExtensionKeys`, called by the manager on
 *    construction, the same place `provides` is checked): a key that is not one chord in
 *    Stave's vocabulary, a key listed twice, a missing name, a place other than `'code'`.
 *  - HANDED BACK: per extension and per key, whether the key goes to Stave instead of the
 *    extension. The default is the manifest's `givenBack`; the person's own choice is kept
 *    in localStorage under `stave:extension-keys`, apart from their shortcuts
 *    (`stave:keybindings`, which no extension ever writes). This file adds the stored
 *    setting and the functions to read and change it; the buttons are in the Extensions
 *    view (#2511) and Keyboard Shortcuts (#2545).
 *
 * A key's identity is its spelling normalised without the platform (`keyId`): aliases
 * resolved (`cmd` → `mod`, `control` → `ctrl`, `option` → `alt`), modifiers in a fixed
 * order, lower case. Matching a key against a keystroke is the app's job, with Stave's one
 * chord builder (`keys/chord.ts`), which this directory does not import.
 */
import type { ExtensionKey, ExtensionManifest } from './types'

const STORAGE = 'stave:extension-keys'

const MODIFIERS: Record<string, string> = {
  mod: 'mod',
  cmd: 'mod',
  command: 'mod',
  meta: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
}
const ORDER = ['mod', 'ctrl', 'shift', 'alt']

/**
 * A key's identity: its spelling with aliases resolved and modifiers in order (`R+Ctrl`
 * and `control+r` are both `ctrl+r`). Null when it is not one chord: empty, two chords
 * (`mod+k z`), no key after the modifiers, two keys, or a modifier given twice.
 */
export function keyId(key: string): string | null {
  if (typeof key !== 'string') return null
  const text = key.trim().toLowerCase()
  if (!text || /\s/.test(text)) return null
  const mods = new Set<string>()
  let main: string | null = null
  for (const part of text.split('+')) {
    if (!part) return null
    const mod = MODIFIERS[part]
    if (mod) {
      if (mods.has(mod)) return null
      mods.add(mod)
    } else {
      if (main !== null) return null
      main = part
    }
  }
  if (main === null) return null
  return [...ORDER.filter((m) => mods.has(m)), main].join('+')
}

/**
 * Refuse a manifest whose `provides.keys` is not well formed. Throws with a sentence that
 * names the extension and the key. Called by the manager when the list is read.
 */
export function checkExtensionKeys(m: ExtensionManifest): void {
  const keys = m.provides?.keys
  if (keys === undefined) return
  if (!Array.isArray(keys)) throw new Error(`The ${m.id} extension lists its keys, but not as a list.`)
  const seen = new Set<string>()
  for (const k of keys as readonly ExtensionKey[]) {
    const id = keyId(k?.key)
    if (!id) {
      throw new Error(
        `The ${m.id} extension declares the key "${String(k?.key)}", which is not one key with its modifiers (like "ctrl+r").`,
      )
    }
    if (seen.has(id)) throw new Error(`The ${m.id} extension declares the key "${k.key}" twice.`)
    seen.add(id)
    if (typeof k.name !== 'string' || !k.name.trim()) {
      throw new Error(`The ${m.id} extension declares the key "${k.key}" without saying what it does.`)
    }
    if (k.where !== 'code') {
      throw new Error(
        `The ${m.id} extension declares the key "${k.key}" for "${String(k.where)}", but a key can only be declared for the code ("code").`,
      )
    }
    if (k.givenBack !== undefined && typeof k.givenBack !== 'boolean') {
      throw new Error(`The ${m.id} extension says "${k.key}" is given back with something other than true or false.`)
    }
  }
}

// ── the person's choices ───────────────────────────────────────────────────────────────

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    if (typeof window.localStorage?.getItem !== 'function') return null
    return window.localStorage
  } catch {
    return null
  }
}

/** extension id → key id → handed back? Only the person's own choices; the rest is the manifest's default. */
type Choices = Record<string, Record<string, boolean>>

/** Choices that could not be saved (storage full or blocked): they hold for this page only. */
let unsaved: Choices | null = null

/**
 * The last stored text and what it parsed to. The key dispatcher asks on every keystroke
 * in the code, once per declared key, so the parse is kept until the stored text changes;
 * the text itself is read each time, so a change from another tab is still seen.
 */
let parsedFrom: { raw: string | null; choices: Choices } | null = null

function read(): Choices {
  if (unsaved) return unsaved
  let raw: string | null = null
  try {
    raw = storage()?.getItem(STORAGE) ?? null
  } catch {
    return {}
  }
  if (parsedFrom && parsedFrom.raw === raw) return parsedFrom.choices
  const choices = parse(raw)
  parsedFrom = { raw, choices }
  return choices
}

function parse(raw: string | null): Choices {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    const out: Choices = {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [ext, keys] of Object.entries(parsed as Record<string, unknown>)) {
        if (!keys || typeof keys !== 'object' || Array.isArray(keys)) continue
        const own: Record<string, boolean> = {}
        for (const [key, back] of Object.entries(keys as Record<string, unknown>)) {
          if (typeof back === 'boolean') own[key] = back
        }
        out[ext] = own
      }
    }
    return out
  } catch {
    // unreadable reads as "no choices made": every key as its manifest says
    return {}
  }
}

const listeners = new Set<() => void>()

/**
 * Is `key` handed back to Stave, for the extension `manifest`? The person's own choice if
 * they made one, else the manifest's `givenBack`. A key the manifest does not declare is
 * never the extension's, so it reads as handed back.
 */
export function isExtensionKeyGivenBack(manifest: ExtensionManifest, key: string): boolean {
  const id = keyId(key)
  const declared = id ? manifest.provides?.keys?.find((k) => keyId(k.key) === id) : undefined
  if (!declared || !id) return true
  return read()[manifest.id]?.[id] ?? declared.givenBack === true
}

/**
 * Hand `key` back to Stave (true), give it to the extension (false), or go back to the
 * manifest's default (null). Never touches the person's shortcuts. Listeners hear about
 * it only if the stored choice changed. A key that is not one chord is ignored.
 */
export function setExtensionKeyGivenBack(extensionId: string, key: string, givenBack: boolean | null): void {
  const id = keyId(key)
  if (!id) return
  const all = read()
  const own = { ...(all[extensionId] ?? {}) }
  if ((own[id] ?? null) === givenBack) return
  if (givenBack === null) delete own[id]
  else own[id] = givenBack
  const next: Choices = { ...all }
  if (Object.keys(own).length) next[extensionId] = own
  else delete next[extensionId]
  try {
    const ls = storage()
    if (!ls) throw new Error('no storage')
    ls.setItem(STORAGE, JSON.stringify(next))
    unsaved = null
  } catch {
    // Storage full or blocked: the choice holds for this page, and a reload forgets it.
    unsaved = next
  }
  for (const fn of [...listeners]) fn()
}

/** Hear about every change to which keys are handed back, made in this page. Returns the unsubscribe. */
export function onExtensionKeysChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** One declared key with where it goes now: what the Extensions view and Keyboard Shortcuts show. */
export interface ExtensionKeyState {
  readonly key: string
  readonly name: string
  readonly where: 'code'
  /** handed back to Stave now (the person's choice, else the default) */
  readonly givenBack: boolean
  /** the manifest's default */
  readonly givenBackByDefault: boolean
}

/** Every key `manifest` declares, with whether it is handed back now. Reads nothing but the store. */
export function extensionKeys(manifest: ExtensionManifest): ExtensionKeyState[] {
  return (manifest.provides?.keys ?? []).map((k) => ({
    key: k.key,
    name: k.name,
    where: k.where,
    givenBack: isExtensionKeyGivenBack(manifest, k.key),
    givenBackByDefault: k.givenBack === true,
  }))
}

/** A key an active extension takes in the code right now. */
export interface ExtensionKeyInCode {
  readonly extensionId: string
  /** the extension's name, as people see it */
  readonly extensionName: string
  /** the key as the manifest spells it */
  readonly key: string
  /** what it does */
  readonly name: string
}

/**
 * The keys the given extensions take in the code now: declared, not handed back. The
 * runtime calls this with its active extensions (`extensionKeysInCode` in `runtime.ts`).
 */
export function keysTakenBy(manifests: readonly ExtensionManifest[]): ExtensionKeyInCode[] {
  const out: ExtensionKeyInCode[] = []
  for (const m of manifests) {
    for (const k of m.provides?.keys ?? []) {
      if (k.where !== 'code' || isExtensionKeyGivenBack(m, k.key)) continue
      out.push({ extensionId: m.id, extensionName: m.name, key: k.key, name: k.name })
    }
  }
  return out
}
