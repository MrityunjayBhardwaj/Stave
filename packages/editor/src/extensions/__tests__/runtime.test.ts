/**
 * #2510 — the page's extensions runtime: an engine attaching, live on/off, worklets,
 * preparation and what reaches the Console; #2538 — page-load start with no engine, the
 * Strudel part following the engine, the order of switch-off, and a part that fails.
 * Against Strudel's REAL registries (see host.test.ts); the audio context is a stand-in
 * that records `addModule`, because jsdom has no audio.
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as webaudio from '@strudel/webaudio'
import * as core from '@strudel/core'
import { createExtensionRuntime } from '../runtime'
import type { ExtensionStrudelDoors } from '../strudel'
import { fromStrudel, RESIDUE } from '../host'
import type { ExtensionManifest, StrudelPart } from '../types'
import { testPart, testManifest, TEST_SOUND, TEST_CONTROL } from './testExtension'

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any
const soundNames = () => Object.keys((webaudio as any).soundMap.get())
const WORKLET = 'blob:zzext-worklet'

function harness(opts: { manifests?: ExtensionManifest[]; on?: string[]; badUrls?: string[]; log?: string[] } = {}) {
  let ids = new Set(opts.on ?? ['zzext'])
  const subs = new Set<(ids: ReadonlySet<string>) => void>()
  const steps: string[] = opts.log ?? []
  const rows: { level: string; message: string }[] = []
  const doors: ExtensionStrudelDoors = {
    registries: () => fromStrudel(webaudio, core),
    registerWorklet: (url) => steps.push(`registerWorklet ${url}`),
    liveContext: async () => ({
      audioWorklet: {
        addModule: async (url: string) => {
          steps.push(`addModule ${url}`)
          if (opts.badUrls?.includes(url)) throw new Error('404')
        },
      },
    }),
    report: (level, message) => rows.push({ level, message }),
  }
  const audio = createExtensionRuntime({
    manifests: opts.manifests ?? [testManifest()],
    enabled: () => ids,
    subscribe: (fn) => {
      subs.add(fn)
      return () => subs.delete(fn)
    },
  })
  let changes = 0
  audio.onChange(() => changes++)
  const flip = async (next: string[]) => {
    ids = new Set(next)
    for (const fn of subs) fn(ids)
    // Only the subscription may act here: calling start() or attachStrudel() would re-read
    // the switches itself and hide a runtime that stopped following them. Let the load/activate
    // chain settle (every step in it is a resolved promise or a macrotask away).
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
  }
  return { audio, doors, steps, rows, flip, changes: () => changes, subscribers: () => subs.size }
}

/** the test extension's Strudel part, plus a worklet and a preparation step, logging what happens */
function workletManifest(steps: string[], over: Partial<StrudelPart> = {}): ExtensionManifest {
  return testManifest({
    load: async () => {
      const base = testPart()
      return {
        strudel: {
          worklets: [WORKLET],
          async activate(host) {
            steps.push('activate')
            await base.activate(host)
            host.onPrepare(() => {
              steps.push('prepare')
            })
          },
          ...over,
        },
      }
    },
  })
}

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

