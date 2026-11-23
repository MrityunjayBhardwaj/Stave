/**
 * #2643 — Add Library…: choosing a tested library from the command palette
 * writes its declaration into stave.libs.json, and a sketch importing it then
 * renders.
 *
 * esm.sh is stood in for by a route serving Spark 2.4.0 from the app's
 * devDependencies at the paths esm.sh uses (an entry that re-exports the build
 * file), so the spec doesn't depend on the network. The hash the page writes is
 * checked against one computed here, in Node, over the bytes the route serves.
 * One optional test (STAVE_LIVE_LIBS=1) does the same against the real esm.sh,
 * downloading the graph fresh in Node.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import path from 'node:path'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { COUNT_RED, onEngine, openShared, playPattern, type Mode, type ProjectFile } from './_threeLibs'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const SPARK_URL = 'https://esm.sh/@sparkjsdev/spark@2.4.0?external=three&target=es2022'
const SPARK_BUILD = 'https://esm.sh/@sparkjsdev/spark@2.4.0/X-ZXRocmVl/es2022/spark.mjs'
const SPARK_ENTRY = `/* esm.sh - @sparkjsdev/spark@2.4.0 */\nexport * from "/@sparkjsdev/spark@2.4.0/X-ZXRocmVl/es2022/spark.mjs";\n`
const SPARK_TEXT = fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@sparkjsdev', 'spark', 'dist', 'spark.module.js'), 'utf8')
const SERVED: Record<string, string> = { [SPARK_URL]: SPARK_ENTRY, [SPARK_BUILD]: SPARK_TEXT }

/** libraryGraphHash's canonical form, written out again here so the check is independent of the app's code. */
function graphHash(modules: Record<string, string>): string {
  const s = Object.keys(modules)
    .sort()
    .map((u) => `${u}\n${modules[u].length}\n${modules[u]}\n`)
    .join('')
  return crypto.createHash('sha384').update(Buffer.from(s, 'utf8')).digest('base64')
}

/** The stand-in esm.sh; `down` answers every request with 503. Returns the URLs asked for. */
async function serveEsm(context: BrowserContext, down = false): Promise<string[]> {
  const asked: string[] = []
  await context.route('https://esm.sh/**', (route) => {
    const url = route.request().url()
    asked.push(url)
    const headers = { 'access-control-allow-origin': '*' }
    if (down) return route.fulfill({ status: 503, headers, body: 'unavailable' })
    const body = SERVED[url]
    if (body === undefined) return route.fulfill({ status: 404, headers, body: 'not found' })
    return route.fulfill({ status: 200, contentType: 'application/javascript', headers, body })
  })
  return asked
}

const SONG: ProjectFile = { id: 'song', path: 'song.strudel', language: 'strudel', content: `drums: s("bd*2").viz("probe")\n` }

/** The bench scene: 3000 opaque red splats on black; reports its red pixels. */
const SPARK_SKETCH: ProjectFile = {
  id: 'viz',
  path: 'probe.three',
  language: 'three',
  content: `import * as THREE from 'three'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
${COUNT_RED}const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true })
const scene = new THREE.Scene(); scene.background = new THREE.Color(0, 0, 0)
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100); camera.position.set(0, 0, 3)
const spark = new SparkRenderer({ renderer }); scene.add(spark)
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const mesh = new SplatMesh({ constructSplats: (splats) => {
  for (let i = 0; i < 3000; i++) { const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); if (v.length() > 1) { i--; continue }
    splats.pushSplat(v.multiplyScalar(0.8), new THREE.Vector3(0.03, 0.03, 0.03), new THREE.Quaternion(), 1, new THREE.Color(1, 0, 0)) } } })
