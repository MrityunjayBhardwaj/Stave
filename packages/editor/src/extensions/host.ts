/**
 * The recording hosts (#2509, #2538): the only way an extension changes Stave, and the
 * reason switching one off can leave Stave exactly as it was.
 *
 * Each part of an extension gets its own host: the common part a `createCommonHost`, the
 * Strudel part a `createRecordingHost` over Strudel's registries. Every registration goes
 * through a host and is recorded with its own undo. Switching a part off runs its
 * `onDeactivate` callbacks, then the undos, newest first. A host only ever undoes what it
 * did itself (the same rule as `setGridKeyMatcher`'s release), and it never overwrites: a
 * name that already exists is refused, because undoing an overwrite would delete the
 * thing that was there before.
 *
 * The registries are handed in, not imported. In the app they are Strudel's own
 * (`fromStrudel`); offline renders build audio nodes in another realm, so nothing here
 * may test classes with `instanceof`, and nothing here does.
 *
 * ── WHAT CANNOT BE UNDONE ────────────────────────────────────────────────────────────────
 * `registerControl` from `@strudel/core` also records the name in a list that module keeps
 * private (`controlAlias`, read by `isControlName`). Removing the method and the global
 * leaves that entry, so after a control's extension is switched off Stave's parser still
 * files `.name(…)` as a parameter. The method itself is gone, so running such code reports
 * a missing method. This is listed in `RESIDUE`, so it is stated, not hidden.
 */
import type { ExtensionHost, SoundTrigger, StrudelHost, StrudelProvides } from './types'

/** Things a switched-off extension leaves behind, by registration kind. */
export const RESIDUE = {
  control:
    "the control's name stays known to Strudel's control list, so Stave's parser still reads `.name(…)` as a parameter",
  worklet:
    "an audio worklet module stays loaded in the live context and on Strudel's worklet list (superdough's `registerWorklet` has no remove), so later renders load it too; nothing uses it",
} as const

/** The registries a Strudel part writes to. In the app: `fromStrudel(webaudio, core)`. */
export interface HostRegistries {
  sounds: {
    has(name: string): boolean
    add(name: string, onTrigger: SoundTrigger, data: Record<string, unknown>): void
    remove(name: string): void
  }
  controls: {
    /** is `name` already a pattern method? */
    has(name: string): boolean
    /** add the method and return the global function for it */
    add(name: string): unknown
    remove(name: string): void
  }
  /** where user code finds globals (`globalThis` in the app) */
  globals: Record<string, unknown>
}

/**
 * Strudel's registries, from the modules the engine has already loaded.
 * superdough lower-cases sound names when it registers them, so this does too.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fromStrudel(webaudio: any, core: any, globals: Record<string, unknown> = globalThis as any): HostRegistries {
  const key = (name: string) => name.toLowerCase().replace(/\s+/g, '_')
  return {
    sounds: {
      has: (name) => key(name) in webaudio.soundMap.get(),
      add: (name, onTrigger, data) => webaudio.registerSound(key(name), onTrigger, data),
      remove: (name) => webaudio.soundMap.setKey(key(name), undefined),
    },
    controls: {
      has: (name) => name in core.Pattern.prototype,
      add: (name) => core.registerControl(name)[name],
      remove: (name) => {
        delete core.Pattern.prototype[name]
      },
    },
    globals,
  }
}

/** Thrown when an extension asks for a name that is already taken. Classified by `code`. */
export interface NameTakenError extends Error {
  code: 'EXTENSION_NAME_TAKEN'
  extensionId: string
  kind: 'sound' | 'control' | 'global'
  taken: string
}

function nameTaken(extensionId: string, kind: NameTakenError['kind'], taken: string): NameTakenError {
  const err = new Error(
    `The ${extensionId} extension wants the ${kind} name "${taken}", but it is already in use, so it was not added.`,
  ) as NameTakenError
  err.code = 'EXTENSION_NAME_TAKEN'
  err.extensionId = extensionId
  err.kind = kind
  err.taken = taken
  return err
}

/** Is `e` a refusal from a host because a name was taken? (An own-property brand, not a class.) */
export function isNameTaken(e: unknown): e is NameTakenError {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'EXTENSION_NAME_TAKEN'
}