describe('createExtensionRuntime: an engine attaching (#2510)', () => {
  it('attach: the worklet goes into the live context, THEN to Strudel, THEN the Strudel part activates', async () => {
    const steps: string[] = []
    const h = harness({ manifests: [workletManifest(steps)], log: steps })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await h.audio.attachStrudel(h.doors)
    expect(steps).toEqual([`addModule ${WORKLET}`, `registerWorklet ${WORKLET}`, 'activate'])
    expect(soundNames()).toContain(TEST_SOUND)
    expect(h.audio.manager.isActive('zzext')).toBe(true)
    expect(h.rows).toEqual([])
  })

  it('a worklet that fails to load is never handed to Strudel, nothing is registered, and the Console names the extension', async () => {
    const steps: string[] = []
    const h = harness({ manifests: [workletManifest(steps)], badUrls: [WORKLET] })
    const before = soundNames().sort()
    await h.audio.attachStrudel(h.doors)
    expect(h.steps).toEqual([`addModule ${WORKLET}`])
    expect(steps).toEqual([])
    // the Strudel part is off; the common part (nothing Strudel's) stays as it was (#2538)
    expect(h.audio.manager.isPartActive('zzext', 'strudel')).toBe(false)
    expect(h.audio.manager.isActive('zzext')).toBe(true)
    expect(soundNames().sort()).toEqual(before)
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0].level).toBe('error')
    expect(h.rows[0].message).toContain('The Test extension extension could not be switched on for Strudel')
    expect(h.rows[0].message).toContain('audio worklet did not load')
    h.audio.manager.deactivate('zzext')
  })

  it('attach can run again (a retried init, a second engine), and start after it: one activation, one worklet registration, one subscription', async () => {
    const steps: string[] = []
    const h = harness({ manifests: [workletManifest(steps)] })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await Promise.all([h.audio.attachStrudel(h.doors), h.audio.attachStrudel(h.doors)])
    await h.audio.attachStrudel(h.doors)
    await h.audio.start({ report: () => undefined })
    await h.audio.start({ report: () => undefined })
    expect(steps).toEqual(['activate'])
    expect(h.steps.filter((s) => s.startsWith('registerWorklet'))).toHaveLength(1)
    expect(h.subscribers()).toBe(1)
  })

  it('switched on while running, it plays with no reload; switched off, its sound is gone again', async () => {
    const steps: string[] = []
    const h = harness({ manifests: [workletManifest(steps)], on: [] })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await h.audio.attachStrudel(h.doors)
    expect(soundNames()).not.toContain(TEST_SOUND)
    expect(h.changes()).toBe(0)

    await h.flip(['zzext'])
    expect(soundNames()).toContain(TEST_SOUND)
    expect(TEST_CONTROL in (core as any).Pattern.prototype).toBe(true)
    expect(h.changes()).toBe(1)

    await h.flip([])
    expect(soundNames()).not.toContain(TEST_SOUND)
    expect(TEST_CONTROL in (core as any).Pattern.prototype).toBe(false)
    expect(h.changes()).toBe(2)

    // on again: the worklet goes into the live context again (harmless), but Strudel's
    // list, which cannot be emptied, gets it once (RESIDUE.worklet)
    await h.flip(['zzext'])
    expect(h.steps.filter((s) => s.startsWith('addModule'))).toHaveLength(2)
    expect(h.steps.filter((s) => s.startsWith('registerWorklet'))).toHaveLength(1)
    expect(RESIDUE.worklet).toMatch(/registerWorklet/)
  })

  it('prepare runs each active extension\'s step, and not a switched-off one\'s', async () => {
    const steps: string[] = []
    const h = harness({ manifests: [workletManifest(steps)] })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await h.audio.attachStrudel(h.doors)
    await h.audio.prepare(1000)
    expect(steps).toEqual(['activate', 'prepare'])
    await h.flip([])
    await h.audio.prepare(1000)
    expect(steps).toEqual(['activate', 'prepare'])
  })

  it('a preparation that fails is one Console row under the extension\'s name, and prepare still resolves', async () => {
    const h = harness({
      manifests: [
        testManifest({
          load: async () => ({ strudel: {
            activate(host) {
              host.registerSound(TEST_SOUND, () => undefined)
              host.onPrepare(async () => {
                throw new Error('wasm missing')
              })
            },
          } }),
        }),
      ],
    })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await h.audio.attachStrudel(h.doors)
    await expect(h.audio.prepare(1000)).resolves.toBeUndefined()
    expect(h.rows).toEqual([
      { level: 'error', message: expect.stringContaining('Test extension extension could not get ready to play: wasm missing') },
    ])
  })

  it('a preparation still running at the cap is reported, not waited for in silence', async () => {
    let release!: () => void
    const h = harness({
      manifests: [
        testManifest({
          load: async () => ({ strudel: {
            activate(host) {
              host.registerSound(TEST_SOUND, () => undefined)
              host.onPrepare(() => new Promise<void>((r) => (release = r)))
              host.onPrepare(() => undefined)
            },
          } }),
        }),
      ],
    })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await h.audio.attachStrudel(h.doors)
    await h.audio.prepare(20)
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0]).toEqual({ level: 'warn', message: expect.stringContaining('Test extension extension was still getting ready') })
    release()
  })

  it('a cancelled render stops waiting for a slow preparation at once, and says nothing about the extension being slow', async () => {
    let release!: () => void
    let finished = false
    const h = harness({
      manifests: [
        testManifest({
          load: async () => ({ strudel: {
            activate(host) {
              host.registerSound(TEST_SOUND, () => undefined)
              host.onPrepare(() =>
                new Promise<void>((r) => (release = r)).then(() => {
                  finished = true
                }),
              )
            },
          } }),
        }),
      ],
    })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await h.audio.attachStrudel(h.doors)

    const cancel = new AbortController()
    const t0 = Date.now()
    const waiting = h.audio.prepare(10_000, cancel.signal)
    setTimeout(() => cancel.abort(), 10)
    await waiting
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(h.rows).toEqual([])

    // already cancelled: returns without starting anything
    const before = Date.now()
    await h.audio.prepare(10_000, cancel.signal)
    expect(Date.now() - before).toBeLessThan(50)

    // the preparation itself kept going, ready for next time
    release()
    await new Promise((r) => setTimeout(r, 0))
    expect(finished).toBe(true)
  })

  it('an undo that throws on switch-off reaches the Console', async () => {
    const h = harness({
      manifests: [
        testManifest({
          load: async () => ({ strudel: {
            activate(host) {
              host.registerSound(TEST_SOUND, () => undefined)
              host.onDeactivate(() => {
                throw new Error('stuck')
              })
            },
          } }),
        }),
      ],
    })
    await h.audio.attachStrudel(h.doors)
    await h.flip([])
    expect(soundNames()).not.toContain(TEST_SOUND)
    expect(h.rows).toEqual([{ level: 'warn', message: expect.stringContaining('did not undo everything (stuck)') }])
  })

  it('one extension that fails does not stop another from switching on', async () => {
    const steps: string[] = []
    const broken = testManifest({ id: 'zzbroken', name: 'Broken', provides: {}, load: async () => { throw new Error('chunk 404') } })
    const h = harness({ manifests: [workletManifest(steps), broken], on: ['zzext', 'zzbroken'] })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await h.audio.attachStrudel(h.doors)
    expect(h.audio.manager.isActive('zzext')).toBe(true)
    expect(h.rows).toEqual([{ level: 'error', message: 'Broken extension could not be switched on: chunk 404.' }])
    // the one that worked is on in full
    expect(h.audio.manager.isPartActive('zzext', 'strudel')).toBe(true)
  })

  it('remembers which extension failed to switch on, until it works or is switched off (#2552)', async () => {
    let fail = true
    const flaky = testManifest({
      id: 'zzflaky',
      name: 'Flaky',
      provides: {},
      load: async () => {
        if (fail) throw new Error('chunk 404')
        return {}
      },
    })
    const h = harness({ manifests: [testManifest(), flaky], on: ['zzext', 'zzflaky'] })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await h.audio.attachStrudel(h.doors)
    expect(h.audio.failure('zzflaky')).toBe('chunk 404.')
    expect(h.audio.failure('zzext')).toBeUndefined()
    const changesAfterFailing = h.changes()

    // switched off: nothing to report any more, and the view hears it
    await h.flip(['zzext'])
    expect(h.audio.failure('zzflaky')).toBeUndefined()
    expect(h.changes()).toBeGreaterThan(changesAfterFailing)

    // failing again, then working on a later pass: the failure goes
    await h.flip(['zzext', 'zzflaky'])
    expect(h.audio.failure('zzflaky')).toBe('chunk 404.')
    fail = false
    const before = h.changes()
    await h.flip(['zzext', 'zzflaky'])
    expect(h.audio.manager.isActive('zzflaky')).toBe(true)
    expect(h.audio.failure('zzflaky')).toBeUndefined()
    expect(h.changes()).toBeGreaterThan(before)
    h.audio.manager.deactivate('zzflaky')
  })
})

