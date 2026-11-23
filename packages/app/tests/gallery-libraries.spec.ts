/**
 * #2642 — a sketch's libraries travel with the project: in a share link and in
 * a gallery entry, and they load wherever it is opened.
 *
 * The project holds a Spark sketch (`import { SplatMesh } from
 * '@sparkjsdev/spark'`, the bench's 3000 red splats), a pattern that draws it,
 * and `stave.libs.json` declaring Spark with its hash. Spark is served by a
 * route standing in for the CDN (`https://libs.stave.test/…`, Spark 2.4.0 from
 * the app's devDependencies, with `access-control-allow-origin: *` as esm.sh
 * sends), so nothing depends on esm.sh. The sketch counts its own red pixels
 * with gl.readPixels and logs them (`[splats] {…}`); a 0-splat sketch is the
 * control, which must read 0.
 *
 * 1. PUBLISH (needs a server with the test sign-in: STAVE_AUTH_TEST_LOGIN=1 and
 *    AUTH_SECRET; skips otherwise). A viz entry of the sketch is published from
 *    the dialog, which says stave.libs.json goes with it; the stored entry, read
 *    back from GET /api/gallery/<id>, holds the sketch and stave.libs.json byte
 *    for byte; its page says "loads @sparkjsdev/spark from libs.stave.test".
 * 2. PREVIEW IN A FRESH PROFILE (needs a production server: `next dev` can't
 *    host the sandboxed frame, see gallery-sandbox.spec.ts; skips on dev). Each
 *    engine is launched with a new, empty profile, opens the entry, presses
 *    Preview, and the frame's sketch reports red pixels > 0; the control 0.
 *    The entries are served by the test, as the publish route stores them;
 *    with STAVE_LIBS_ENTRY_ID / STAVE_LIBS_CONTROL_ID set, the real stored
 *    entries are opened instead (publish on a dev server, then `next start`
 *    with STAVE_SHARE_DEV_STORE=1 over the same store folders).
 * 3. SHARE LINK ROUND TRIP (any server). The app's own Copy Private Link makes
 *    the long `#share=` link (the short-link upload is answered 503 here, so it
 *    falls back to the link that carries the project); decoding its manifest
 *    shows stave.libs.json, and the link opened in a fresh profile plays the
 *    sketch with splats on screen.
 *
 * Screenshots go to $GALLERY_SHOT_DIR.
 */
import { test, expect, chromium, firefox, webkit, type Page, type BrowserContext, type Browser } from '@playwright/test'
import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs'
import zlib from 'node:zlib'

const SHOTS = process.env.GALLERY_SHOT_DIR
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const SPARK_TEXT = fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@sparkjsdev', 'spark', 'dist', 'spark.module.js'), 'utf8')
const LIB_URL = 'https://libs.stave.test/@sparkjsdev/spark@2.4.0/spark.module.js'
const ENGINES = { chromium, firefox, webkit } as const
type Engine = keyof typeof ENGINES

/** libraryGraphHash's canonical form, over one module. */
const SPARK_SHA = crypto
  .createHash('sha384')
  .update(Buffer.from(`${LIB_URL}\n${SPARK_TEXT.length}\n${SPARK_TEXT}\n`, 'utf8'))
  .digest('base64')
const LIBS_TEXT = JSON.stringify({ '@sparkjsdev/spark': { url: LIB_URL, sha384: SPARK_SHA } }, null, 2)

