/**
 * #2328 — gallery entries preview in a sandbox, and imported code asks before
 * it first runs.
 *
 * 1. HOSTILE ENTRY. Two real entries in the server's gallery store: a "victim"
 *    this browser published (its manage token is in this page's localStorage,
 *    as publishing leaves it) and a hostile one, whose code tries to reach the
 *    person's data from inside the preview: IndexedDB, localStorage,
 *    `document.cookie` (a readable cookie is set on the page), the account's
 *    private-link list, and deleting the victim with its token. It reports what
 *    each attempt got twice — posted to the gallery page (which ignores it; the
 *    spec reads it) and thrown from the playing pattern, so the preview's
 *    status line shows it. Every
 *    attempt must fail or be refused, the victim must still exist, and the
 *    gallery page's localStorage must be exactly what it was. Then, straight at
 *    the server: the victim's own valid token with `Origin: null` is 403, and
 *    the same request with no Origin deletes it (the control: the 403 was the
 *    origin check, not a bad token).
 * 2. A normal music entry previews: the frame reports `playing`, and the
 *    entry's top-level statement ran in the FRAME, not on the gallery page. A
 *    Hydra entry renders there too.
 * 3. TRUST STEP. The first Play after "Open as new project" asks, naming the
 *    author; Cancel leaves it unrun; Run it plays; the next Play doesn't ask.
 *
 * Screenshots go to $GALLERY_SHOT_DIR.
 *
 * ─── TESTS 1 AND 2 NEED A PRODUCTION SERVER ─────────────────────────────────
 * `next dev` can't host the preview frame: its cross-site guard answers 403 to
 * every `/_next/` script an opaque-origin frame asks for (it wants a Referer
 * naming an allowed host, and an opaque origin sends none —
 * next/dist/server/lib/router-utils/block-cross-site-dev.js), and refuses the
 * HMR socket. Re-serving those scripts from the test isn't enough either: the
 * dev client then loads but never hydrates. `next start` has no such guard,
 * and there the player loads, plays and renders with nothing in between. So
 * on a dev server these two tests SKIP, saying so; run them against a
 * production build (the dev store flag gives it the folder store test 1 seeds):
 *
 *   AUTH_SECRET=dev-only-secret npx next build
 *   STAVE_SHARE_DEV_STORE=1 AUTH_SECRET=dev-only-secret npx next start -p 3359
 *   STAVE_E2E_PORT=3359 npx playwright test tests/gallery-sandbox.spec.ts --project=chromium --workers=1
 *
 * Test 3 (the trust step) runs on either.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { chromium, test, expect, type Page } from '@playwright/test'
import { bootApp, editorValue, evalCode, stopCode } from './_appBoot'
import { MUSIC_CODE, routeGallery } from './_gallery'

const SHOTS = process.env.GALLERY_SHOT_DIR
const RUN = Date.now().toString(36)
// The folder store the server reads (store.ts), as gallery-account.spec.ts finds it.
const GALLERY_DIR = process.env.STAVE_GALLERY_DEV_DIR || path.join(os.tmpdir(), 'stave-gallery-dev')
const MANAGE_TOKEN_HEADER = 'x-stave-manage-token'

/** Is this a `next dev` server? Its pages load the HMR client; a production build's don't. */
async function isDevServer(page: Page): Promise<boolean> {
  const html = await (await page.request.get('/gallery-player')).text()
  return html.includes('hmr-client')
}
const DEV_SKIP = "next dev can't host the sandboxed preview frame (see this file's header); run against next build && next start"

/**
 * Console errors, frame and page together (a console message doesn't say which
 * frame it came from); printed at the end of each test for the record.
 */
function consoleErrors(page: Page): string[] {
  const out: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') out.push(`${m.text().slice(0, 300)}  @ ${m.location()?.url ?? '?'}`)
  })
  page.on('pageerror', (e) => out.push(`pageerror: ${e.message.slice(0, 300)}`))
  return out
}

