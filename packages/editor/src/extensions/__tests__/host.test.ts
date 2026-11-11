/**
 * #2509 — the recording host (the Strudel part's, #2538), against Strudel's REAL registries (`@strudel/webaudio`'s
 * sound map, `@strudel/core`'s Pattern and controls) and the real `globalThis`.
 *
 * The headline test is "off means exactly as before": snapshot what an extension can
 * touch, switch the test extension on and off, snapshot again, compare. Breaking any one
 * undo (sound, control method, control global, plain global) must turn it red.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as webaudio from '@strudel/webaudio'
import * as core from '@strudel/core'
import { createCommonHost, createRecordingHost, fromStrudel, isNameTaken, type HostRegistries } from '../host'
import { testPart, TEST_SOUND, TEST_CONTROL, TEST_GLOBAL } from './testExtension'

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any

function snapshot() {
  return {
    sounds: Object.keys((webaudio as any).soundMap.get()).sort(),
    methods: Object.getOwnPropertyNames((core as any).Pattern.prototype).sort(),
    globals: Object.getOwnPropertyNames(globalThis).sort(),
  }
}

// The engine is not started here, so the sound map holds no built-in sounds. One stands in
// for "a sound Stave already has", registered straight into superdough as Stave would.
const EXISTING = 'zzexisting'
let reg: HostRegistries
beforeAll(() => {
  reg = fromStrudel(webaudio, core)
  ;(webaudio as any).registerSound(EXISTING, () => undefined, { type: 'synth' })
})
afterAll(() => {
  ;(webaudio as any).soundMap.setKey(EXISTING, undefined)
})

describe('createRecordingHost', () => {
  it('switching an extension on and then off leaves the sound map, Pattern and the globals exactly as before', async () => {
    const before = snapshot()
    const rec = createRecordingHost('zzext', reg)
    await testPart().activate(rec.host)

    // it really did register each kind (otherwise "unchanged" would prove nothing)
    expect(Object.keys((webaudio as any).soundMap.get())).toContain(TEST_SOUND)
    expect(TEST_CONTROL in (core as any).Pattern.prototype).toBe(true)
    expect(typeof g[TEST_CONTROL]).toBe('function')
    expect(g[TEST_GLOBAL]).toBe(42)

    expect(rec.undo()).toEqual([])
    expect(snapshot()).toEqual(before)
  })

  it('the control it adds works as Strudel controls do, as a method and as a global', async () => {
    const rec = createRecordingHost('zzext', reg)
    try {
      await testPart().activate(rec.host)
      const pat = (core as any).note('c4')[TEST_CONTROL]('hi')
      expect(pat.firstCycle()[0].value[TEST_CONTROL]).toBe('hi')
      expect(g[TEST_CONTROL]('hi').firstCycle()[0].value).toEqual({ [TEST_CONTROL]: 'hi' })
    } finally {
      rec.undo()
    }
  })

  it('with the manifest\'s names given, refuses anything it did not declare, and accepts what it did', () => {
    const rec = createRecordingHost('zzext', reg, { sounds: [TEST_SOUND], controls: [TEST_CONTROL] })
    try {
      expect(() => rec.host.registerSound('zz_undeclared', () => undefined)).toThrow(/without declaring it/)
      expect(() => rec.host.registerControl('zzundeclared')).toThrow(/without declaring it/)
      expect(Object.keys((webaudio as any).soundMap.get())).not.toContain('zz_undeclared')
      expect('zzundeclared' in (core as any).Pattern.prototype).toBe(false)
      rec.host.registerSound(TEST_SOUND.toUpperCase(), () => undefined)
      rec.host.registerControl(TEST_CONTROL)
    } finally {
      rec.undo()
    }
  })

  it('refuses a name that is already taken, and says which, without touching the original', () => {
    const rec = createRecordingHost('zzext', reg)
    const original = (webaudio as any).soundMap.get()[EXISTING]
    expect(original).toBeTruthy()
    let err: unknown
    try {
      rec.host.registerSound(EXISTING, () => undefined)
    } catch (e) {
      err = e
    }
    expect(isNameTaken(err)).toBe(true)
    expect(err).toMatchObject({ kind: 'sound', taken: EXISTING, extensionId: 'zzext' })
    expect(() => rec.host.registerControl('note')).toThrow(/already in use/)
    expect(() => rec.host.setGlobal('setTimeout', 1)).toThrow(/already in use/)
    rec.undo()
    expect((webaudio as any).soundMap.get()[EXISTING]).toBe(original)
    expect(typeof (core as any).Pattern.prototype.note).toBe('function')
    expect(typeof setTimeout).toBe('function')
  })

  it('sound names are taken case-insensitively, the way superdough stores them', () => {
    const rec = createRecordingHost('zzext', reg)
    expect(() => rec.host.registerSound('ZZExisting', () => undefined)).toThrow(/already in use/)
    rec.undo()
  })

  it('runs onDeactivate first, then undoes newest first, and every undo runs even if one throws', () => {
    const order: string[] = []
    const fake: HostRegistries = {
      sounds: { has: () => false, add: () => order.push('+sound'), remove: () => order.push('-sound') },
      controls: {
        has: () => false,
        add: () => order.push('+control'),
        remove: () => {
          order.push('-control')
          throw new Error('boom')
        },
      },
      globals: {},
    }
    const rec = createRecordingHost('x', fake)
    rec.host.registerSound('a', () => undefined)
    rec.host.registerControl('b')
    rec.host.onDeactivate(() => order.push('cleanup'))
    const errors = rec.undo()
    expect(order).toEqual(['+sound', '+control', 'cleanup', '-control', '-sound'])
    expect(errors).toHaveLength(1)
    expect(fake.globals).toEqual({})
  })

  it('onPrepare callbacks are listed while on and gone once undone (#2510)', () => {
    const rec = createRecordingHost('zzext', reg)
    const a = () => undefined
    const b = () => undefined
    rec.host.onPrepare(a)
    rec.host.onPrepare(b)
    expect(rec.preparers()).toEqual([a, b])
    expect(rec.undo()).toEqual([])
    expect(rec.preparers()).toEqual([])
  })

  it('a host that has been undone refuses further registrations', () => {
    const rec = createRecordingHost('zzext', reg)
    rec.undo()
    expect(() => rec.host.registerSound('zz_late', () => undefined)).toThrow(/switched off/)
    expect(Object.keys((webaudio as any).soundMap.get())).not.toContain('zz_late')
  })
})

describe('createCommonHost (#2538)', () => {
  it('names no language: an id, onDeactivate, and the editor hook and keys (#2513), nothing else', () => {
    const rec = createCommonHost('zzext')
    expect(Object.keys(rec.host).sort()).toEqual(['id', 'onDeactivate', 'onEditor', 'takesKey'])
    rec.undo()
  })

  it('undo runs its onDeactivate callbacks newest first, every one even if one throws, then refuses more', () => {
    const order: string[] = []
    const rec = createCommonHost('zzext')
    rec.host.onDeactivate(() => order.push('a'))
    rec.host.onDeactivate(() => {
      order.push('b')
      throw new Error('stuck')
    })
    rec.host.onDeactivate(() => order.push('c'))
    expect(rec.undo()).toHaveLength(1)
    expect(order).toEqual(['c', 'b', 'a'])
    expect(rec.undo()).toEqual([])
    expect(() => rec.host.onDeactivate(() => undefined)).toThrow(/switched off/)
  })
})
