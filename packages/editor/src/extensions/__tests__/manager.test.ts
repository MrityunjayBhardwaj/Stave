/**
 * #2509 — switching extensions on and off, against Strudel's real registries.
 */
import { describe, it, expect } from 'vitest'
import * as webaudio from '@strudel/webaudio'
import * as core from '@strudel/core'
import { fromStrudel } from '../host'
import { createExtensionManager } from '../manager'
import { BUILTIN_EXTENSIONS } from '../builtin'
import { testManifest, testModule, TEST_SOUND } from './testExtension'
import type { ExtensionManifest } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any */
const sounds = () => Object.keys((webaudio as any).soundMap.get())
const registries = () => fromStrudel(webaudio, core)

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('createExtensionManager', () => {
  it('switches on, and off, through the host', async () => {
    const log: string[] = []
    const m = createExtensionManager({ manifests: [testManifest({}, log)], registries })
    await m.activate('zzext')
    expect(m.isActive('zzext')).toBe(true)
    expect(sounds()).toContain(TEST_SOUND)
    expect(m.deactivate('zzext')).toEqual([])
    expect(m.isActive('zzext')).toBe(false)
    expect(sounds()).not.toContain(TEST_SOUND)
    expect(log).toEqual(['deactivated'])
  })

  it('switching on twice, even at the same moment, loads and registers once', async () => {
    let loads = 0
    const m = createExtensionManager({
      manifests: [testManifest({ load: async () => (loads++, testModule()) })],
      registries,
    })
    await Promise.all([m.activate('zzext'), m.activate('zzext')])
    await m.activate('zzext')
    expect(loads).toBe(1)
    m.deactivate('zzext')
  })

  it('an activation that throws leaves nothing behind, and the caller gets the error', async () => {
    const before = sounds()
    const broken: ExtensionManifest = testManifest({
      load: async () => ({
        activate(host) {
          host.registerSound(TEST_SOUND, () => undefined)
          throw new Error('half-way')
        },
      }),
    })
    const m = createExtensionManager({ manifests: [broken], registries })
    await expect(m.activate('zzext')).rejects.toThrow('half-way')
    expect(m.isActive('zzext')).toBe(false)
    expect(sounds()).toEqual(before)
  })

  it('an extension that registers a name its manifest does not declare is refused, leaving nothing', async () => {
    const before = sounds()
    const liar = testManifest({ provides: { sounds: [TEST_SOUND] } }) // its module also adds a control and a global
    const m = createExtensionManager({ manifests: [liar], registries })
    await expect(m.activate('zzext')).rejects.toThrow(/without declaring it/)
    expect(sounds()).toEqual(before)
    expect(m.isActive('zzext')).toBe(false)
  })

  it('when cleanup after a failed activation also fails, those errors travel with the error', async () => {
    const reg = registries()
    const flaky = { ...reg, sounds: { ...reg.sounds, remove: () => { throw new Error('stuck') } } }
    const m = createExtensionManager({
      manifests: [
        testManifest({
          load: async () => ({
            activate(host) {
              host.registerSound(TEST_SOUND, () => undefined)
              throw new Error('half-way')
            },
          }),
        }),
      ],
      registries: () => flaky,
    })
    const err = await m.activate('zzext').catch((e: unknown) => e)
    expect((err as { undoErrors?: unknown[] }).undoErrors).toHaveLength(1)
    reg.sounds.remove(TEST_SOUND)
  })

  it('switching off while it is still loading wins: nothing is registered when the load ends', async () => {
    const gate = deferred<void>()
    const m = createExtensionManager({
      manifests: [testManifest({ load: async () => (await gate.promise, testModule()) })],
      registries,
    })
    const on = m.activate('zzext')
    m.deactivate('zzext')
    gate.resolve()
    await on
    expect(m.isActive('zzext')).toBe(false)
    expect(sounds()).not.toContain(TEST_SOUND)
  })

  it('switching back on right after a cancelled load does not trip over the names it held', async () => {
    const gate = deferred<void>()
    let first = true
    const m = createExtensionManager({
      manifests: [
        testManifest({
          load: async () => {
            if (first) {
              first = false
              return {
                async activate(host) {
                  host.registerSound(TEST_SOUND, () => undefined)
                  await gate.promise
                },
              }
            }
            return testModule()
          },
        }),
      ],
      registries,
    })
    const a = m.activate('zzext')
    await Promise.resolve()
    await Promise.resolve()
    m.deactivate('zzext')
    const b = m.activate('zzext')
    gate.resolve()
    await a
    await b
    expect(m.isActive('zzext')).toBe(true)
    expect(sounds()).toContain(TEST_SOUND)
    m.deactivate('zzext')
  })

  it('sync makes the active set equal the ids, and reports failures without stopping the rest', async () => {
    const bad = testManifest({ id: 'bad', load: async () => Promise.reject(new Error('no network')) })
    const m = createExtensionManager({ manifests: [testManifest(), bad], registries })
    const r1 = await m.sync(new Set(['zzext', 'bad', 'gone']))
    expect(m.activeIds()).toEqual(['zzext'])
    expect(r1.failed.map((f) => f.id)).toEqual(['bad'])
    // an id saved as on for an extension Stave no longer ships is skipped, not a failure
    expect(r1.unknown).toEqual(['gone'])
    await m.sync(new Set())
    expect(m.activeIds()).toEqual([])
    expect(sounds()).not.toContain(TEST_SOUND)
  })

  it('refuses two manifests with one id, and an unknown id', async () => {
    expect(() => createExtensionManager({ manifests: [testManifest(), testManifest()], registries })).toThrow(/share the id/)
    const m = createExtensionManager({ manifests: [], registries })
    await expect(m.activate('nope')).rejects.toThrow(/no extension called/)
  })

  it('the built-in list has unique ids and no two extensions provide the same name', () => {
    const ids = BUILTIN_EXTENSIONS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    const names = BUILTIN_EXTENSIONS.flatMap((e) => [...(e.provides.sounds ?? []), ...(e.provides.controls ?? [])])
    expect(new Set(names).size).toBe(names.length)
    expect(() => createExtensionManager({ manifests: BUILTIN_EXTENSIONS, registries })).not.toThrow()
  })
})
