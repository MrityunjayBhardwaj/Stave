/**
 * #2640 — a declared library is kept on this device, so a second load of a sketch
 * using it asks the network for nothing, and the sketch still renders with the
 * network blocked.
 *
 * The project arrives as a shared one (a `#share=` link, then Import) holding a Spark
 * sketch, a pattern that draws it, and `stave.libs.json`, exactly as
 * `three-libraries.spec.ts` sets it up (the helpers below are copied from there). The
 * library is served by a route standing in for the CDN, which also counts what it is
 * asked for.
 *
 * Three loads in ONE browser context (so they share IndexedDB), each in a fresh page
 * (so nothing loaded in memory carries over):
 *   1. first load: the library is fetched (this is also the control that the route
 *      sees the loader's requests on this engine and path, so a 0 later means 0);
 *   2. second load: 0 requests for the library, and splats drawn;
 *   3. every request off this origin aborted: splats still drawn, 0 attempts.
 */
import { test, expect, chromium, firefox, webkit, type Page, type BrowserContext } from '@playwright/test'
import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs'
import zlib from 'node:zlib'

const SPARK_TEXT = fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@sparkjsdev', 'spark', 'dist', 'spark.module.js'), 'utf8')
const LIB_URL = 'https://libs.stave.test/@sparkjsdev/spark@2.4.0/spark.module.js'

function graphHash(modules: Record<string, string>): string {
  const s = Object.keys(modules)
    .sort()
    .map((u) => `${u}\n${modules[u].length}\n${modules[u]}\n`)
    .join('')
  return crypto.createHash('sha384').update(Buffer.from(s, 'utf8')).digest('base64')
}
const SPARK_SHA = graphHash({ [LIB_URL]: SPARK_TEXT })
const LIBS = JSON.stringify({ '@sparkjsdev/spark': { url: LIB_URL, sha384: SPARK_SHA } }, null, 2)
const ENGINES = { chromium, firefox, webkit } as const

const SKETCH = `import * as THREE from 'three'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
const realm = typeof WorkerGlobalScope !== 'undefined' ? 'worker' : 'main'
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true })
const scene = new THREE.Scene(); scene.background = new THREE.Color(0, 0, 0)
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100); camera.position.set(0, 0, 3)
const spark = new SparkRenderer({ renderer }); scene.add(spark)
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const mesh = new SplatMesh({ constructSplats: (splats) => {
  for (let i = 0; i < 3000; i++) { const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); if (v.length() > 1) { i--; continue }
    splats.pushSplat(v.multiplyScalar(0.8), new THREE.Vector3(0.03, 0.03, 0.03), new THREE.Quaternion(), 1, new THREE.Color(1, 0, 0)) } } })
scene.add(mesh); await mesh.initialized
let frames = 0
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera)
  if (++frames === 30) {
    const gl = renderer.getContext(); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
    const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    let red = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 60 && px[i + 1] < 40) red++
    new BroadcastChannel('stave-test-splats').postMessage({ red, realm })
  }
})
`

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

type Mode = 'worker' | 'main'
interface Played {
  splats: Array<{ red: number; realm: string }>
  errors: string[]
}

