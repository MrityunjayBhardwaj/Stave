/**
 * #2639 — libraries declared in stave.libs.json: the graph loader, the hash,
 * instantiation sharing Stave's three.js, and every refusal message. Modules
 * are real (imported as `data:` URLs); the network is a fake `fetchText`.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { compileThreeSketch, loadThreeModules, ThreeImportError } from '../../renderers/threeSketch'
import { libraryGraphBytes, libraryGraphHash, LibraryLoadError, loadLibraryGraph, type LibraryGraph } from '../graph'
import { instantiateLibraryGraph as instantiateWith } from '../instantiate'
import { createHostShims, dataModuleUrl } from '../hostShims'
import { forgetLoadedLibraries, sketchImportChain, type LibraryGraphCache } from '../declaredLibraries'
import { parseLibraryDeclarations } from '../declarations'

const BASE = 'https://libs.example/pkg@1.0.0/'

// Node imports data: URLs, not blob: URLs (which the browser uses).
const nodeShims = createHostShims({ makeUrl: dataModuleUrl })
const instantiateLibraryGraph = (g: LibraryGraph) => instantiateWith(g, { makeUrl: dataModuleUrl, shims: nodeShims })

/** A fake CDN: url → text; counts what was fetched. */
function cdn(files: Record<string, string>) {
  const fetched: string[] = []
  const fetchText = async (url: string) => {
    fetched.push(url)
    if (!(url in files)) throw new LibraryLoadError(`fetching ${url} failed (HTTP 404)`)
    return files[url]
  }
  return { fetchText, fetched }
}

// A tiny "three.js library": registers a shader chunk on the three it imports
// (as Spark does with splatDefines) and exports a Mesh subclass.
const LIB = {
  [`${BASE}index.js`]: `export * from './mesh.js';\nexport { tag } from "/pkg@1.0.0/tag.js";\n`,
  [`${BASE}mesh.js`]: `import * as THREE from 'three';\nimport { Pass } from 'three/addons/postprocessing/Pass.js';\nTHREE.ShaderChunk.testLibDefines = '// lib';\nglobalThis.__libRan = (globalThis.__libRan ?? 0) + 1;\nexport class LibMesh extends THREE.Mesh {}\nexport const LibPass = Pass;\nexport const libThree = THREE;\n`,
  'https://libs.example/pkg@1.0.0/tag.js': `export const tag = 'lib-1.0.0';\n`,
}

async function graphOf(files: Record<string, string>, entry = `${BASE}index.js`): Promise<LibraryGraph> {
  return loadLibraryGraph(entry, { fetchText: cdn(files).fetchText, instantiate: instantiateLibraryGraph })
}

describe('loadLibraryGraph', () => {
  it('follows relative and absolute imports, never fetches host modules', async () => {
    const { fetchText, fetched } = cdn(LIB)
    const g = await loadLibraryGraph(`${BASE}index.js`, { fetchText })
    expect(Object.keys(g.modules).sort()).toEqual(Object.keys(LIB).sort())
    expect(fetched.some((u) => u.includes('three'))).toBe(false)
    expect(g.entry).toBe(`${BASE}index.js`)
  })

  it('an unresolvable bare specifier inside a library names the module and the specifier', async () => {
    const files = { [`${BASE}index.js`]: `import './a.js'`, [`${BASE}a.js`]: `import { x } from 'left-pad';\nexport { x }` }
    const e = await graphOf(files).catch((x) => x)
    expect(e).toBeInstanceOf(LibraryLoadError)
    expect(e.message).toContain(`${BASE}a.js imports 'left-pad'`)
  })

  it('a three.js path Stave refuses, inside a library, is named with the reason', async () => {
    const files = { [`${BASE}index.js`]: `import { OrbitControls } from 'three/addons/controls/OrbitControls.js'` }
    const e = await graphOf(files).catch((x) => x)
    expect(e.message).toBe(
      `${BASE}index.js imports 'three/addons/controls/OrbitControls.js', which Stave doesn't provide: 'three/addons/controls/OrbitControls.js' needs pointer input, which a Stave viz doesn't receive. Move the camera in code instead (for example from \`sig\` or the time)`,
    )
  })

  it('follows a dynamic import with a literal URL', async () => {
    const files = { [`${BASE}index.js`]: `export const later = () => import("./lazy.js")`, [`${BASE}lazy.js`]: `export const v = 1` }
    expect(Object.keys((await graphOf(files)).modules)).toContain(`${BASE}lazy.js`)
  })
})

