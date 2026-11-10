/**
 * #2509 — switching extensions on and off, against Strudel's real registries; #2538 — in
 * parts: a common part, and a Strudel part that switches on through the Strudel driver.
 */
import { describe, it, expect } from 'vitest'
import * as webaudio from '@strudel/webaudio'
import * as core from '@strudel/core'
import { fromStrudel } from '../host'
import { createExtensionManager, type ExtensionManager } from '../manager'
import { createStrudelDriver, type ExtensionStrudelDoors } from '../strudel'
import { BUILTIN_EXTENSIONS } from '../builtin'
import { testManifest, testModule, testPart, TEST_SOUND, TEST_CONTROL, TEST_GLOBAL } from './testExtension'
import type { ExtensionManifest } from '../types'

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any
const sounds = () => Object.keys((webaudio as any).soundMap.get())
const registries = () => fromStrudel(webaudio, core)
const doors: ExtensionStrudelDoors = {
  registries,
  registerWorklet: () => undefined,
  liveContext: async () => null,
  report: () => undefined,
}

function managerOf(manifests: ExtensionManifest[], reg: () => ReturnType<typeof registries> = registries) {
  return createExtensionManager({ manifests, parts: { strudel: createStrudelDriver(() => ({ ...doors, registries: reg })) } })
}