async function play(page: Page, mode: Mode, name: string): Promise<Played> {
  page.on('dialog', (d) => d.accept())
  await page.addInitScript((m: Mode) => {
    const w = window as unknown as { __STAVE_E2E__?: boolean; __splats?: unknown[] }
    w.__STAVE_E2E__ = true
    w.__splats = []
    new BroadcastChannel('stave-test-splats').onmessage = (e) => w.__splats!.push(e.data)
    try {
      localStorage.setItem('stave.viz.worker', m === 'main' ? '0' : '1')
    } catch {
      /* ignore */
    }
  }, mode)
  const files: ProjectFile[] = [
    { id: 'viz', path: 'probe.three', language: 'three', content: SKETCH },
    { id: 'song', path: 'song.strudel', language: 'strudel', content: `drums: s("bd*2").viz("probe")\n` },
    { id: 'libs', path: 'stave.libs.json', language: 'json', content: LIBS },
  ]
  await page.goto(`/#share=${shareHash(name, files)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 120_000 })
  await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 120_000 })
  const song = page.locator('[data-file-tree-item]').filter({ hasText: 'song.strudel' }).first()
  await expect(song).toBeVisible({ timeout: 30_000 })
  await song.dblclick()
  await page.waitForTimeout(1500)
  await page.locator('[data-strudel-runtime-chrome="root"]').getByRole('button', { name: /Play/ }).first().click()
  const read = (): Promise<Played> =>
    page.evaluate(() => {
      const w = window as unknown as { __splats?: Played['splats']; __staveGetLog?: () => Array<{ runtime: string; level: string; message: string }> }
      const errors = (w.__staveGetLog?.() ?? []).filter((r) => r.runtime === 'three' && r.level === 'error').map((r) => r.message)
      return { splats: (w.__splats ?? []).slice(), errors }
    })
  await expect.poll(async () => { const r = await read(); return r.splats.length + r.errors.length }, { timeout: 60_000 }).toBeGreaterThan(0).catch(() => {})
  await page.waitForTimeout(1000)
  return read()
}

for (const browserName of ['chromium', 'firefox', 'webkit'] as const) {
  test.describe(`#2640 a declared library loads from this device (${browserName})`, () => {
    test.describe.configure({ timeout: 300_000 })
    for (const mode of ['worker', 'main'] as const) {
      test(`second load asks the network for nothing; blocked network still renders (${mode})`, async () => {
        // #2646 — Spark sometimes never gets a frame in Firefox's sketch worker
        // (handled as three-libraries.spec.ts does).
        test.fixme(browserName === 'firefox' && mode === 'worker', "#2646: Spark sometimes stalls in Firefox's sketch worker")
        test.skip(!fs.existsSync(ENGINES[browserName].executablePath()), `${browserName} is not installed for Playwright`)
        const baseURL = test.info().project.use.baseURL!
        const origin = new URL(baseURL).origin
        const browser = await ENGINES[browserName].launch()
        try {
          const context: BrowserContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })
          let offline = false
          const asked: string[] = []
          const blocked: string[] = []
          // Everything off this origin passes through here: the stand-in CDN is served
          // (and counted); with `offline` on, every such request is aborted (and counted).
          await context.route((url) => url.origin !== origin, (route) => {
            const url = route.request().url()
            if (offline) {
              blocked.push(url)
              return route.abort('internetdisconnected')
            }
            if (url.startsWith('https://libs.stave.test/')) {
              asked.push(url)
              if (url === LIB_URL) return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: SPARK_TEXT })
              return route.fulfill({ status: 404, body: 'not found' })
            }
            return route.continue()
          })

          const loads: Array<{ load: string; red: number | null; realm: string | null; libRequests: number; blocked: number; errors: string[] }> = []
          const record = async (load: string): Promise<void> => {
            const page = await context.newPage()
            const before = asked.length
            const blockedBefore = blocked.length
            const r = await play(page, mode, `cache-${load}`)
            loads.push({
              load,
              red: r.splats[0]?.red ?? null,
              realm: r.splats[0]?.realm ?? null,
              libRequests: asked.slice(before).filter((u) => u === LIB_URL).length,
              blocked: blocked.slice(blockedBefore).filter((u) => u.startsWith('https://libs.stave.test/')).length,
              errors: r.errors,
            })
            await page.close()
          }
          await record('first')
          await record('second')
          offline = true
          await record('offline')
          console.log(`[#2640] ${browserName} ${mode} ${JSON.stringify(loads)}`)

          const lit = (n: number | null) => n !== null && n > 0
          expect(
            loads.map((l) => ({ load: l.load, drew: lit(l.red), realm: l.realm, libRequests: l.libRequests, blocked: l.blocked, errors: l.errors })),
          ).toEqual([
            { load: 'first', drew: true, realm: mode, libRequests: 1, blocked: 0, errors: [] },
            { load: 'second', drew: true, realm: mode, libRequests: 0, blocked: 0, errors: [] },
            { load: 'offline', drew: true, realm: mode, libRequests: 0, blocked: 0, errors: [] },
          ])
        } finally {
          await browser.close()
        }
      })
    }
  })
}