const previewState = (page: Page) => page.locator('[data-gallery-preview-state]').getAttribute('data-gallery-preview-state')
const parentRuns = (page: Page) => page.evaluate(() => (window as unknown as { __galleryRuns?: number }).__galleryRuns ?? 0)
const playerFrame = (page: Page) => page.frames().find((f) => f.url().includes('/gallery-player'))

const newId = () => randomBytes(8).toString('base64url') // 11 chars, the gallery id shape
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

async function putJson(rel: string, value: unknown): Promise<void> {
  const file = path.join(GALLERY_DIR, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value))
}

/** One listed music entry, as a publish writes it (store.ts galleryPaths). */
async function seedEntry(title: string, filePath: string, content: string): Promise<{ id: string; manageToken: string }> {
  const id = newId()
  const manageToken = randomBytes(32).toString('base64url')
  const now = Date.now()
  await putJson(`gallery/private/${id}.json`, { authorEmail: `sandbox-${RUN}@example.invalid`, manageTokenHash: sha(manageToken) })
  await putJson(`gallery/manifests/${id}.json`, {
    schemaVersion: 1,
    project: { name: title, sharedAt: now },
    files: [{ id: 'f0', path: filePath, language: 'strudel', content }],
    fileOrder: { '': ['f0'] },
    subfolderOrder: {},
  })
  await putJson(`gallery/entries/${id}.json`, {
    id, title, kind: 'music', tags: ['sandbox-test'], authorName: 'Mallory', publishedAt: now, fileCount: 1, hasThumbnail: false,
  })
  return { id, manageToken }
}

/**
 * The hostile entry's code. Strudel code, so strings are single-quoted (double
 * quotes and backticks are mini-notation). Each attempt's outcome is the value
 * it got or the error it raised, verbatim. The victim's token is written in,
 * as if it had leaked: even then the delete must not happen.
 */
function hostileCode(victimId: string, victimToken: string): string {
  return `// #2328 test fixture: tries to reach the person's data from the preview.
const probe = async () => {
  const out = {}
  const attempt = async (name, fn) => {
    try { out[name] = 'GOT ' + String(await fn()).slice(0, 160) }
    catch (e) { out[name] = 'FAILED ' + ((e && e.name) || 'Error') + ': ' + ((e && e.message) || String(e)) }
  }
  await attempt('indexedDB', () => new Promise((ok, no) => {
    const r = indexedDB.open('stave-workspace')
    r.onsuccess = () => ok('opened ' + r.result.objectStoreNames.length + ' stores')
    r.onerror = () => no(r.error)
  }))
  await attempt('localStorage', () => localStorage.getItem('stave.gallery.shares'))
  await attempt('cookie', () => 'cookie=[' + document.cookie + ']')
  await attempt('myShares', async () => {
    const r = await fetch('/api/gallery/me/shares', { credentials: 'include' })
    return 'status ' + r.status + ' ' + (await r.text()).slice(0, 120)
  })
  await attempt('deleteEntry', async () => {
    const r = await fetch('/api/gallery/${victimId}', { method: 'DELETE', credentials: 'include', headers: { '${MANAGE_TOKEN_HEADER}': '${victimToken}' } })
    return 'status ' + r.status + ' ' + (await r.text()).slice(0, 120)
  })
  parent.postMessage({ hostileProbe: out }, '*')
  globalThis.__probeReport = 'PROBE ' + JSON.stringify(out)
}
probe()
// Once the report is ready, the pattern throws it while playing: the error the
// preview shows. (A rejected promise or a timer's throw doesn't serve: Strudel
// keeps the first to itself, and the browser mutes the second to "Script
// error." because the code runs from a script of another origin than the frame's.)
s('bd ~ ~ ~').withValue((v) => { if (globalThis.__probeReport) throw new Error(globalThis.__probeReport); return v })
`
}

