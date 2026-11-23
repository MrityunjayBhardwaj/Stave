/**
 * #2642 — the asset library's live card preview (`mountVizPreview`) gives a
 * three.js sketch the project's stave.libs.json, as every other renderer of a
 * sketch does (makeThreeRenderer), so a card whose sketch imports a declared
 * library previews instead of being refused.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const made: Array<{ kind: string; extras: unknown }> = []

vi.mock('../renderers/WorkerVizRenderer', () => ({
  WorkerVizRenderer: class {
    constructor(kind: string, _code: string, _name: string, extras: unknown) {
      made.push({ kind, extras })
    }
    setDemoSource() {}
    destroy() {}
  },
}))
vi.mock('../renderers/makeP5Renderer', () => ({ shouldUseWorkerRenderer: () => true }))
vi.mock('../mountVizRenderer', () => ({
  mountVizRenderer: (_c: unknown, source: () => unknown) => ({ renderer: source(), disconnect: () => {} }),
}))
vi.mock('../demoSignalSource', () => ({ createDrumDemoSignalSource: () => ({}) }))

import { mountVizPreview } from '../mountVizPreview'
import { setProjectLibrariesSource } from '../libraries/projectLibraries'

const LIBS = '{ "@sparkjsdev/spark": { "url": "https://esm.sh/@sparkjsdev/spark@2.4.0" } }'
const box = {} as HTMLDivElement
const size = { w: 160, h: 90 }

afterEach(() => {
  made.length = 0
  setProjectLibrariesSource(null)
})

describe('mountVizPreview passes a sketch its libraries (#2642)', () => {
  it("a three sketch gets the project's stave.libs.json", () => {
    setProjectLibrariesSource(() => LIBS)
    mountVizPreview(box, { renderer: 'three', code: '', name: 'card' }, size, () => {})
    expect(made).toEqual([{ kind: 'three', extras: { libs: LIBS } }])
  })

  it('an explicit libs wins over the project file', () => {
    setProjectLibrariesSource(() => LIBS)
    mountVizPreview(box, { renderer: 'three', code: '', name: 'card', libs: null }, size, () => {})
    expect(made).toEqual([{ kind: 'three', extras: { libs: null } }])
  })

  it('other kinds get none', () => {
    setProjectLibrariesSource(() => LIBS)
    mountVizPreview(box, { renderer: 'hydra', code: '', name: 'card' }, size, () => {})
    expect(made).toEqual([{ kind: 'hydra', extras: { libs: null } }])
  })
})