describe('libraryGraphHash', () => {
  it("is SHA-384 over the canonical form, equal to Node's crypto", async () => {
    const g = await graphOf(LIB)
    const urls = Object.keys(g.modules).sort()
    const canonical = urls.map((u) => `${u}\n${g.modules[u].length}\n${g.modules[u]}\n`).join('')
    const node = createHash('sha384').update(Buffer.from(canonical, 'utf8')).digest('base64')
    expect(Buffer.from(libraryGraphBytes(g)).toString('utf8')).toBe(canonical)
    expect(await libraryGraphHash(g)).toBe(node)
  })

  it('changes when any module changes, not only the entry', async () => {
    const a = await libraryGraphHash(await graphOf(LIB))
    const b = await libraryGraphHash(await graphOf({ ...LIB, 'https://libs.example/pkg@1.0.0/tag.js': `export const tag = 'evil';\n` }))
    expect(a).not.toBe(b)
  })
})

describe('instantiateLibraryGraph', () => {
  it("runs the library against Stave's own three.js and addons", async () => {
    const g = await graphOf(LIB)
    const lib = await instantiateLibraryGraph(g)
    const THREE = await import('three')
    const { Pass } = await import('three/addons/postprocessing/Pass.js')
    expect(lib.namespace.libThree).toBeDefined()
    expect((lib.namespace.libThree as typeof THREE).Mesh).toBe(THREE.Mesh)
    expect(new (lib.namespace.LibMesh as new () => object)()).toBeInstanceOf(THREE.Mesh)
    expect(lib.namespace.LibPass).toBe(Pass)
    expect((THREE.ShaderChunk as Record<string, string>).testLibDefines).toBe('// lib')
    expect(lib.namespace.tag).toBe('lib-1.0.0')
    expect(lib.hostRewrites).toBe(2)
    expect(lib.urls).toHaveLength(3)
  })
})

describe('instantiateLibraryGraph releases its module URLs (#2641 handoff)', () => {
  it('revokes every statically imported module URL once imported; keeps dynamic-import targets', async () => {
    const files = {
      [`${BASE}index.js`]: `import { a } from './a.js';\nexport const lazy = () => import('./lazy.js');\nexport { a };\n`,
      [`${BASE}a.js`]: `import * as THREE from 'three';\nexport const a = THREE.REVISION;\n`,
      [`${BASE}lazy.js`]: `export const later = 42;\n`,
    }
    const g = await graphOf(files)
    const revoked: string[] = []
    const lib = await instantiateWith(g, { makeUrl: dataModuleUrl, shims: nodeShims, revokeUrl: (u) => revoked.push(u) })
    expect(lib.urls).toHaveLength(3)
    expect(lib.retained).toHaveLength(1) // lazy.js: only reached by import()
    expect(revoked).toHaveLength(2)
    expect(revoked).not.toContain(lib.retained[0])
    // Shim URLs belong to the realm, not to this library.
    expect(revoked.every((u) => lib.urls.includes(u))).toBe(true)
    // The library still works after its URLs are released, the dynamic import included.
    expect(lib.namespace.a).toBe((await import('three')).REVISION)
    expect((await (lib.namespace.lazy as () => Promise<{ later: number }>)()).later).toBe(42)
  })

  it('a library whose entry throws while importing releases every URL it made', async () => {
    const files = { [`${BASE}index.js`]: `import './a.js';\nthrow new Error('boom');\n`, [`${BASE}a.js`]: `export {}\n` }
    const revoked: string[] = []
    const e = await instantiateWith(await graphOf(files), { makeUrl: dataModuleUrl, shims: nodeShims, revokeUrl: (u) => revoked.push(u) }).catch((x) => x)
    expect(e.message).toBe('boom')
    expect(revoked).toHaveLength(2)
  })
})