/** A part's host and the record of what it did. */
export interface PartRecording<H> {
  host: H
  /**
   * Undo everything, newest first. Each undo runs even if an earlier one throws;
   * the errors are returned rather than thrown so one bad step cannot strand the rest.
   */
  undo(): unknown[]
}

/**
 * The common part's host (#2538): `id` and `onDeactivate`, nothing that names a language.
 * Its undo runs the `onDeactivate` callbacks, newest first.
 */
export function createCommonHost(id: string): PartRecording<ExtensionHost> {
  const onOff: (() => void)[] = []
  let closed = false
  return {
    host: {
      id,
      onDeactivate(fn) {
        if (closed) throw new Error(`The ${id} extension is switched off; it cannot register anything now.`)
        onOff.push(fn)
      },
    },
    undo() {
      closed = true
      const errors: unknown[] = []
      for (const fn of onOff.splice(0).reverse()) {
        try {
          fn()
        } catch (e) {
          errors.push(e)
        }
      }
      return errors
    },
  }
}

/** The Strudel part's host and its record. */
export interface RecordingHost extends PartRecording<StrudelHost> {
  host: StrudelHost
  /** the `onPrepare` callbacks registered so far; empty once undone */
  preparers(): readonly (() => unknown)[]
}

/**
 * The Strudel part's host. `declared`: the Strudel names the extension's manifest says it
 * provides (`provides.strudel`). When given, the host refuses any sound or control not on
 * it, so the manifest can never claim less than the extension does: Stave names a
 * switched-off extension from its manifest alone (#2512). The runtime always gives it
 * (an empty list when the manifest declares none).
 */
export function createRecordingHost(id: string, reg: HostRegistries, declared?: StrudelProvides): RecordingHost {
  const declaredSounds = new Set((declared?.sounds ?? []).map((n) => n.toLowerCase()))
  const declaredControls = new Set(declared?.controls ?? [])
  const undeclared = (kind: 'sound' | 'control', name: string) =>
    new Error(`The ${id} extension registered the ${kind} "${name}" without declaring it in its manifest, so it was not added.`)
  const undos: (() => void)[] = []
  const onOff: (() => void)[] = []
  const prepares: (() => unknown)[] = []
  let closed = false
  const open = () => {
    if (closed) throw new Error(`The ${id} extension is switched off; it cannot register anything now.`)
  }

  const host: StrudelHost = {
    id,
    registerSound(name, onTrigger, data = {}) {
      open()
      if (declared && !declaredSounds.has(name.toLowerCase())) throw undeclared('sound', name)
      if (reg.sounds.has(name)) throw nameTaken(id, 'sound', name)
      reg.sounds.add(name, onTrigger, data)
      undos.push(() => reg.sounds.remove(name))
    },
    registerControl(name) {
      open()
      if (declared && !declaredControls.has(name)) throw undeclared('control', name)
      if (reg.controls.has(name)) throw nameTaken(id, 'control', name)
      if (name in reg.globals) throw nameTaken(id, 'global', name)
      const fn = reg.controls.add(name)
      undos.push(() => reg.controls.remove(name))
      reg.globals[name] = fn
      undos.push(() => {
        delete reg.globals[name]
      })
    },
    setGlobal(name, value) {
      open()
      if (name in reg.globals) throw nameTaken(id, 'global', name)
      reg.globals[name] = value
      undos.push(() => {
        delete reg.globals[name]
      })
    },
    onDeactivate(fn) {
      open()
      onOff.push(fn)
    },
    onPrepare(fn) {
      open()
      prepares.push(fn)
      undos.push(() => {
        const i = prepares.indexOf(fn)
        if (i >= 0) prepares.splice(i, 1)
      })
    },
  }

  return {
    host,
    undo() {
      closed = true
      const errors: unknown[] = []
      for (const fn of [...onOff.splice(0).reverse(), ...undos.splice(0).reverse()]) {
        try {
          fn()
        } catch (e) {
          errors.push(e)
        }
      }
      return errors
    },
    preparers: () => [...prepares],
  }
}
