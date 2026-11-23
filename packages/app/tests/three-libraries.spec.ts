/**
 * #2639 — a three.js sketch imports a library the project declares in
 * `stave.libs.json`, exactly as the library's docs write it, and it renders
 * sharing Stave's one three.js (#2638). First case: Spark, the Gaussian-splat
 * renderer.
 *
 * The project arrives the way a shared one does (a `#share=` link, then Import),
 * holding three files: the sketch, a pattern that draws it with `.viz("probe")`,
 * and `stave.libs.json`. The library is served by a route standing in for the CDN
 * (`https://libs.stave.test/…`, Spark 2.4.0 from the app's devDependencies), so
 * the spec doesn't depend on esm.sh being up; one optional test uses the live
 * esm.sh URL (STAVE_LIVE_LIBS=1).
 *
 * What is read: the sketch counts its own red pixels with gl.readPixels on its
 * own WebGL context and logs them (a worker's OffscreenCanvas can't be read back
 * reliably from the page), and the Console rows Stave writes for a sketch that
 * can't start. Every engine, on the worker path and on the main-thread path.
 */
import { test, expect, chromium, firefox, webkit, type Page, type BrowserContext } from '@playwright/test'
import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs'
import zlib from 'node:zlib'

// Spark 2.4.0 from the app's devDependencies (its package exports don't list the dist file, so by path).
const SPARK_TEXT = fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@sparkjsdev', 'spark', 'dist', 'spark.module.js'), 'utf8')
const LIB_URL = 'https://libs.stave.test/@sparkjsdev/spark@2.4.0/spark.module.js'
const BARE_URL = 'https://libs.stave.test/needs-left-pad/index.js'

/** The stave.libs.json hash for a set of modules (libraryGraphHash's canonical form). */
function graphHash(modules: Record<string, string>): string {
  const s = Object.keys(modules)
    .sort()
    .map((u) => `${u}\n${modules[u].length}\n${modules[u]}\n`)
    .join('')
  return crypto.createHash('sha384').update(Buffer.from(s, 'utf8')).digest('base64')
}
const SPARK_SHA = graphHash({ [LIB_URL]: SPARK_TEXT })
const ENGINES = { chromium, firefox, webkit } as const

/** The bench's scene (3000 opaque red splats in a ball, on black), as a Stave sketch. */
const sparkSketch = (count: number): string => `import * as THREE from 'three'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
const realm = typeof WorkerGlobalScope !== 'undefined' ? 'worker' : 'main'
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true })
const scene = new THREE.Scene(); scene.background = new THREE.Color(0, 0, 0)
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100); camera.position.set(0, 0, 3)
const spark = new SparkRenderer({ renderer }); scene.add(spark)
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const mesh = new SplatMesh({ constructSplats: (splats) => {
  for (let i = 0; i < ${count}; i++) { const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); if (v.length() > 1) { i--; continue }
    splats.pushSplat(v.multiplyScalar(0.8), new THREE.Vector3(0.03, 0.03, 0.03), new THREE.Quaternion(), 1, new THREE.Color(1, 0, 0)) } } })
scene.add(mesh); await mesh.initialized
let frames = 0
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera)
  if (++frames === 30) {
    const gl = renderer.getContext(); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
    const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    let red = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 60 && px[i + 1] < 40) red++
    const result = { count: ${count}, red, of: w * h, realm, sameThree: spark instanceof THREE.Object3D }
    // To the page over a BroadcastChannel: a worker's console doesn't always reach the test in Firefox.
    new BroadcastChannel('stave-test-splats').postMessage(result)
    console.log('[splats] ' + JSON.stringify(result))
  }
})
`

const libs = (decl: Record<string, { url: string; sha384?: string }>) => JSON.stringify(decl, null, 2)

interface ProjectFile {
  id: string
  path: string
  language: string
  content: string
}

function shareHash(name: string, files: ProjectFile[]): string {
  const manifest = { schemaVersion: 1, project: { name, sharedAt: Date.now() }, files, fileOrder: { '': files.map((f) => f.id) }, subfolderOrder: {} }
  return zlib.gzipSync(Buffer.from(JSON.stringify(manifest))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Serve the stand-in CDN; returns the URLs it was asked for. */
async function serveLibraries(context: BrowserContext): Promise<string[]> {
  const asked: string[] = []
  await context.route('https://libs.stave.test/**', (route) => {
    const url = route.request().url()
    asked.push(url)
    const body = url === LIB_URL ? SPARK_TEXT : url === BARE_URL ? `import pad from 'left-pad'\nexport default pad\n` : null
    if (body === null) return route.fulfill({ status: 404, body: 'not found' })
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body })
  })
  return asked
}

type Mode = 'worker' | 'main'

interface Played {
  splats: Array<{ count: number; red: number; of: number; realm: string; sameThree: boolean }>
  rows: Array<{ level: string; message: string; line?: number }>
}

