/**
 * #2209, #2210 — a visual is compiled with the FILE its errors belong to.
 *
 * A preview's preset is named by its path. A visual used by name
 * (`.viz("Prism")`) is named `Prism`, and errors written against that name
 * have no file to land on; its preset carries the path in `filePath`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const made: Array<[string, string]> = []
// The real factories pull in p5 → gifenc, which the vitest loader can't take.
vi.mock('../renderers/makeP5Renderer', () => ({
  makeP5Renderer: (_code: string, name: string) => { made.push(['p5', name]); return {} },
  shouldUseWorkerRenderer: () => false,
}))
vi.mock('../renderers/makeHydraRenderer', () => ({
  makeHydraRenderer: (_code: string, name: string) => { made.push(['hydra', name]); return {} },
}))
vi.mock('../renderers/makeGLSLRenderer', () => ({
  makeGLSLRenderer: (_code: string, name: string) => { made.push(['glsl', name]); return {} },
}))

import { compilePreset } from '../vizCompiler'
import type { VizPreset } from '../vizPreset'

const preset = (over: Partial<VizPreset>): VizPreset => ({
  id: 'x', name: 'Prism', renderer: 'glsl', code: '', requires: [], createdAt: 0, updatedAt: 0, ...over,
})

beforeEach(() => { made.length = 0 })

describe('compilePreset — which file a visual reports its errors against', () => {
  it('a visual used by name reports against the file it was saved from', () => {
    for (const renderer of ['glsl', 'hydra', 'p5'] as const) {
      const d = compilePreset(preset({ renderer, filePath: `viz_lib/Prism/Prism.${renderer}` }))
      d.factory()
      expect(d.label).toBe('Prism') // the name stays its label
    }
    expect(made).toEqual([
      ['glsl', 'viz_lib/Prism/Prism.glsl'],
      ['hydra', 'viz_lib/Prism/Prism.hydra'],
      ['p5', 'viz_lib/Prism/Prism.p5'],
    ])
  })

  it('a preset with no file (a preview, or a bundled default) keeps its name', () => {
    compilePreset(preset({ name: 'viz_lib/Prism/Prism.glsl' })).factory()
    compilePreset(preset({ name: 'creation' })).factory()
    expect(made).toEqual([['glsl', 'viz_lib/Prism/Prism.glsl'], ['glsl', 'creation']])
  })
})