scene.add(mesh); await mesh.initialized
let frames = 0
renderer.setAnimationLoop(() => { renderer.render(scene, camera); if (++frames === 30) report({ ...countRed(renderer), sameThree: spark instanceof THREE.Object3D }) })
`,
}

const fileText = (page: Page, p: string): Promise<string | null> =>
  page.evaluate((x) => (window as unknown as { __staveFileText: (p: string) => string | null }).__staveFileText(x), p)
const toast = (page: Page, text: string | RegExp) => page.locator('[data-testid="toast"]', { hasText: text }).last()

/** Command palette → Add Library… → the row for `title`. */
async function addFromPalette(page: Page, title: string): Promise<void> {
  await page.keyboard.press(`${MOD}+Shift+P`)
  await page.getByPlaceholder('Type a command...').fill('Add Library')
  await expect(page.locator('[data-palette-row]', { hasText: 'Add Library…' })).toBeVisible()
  await page.keyboard.press('Enter')
  await page.getByPlaceholder('Add a library to this project…').fill(title)
  await expect(page.locator('[data-palette-row]', { hasText: title }).first()).toBeVisible()
  await page.keyboard.press('Enter')
}

for (const browserName of ['chromium', 'firefox', 'webkit'] as const) {
  test.describe(`#2643 Add Library… (${browserName})`, () => {
    test.describe.configure({ timeout: 180_000 })

    test('choosing Spark writes a declaration whose hash matches a fresh download, and a sketch importing it renders', () =>
      onEngine(browserName, test.info(), async (page, context) => {
        // #2646 — Spark sometimes stalls in Firefox's sketch worker; the main thread never does.
        const mode: Mode = browserName === 'firefox' ? 'main' : 'worker'
        const asked = await serveEsm(context)
        await openShared(page, mode, `catalogue-${browserName}`, [SONG, SPARK_SKETCH])
        expect(await fileText(page, 'stave.libs.json'), 'no stave.libs.json yet').toBeNull()

        await addFromPalette(page, 'Spark')
        await expect(page.getByText('Spark 2.4.0 is in stave.libs.json')).toBeVisible({ timeout: 60_000 })
        await expect(page.getByText('Created stave.libs.json. Paste this line at the top of a .three sketch:')).toBeVisible()
        await expect(page.locator('input[value*="@sparkjsdev/spark"]')).toHaveValue("import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'")
        await page.getByRole('button', { name: 'Cancel' }).click()

        const written = await fileText(page, 'stave.libs.json')
        const fresh = graphHash(SERVED)
        console.log(`[#2643] ${browserName} written=${JSON.stringify(written)} fresh=${fresh} asked=${JSON.stringify(asked)}`)
        expect(written).toBe(`{\n  "@sparkjsdev/spark": {\n    "url": "${SPARK_URL}",\n    "sha384": "${fresh}"\n  }\n}\n`)
        await expect(page.locator('[data-file-tree-item]').filter({ hasText: 'stave.libs.json' }).first()).toBeVisible()

        const r = await playPattern<{ red: number; of: number; realm: string; sameThree: boolean }>(page, 'song.strudel')
        console.log(`[#2643] ${browserName} ${mode} results=${JSON.stringify(r.results)} rows=${JSON.stringify(r.rows)}`)
        expect(r.rows.filter((x) => x.level === 'error'), 'no error rows').toEqual([])
        expect(r.results).toHaveLength(1)
        expect(r.results[0].realm, `ran on the ${mode} path`).toBe(mode)
        expect(r.results[0].sameThree).toBe(true)
        expect(r.results[0].red, 'splats drew red pixels').toBeGreaterThan(0)
      }))
  })
}