/** Open a shared project holding `sketch` (+ `libsText` as stave.libs.json), play
 *  its pattern, and collect what the sketch logged and the Console's three rows. */
async function playShared(page: Page, mode: Mode, sketch: string, libsText: string | null, waitMs = 60_000): Promise<Played> {
  page.on('dialog', (d) => d.accept())
  await page.addInitScript((m: Mode) => {
    const w = window as unknown as { __STAVE_E2E__?: boolean; __splats?: unknown[] }
    w.__STAVE_E2E__ = true
    w.__splats = []
    // The sketch's result, from the worker or the page itself (same origin).
    new BroadcastChannel('stave-test-splats').onmessage = (e) => w.__splats!.push(e.data)
    try {
      localStorage.setItem('stave.viz.worker', m === 'main' ? '0' : '1')
    } catch {
      /* ignore */
    }
  }, mode)
  const files: ProjectFile[] = [
    { id: 'viz', path: 'probe.three', language: 'three', content: sketch },
    { id: 'song', path: 'song.strudel', language: 'strudel', content: `drums: s("bd*2").viz("probe")\n` },
  ]
  if (libsText !== null) files.push({ id: 'libs', path: 'stave.libs.json', language: 'json', content: libsText })
  await page.goto(`/#share=${shareHash(`libs-${mode}`, files)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 120_000 })
  await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 120_000 })
  await expect(page.locator('[data-file-tree-item]').filter({ hasText: 'song.strudel' }).first()).toBeVisible({ timeout: 30_000 })
  await page.locator('[data-file-tree-item]').filter({ hasText: 'song.strudel' }).first().dblclick()
  await page.waitForTimeout(1500)
  await page.locator('[data-strudel-runtime-chrome="root"]').getByRole('button', { name: /Play/ }).first().click()
  const splats = (): Promise<Played['splats']> => page.evaluate(() => ((window as unknown as { __splats?: Played['splats'] }).__splats ?? []).slice())
  await expect.poll(async () => (await splats()).length + (await threeRows(page)).length, { timeout: waitMs }).toBeGreaterThan(0).catch(() => {})
  await page.waitForTimeout(1000)
  return { splats: await splats(), rows: await threeRows(page) }
}

async function threeRows(page: Page): Promise<Played['rows']> {
  return page.evaluate(() => {
    const get = (window as unknown as { __staveGetLog?: () => Array<{ runtime: string; level: string; message: string; line?: number }> }).__staveGetLog
    return (get?.() ?? []).filter((r) => r.runtime === 'three').map((r) => ({ level: r.level, message: r.message, line: r.line }))
  })
}

for (const browserName of ['chromium', 'firefox', 'webkit'] as const) {
  test.describe(`#2639 a sketch imports a declared library (${browserName})`, () => {
    test.describe.configure({ timeout: 180_000 })
    /** Each engine is launched here (the gate's project is Chromium; a describe
     *  can't switch engines), with the project's base URL. */
    const onEngine = async (fn: (page: Page, context: BrowserContext) => Promise<void>): Promise<void> => {
      const browser = await ENGINES[browserName].launch()
      try {
        const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 900 } })
        await fn(await context.newPage(), context)
      } finally {
        await browser.close()
      }
    }

    for (const mode of ['worker', 'main'] as const) {
      test(`Spark renders splats sharing Stave's three.js (${mode})`, () => onEngine(async (page, context) => {
        // #2646 — in Firefox's worker, Spark sometimes never gets a frame (about 3 runs
        // in 10; the main thread and the other engines never stall).
        test.fixme(browserName === 'firefox' && mode === 'worker', '#2646: Spark sometimes stalls in Firefox\'s sketch worker')
        const asked = await serveLibraries(context)
        const lit = await playShared(page, mode, sparkSketch(3000), libs({ '@sparkjsdev/spark': { url: LIB_URL, sha384: SPARK_SHA } }))
        console.log(`[#2639] ${browserName} ${mode} splats=3000 ${JSON.stringify(lit.splats)} rows=${JSON.stringify(lit.rows)}`)
        expect(lit.rows.filter((r) => r.level === 'error'), 'no error rows').toEqual([])
        expect(lit.splats, 'the sketch reported its pixels').toHaveLength(1)
        expect(lit.splats[0].realm, `ran on the ${mode} path`).toBe(mode)
        expect(lit.splats[0].sameThree, "Spark's objects are the sketch's three.js objects").toBe(true)
        expect(lit.splats[0].red, 'splats drew red pixels').toBeGreaterThan(0)
        expect(asked.filter((u) => u === LIB_URL).length, 'the library was fetched').toBeGreaterThan(0)
      }))

      test(`the empty-scene control draws no red (${mode})`, () => onEngine(async (page, context) => {
        test.fixme(browserName === 'firefox' && mode === 'worker', '#2646: Spark sometimes stalls in Firefox\'s sketch worker')
        await serveLibraries(context)
        const dark = await playShared(page, mode, sparkSketch(0), libs({ '@sparkjsdev/spark': { url: LIB_URL, sha384: SPARK_SHA } }))
        console.log(`[#2639] ${browserName} ${mode} splats=0 ${JSON.stringify(dark.splats)}`)
        expect(dark.splats).toHaveLength(1)
        expect(dark.splats[0].red).toBe(0)
      }))
    }

    test('wrong hash: refused, and the message names the library', () => onEngine(async (page, context) => {
      await serveLibraries(context)
      const wrong = 'A'.repeat(64)
      const r = await playShared(page, 'worker', sparkSketch(3000), libs({ '@sparkjsdev/spark': { url: LIB_URL, sha384: wrong } }))
      console.log(`[#2639] ${browserName} wrong-hash rows=${JSON.stringify(r.rows)}`)
      expect(r.splats).toEqual([])
      const row = r.rows.find((x) => x.level === 'error')!
      expect(row.message).toBe(
        `'@sparkjsdev/spark' (declared in stave.libs.json) was refused: what ${LIB_URL} serves doesn't match the "sha384" in stave.libs.json (expected "${wrong}", got "${SPARK_SHA}"). Nothing from it was run. If the library changed on purpose, put the new value in stave.libs.json.`,
      )
      expect(row.line, 'on the import line').toBe(2)
    }))

    test('undeclared name: the message says how to declare it', () => onEngine(async (page, context) => {
      await serveLibraries(context)
      const r = await playShared(page, 'worker', sparkSketch(3000), null)
      console.log(`[#2639] ${browserName} undeclared rows=${JSON.stringify(r.rows)}`)
      const row = r.rows.find((x) => x.level === 'error')!
      expect(row.message).toBe(
        `'@sparkjsdev/spark' isn't available in Stave. A three.js sketch can import 'three' and any 'three/addons/…' file. To use a library, declare it in stave.libs.json at the project root: { "@sparkjsdev/spark": { "url": "https://…", "sha384": "…" } }.`,
      )
      expect(row.line).toBe(2)
    }))

    test('a bare specifier inside a library: the message names the module and the specifier', () => onEngine(async (page, context) => {
      await serveLibraries(context)
      const sketch = `import * as THREE from 'three'\nimport pad from 'needs-left-pad'\n`
      const r = await playShared(page, 'worker', sketch, libs({ 'needs-left-pad': { url: BARE_URL, sha384: 'A'.repeat(64) } }))
      console.log(`[#2639] ${browserName} bare rows=${JSON.stringify(r.rows)}`)
      const row = r.rows.find((x) => x.level === 'error')!
      expect(row.message).toBe(
        `'needs-left-pad' (declared in stave.libs.json) couldn't be loaded: ${BARE_URL} imports 'left-pad', which is neither a URL nor a module Stave provides ('three' or 'three/addons/…'). Use a build of the library that bundles 'left-pad' or imports it by URL.`,
      )
    }))
  })
}