/** The bench's scene as a Stave sketch; logs its red pixels once, at frame 30. */
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
    try { new BroadcastChannel('stave-test-splats').postMessage(result) } catch {}
    console.log('[splats] ' + JSON.stringify(result))
  }
})
`

interface Splats {
  count: number
  red: number
  of: number
  realm: string
  sameThree: boolean
}

interface ProjectFile {
  id: string
  path: string
  language: string
  content: string
}

const projectFiles = (count: number): ProjectFile[] => [
  { id: 'viz', path: 'probe.three', language: 'three', content: sparkSketch(count) },
  { id: 'song', path: 'song.strudel', language: 'strudel', content: `drums: s("bd*2").viz("probe")\n` },
  { id: 'libs', path: 'stave.libs.json', language: 'json', content: LIBS_TEXT },
]

function shareHash(name: string, files: ProjectFile[]): string {
  const manifest = { schemaVersion: 1, project: { name, sharedAt: Date.now() }, files, fileOrder: { '': files.map((f) => f.id) }, subfolderOrder: {} }
  return zlib.gzipSync(Buffer.from(JSON.stringify(manifest))).toString('base64url')
}

function decodeShare(url: string): { files: ProjectFile[] } {
  const encoded = url.slice(url.indexOf('#share=') + '#share='.length)
  return JSON.parse(zlib.gunzipSync(Buffer.from(encoded, 'base64url')).toString('utf8'))
}

/** Serve the stand-in CDN; returns the URLs it was asked for. */
async function serveLibraries(context: BrowserContext): Promise<string[]> {
  const asked: string[] = []
  await context.route('https://libs.stave.test/**', (route) => {
    const url = route.request().url()
    asked.push(url)
    if (url !== LIB_URL) return route.fulfill({ status: 404, body: 'not found' })
    return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: SPARK_TEXT })
  })
  return asked
}

/** What the sketch logs, from the page or any of its frames. */
function collectSplats(page: Page): Splats[] {
  const out: Splats[] = []
  page.on('console', (m) => {
    const t = m.text()
    if (t.startsWith('[splats] ')) out.push(JSON.parse(t.slice(9)))
  })
  return out
}

async function onEngine(engine: Engine, fn: (browser: Browser) => Promise<void>): Promise<void> {
  const browser = await ENGINES[engine].launch()
  try {
    await fn(browser)
  } finally {
    await browser.close()
  }
}

const freshContext = (browser: Browser) =>
  browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 900 } })

/** Open a `#share=` link and Import it. */
async function importShare(page: Page, url: string): Promise<void> {
  page.on('dialog', (d) => d.accept())
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 120_000 })
  await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 120_000 })
  await expect(page.locator('[data-file-tree-item]').filter({ hasText: 'song.strudel' }).first()).toBeVisible({ timeout: 30_000 })
}

async function isDevServer(page: Page): Promise<boolean> {
  return (await (await page.request.get('/gallery-player')).text()).includes('hmr-client')
}
const DEV_SKIP = "next dev can't host the sandboxed preview frame (see gallery-sandbox.spec.ts); run against next build && next start"

// ─── 1. publish ───────────────────────────────────────────────────────────────

test.describe('#2642 publishing a viz entry carries stave.libs.json', () => {
  test('the stored entry holds it, and its page says what it loads (Chromium)', async ({ browser, request }) => {
    test.setTimeout(240_000)
    const me = (await (await request.get('/api/gallery/me')).json()) as { providers: Array<{ id: string }> }
    test.skip(!me.providers?.some((p) => p.id === 'test-login'), 'needs a server started with STAVE_AUTH_TEST_LOGIN=1 and AUTH_SECRET')
    const context = await freshContext(browser)
    await serveLibraries(context)
    const id = `libs-${Date.now().toString(36)}`
    const { csrfToken } = (await (await context.request.get('/api/auth/csrf')).json()) as { csrfToken: string }
    const signIn = await context.request.post('/api/auth/callback/test-login', {
      form: { csrfToken, id, name: `Test ${id}`, login: id, email: `${id}@test-login.invalid`, as: 'github', callbackUrl: '/' },
      maxRedirects: 0,
    })
    expect(signIn.status()).toBe(302)
    const page = await context.newPage()
    await page.addInitScript(() => {
      ;(window as unknown as { __STAVE_E2E__: boolean }).__STAVE_E2E__ = true
      // the publish copies the entry's link; keep it here instead
      navigator.clipboard.writeText = async () => {}
    })
    await importShare(page, `/#share=${shareHash('Splats', projectFiles(3000))}`)

    await page.keyboard.press(`${MOD}+Shift+P`)
    await page.getByPlaceholder('Type a command...').fill('Publish to Gallery')
    await expect(page.locator('[data-palette-row]', { hasText: 'Publish to Gallery' })).toBeVisible()
    await page.keyboard.press('Enter')
    const dialog = page.getByTestId('gallery-publish-dialog')
    await expect(page.getByTestId('gallery-publish-as')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('gallery-publish-kind-viz').click()
    await page.getByTestId('gallery-publish-file').selectOption({ label: 'probe.three' })
    await expect(page.getByTestId('gallery-publish-libraries')).toHaveText(
      "stave.libs.json goes with it, so @sparkjsdev/spark loads wherever it's opened.",
    )
    if (SHOTS) await dialog.screenshot({ path: `${SHOTS}/libraries-publish-dialog.png` })
    await page.getByTestId('gallery-publish-title').fill('Red splats')
    const published = page.waitForResponse((r) => r.url().endsWith('/api/gallery') && r.request().method() === 'POST', { timeout: 120_000 })
    await page.getByTestId('gallery-publish-submit').click()
    const res = await published
    expect(res.status(), await res.text()).toBe(201)
    const entryId = ((await res.json()) as { id: string }).id
    console.log(`[#2642] published entry ${entryId}`)

    // read the stored record back
    const stored = (await (await request.get(`/api/gallery/${entryId}`)).json()) as {
      entry: { kind: string; fileCount: number }
      manifest: { files: ProjectFile[] }
    }
    console.log(`[#2642] stored kind=${stored.entry.kind} fileCount=${stored.entry.fileCount} files=${JSON.stringify(stored.manifest.files.map((f) => f.path))}`)
    expect(stored.entry.kind).toBe('viz')
    expect(stored.manifest.files.map((f) => f.path)).toEqual(['probe.three', 'stave.libs.json'])
    expect(stored.manifest.files[1].content, 'byte for byte').toBe(LIBS_TEXT)

    // the entry page says what loads from where
    await page.goto(`/#gallery=${entryId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator(`[data-gallery-detail="${entryId}"]`)).toBeVisible({ timeout: 60_000 })
    const lib = page.locator('[data-gallery-library="@sparkjsdev/spark"]')
    await expect(lib).toHaveText('loads @sparkjsdev/spark from libs.stave.test')
    await expect(lib).toHaveAttribute('title', LIB_URL)
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/libraries-entry-page.png` })
      await page.locator('.sg-side').screenshot({ path: `${SHOTS}/libraries-entry-side.png` })
    }
    await context.close()
  })
})