test.describe('gallery preview sandbox (#2328)', () => {
  test('a hostile entry in the preview reaches none of your data, and the API refuses it', async ({ page }) => {
    test.setTimeout(180_000)
    test.skip(await isDevServer(page), DEV_SKIP)
    const errors = consoleErrors(page)

    const victim = await seedEntry(`Victim ${RUN}`, 'victim.strudel', 's("hh*4")')
    expect((await page.request.get(`/api/gallery/${victim.id}`)).status(), 'the server does not read the seeded store').toBe(200)
    const hostile = await seedEntry(`Hostile ${RUN}`, 'probe.strudel', hostileCode(victim.id, victim.manageToken))

    // Every API request the FRAME makes, as it left the browser.
    const frameApi: string[] = []
    page.on('request', (r) => {
      if (r.frame() !== page.mainFrame() && r.url().includes('/api/')) {
        void r.allHeaders().then((h) =>
          frameApi.push(`${r.method()} ${new URL(r.url()).pathname} origin=${h['origin'] ?? '(none)'} cookie=${h['cookie'] ? 'SENT' : 'none'}`),
        )
      }
    })
    page.on('response', (r) => {
      if (r.frame() !== page.mainFrame() && r.url().includes('/api/')) frameApi.push(`  -> ${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`)
    })
    page.on('requestfailed', (r) => {
      if (r.frame() !== page.mainFrame() && r.url().includes('/api/')) frameApi.push(`  xx ${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText}`)
    })

    // A cookie the page itself can read, so "the frame read no cookie" means something.
    await page.context().addCookies([{ name: 'stave_probe', value: 'readable-by-the-page', url: new URL('/', test.info().project.use.baseURL ?? 'http://localhost').href, sameSite: 'Lax' }])
    await page.addInitScript(
      ([victimId, token]) => {
        ;(window as unknown as { __hostile: unknown[] }).__hostile = []
        window.addEventListener('message', (e) => {
          const d = e.data as { hostileProbe?: unknown }
          if (d && typeof d === 'object' && 'hostileProbe' in d) (window as unknown as { __hostile: unknown[] }).__hostile.push(d.hostileProbe)
        })
        // What publishing left in this browser: the entry and its manage token.
        if (!localStorage.getItem('stave.gallery.shares')) {
          localStorage.setItem('stave.gallery.shares', JSON.stringify([{ id: victimId, title: 'Victim', kind: 'music', publishedAt: Date.now(), manageToken: token }]))
        }
      },
      [victim.id, victim.manageToken] as const,
    )
    await bootApp(page)
    expect(await page.evaluate(() => document.cookie), 'the page can read its own cookie').toContain('stave_probe=readable-by-the-page')

    await page.goto(`/#gallery=${hostile.id}`)
    await expect(page.locator(`[data-gallery-detail="${hostile.id}"]`)).toBeVisible({ timeout: 30_000 })
    const storageBefore = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()))

    await page.locator('[data-gallery-preview-button]').click()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __hostile: unknown[] }).__hostile.length), { timeout: 60_000 })
      .toBeGreaterThan(0)
    const results = (await page.evaluate(() => (window as unknown as { __hostile: Record<string, string>[] }).__hostile[0])) as Record<string, string>
    // the same report, shown by the gallery as the error the playing code raised
    await expect(page.locator('[data-gallery-preview-state="playing"]')).toContainText('The code reported an error: PROBE', { timeout: 10_000 })
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sandbox-hostile-results.png` })

    console.log('HOSTILE RESULTS', JSON.stringify(results, null, 2))
    console.log('FRAME API REQUESTS\n' + frameApi.join('\n'))

    expect(results.indexedDB).toMatch(/^FAILED /)
    expect(results.localStorage).toMatch(/^FAILED /)
    expect(results.cookie).toMatch(/^FAILED |^GOT cookie=\[\]$/)
    expect(results.myShares).toMatch(/^FAILED /)
    expect(results.deleteEntry).toMatch(/^FAILED /)
    // no API request from the frame carried a cookie
    expect(frameApi.filter((l) => l.includes('cookie=SENT'))).toEqual([])

    // The victim is still there, and the gallery page's storage is untouched.
    expect((await page.request.get(`/api/gallery/${victim.id}`)).status()).toBe(200)
    expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()))).toBe(storageBefore)

    // Straight at the server: the victim's own valid token from an opaque origin is 403 ...
    const forged = await page.request.delete(`/api/gallery/${victim.id}`, { headers: { origin: 'null', [MANAGE_TOKEN_HEADER]: victim.manageToken } })
    expect(forged.status()).toBe(403)
    expect(await forged.json()).toEqual({ error: "this can only be done from Stave's own page" })
    expect((await page.request.get(`/api/gallery/${victim.id}`)).status()).toBe(200)
    // ... and the same request with no Origin (curl) deletes it: the 403 was the origin check.
    const control = await page.request.delete(`/api/gallery/${victim.id}`, { headers: { [MANAGE_TOKEN_HEADER]: victim.manageToken } })
    expect(control.status()).toBe(204)

    console.log('CONSOLE ERRORS\n' + errors.join('\n'))
  })

  test('a music entry previews in the frame and reports playing; a Hydra entry renders there', async ({ page }) => {
    test.setTimeout(300_000)
    test.skip(await isDevServer(page), DEV_SKIP)
    const errors = consoleErrors(page)
    await routeGallery(page)
    // a Hydra entry written to Stave's .hydra contract (`s` is the synth)
    const HYDRA = 's.osc(12, 0.08, 1.4).rotate(() => s.a.fft[0] * 0.5).kaleid(4).out()'
    await page.route('**/api/gallery/hydr1EEEEEE', (route) =>
      route.fulfill({
        json: {
          entry: { id: 'hydr1EEEEEE', title: 'Kaleid', kind: 'viz', tags: ['hydra'], authorName: 'Eve', publishedAt: Date.UTC(2026, 10, 1), fileCount: 1, hasThumbnail: false },
          manifest: { schemaVersion: 1, project: { name: 'Kaleid', sharedAt: 0 }, files: [{ id: 'h1', path: 'kaleid.hydra', language: 'hydra', content: HYDRA }], fileOrder: {}, subfolderOrder: {} },
        },
      }),
    )
    await bootApp(page)

    await page.goto('/#gallery=musc1CCCCCC')
    await expect(page.locator('[data-gallery-detail="musc1CCCCCC"]')).toBeVisible({ timeout: 30_000 })
    const clicked = Date.now()
    await page.locator('[data-gallery-preview-button]').click()
    await expect.poll(() => previewState(page), { timeout: 150_000 }).toBe('playing')
    console.log(`music preview: Preview click -> playing in ${Date.now() - clicked} ms`)
    await expect(page.locator('[data-gallery-preview-frame]')).toHaveAttribute('sandbox', 'allow-scripts')
    // the entry's top-level statement ran — in the frame, not here
    const frame = playerFrame(page)!
    expect(await frame.evaluate(() => (window as unknown as { __galleryRuns?: number }).__galleryRuns ?? 0)).toBeGreaterThan(0)
    expect(await frame.evaluate(() => self.origin)).toBe('null')
    expect(await parentRuns(page)).toBe(0)
    await page.waitForTimeout(1500)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sandbox-music-playing.png` })

    // Stop from the gallery
    await page.locator('[data-gallery-preview-button]').click()
    await expect.poll(() => previewState(page), { timeout: 10_000 }).toBe('stopped')

    // A Hydra entry renders inside the frame
    await page.goto('/#gallery=hydr1EEEEEE')
    await expect(page.locator('[data-gallery-detail="hydr1EEEEEE"]')).toBeVisible({ timeout: 30_000 })
    await page.locator('[data-gallery-preview-button]').click()
    await expect.poll(() => previewState(page), { timeout: 150_000 }).toBe('playing')
    const vframe = playerFrame(page)!
    await expect.poll(() => vframe.evaluate(() => document.querySelectorAll('[data-gallery-player-viz] canvas').length), { timeout: 15_000 }).toBeGreaterThan(0)
    await page.waitForTimeout(1500)
    expect(await previewState(page), 'the sketch errored after starting').toBe('playing')
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sandbox-hydra-playing.png` })

    console.log('CONSOLE ERRORS\n' + errors.join('\n'))
  })

  test('the first Play after "Open as new project" asks, naming the author; the second does not', async ({ page }) => {
    test.setTimeout(90_000)
    await routeGallery(page)
    await bootApp(page)
    await page.getByRole('button', { name: 'View', exact: true }).click()
    await page.getByText('Community Gallery...', { exact: true }).click()
    await page.locator('[data-gallery-card="proj1AAAAAA"]').click()
    await page.getByRole('button', { name: 'Open as new project' }).click()
    await expect.poll(() => editorValue(page), { timeout: 20_000 }).toBe(MUSIC_CODE)

    const ask = page.getByText(
      "This code was written by Alice. Running it in your workspace gives it the same access you have to Stave on this browser: your projects and your account. Preview it in the gallery first if you're unsure.",
    )

    // First Play asks; Cancel leaves it unrun.
    await evalCode(page)
    await expect(ask).toBeVisible({ timeout: 10_000 })
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sandbox-trust-dialog.png` })
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(ask).toHaveCount(0)
    await page.waitForTimeout(2000)
    expect(await parentRuns(page), 'Cancel must leave the code unrun').toBe(0)

    // Play again: it asks again; Run it plays.
    await evalCode(page)
    await expect(ask).toBeVisible({ timeout: 10_000 })
    expect(await parentRuns(page)).toBe(0)
    await page.getByRole('button', { name: 'Run it' }).click()
    await expect.poll(() => parentRuns(page), { timeout: 20_000 }).toBeGreaterThan(0)

    // Stop, then Play once more: no question this time.
    await stopCode(page)
    const before = await parentRuns(page)
    await evalCode(page)
    await expect.poll(() => parentRuns(page), { timeout: 20_000 }).toBeGreaterThan(before)
    await expect(ask).toHaveCount(0)

    // After a reload it's still trusted.
    await page.reload()
    await expect.poll(() => editorValue(page), { timeout: 30_000 }).toBe(MUSIC_CODE)
    await evalCode(page)
    await expect.poll(() => parentRuns(page), { timeout: 20_000 }).toBeGreaterThan(0)
    await expect(ask).toHaveCount(0)
  })
})