describe('a sketch importing a declared library', () => {
  // Each case starts with nothing loaded in this realm (a verified library is otherwise reused).
  beforeEach(() => forgetLoadedLibraries())
  const sha = async () => libraryGraphHash(await graphOf(LIB))
  const libsJson = (decl: Record<string, unknown>) => JSON.stringify({ 'test-lib': { url: `${BASE}index.js`, ...decl } })
  const sketch = "import * as THREE from 'three'\nimport { LibMesh, tag } from 'test-lib'\n"

  it('loads, sharing the sketch’s three.js', async () => {
    const chain = sketchImportChain(libsJson({ sha384: await sha() }), { fetchText: cdn(LIB).fetchText, instantiate: instantiateLibraryGraph })
    const m = await loadThreeModules(compileThreeSketch(sketch), chain)
    const ns = m.modules[1] as Record<string, unknown>
    expect(ns.tag).toBe('lib-1.0.0')
    expect(new (ns.LibMesh as new () => object)()).toBeInstanceOf(m.THREE.Mesh)
  })

  it('wrong hash: refused, names the library, says the hash it got, runs nothing', async () => {
    const evil = { ...LIB, [`${BASE}mesh.js`]: LIB[`${BASE}mesh.js`].replace("'// lib'", "'// evil'") + 'globalThis.__evilRan = true;\n' }
    const chain = sketchImportChain(libsJson({ sha384: await sha() }), { fetchText: cdn(evil).fetchText, instantiate: instantiateLibraryGraph })
    const e = await loadThreeModules(compileThreeSketch(sketch), chain).catch((x) => x)
    expect(e).toBeInstanceOf(ThreeImportError)
    expect(e.line).toBe(2)
    expect(e.message).toMatch(/^'test-lib' \(declared in stave\.libs\.json\) was refused: what https:\/\/libs\.example\/pkg@1\.0\.0\/index\.js serves doesn't match the "sha384"/)
    expect(e.message).toContain(`got "${await libraryGraphHash(await graphOf(evil))}"`)
    expect((globalThis as Record<string, unknown>).__evilRan).toBeUndefined()
  })

  it('no sha384: refused, and the message gives the value to add', async () => {
    const chain = sketchImportChain(libsJson({}), { fetchText: cdn(LIB).fetchText, instantiate: instantiateLibraryGraph })
    const e = await loadThreeModules(compileThreeSketch(sketch), chain).catch((x) => x)
    expect(e.message).toContain(`add "sha384": "${await sha()}"`)
  })

  it('undeclared name: the message says how to declare it', async () => {
    const e = await loadThreeModules(compileThreeSketch("import { SplatMesh } from '@sparkjsdev/spark'\n"), sketchImportChain(null)).catch((x) => x)
    expect(e).toBeInstanceOf(ThreeImportError)
    expect(e.line).toBe(1)
    expect(e.message).toBe(
      `'@sparkjsdev/spark' isn't available in Stave. A three.js sketch can import 'three' and any 'three/addons/…' file. To use a library, declare it in stave.libs.json at the project root: { "@sparkjsdev/spark": { "url": "https://…", "sha384": "…" } }.`,
    )
  })

  it('a URL import: the message says to declare the URL under a name', async () => {
    const url = 'https://esm.sh/@sparkjsdev/spark@2.4.0?external=three'
    const e = await loadThreeModules(compileThreeSketch(`import { SplatMesh } from '${url}'\n`), sketchImportChain(null)).catch((x) => x)
    expect(e.message).toContain(`declare it in stave.libs.json at the project root, { "<name>": { "url": "${url}", "sha384": "…" } }`)
  })

  it('an unresolvable bare specifier inside the library: names the library, the module and the specifier', async () => {
    const files = { [`${BASE}index.js`]: `import { x } from 'left-pad';\nexport { x }` }
    const chain = sketchImportChain(libsJson({ sha384: 'A'.repeat(64) }), { fetchText: cdn(files).fetchText, instantiate: instantiateLibraryGraph })
    const e = await loadThreeModules(compileThreeSketch("import { x } from 'test-lib'\n"), chain).catch((x) => x)
    expect(e.message).toMatch(/^'test-lib' \(declared in stave\.libs\.json\) couldn't be loaded: https:\/\/libs\.example\/pkg@1\.0\.0\/index\.js imports 'left-pad', which is neither a URL nor a module Stave provides/)
  })

  it('a broken stave.libs.json is reported only when a sketch needs a declared name', async () => {
    const chain = sketchImportChain('{ nope')
    await expect(loadThreeModules(compileThreeSketch("import * as THREE from 'three'\n"), chain)).resolves.toBeTruthy()
    const e = await loadThreeModules(compileThreeSketch("import x from 'test-lib'\n"), chain).catch((x) => x)
    expect(e.message).toMatch(/^'test-lib' can't be looked up: stave\.libs\.json isn't valid JSON/)
  })

  it('the cache seam: a verified graph is stored; next time it is used without fetching; a bad one is never stored', async () => {
    const good = await sha()
    const store = new Map<string, LibraryGraph>()
    const cache: LibraryGraphCache = { getGraph: vi.fn(async (s) => store.get(s) ?? null), putGraph: vi.fn(async (s, g) => void store.set(s, g)) }
    const json = libsJson({ sha384: good })

    forgetLoadedLibraries()
    const net = cdn(LIB)
    await loadThreeModules(compileThreeSketch(sketch), sketchImportChain(json, { fetchText: net.fetchText, cache, instantiate: instantiateLibraryGraph }))
    expect(net.fetched).toHaveLength(3)
    expect(cache.putGraph).toHaveBeenCalledTimes(1)
    expect(store.has(good)).toBe(true)

    forgetLoadedLibraries()
    const offline = cdn({})
    const m = await loadThreeModules(compileThreeSketch(sketch), sketchImportChain(json, { fetchText: offline.fetchText, cache, instantiate: instantiateLibraryGraph }))
    expect(offline.fetched).toHaveLength(0)
    expect((m.modules[1] as Record<string, unknown>).tag).toBe('lib-1.0.0')

    // A cached graph that no longer matches is refused, like a fetched one.
    forgetLoadedLibraries()
    store.set(good, { ...store.get(good)!, modules: { ...store.get(good)!.modules, 'https://libs.example/pkg@1.0.0/tag.js': 'export const tag = 1' } })
    const e = await loadThreeModules(compileThreeSketch(sketch), sketchImportChain(json, { fetchText: offline.fetchText, cache, instantiate: instantiateLibraryGraph })).catch((x) => x)
    expect(e.message).toMatch(/was refused/)
    forgetLoadedLibraries()
  })
})

describe('parseLibraryDeclarations', () => {
  it('accepts https and localhost http, refuses other URLs and malformed hashes', () => {
    const ok = parseLibraryDeclarations(JSON.stringify({ a: { url: 'https://x/y.js', sha384: 'A'.repeat(64) }, b: { url: 'http://localhost:3581/z.js' } }))
    expect(ok.ok).toBe(true)
    expect(parseLibraryDeclarations(JSON.stringify({ a: { url: 'http://evil.example/y.js' } }))).toMatchObject({ ok: false })
    const pre = parseLibraryDeclarations(JSON.stringify({ a: { url: 'https://x/y.js', sha384: 'sha384-' + 'A'.repeat(64) } }))
    expect(pre.ok === false && pre.message).toMatch(/Leave out the "sha384-" prefix/)
    expect(parseLibraryDeclarations(null)).toEqual({ ok: true, libs: {} })
  })
})