describe('createExtensionRuntime: in parts, from page load (#2538)', () => {
  /** a '*' extension whose common part sets a global (it has no Strudel part) */
  function editorWide(log: string[] = []): ExtensionManifest {
    return testManifest({
      id: 'zzeditorwide',
      name: 'Wide',
      languages: '*',
      provides: undefined,
      load: async () => ({
        activate(host) {
          g.zzWideOn = true
          log.push('wide on')
          host.onDeactivate(() => {
            delete g.zzWideOn
            log.push('wide off')
          })
        },
      }),
    })
  }

  it("a '*' extension's common part is on after start, with no Strudel engine attached", async () => {
    const log: string[] = []
    const h = harness({ manifests: [editorWide(log)], on: ['zzeditorwide'] })
    cleanup = () => h.audio.manager.deactivate('zzeditorwide')
    await h.audio.start({ report: (level, message) => h.rows.push({ level, message }) })
    expect(h.audio.manager.isActive('zzeditorwide')).toBe(true)
    expect(g.zzWideOn).toBe(true)
    expect(log).toEqual(['wide on'])
    // and it follows the switches from page load, still with no engine
    await h.flip([])
    expect(g.zzWideOn).toBeUndefined()
    expect(log).toEqual(['wide on', 'wide off'])
    await h.flip(['zzeditorwide'])
    expect(g.zzWideOn).toBe(true)
    expect(h.rows).toEqual([])
  })

  it("a Strudel extension's Strudel part is on only once the engine attaches, and at once when switched on after that", async () => {
    const steps: string[] = []
    const h = harness({ manifests: [workletManifest(steps)], on: ['zzext'] })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await h.audio.start({ report: (level, message) => h.rows.push({ level, message }) })
    expect(h.audio.manager.isActive('zzext')).toBe(true)
    expect(h.audio.manager.isPartActive('zzext', 'strudel')).toBe(false)
    expect(soundNames()).not.toContain(TEST_SOUND)
    expect(h.steps).toEqual([])
    expect(h.changes()).toBe(1) // the common part came on

    await h.audio.attachStrudel(h.doors)
    expect(h.audio.manager.isPartActive('zzext', 'strudel')).toBe(true)
    expect(soundNames()).toContain(TEST_SOUND)
    expect(h.changes()).toBe(2) // the engine reads its sound names again

    // switched off and on again while attached: the Strudel part is on with no new attach
    await h.flip([])
    expect(soundNames()).not.toContain(TEST_SOUND)
    await h.flip(['zzext'])
    expect(h.audio.manager.isPartActive('zzext', 'strudel')).toBe(true)
    expect(soundNames()).toContain(TEST_SOUND)
    expect(h.rows).toEqual([])
  })

  it('an engine that attaches before start still gets the extensions, and its report is used until start gives one', async () => {
    const log: string[] = []
    const broken = testManifest({ id: 'zzbroken', name: 'Broken', languages: '*', provides: undefined, load: async () => { throw new Error('chunk 404') } })
    const h = harness({ manifests: [testManifest({}, log), broken], on: ['zzext', 'zzbroken'] })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await h.audio.attachStrudel(h.doors)
    expect(h.audio.manager.isActive('zzext')).toBe(true)
    expect(h.audio.manager.isPartActive('zzext', 'strudel')).toBe(true)
    expect(soundNames()).toContain(TEST_SOUND)
    expect(h.rows).toEqual([{ level: 'error', message: 'Broken extension could not be switched on: chunk 404.' }])
    expect(h.subscribers()).toBe(1)

    // start later joins what is running: no second subscription, no second activation
    const pageRows: string[] = []
    await h.audio.start({ report: (_level, message) => pageRows.push(message) })
    expect(h.subscribers()).toBe(1)
    // and from now on rows go to the page's report
    await h.flip(['zzext'])
    await h.flip(['zzext', 'zzbroken'])
    expect(pageRows).toEqual(['Broken extension could not be switched on: chunk 404.'])
    expect(h.rows).toHaveLength(1)
  })

  it('switching off undoes the Strudel part before the common part, and leaves nothing behind', async () => {
    const order: string[] = []
    const before = {
      sounds: soundNames().sort(),
      methods: Object.getOwnPropertyNames((core as any).Pattern.prototype).sort(),
      globals: Object.getOwnPropertyNames(globalThis).sort(),
    }
    const h = harness({
      manifests: [
        testManifest({
          load: async () => ({
            activate(host) {
              host.onDeactivate(() => order.push(`common (sound ${soundNames().includes(TEST_SOUND) ? 'still there' : 'gone'})`))
            },
            strudel: {
              activate(host) {
                testPart().activate(host)
                host.onDeactivate(() => order.push('strudel'))
              },
            },
          }),
        }),
      ],
    })
    await h.audio.start({ report: (level, message) => h.rows.push({ level, message }) })
    await h.audio.attachStrudel(h.doors)
    expect(soundNames()).toContain(TEST_SOUND)
    await h.flip([])
    expect(order).toEqual(['strudel', 'common (sound gone)'])
    expect({
      sounds: soundNames().sort(),
      methods: Object.getOwnPropertyNames((core as any).Pattern.prototype).sort(),
      globals: Object.getOwnPropertyNames(globalThis).sort(),
    }).toEqual(before)
    expect(h.audio.manager.activeIds()).toEqual([])
    expect(h.rows).toEqual([])
  })

  it("a Strudel part that fails is reported under the extension's name and left off; its common part stays on", async () => {
    const log: string[] = []
    const h = harness({
      manifests: [
        testManifest({
          load: async () => ({
            activate(host) {
              g.zzCommonOn = true
              host.onDeactivate(() => {
                delete g.zzCommonOn
                log.push('common off')
              })
            },
            strudel: {
              activate(host) {
                host.registerSound(TEST_SOUND, () => undefined)
                throw new Error('no voice model')
              },
            },
          }),
        }),
      ],
    })
    await h.audio.start({ report: (level, message) => h.rows.push({ level, message }) })
    await h.audio.attachStrudel(h.doors)
    expect(h.rows).toEqual([
      { level: 'error', message: 'The Test extension extension could not be switched on for Strudel: no voice model.' },
    ])
    expect(h.audio.manager.isActive('zzext')).toBe(true)
    expect(h.audio.manager.isPartActive('zzext', 'strudel')).toBe(false)
    // the view hears that its Strudel part failed, though the common part is on (#2552)
    expect(h.audio.failure('zzext')).toBe('Its Strudel part failed: no voice model.')
    expect(g.zzCommonOn).toBe(true)
    expect(soundNames()).not.toContain(TEST_SOUND)
    // switched off, the common part is undone as usual
    await h.flip([])
    expect(log).toEqual(['common off'])
    expect(g.zzCommonOn).toBeUndefined()
  })

  it('start can run again: one subscription, one activation', async () => {
    let loads = 0
    const h = harness({ manifests: [testManifest({ load: async () => (loads++, { activate: () => undefined }) })] })
    cleanup = () => h.audio.manager.deactivate('zzext')
    const report = () => undefined
    await Promise.all([h.audio.start({ report }), h.audio.start({ report })])
    await h.audio.start({ report })
    expect(loads).toBe(1)
    expect(h.subscribers()).toBe(1)
    expect(h.audio.manager.isActive('zzext')).toBe(true)
  })

})