// ─── 2. preview in a fresh profile ─────────────────────────────────────────────

/** Serve a viz entry as the publish route stores one: the sketch, then stave.libs.json. */
async function routeVizEntry(context: BrowserContext, count: number): Promise<string> {
  const id = crypto.randomBytes(8).toString('base64url')
  const now = Date.now()
  const files = projectFiles(count).filter((f) => f.id !== 'song')
  const body = {
    entry: { id, title: `Splats ${count}`, kind: 'viz', tags: [], authorName: 'Ada', publishedAt: now, fileCount: files.length, hasThumbnail: false },
    manifest: { schemaVersion: 1, project: { name: 'Splats', sharedAt: now }, files, fileOrder: { '': ['viz', 'libs'] }, subfolderOrder: {} },
  }
  await context.route(`**/api/gallery/${id}`, (route) => (route.request().method() === 'GET' ? route.fulfill({ json: body }) : route.fallback()))
  return id
}

async function previewSplats(browser: Browser, engine: Engine, count: number, realId?: string): Promise<{ splats: Splats[]; asked: string[]; state: string | null }> {
  const context = await freshContext(browser)
  const asked = await serveLibraries(context)
  const id = realId ?? (await routeVizEntry(context, count))
  const page = await context.newPage()
  const splats = collectSplats(page)
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)))
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${new URL(r.url()).pathname}`))
  await page.goto(`/#gallery=${id}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator(`[data-gallery-detail="${id}"]`)).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-gallery-library="@sparkjsdev/spark"]')).toHaveText('loads @sparkjsdev/spark from libs.stave.test')
  // a visual alone makes no sound, so no engine asks for a press inside the frame
  await page.locator('[data-gallery-preview-button]').click({ timeout: 60_000 })
  await expect.poll(() => splats.length, { timeout: 90_000 }).toBeGreaterThan(0).catch(() => {})
  const state = await page.locator('[data-gallery-preview-state]').getAttribute('data-gallery-preview-state').catch(() => null)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/libraries-preview-${engine}-${count}.png` })
  console.log(`[#2642] preview ${engine} count=${count} splats=${JSON.stringify(splats)} state=${state} libFetches=${asked.filter((u) => u === LIB_URL).length} errors=${JSON.stringify(errors)}`)
  await context.close()
  return { splats, asked, state }
}

