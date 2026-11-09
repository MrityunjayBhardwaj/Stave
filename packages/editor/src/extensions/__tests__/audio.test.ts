/**
 * #2510 — the page's extensions runtime: start-up, live on/off, worklets, preparation and
 * what reaches the Console. Against Strudel's REAL registries (see host.test.ts); the audio
 * context is a stand-in that records `addModule`, because jsdom has no audio.
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as webaudio from '@strudel/webaudio'
import * as core from '@strudel/core'
import { createExtensionAudio, type ExtensionAudioDoors } from '../audio'
import { fromStrudel, RESIDUE } from '../host'
import type { ExtensionManifest, ExtensionModule } from '../types'
import { testModule, testManifest, TEST_SOUND, TEST_CONTROL } from './testExtension'

/* eslint-disable @typescript-eslint/no-explicit-any */
const soundNames = () => Object.keys((webaudio as any).soundMap.get())
const WORKLET = 'blob:zzext-worklet'

function harness(opts: { manifests?: ExtensionManifest[]; on?: string[]; badUrls?: string[]; log?: string[] } = {}) {
  let ids = new Set(opts.on ?? ['zzext'])
  const subs = new Set<(ids: ReadonlySet<string>) => void>()
  const steps: string[] = opts.log ?? []
  const rows: { level: string; message: string }[] = []
  const doors: ExtensionAudioDoors = {
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
  const audio = createExtensionAudio({
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
    // Only the subscription may act here: calling start() would re-read the switches
    // itself and hide a runtime that stopped following them. Let the load/activate
    // chain settle (every step in it is a resolved promise or a macrotask away).
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
  }
  return { audio, doors, steps, rows, flip, changes: () => changes, subscribers: () => subs.size }
}

/** the test extension, plus a worklet and a preparation step, logging what happens */
function workletManifest(steps: string[], over: Partial<ExtensionModule> = {}): ExtensionManifest {
  return testManifest({
    load: async () => {
      const base = testModule()
      return {
        worklets: [WORKLET],
        async activate(host) {
          steps.push('activate')
          await base.activate(host)
          host.onPrepare(() => {
            steps.push('prepare')
          })
        },
        ...over,
      }
    },
  })
}

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

describe('createExtensionAudio', () => {
  it('start: the worklet goes into the live context, THEN to Strudel, THEN the extension activates', async () => {
    const steps: string[] = []
    const h = harness({ manifests: [workletManifest(steps)], log: steps })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await h.audio.start(h.doors)
    expect(steps).toEqual([`addModule ${WORKLET}`, `registerWorklet ${WORKLET}`, 'activate'])
    expect(soundNames()).toContain(TEST_SOUND)
    expect(h.audio.manager.isActive('zzext')).toBe(true)
    expect(h.rows).toEqual([])
  })

  it('a worklet that fails to load is never handed to Strudel, nothing is registered, and the Console names the extension', async () => {
    const steps: string[] = []
    const h = harness({ manifests: [workletManifest(steps)], badUrls: [WORKLET] })
    const before = soundNames().sort()
    await h.audio.start(h.doors)
    expect(h.steps).toEqual([`addModule ${WORKLET}`])
    expect(steps).toEqual([])
    expect(h.audio.manager.isActive('zzext')).toBe(false)
    expect(soundNames().sort()).toEqual(before)
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0].level).toBe('error')
    expect(h.rows[0].message).toContain('Test extension')
    expect(h.rows[0].message).toContain('audio worklet did not load')
  })

  it('start can run again (a retried init, a second engine): one activation, one worklet registration, one subscription', async () => {
    const steps: string[] = []
    const h = harness({ manifests: [workletManifest(steps)] })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await Promise.all([h.audio.start(h.doors), h.audio.start(h.doors)])
    await h.audio.start(h.doors)
    expect(steps).toEqual(['activate'])
    expect(h.steps.filter((s) => s.startsWith('registerWorklet'))).toHaveLength(1)
    expect(h.subscribers()).toBe(1)
  })

  it('switched on while running, it plays with no reload; switched off, its sound is gone again', async () => {
    const steps: string[] = []
    const h = harness({ manifests: [workletManifest(steps)], on: [] })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await h.audio.start(h.doors)
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
    await h.audio.start(h.doors)
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
          load: async () => ({
            activate(host) {
              host.registerSound(TEST_SOUND, () => undefined)
              host.onPrepare(async () => {
                throw new Error('wasm missing')
              })
            },
          }),
        }),
      ],
    })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await h.audio.start(h.doors)
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
          load: async () => ({
            activate(host) {
              host.registerSound(TEST_SOUND, () => undefined)
              host.onPrepare(() => new Promise<void>((r) => (release = r)))
              host.onPrepare(() => undefined)
            },
          }),
        }),
      ],
    })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await h.audio.start(h.doors)
    await h.audio.prepare(20)
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0]).toEqual({ level: 'warn', message: expect.stringContaining('Test extension extension was still getting ready') })
    release()
  })

  it('an undo that throws on switch-off reaches the Console', async () => {
    const h = harness({
      manifests: [
        testManifest({
          load: async () => ({
            activate(host) {
              host.registerSound(TEST_SOUND, () => undefined)
              host.onDeactivate(() => {
                throw new Error('stuck')
              })
            },
          }),
        }),
      ],
    })
    await h.audio.start(h.doors)
    await h.flip([])
    expect(soundNames()).not.toContain(TEST_SOUND)
    expect(h.rows).toEqual([{ level: 'warn', message: expect.stringContaining('did not undo everything (stuck)') }])
  })

  it('one extension that fails does not stop another from switching on', async () => {
    const steps: string[] = []
    const broken = testManifest({ id: 'zzbroken', name: 'Broken', provides: {}, load: async () => { throw new Error('chunk 404') } })
    const h = harness({ manifests: [workletManifest(steps), broken], on: ['zzext', 'zzbroken'] })
    cleanup = () => h.audio.manager.deactivate('zzext')
    await h.audio.start(h.doors)
    expect(h.audio.manager.isActive('zzext')).toBe(true)
    expect(h.rows).toEqual([{ level: 'error', message: 'Broken extension could not be switched on: chunk 404.' }])
  })
})