// Headless Chromium starts audio without a gesture; a real browser doesn't, and
// the click on the gallery's Preview button activates the gallery page, not the
// frame. Under the real rule (a browser of its own, launched with it) the frame
// says so and offers its own Play button.
test('under the browser autoplay rule, the frame asks for a click of its own, then plays', async ({ page: probe, baseURL }) => {
  test.setTimeout(120_000)
  test.skip(await isDevServer(probe), DEV_SKIP)
  const browser = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] })
  try {
    const page = await (await browser.newContext({ baseURL })).newPage()
    await routeGallery(page)
    await bootApp(page)
    await page.goto('/#gallery=musc1CCCCCC')
    await expect(page.locator('[data-gallery-detail="musc1CCCCCC"]')).toBeVisible({ timeout: 30_000 })
    await page.locator('[data-gallery-preview-button]').click()
    await expect(page.locator('[data-gallery-preview-state="stopped"]')).toHaveText('Press Play in the preview to hear it.', { timeout: 60_000 })
    const frame = playerFrame(page)!
    const start = frame.locator('[data-gallery-player-start]')
    await expect(start).toBeVisible()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sandbox-needs-a-click.png` })
    await start.click()
    await expect.poll(() => previewState(page), { timeout: 20_000 }).toBe('playing')
    expect(await frame.evaluate(() => (window as unknown as { __galleryRuns?: number }).__galleryRuns ?? 0)).toBeGreaterThan(0)
  } finally {
    await browser.close()
  }
})