test.describe('#2643 Add Library… keeps what stave.libs.json holds', () => {
  test.describe.configure({ timeout: 180_000 })
  const OTHER = `{\n    "my-lib": {\n        "url": "https://example.test/my-lib.js",\n        "sha384": "${'B'.repeat(64)}"\n    }\n}\n`

  test('adding when the file has other entries keeps them, and their layout', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await serveEsm(context)
    await openShared(page, 'worker', 'catalogue-merge', [SONG, { id: 'libs', path: 'stave.libs.json', language: 'json', content: OTHER }])
    await addFromPalette(page, 'Spark')
    await expect(page.getByText('Spark 2.4.0 is in stave.libs.json')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('Paste this line at the top of a .three sketch:', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    const written = await fileText(page, 'stave.libs.json')
    console.log(`[#2643] merge written=${JSON.stringify(written)}`)
    expect(written).toBe(
      `{\n    "my-lib": {\n        "url": "https://example.test/my-lib.js",\n        "sha384": "${'B'.repeat(64)}"\n    },\n    "@sparkjsdev/spark": {\n        "url": "${SPARK_URL}",\n        "sha384": "${graphHash(SERVED)}"\n    }\n}\n`,
    )
    await context.close()
  })

  test('when the library can\'t be fetched, the file is left as it was and the message says why', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const asked = await serveEsm(context, true)
    await openShared(page, 'worker', 'catalogue-down', [SONG, { id: 'libs', path: 'stave.libs.json', language: 'json', content: OTHER }])
    await addFromPalette(page, 'Spark')
    const msg = `Couldn't add Spark: fetching ${SPARK_URL} failed (HTTP 503). stave.libs.json was not changed.`
    await expect(toast(page, msg)).toBeVisible({ timeout: 60_000 })
    expect(asked, 'the fetch was tried').toContain(SPARK_URL)
    expect(await fileText(page, 'stave.libs.json')).toBe(OTHER)
    await expect(page.getByText('is in stave.libs.json')).toHaveCount(0)
    await context.close()
  })

  test('with no file and no network, no file is made', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await serveEsm(context, true)
    await openShared(page, 'worker', 'catalogue-down-nofile', [SONG])
    await addFromPalette(page, 'Spark')
    await expect(toast(page, /^Couldn't add Spark: fetching .* failed \(HTTP 503\)\. stave\.libs\.json was not changed\./)).toBeVisible({ timeout: 60_000 })
    expect(await fileText(page, 'stave.libs.json')).toBeNull()
    await context.close()
  })
})

// Optional: the real esm.sh. The hash the page writes must equal one computed
// here over a fresh download of the same URL (each module fetched by Node and
// its imports followed). The request carries an Origin header, as the browser's does:
// for some packages esm.sh serves different bytes to requests with and without one.
test.describe('#2643 live esm.sh (STAVE_LIVE_LIBS=1)', () => {
  test.skip(process.env.STAVE_LIVE_LIBS !== '1', 'set STAVE_LIVE_LIBS=1 to add Spark from esm.sh')
  test.describe.configure({ timeout: 240_000 })

  async function freshGraph(entry: string, origin: string): Promise<Record<string, string>> {
    const modules: Record<string, string> = {}
    const queue = [entry]
    while (queue.length) {
      const url = queue.shift()!
      if (url in modules) continue
      const res = await fetch(url, { headers: { origin } })
      expect(res.ok, `${url} fetched`).toBe(true)
      const text = await res.text()
      modules[url] = text
      for (const m of text.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
        const spec = m[1]
        if (spec === 'three' || spec.startsWith('three/')) continue
        queue.push(new URL(spec, url).href)
      }
    }
    return modules
  }

  test('Spark from esm.sh: the written hash equals a fresh download\'s, and it renders', async ({ browser }) => {
    const baseURL = test.info().project.use.baseURL!
    const page = await browser.newPage({ baseURL })
    await openShared(page, 'worker', 'catalogue-live', [SONG, SPARK_SKETCH])
    await addFromPalette(page, 'Spark')
    await expect(page.getByText('Spark 2.4.0 is in stave.libs.json')).toBeVisible({ timeout: 120_000 })
    await page.getByRole('button', { name: 'Cancel' }).click()
    const written = JSON.parse((await fileText(page, 'stave.libs.json'))!)
    const fresh = await freshGraph(SPARK_URL, new URL(baseURL).origin)
    console.log(`[#2643] live written=${JSON.stringify(written)} fresh modules=${Object.keys(fresh).length} hash=${graphHash(fresh)}`)
    expect(written['@sparkjsdev/spark']).toEqual({ url: SPARK_URL, sha384: graphHash(fresh) })
    const r = await playPattern<{ red: number }>(page, 'song.strudel')
    console.log(`[#2643] live results=${JSON.stringify(r.results)} rows=${JSON.stringify(r.rows)}`)
    expect(r.results[0]?.red ?? 0).toBeGreaterThan(0)
    await page.close()
  })
})
