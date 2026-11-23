/**
 * #2638 — a library Stave fetches must get Stave's own three.js, never a second
 * copy. These tests import generated shim modules for real (as `data:` URLs,
 * which Node imports; the browser uses blob URLs) and compare object identity
 * with what a running sketch sees.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { compileThreeSketch, loadThreeModules, runThreeSketch, type ThreeSketchHost } from '../../renderers/threeSketch'
import { createHostShims, dataModuleUrl, shimSource } from '../hostShims'
import { hostModuleName } from '../hostModules'

const host = (): ThreeSketchHost => ({
  canvas: document.createElement('canvas'),
  size: () => ({ w: 10, h: 10 }),
  dpr: () => 1,
  uniforms: () => ({ sig: () => ({}) }) as never,
  options: () => ({}),
  scheduler: () => null,
  createCanvas: () => document.createElement('canvas'),
  report: () => {},
})

/** What a sketch that imports `spec` sees as that module. */
async function sketchView(spec: string): Promise<Record<string, unknown>> {
  const compiled = compileThreeSketch(`import * as M from '${spec}'\nglobalThis.__sketchView = M\n`)
  const loaded = await loadThreeModules(compiled)
  const run = runThreeSketch(compiled, loaded, host())
  expect((await run.done).error).toBeNull()
  run.dispose()
  return (globalThis as Record<string, unknown>).__sketchView as Record<string, unknown>
}

/** A "library": a module that imports `spec` through its shim URL and re-exports it. */
async function libraryView(shimUrl: string): Promise<Record<string, unknown>> {
  const lib = await import(/* @vite-ignore */ dataModuleUrl(`import * as T from ${JSON.stringify(shimUrl)};\nexport const view = T;\n`))
  return lib.view as Record<string, unknown>
}

/** A file URL for a copy of three's build (module + core) in a temp folder. */
function secondThreeUrl(): string {
  const require = createRequire(import.meta.url)
  const build = path.dirname(require.resolve('three'))
  // Inside the package (node_modules/.cache), where the test runner serves files from.
  const cache = path.join(path.dirname(require.resolve('../../../../package.json')), 'node_modules', '.cache')
  const dir = path.join(cache, 'second-three')
  fs.mkdirSync(dir, { recursive: true })
  for (const f of ['three.module.js', 'three.core.js']) fs.copyFileSync(path.join(build, f), path.join(dir, f))
  return path.join(dir, 'three.module.js')
}

/** Keys of `a` whose value is not the very same object in `b`. */
function notShared(a: Record<string, unknown>, b: Record<string, unknown>, skip: string[] = []): string[] {
  return Object.keys(a).filter((k) => !skip.includes(k) && a[k] !== b[k])
}

describe("a library reaches Stave's own three.js through the shim (#2638)", () => {
  it("a module importing 'three' through the shim gets the sketch's THREE: every export the same object", async () => {
    const shims = createHostShims({ makeUrl: dataModuleUrl })
    const lib = await libraryView((await shims.urlFor('three'))!)
    const sketch = await sketchView('three')
    expect(Object.keys(lib).length).toBeGreaterThan(400)
    // The sketch's copy differs only where Stave patches it on purpose: its own
    // renderer subclass (on the viz canvas) and, in a worker, its texture loader.
    expect(notShared(lib, sketch, ['WebGLRenderer', 'TextureLoader'])).toEqual([])
    expect(lib.Mesh).toBe(sketch.Mesh)
    // The sketch's renderer IS a three WebGLRenderer, so a library's instanceof holds.
    expect((sketch.WebGLRenderer as { prototype: object }).prototype instanceof (lib.WebGLRenderer as never)).toBe(true)
  })

  it('mutation: a shim pointed at a second three.js fails the identity check', async () => {
    // A real second copy: three's build files copied elsewhere and imported from
    // there, so it has its own classes — what a CDN copy next to Stave's would be.
    const real = await import('three')
    const second = await import(/* @vite-ignore */ secondThreeUrl())
    expect(second.Mesh).not.toBe(real.Mesh)
    const shims = createHostShims({ makeUrl: dataModuleUrl, load: async (n) => (n === 'three' ? second : null) })
    const lib = await libraryView((await shims.urlFor('three'))!)
    const sketch = await sketchView('three')
    // The same identity check as above, now failing: every class and shared table
    // differs (constants still compare equal by value). ShaderChunk is where a
    // library such as Spark registers its shader chunks (`splatDefines`).
    const differ = notShared(lib, sketch, ['WebGLRenderer', 'TextureLoader'])
    expect(differ).toContain('ShaderChunk')
    expect(differ).toContain('Mesh')
    expect(differ.length).toBeGreaterThan(200)
  })

  it("import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js' works in a sketch, and a library gets the same one", async () => {
    const compiled = compileThreeSketch(
      "import * as THREE from 'three'\nimport { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js'\nglobalThis.__pass = { FullScreenQuad, Pass, quad: new FullScreenQuad(new THREE.MeshBasicMaterial()) }\n",
    )
    const loaded = await loadThreeModules(compiled)
    const run = runThreeSketch(compiled, loaded, host())
    expect((await run.done).error).toBeNull()
    const got = (globalThis as Record<string, any>).__pass // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(typeof got.FullScreenQuad).toBe('function')
    expect(got.quad).toBeInstanceOf(got.FullScreenQuad)
    run.dispose()

    const shims = createHostShims({ makeUrl: dataModuleUrl })
    const lib = await libraryView((await shims.urlFor('three/addons/postprocessing/Pass.js'))!)
    expect(lib.FullScreenQuad).toBe(got.FullScreenQuad)
    expect(lib.Pass).toBe(got.Pass)
  })

  it('the old examples/jsm path and the addons path are one module', async () => {
    const shims = createHostShims({ makeUrl: dataModuleUrl })
    expect(hostModuleName('three/examples/jsm/postprocessing/Pass')).toBe('three/addons/postprocessing/Pass.js')
    expect(await shims.urlFor('three/examples/jsm/postprocessing/Pass.js')).toBe(await shims.urlFor('three/addons/postprocessing/Pass.js'))
  })

  it('names that are not host modules get no shim', async () => {
    const shims = createHostShims({ makeUrl: dataModuleUrl })
    expect(await shims.urlFor('@sparkjsdev/spark')).toBeNull()
    expect(await shims.urlFor('three/addons/loaders/TTFLoader.js')).toBeNull() // left out: imports a CDN URL
    expect(await shims.urlFor('three/addons/controls/OrbitControls.js')).toBeNull() // needs pointer input
  })
})

describe('shimSource', () => {
  it('re-exports default, ordinary, reserved-word and non-identifier names', async () => {
    const ns = { default: 'd', Mesh: 'm', delete: 'x', 'not-an-id': 'n' }
    ;(globalThis as Record<string, unknown>).__staveHostModules ??= Object.create(null)
    ;((globalThis as Record<string, unknown>).__staveHostModules as Record<string, unknown>)['t:ns'] = ns
    const m = await import(/* @vite-ignore */ dataModuleUrl(shimSource('t:ns', ns)))
    expect({ ...m }).toEqual(ns)
  })
})