for (const engine of ['chromium', 'firefox', 'webkit'] as const) {
  test.describe(`#2642 the gallery preview loads the entry's libraries (${engine})`, () => {
    test.describe.configure({ timeout: 240_000 })
    test.beforeEach(async ({ page }) => {
      test.skip(await isDevServer(page), DEV_SKIP)
    })

    test('splats render in a fresh profile', () =>
      onEngine(engine, async (browser) => {
        const r = await previewSplats(browser, engine, 3000, process.env.STAVE_LIBS_ENTRY_ID)
        expect(r.splats, 'the sketch reported its pixels').toHaveLength(1)
        expect(r.splats[0].realm, 'the frame draws on its main thread').toBe('main')
        expect(r.splats[0].sameThree).toBe(true)
        expect(r.splats[0].red, 'splats drew red pixels').toBeGreaterThan(0)
        expect(r.asked.filter((u) => u === LIB_URL).length, 'the library was fetched').toBeGreaterThan(0)
      }))

    test('the empty-scene control draws no red', () =>
      onEngine(engine, async (browser) => {
        const r = await previewSplats(browser, engine, 0, process.env.STAVE_LIBS_CONTROL_ID)
        expect(r.splats).toHaveLength(1)
        expect(r.splats[0].red).toBe(0)
      }))
  })
}

// ─── 3. share link round trip ──────────────────────────────────────────────────

for (const engine of ['chromium', 'firefox', 'webkit'] as const) {
  test(`#2642 a share link carries stave.libs.json and the opened project renders (${engine})`, () =>
    onEngine(engine, async (browser) => {
      test.setTimeout(300_000)
      // MAKE the link with the app's own Copy Private Link
      const a = await freshContext(browser)
      await a.route('**/api/share', (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 503, body: 'no store' }) : route.fallback()))
      const maker = await a.newPage()
      await maker.addInitScript(() => {
        const w = window as unknown as { __copied?: string }
        navigator.clipboard.writeText = async (t: string) => {
          w.__copied = t
        }
      })
      await importShare(maker, `/#share=${shareHash('Splats', projectFiles(3000))}`)
      await maker.getByRole('button', { name: 'File', exact: true }).click()
      await maker.locator('[data-stave-menu-item]', { hasText: /^Share/ }).hover()
      await maker.locator('[data-stave-menu-item]', { hasText: 'Copy Private Link' }).click()
      await maker.locator('[data-testid="toast"]', { hasText: 'Private link copied' }).last().waitFor({ timeout: 30_000 })
      const link = (await maker.evaluate(() => (window as unknown as { __copied?: string }).__copied)) ?? ''
      await a.close()
      expect(link).toContain('#share=')
      const decoded = decodeShare(link)
      console.log(`[#2642] ${engine} link ${link.length} chars, files=${JSON.stringify(decoded.files.map((f) => `${f.path} (${f.language})`))}`)
      const libs = decoded.files.find((f) => f.path === 'stave.libs.json')
      expect(libs, 'the manifest carries stave.libs.json').toBeTruthy()
      expect(libs!.content).toBe(LIBS_TEXT)

      // OPEN it in a fresh profile and play
      const b = await freshContext(browser)
      const asked = await serveLibraries(b)
      const page = await b.newPage()
      // #2646: Spark sometimes stalls in Firefox's sketch worker, so Firefox draws on its main thread here
      await page.addInitScript((mode: string) => {
        ;(window as unknown as { __STAVE_E2E__: boolean }).__STAVE_E2E__ = true
        try {
          localStorage.setItem('stave.viz.worker', mode)
        } catch {
          /* ignore */
        }
      }, engine === 'firefox' ? '0' : '1')
      const splats: Splats[] = []
      await page.exposeBinding('__splatsSeen', (_s, r: Splats) => void splats.push(r))
      await page.addInitScript(() => {
        new BroadcastChannel('stave-test-splats').onmessage = (e) =>
          (window as unknown as { __splatsSeen: (r: unknown) => void }).__splatsSeen(e.data)
      })
      await importShare(page, link.slice(link.indexOf('/#share=')))
      await page.locator('[data-file-tree-item]').filter({ hasText: 'song.strudel' }).first().dblclick()
      await page.waitForTimeout(1500)
      await page.locator('[data-strudel-runtime-chrome="root"]').getByRole('button', { name: /Play/ }).first().click()
      await expect.poll(() => splats.length, { timeout: 90_000 }).toBeGreaterThan(0).catch(() => {})
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/libraries-share-${engine}.png` })
      console.log(`[#2642] ${engine} opened link splats=${JSON.stringify(splats)} libFetches=${asked.filter((u) => u === LIB_URL).length}`)
      await b.close()
      expect(splats.length, 'the sketch reported its pixels').toBeGreaterThan(0)
      expect(splats[0].red, 'splats drew red pixels').toBeGreaterThan(0)
      expect(splats[0].sameThree).toBe(true)
    }))
}