/** switch on the common part, then the Strudel part */
async function on(m: ExtensionManager, id = 'zzext') {
  await m.activate(id)
  await m.activatePart(id, 'strudel')
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('createExtensionManager', () => {
  it('switches on, and off, through the hosts', async () => {
    const log: string[] = []
    const m = managerOf([testManifest({}, log)])
    await on(m)
    expect(m.isActive('zzext')).toBe(true)
    expect(m.isPartActive('zzext', 'strudel')).toBe(true)
    expect(sounds()).toContain(TEST_SOUND)
    expect(m.deactivate('zzext')).toEqual([])
    expect(m.isActive('zzext')).toBe(false)
    expect(m.isPartActive('zzext', 'strudel')).toBe(false)
    expect(sounds()).not.toContain(TEST_SOUND)
    expect(log).toEqual(['deactivated', 'common off'])
  })

  it('switching off undoes the Strudel part, then the common part, and leaves nothing behind (#2538)', async () => {
    const order: string[] = []
    const before = {
      sounds: sounds().sort(),
      methods: Object.getOwnPropertyNames((core as any).Pattern.prototype).sort(),
      globals: Object.getOwnPropertyNames(globalThis).sort(),
    }
    const m = managerOf([
      testManifest({
        load: async () => ({
          activate(host) {
            host.onDeactivate(() => order.push(`common: sound ${sounds().includes(TEST_SOUND) ? 'still there' : 'gone'}`))
          },
          strudel: {
            activate(host) {
              testPart().activate(host)
              host.onDeactivate(() => order.push('strudel'))
            },
          },
        }),
      }),
    ])
    await on(m)
    expect(g[TEST_GLOBAL]).toBe(42)
    expect(m.deactivate('zzext')).toEqual([])
    // the common part's callback runs after the Strudel part's whole undo
    expect(order).toEqual(['strudel', 'common: sound gone'])
    expect({
      sounds: sounds().sort(),
      methods: Object.getOwnPropertyNames((core as any).Pattern.prototype).sort(),
      globals: Object.getOwnPropertyNames(globalThis).sort(),
    }).toEqual(before)
  })

  it('switching on twice, even at the same moment, loads and registers once', async () => {
    let loads = 0
    const m = managerOf([testManifest({ load: async () => (loads++, testModule()) })])
    await Promise.all([m.activate('zzext'), m.activate('zzext')])
    await Promise.all([m.activatePart('zzext', 'strudel'), m.activatePart('zzext', 'strudel')])
    await on(m)
    expect(loads).toBe(1)
    m.deactivate('zzext')
  })

  it('a Strudel part cannot switch on before the extension has', async () => {
    const m = managerOf([testManifest()])
    await expect(m.activatePart('zzext', 'strudel')).rejects.toThrow(/not switched on/)
    expect(sounds()).not.toContain(TEST_SOUND)
  })

  it('a common part that throws leaves nothing behind, and the caller gets the error', async () => {
    const log: string[] = []
    const broken: ExtensionManifest = testManifest({
      load: async () => ({
        activate(host) {
          host.onDeactivate(() => log.push('cleaned'))
          throw new Error('half-way')
        },
      }),
    })
    const m = managerOf([broken])
    await expect(m.activate('zzext')).rejects.toThrow('half-way')
    expect(m.isActive('zzext')).toBe(false)
    expect(log).toEqual(['cleaned'])
  })

  it('a Strudel part that throws leaves nothing behind, the caller gets the error, and the common part stays on', async () => {
    const before = sounds()
    const broken: ExtensionManifest = testManifest({
      load: async () => ({
        strudel: {
          activate(host) {
            host.registerSound(TEST_SOUND, () => undefined)
            throw new Error('half-way')
          },
        },
      }),
    })
    const m = managerOf([broken])
    await m.activate('zzext')
    await expect(m.activatePart('zzext', 'strudel')).rejects.toThrow('half-way')
    expect(m.isPartActive('zzext', 'strudel')).toBe(false)
    expect(m.isActive('zzext')).toBe(true)
    expect(sounds()).toEqual(before)
    m.deactivate('zzext')
  })

  it('a Strudel part that registers a name its manifest does not declare under provides.strudel is refused, leaving nothing', async () => {
    const before = sounds()
    const liar = testManifest({ provides: { strudel: { sounds: [TEST_SOUND] } } }) // its part also adds a control
    const m = managerOf([liar])
    await m.activate('zzext')
    await expect(m.activatePart('zzext', 'strudel')).rejects.toThrow(/without declaring it/)
    expect(sounds()).toEqual(before)
    expect(m.isPartActive('zzext', 'strudel')).toBe(false)
    m.deactivate('zzext')
  })

  it('a Strudel part whose manifest declares no Strudel names may register none (#2538)', async () => {
    const before = sounds()
    const m = managerOf([testManifest({ provides: {} })])
    await m.activate('zzext')
    await expect(m.activatePart('zzext', 'strudel')).rejects.toThrow(/without declaring it/)
    expect(sounds()).toEqual(before)
    m.deactivate('zzext')
  })

  it('when cleanup after a failed activation also fails, those errors travel with the error', async () => {
    const reg = registries()
    const flaky = { ...reg, sounds: { ...reg.sounds, remove: () => { throw new Error('stuck') } } }
    const m = managerOf(
      [
        testManifest({
          load: async () => ({
            strudel: {
              activate(host) {
                host.registerSound(TEST_SOUND, () => undefined)
                throw new Error('half-way')
              },
            },
          }),
        }),
      ],
      () => flaky,
    )
    await m.activate('zzext')
    const err = await m.activatePart('zzext', 'strudel').catch((e: unknown) => e)
    expect((err as { undoErrors?: unknown[] }).undoErrors).toHaveLength(1)
    reg.sounds.remove(TEST_SOUND)
    m.deactivate('zzext')
  })

  it('switching off while it is still loading wins: nothing is on when the load ends', async () => {
    const gate = deferred<void>()
    const log: string[] = []
    const m = managerOf([testManifest({ load: async () => (await gate.promise, testModule(log)) })])
    const pending = m.activate('zzext')
    m.deactivate('zzext')
    gate.resolve()
    await pending
    expect(m.isActive('zzext')).toBe(false)
    await expect(m.activatePart('zzext', 'strudel')).rejects.toThrow(/not switched on/)
    expect(sounds()).not.toContain(TEST_SOUND)
  })

  it('switching off while the Strudel part is still activating wins: what it registered is undone when it ends', async () => {
    const gate = deferred<void>()
    const m = managerOf([
      testManifest({
        load: async () => ({
          strudel: {
            async activate(host) {
              host.registerSound(TEST_SOUND, () => undefined)
              await gate.promise
            },
          },
        }),
      }),
    ])
    await m.activate('zzext')
    const part = m.activatePart('zzext', 'strudel')
    await Promise.resolve()
    await Promise.resolve()
    expect(sounds()).toContain(TEST_SOUND)
    m.deactivate('zzext')
    gate.resolve()
    await part
    expect(m.isPartActive('zzext', 'strudel')).toBe(false)
    expect(sounds()).not.toContain(TEST_SOUND)
  })

  it('switched off while its worklet is still loading, the Strudel part never activates', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let activated = false
    const m = createExtensionManager({
      manifests: [
        testManifest({
          load: async () => ({
            strudel: {
              worklets: ['blob:zz'],
              activate(host) {
                activated = true
                testPart().activate(host)
              },
            },
          }),
        }),
      ],
      parts: {
        strudel: createStrudelDriver(() => ({
          ...doors,
          liveContext: async () => ({ audioWorklet: { addModule: () => gate } }),
        })),
      },
    })
    await m.activate('zzext')
    const part = m.activatePart('zzext', 'strudel')
    m.deactivate('zzext')
    release()
    await part
    expect(activated).toBe(false)
    expect(m.isPartActive('zzext', 'strudel')).toBe(false)
    expect(sounds()).not.toContain(TEST_SOUND)
  })

  it('switching back on right after a cancelled part does not trip over the names it held', async () => {
    const gate = deferred<void>()
    let first = true
    const m = managerOf([
      testManifest({
        load: async () => {
          if (first) {
            first = false
            return {
              strudel: {
                async activate(host) {
                  host.registerSound(TEST_SOUND, () => undefined)
                  await gate.promise
                },
              },
            }
          }
          return testModule()
        },
      }),
    ])
    await m.activate('zzext')
    const a = m.activatePart('zzext', 'strudel')
    await Promise.resolve()
    await Promise.resolve()
    m.deactivate('zzext')
    await m.activate('zzext')
    const b = m.activatePart('zzext', 'strudel')
    gate.resolve()
    await a
    await b
    expect(m.isPartActive('zzext', 'strudel')).toBe(true)
    expect(sounds()).toContain(TEST_SOUND)
    m.deactivate('zzext')
  })

  it('sync makes the active set equal the ids, and reports failures without stopping the rest', async () => {
    const bad = testManifest({ id: 'bad', load: async () => Promise.reject(new Error('no network')) })
    const m = managerOf([testManifest(), bad])
    const r1 = await m.sync(new Set(['zzext', 'bad', 'gone']))
    expect(m.activeIds()).toEqual(['zzext'])
    expect(r1.failed.map((f) => f.id)).toEqual(['bad'])
    // an id saved as on for an extension Stave no longer ships is skipped, not a failure
    expect(r1.unknown).toEqual(['gone'])
    await m.activatePart('zzext', 'strudel')
    expect(sounds()).toContain(TEST_SOUND)
    await m.sync(new Set())
    expect(m.activeIds()).toEqual([])
    expect(sounds()).not.toContain(TEST_SOUND)
  })

  it('refuses two manifests with one id, and an unknown id', async () => {
    expect(() => managerOf([testManifest(), testManifest()])).toThrow(/share the id/)
    const m = managerOf([])
    await expect(m.activate('nope')).rejects.toThrow(/no extension called/)
  })

  it('refuses, when the list is read, a manifest whose provides names a language it does not list (#2538)', () => {
    expect(() => managerOf([testManifest({ languages: ['hydra'] })])).toThrow(/provides for strudel, but strudel is not one of the languages it lists/)
    // '*' is the editor as a whole: it covers no language's names
    expect(() => managerOf([testManifest({ languages: '*' })])).toThrow(/not one of the languages it lists/)
    expect(() => managerOf([testManifest({ languages: ['hydra', 'strudel'] })])).not.toThrow()
    expect(() => managerOf([testManifest({ languages: '*', provides: {} })])).not.toThrow()
  })

  it('refuses at load a Strudel part on an extension that does not list strudel, leaving it off (#2538)', async () => {
    for (const languages of ['*', ['hydra']] as const) {
      const log: string[] = []
      const m = managerOf([testManifest({ languages, provides: undefined }, log)])
      await expect(m.activate('zzext')).rejects.toThrow(/has a strudel part, but strudel is not one of the languages it lists/)
      expect(m.isActive('zzext')).toBe(false)
      // refused before its common part ran: nothing to undo
      expect(log).toEqual([])
    }
  })

  it("a '*' extension's common part switches on with no Strudel driver at all (#2538)", async () => {
    const log: string[] = []
    const m = createExtensionManager({
      manifests: [
        testManifest({ languages: '*', provides: undefined, load: async () => ({ activate: (h) => h.onDeactivate(() => log.push('off')) }) }),
      ],
    })
    await m.activate('zzext')
    expect(m.isActive('zzext')).toBe(true)
    await m.activatePart('zzext', 'strudel') // no such part: nothing to do
    expect(m.isPartActive('zzext', 'strudel')).toBe(false)
    m.deactivate('zzext')
    expect(log).toEqual(['off'])
  })

  it('the built-in list has unique ids, is accepted as a list, and no two extensions provide the same Strudel name', () => {
    const ids = BUILTIN_EXTENSIONS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    const names = BUILTIN_EXTENSIONS.flatMap((e) => [...(e.provides?.strudel?.sounds ?? []), ...(e.provides?.strudel?.controls ?? [])])
    expect(new Set(names).size).toBe(names.length)
    expect(() => managerOf([...BUILTIN_EXTENSIONS])).not.toThrow()
  })

  it('TEST_CONTROL is a real control while on (sanity for the snapshots above)', async () => {
    const m = managerOf([testManifest()])
    await on(m)
    expect(TEST_CONTROL in (core as any).Pattern.prototype).toBe(true)
    m.deactivate('zzext')
    expect(TEST_CONTROL in (core as any).Pattern.prototype).toBe(false)
  })

  // Switching off must win at EVERY moment, not only at the awaits a test happens to hit:
  // a switch-off that lands between the last cancel check and the "it is on now" step
  // would leave the extension on, with nothing left to undo it.
  for (const level of ['common', 'strudel'] as const) {
    it(`switching off ${level === 'common' ? 'the extension' : 'during its Strudel part'} at any microtask after it starts wins`, async () => {
      const leaks: number[] = []
      for (let n = 0; n < 16; n++) {
        const log: string[] = []
        const m = managerOf([testManifest({}, log)])
        if (level === 'strudel') await m.activate('zzext')
        const pending = level === 'common' ? m.activate('zzext') : m.activatePart('zzext', 'strudel')
        for (let i = 0; i < n; i++) await Promise.resolve()
        m.deactivate('zzext')
        await pending.catch(() => undefined)
        const on = m.isActive('zzext') || m.isPartActive('zzext', 'strudel') || sounds().includes(TEST_SOUND)
        if (on) {
          leaks.push(n)
          m.deactivate('zzext')
        }
        // whatever it managed to register before the switch-off was undone
      }
      expect(leaks).toEqual([])
    })
  }
})
