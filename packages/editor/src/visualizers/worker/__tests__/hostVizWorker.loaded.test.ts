/**
 * #2560 — the worker's two startup signals, driven through the real host with a
 * three.js sketch that draws no WebGL (jsdom has none):
 *   - `alive` the moment the host takes the mount (what the probation judges);
 *   - `loaded` once the sketch has set up (its top level ran, its loads are in);
 *   - a WARM-UP mount draws one frame before `loaded`, while no signal frame
 *     ever arrives (it is hidden and paused), and that frame counts as `ready`.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { hostVizWorker } from '../hostP5Worker'
import type { MountMessage } from '../workerMessages'

function fakeScope() {
  const posted: Array<{ type?: string; message?: string }> = []
  const listeners: Array<(ev: { data: unknown }) => void> = []
  const scope = {
    postMessage: (m: unknown) => posted.push(m as { type?: string }),
    addEventListener: (_t: 'message', h: (ev: { data: unknown }) => void) => {
      listeners.push(h)
    },
    removeEventListener: () => {},
  }
  return {
    scope,
    send: (data: unknown) => {
      for (const l of listeners) l({ data })
    },
    types: () => posted.map((m) => m.type).filter((t) => t !== 'diag'),
  }
}

function mountMsg(code: string, warm: boolean): MountMessage {
  return {
    type: 'mount',
    kind: 'three',
    code,
    name: 'Sketch.three',
    canvas: { width: 0, height: 0 } as unknown as OffscreenCanvas,
    size: { w: 100, h: 50 },
    dpr: 1,
    ...(warm ? { warm: true } : {}),
  }
}

const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const SLOW_TOP = `
  import * as THREE from 'three'
  globalThis.__w = { top: (globalThis.__w?.top ?? 0) + 1, frames: 0 }
  requestAnimationFrame(() => { __w.frames++ })
  await new Promise((ok) => setTimeout(ok, 60))
`

describe('hostVizWorker alive / loaded (#2560)', () => {
  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).__w = undefined
  })

  it('says alive at once, loaded only after the sketch has set up', async () => {
    const w = fakeScope()
    hostVizWorker(w.scope)
    w.send(mountMsg(SLOW_TOP, false))
    expect(w.types()[0]).toBe('alive') // before the sketch has even compiled
    await until(() => (globalThis as Record<string, any>).__w !== undefined)
    expect(w.types()).not.toContain('loaded') // the top level is still awaiting
    await until(() => w.types().includes('loaded'))
    // not a warm-up: no frame drawn without a signal frame
    expect((globalThis as Record<string, any>).__w.frames).toBe(0)
    expect(w.types()).not.toContain('ready')
  })

  it('a warm-up mount draws one hidden frame, then says ready and loaded', async () => {
    const w = fakeScope()
    hostVizWorker(w.scope)
    w.send(mountMsg(SLOW_TOP, true))
    await until(() => w.types().includes('loaded'))
    expect((globalThis as Record<string, any>).__w.frames).toBe(1)
    const t = w.types()
    expect(t.indexOf('ready')).toBeGreaterThan(-1)
    expect(t.indexOf('ready')).toBeLessThan(t.indexOf('loaded'))
    expect((globalThis as Record<string, any>).__w.top).toBe(1) // the top level ran once
  })

  it('a sketch destroyed while loading never says loaded', async () => {
    const w = fakeScope()
    hostVizWorker(w.scope)
    w.send(mountMsg(SLOW_TOP, true))
    await until(() => (globalThis as Record<string, any>).__w !== undefined)
    w.send({ type: 'destroy' })
    await new Promise((r) => setTimeout(r, 150))
    expect(w.types()).not.toContain('loaded')
    expect((globalThis as Record<string, any>).__w.frames).toBe(0)
  })
})
