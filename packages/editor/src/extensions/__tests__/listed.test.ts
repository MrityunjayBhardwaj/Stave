/**
 * #2511 — the extensions a page lists: Stave's own, plus a test-only one in end-to-end runs.
 *
 * The Extensions view and the page runtime both read `listedExtensions()`, so what the
 * view shows is what the runtime can switch on. The test extension must never reach a
 * real user's page: without the end-to-end flag the list is exactly `BUILTIN_EXTENSIONS`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { BUILTIN_EXTENSIONS, listedExtensions } from '../builtin'
import { E2E_TONE, E2E_TONE_ID, E2E_TONE_SOUND } from '../e2eTone'
import { createExtensionManager } from '../manager'

const g = globalThis as { __STAVE_E2E__?: unknown }

afterEach(() => {
  delete g.__STAVE_E2E__
})

describe('listedExtensions', () => {
  it('is exactly the built-in list when the page is not an end-to-end run', () => {
    expect(listedExtensions()).toBe(BUILTIN_EXTENSIONS)
    expect(listedExtensions().some((m) => m.id === E2E_TONE_ID)).toBe(false)
  })

  it('only a real `true` counts as an end-to-end run', () => {
    g.__STAVE_E2E__ = 'yes'
    expect(listedExtensions()).toBe(BUILTIN_EXTENSIONS)
  })

  it('adds the test tone, after the built-in ones, in an end-to-end run', () => {
    g.__STAVE_E2E__ = true
    const listed = listedExtensions()
    expect(listed.map((m) => m.id)).toEqual([...BUILTIN_EXTENSIONS.map((m) => m.id), E2E_TONE_ID])
    // the same array on each call, so the view and the runtime read one list
    expect(listedExtensions()).toBe(listed)
  })

  it('every listed manifest is accepted by the manager (ids unique, provides keys declared)', () => {
    g.__STAVE_E2E__ = true
    expect(() => createExtensionManager({ manifests: listedExtensions(), parts: {} })).not.toThrow()
  })
})

describe('what a manifest says it adds matches its code', () => {
  it.each([...BUILTIN_EXTENSIONS, E2E_TONE].map((m) => [m.id, m] as const))(
    '%s: one `about.worklets` line per worklet in its Strudel part',
    async (_id, m) => {
      const mod = await m.load()
      expect(m.about?.worklets?.length ?? 0).toBe(mod.strudel?.worklets?.length ?? 0)
    },
  )
})

describe('the test tone', () => {
  it('declares the one sound it registers, for Strudel only', async () => {
    expect(E2E_TONE.languages).toEqual(['strudel'])
    expect(E2E_TONE.provides?.strudel?.sounds).toEqual([E2E_TONE_SOUND])
    const names: string[] = []
    const mod = await E2E_TONE.load()
    await mod.strudel?.activate({
      id: E2E_TONE_ID,
      registerSound: (name: string) => names.push(name),
      registerControl: () => undefined,
      setGlobal: () => undefined,
      onDeactivate: () => undefined,
      onPrepare: () => undefined,
    })
    expect(names).toEqual([E2E_TONE_SOUND])
  })

  it('hands over the same worklet URL every time it loads (a context refuses a processor name twice)', async () => {
    const a = await E2E_TONE.load()
    const b = await E2E_TONE.load()
    expect(a.strudel?.worklets).toEqual(b.strudel?.worklets)
  })
})