// Optional: the live esm.sh build, exactly as the issue declares it. Declared first
// with no hash (the message says what it hashes to), then with that hash.
test.describe('#2639 live esm.sh (STAVE_LIVE_LIBS=1)', () => {
  test.skip(process.env.STAVE_LIVE_LIBS !== '1', 'set STAVE_LIVE_LIBS=1 to load Spark from esm.sh')
  test.describe.configure({ timeout: 240_000 })
  const LIVE = 'https://esm.sh/@sparkjsdev/spark@2.4.0?external=three'
  test('Spark from esm.sh renders splats', async ({ browser }) => {
    const first = await browser.newPage({ baseURL: test.info().project.use.baseURL })
    const r1 = await playShared(first, 'worker', sparkSketch(3000), libs({ '@sparkjsdev/spark': { url: LIVE } }), 60_000)
    const said = /add "sha384": "([A-Za-z0-9+/]{64})"/.exec(r1.rows.map((r) => r.message).join('\n'))
    console.log(`[#2639] live no-hash rows=${JSON.stringify(r1.rows)}`)
    expect(said, 'the message gives the hash to declare').not.toBeNull()
    await first.close()
    const second = await browser.newPage({ baseURL: test.info().project.use.baseURL })
    const r2 = await playShared(second, 'worker', sparkSketch(3000), libs({ '@sparkjsdev/spark': { url: LIVE, sha384: said![1] } }), 60_000)
    console.log(`[#2639] live splats=${JSON.stringify(r2.splats)} rows=${JSON.stringify(r2.rows)}`)
    expect(r2.splats[0]?.red ?? 0).toBeGreaterThan(0)
    await second.close()
  })
})
