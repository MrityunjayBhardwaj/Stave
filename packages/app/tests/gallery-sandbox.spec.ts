/**
 * #2328 — gallery entries preview in a sandbox, and imported code asks before
 * it first runs.
 *
 * 1. HOSTILE ENTRY. A "victim" this browser published (its manage token is in
 *    this page's localStorage, as publishing leaves it) and a hostile entry,
 *    whose code tries to reach the person's data from inside the preview:
 *    IndexedDB, localStorage, `document.cookie` (a readable cookie is set on the
 *    page), the account's private-link list, and deleting the victim with its
 *    token — those two requests go to the REAL server. It reports what each
 *    attempt got twice — posted to the gallery page (which ignores it; the spec
 *    reads it) and thrown from the playing pattern, so the preview's status line
 *    shows it. Every attempt must fail or be refused, no delete may reach the
 *    server, and the gallery page's localStorage must be exactly what it was.
 *    Then, straight at the server: a delete with the token and `Origin: null` is
 *    403, and the same request with no Origin is not (the control: the 403 was
 *    the origin check). That every write route refuses `Origin: null` before
 *    anything else, a valid token included, is galleryOrigin.test.ts.
 *    (#2343: the entries are served by the test, so no database and no sign-in
 *    are needed, and the test runs on a plain production build.)
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
 * on a dev server those tests SKIP, saying so. CI runs this file against a
 * production build (.github/workflows/ci.yml, #2343); by hand:
 *
 *   AUTH_SECRET=dev-only-secret npx next build
 *   AUTH_SECRET=dev-only-secret npx next start -p 3359
 *   STAVE_E2E_PORT=3359 npx playwright test tests/gallery-sandbox.spec.ts --project=chromium --workers=1
 *
 * None of them needs a database or a sign-in. The trust-step tests run on either.
 */
import { randomBytes } from 'node:crypto'

import { chromium, test, expect, type Page } from '@playwright/test'
import { bootApp, editorValue, evalCode, seedCode, stopCode } from './_appBoot'
import { MUSIC_CODE, routeGallery } from './_gallery'
import { NAVIGATED_AWAY } from '../src/gallery/GalleryPreview'

const SHOTS = process.env.GALLERY_SHOT_DIR
const RUN = Date.now().toString(36)
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

/**
 * Serve one music entry from the test (GET /api/gallery/<id> only), so no
 * database is needed: every other request, the frame's included, goes to the
 * real server.
 */
async function routeEntry(page: Page, title: string, filePath: string, content: string): Promise<{ id: string }> {
  const id = newId()
  const now = Date.now()
  const body = {
    entry: { id, title, kind: 'music', tags: ['sandbox-test'], authorName: 'Mallory', publishedAt: now, fileCount: 1, hasThumbnail: false },
    manifest: { schemaVersion: 1, project: { name: title, sharedAt: now }, files: [{ id: 'f0', path: filePath, language: 'strudel', content }], fileOrder: { '': ['f0'] }, subfolderOrder: {} },
  }
  await page.route(`**/api/gallery/${id}`, (route) => (route.request().method() === 'GET' ? route.fulfill({ json: body }) : route.fallback()))
  return { id }
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

    const victim = { id: newId(), manageToken: randomBytes(32).toString('base64url') }
    const hostile = await routeEntry(page, `Hostile ${RUN}`, 'probe.strudel', hostileCode(victim.id, victim.manageToken))

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
        // An init script runs in every frame, the sandboxed preview included, where
        // reading localStorage throws: that was the stray "SecurityError" this test
        // used to log from inside the frame (#2343). The page's setup is for the page.
        if (window.parent !== window) return
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
    // no API request from the frame carried a cookie, and its delete never got an answer from the server
    expect(frameApi.filter((l) => l.includes('cookie=SENT'))).toEqual([])
    expect(frameApi.filter((l) => l.startsWith('  -> DELETE'))).toEqual([])

    // The gallery page's storage is untouched.
    expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()))).toBe(storageBefore)

    // Straight at the server: the token from an opaque origin is 403 ...
    const forged = await page.request.delete(`/api/gallery/${victim.id}`, { headers: { origin: 'null', [MANAGE_TOKEN_HEADER]: victim.manageToken } })
    expect(forged.status()).toBe(403)
    expect(await forged.json()).toEqual({ error: "this can only be done from Stave's own page" })
    // ... and the same request with no Origin (curl) is not: the 403 was the origin check.
    const control = await page.request.delete(`/api/gallery/${victim.id}`, { headers: { [MANAGE_TOKEN_HEADER]: victim.manageToken } })
    expect(control.status()).not.toBe(403)

    console.log('CONSOLE ERRORS\n' + errors.join('\n'))
    // #2343 — nothing went uncaught, in the page or the frame
    expect(errors.filter((e) => e.startsWith('pageerror:'))).toEqual([])
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

  // #2343 — the frame loads the app's scripts from an origin that isn't its own
  // (its own is opaque), and the browser used to mute what they throw later.
  test("an error the entry raises later comes through in full: a timer's throw, a rejected promise", async ({ page }) => {
    test.setTimeout(240_000)
    test.skip(await isDevServer(page), DEV_SKIP)
    const timer = await routeEntry(page, 'Timer', 'timer.strudel', "setTimeout(() => { throw new Error('TIMER-BOOM') }, 300)\ns('bd ~ ~ ~')")
    const rejected = await routeEntry(page, 'Rejected', 'rejected.strudel', "Promise.reject(new Error('REJECT-BOOM'))\ns('bd ~ ~ ~')")
    await bootApp(page)
    for (const [id, word] of [[timer.id, 'TIMER-BOOM'], [rejected.id, 'REJECT-BOOM']] as const) {
      await page.goto(`/#gallery=${id}`)
      await expect(page.locator(`[data-gallery-detail="${id}"]`)).toBeVisible({ timeout: 30_000 })
      await page.locator('[data-gallery-preview-button]').click()
      await expect(page.locator('[data-gallery-preview-state="playing"]')).toContainText(`The code reported an error: ${word}`, { timeout: 90_000 })
      await expect(page.locator('[data-gallery-preview-state]')).not.toContainText('Script error.')
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/sandbox-error-${word.toLowerCase()}.png` })
    }
  })

  // #2343 — the code can navigate its own frame; what loads there instead must not stay up.
  test('a preview whose code opens another page in its place is closed, and says so', async ({ page }) => {
    test.setTimeout(240_000)
    test.skip(await isDevServer(page), DEV_SKIP)
    const lookalike = 'data:text/html,<h1>Sign in to Stave</h1><input placeholder=password>'
    const nav = await routeEntry(page, 'Navigates', 'nav.strudel', `setTimeout(() => { location.href = '${lookalike}' }, 1500)\ns('bd ~ ~ ~')`)
    await bootApp(page)
    await page.goto(`/#gallery=${nav.id}`)
    await expect(page.locator(`[data-gallery-detail="${nav.id}"]`)).toBeVisible({ timeout: 30_000 })
    await page.locator('[data-gallery-preview-button]').click()
    await expect(page.locator('[data-gallery-preview-state]')).toHaveText(NAVIGATED_AWAY, { timeout: 90_000 })
    await expect(page.locator('[data-gallery-preview-frame]')).toHaveCount(0)
    expect(page.frames().map((f) => f.url()).filter((u) => u.startsWith('data:')), 'the lookalike is not on the page').toEqual([])
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/sandbox-navigated-away.png` })
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

/*
 * #2342 / #2344 — every other way to run imported code asks the same question.
 * Bounce to WAV and the stems export evaluate the file; a viz file runs when its
 * ▶ Play shows it; and `.viz("name")` in your own code must not mount an
 * imported viz file nobody agreed to run. "Ran" is the fixture's top-level
 * counter, `window.__galleryRuns`, on the page.
 */
test.describe('every path that runs imported code asks first (#2342, #2344)', () => {
  const ASK =
    "This code was written by Alice. Running it in your workspace gives it the same access you have to Stave on this browser: your projects and your account. Preview it in the gallery first if you're unsure."

  /** The trust question's own buttons (the Bounce dialog has a Cancel too). */
  const trust = (page: Page) =>
    page
      .locator('div', { has: page.getByText('Run code from the gallery?', { exact: true }) })
      .filter({ has: page.getByRole('button', { name: 'Run it', exact: true }) })
      .last()

  async function openProjectEntry(page: Page): Promise<void> {
    await routeGallery(page)
    await bootApp(page)
    await page.getByRole('button', { name: 'View', exact: true }).click()
    await page.getByText('Community Gallery...', { exact: true }).click()
    await page.locator('[data-gallery-card="proj1AAAAAA"]').click()
    await page.getByRole('button', { name: 'Open as new project' }).click()
    await expect.poll(() => editorValue(page), { timeout: 20_000 }).toBe(MUSIC_CODE)
  }

  async function startBounce(page: Page, kind: 'Mix' | 'Stems'): Promise<void> {
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByText('Bounce to WAV...').click()
    await expect(page.getByRole('dialog', { name: 'Bounce to WAV' })).toBeVisible()
    await page.getByRole('button', { name: '8s' }).click()
    if (kind === 'Stems') await page.getByTestId('bounce-export-kind').getByRole('button', { name: 'Stems' }).click()
    await page.getByRole('button', { name: 'Start Bounce' }).click()
  }

  for (const kind of ['Mix', 'Stems'] as const) {
    test(`Bounce (${kind}) of an imported project asks before anything runs; Cancel saves nothing`, async ({ page }) => {
      test.setTimeout(120_000)
      const downloads: string[] = []
      page.on('download', (d) => downloads.push(d.suggestedFilename()))
      await openProjectEntry(page)
      const ask = page.getByText(ASK)

      await startBounce(page, kind)
      await expect(ask).toBeVisible({ timeout: 10_000 })
      expect(await parentRuns(page), 'nothing ran before the answer').toBe(0)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/bounce-${kind.toLowerCase()}-trust-dialog.png` })
      await trust(page).getByRole('button', { name: 'Cancel' }).click()
      await expect(ask).toHaveCount(0)
      await expect(page.getByText('Bounce cancelled — nothing was saved.')).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole('dialog', { name: 'Bounce to WAV' })).toBeHidden({ timeout: 10_000 })
      await page.waitForTimeout(2000)
      expect(await parentRuns(page), 'Cancel must leave the code unrun').toBe(0)
      expect(downloads, 'Cancel must save nothing').toEqual([])

      // Again, and Run it: it runs and the file arrives. (The control: the same
      // path does evaluate, and does save, once the person agreed.)
      const saved = page.waitForEvent('download', { timeout: 90_000 })
      await startBounce(page, kind)
      await expect(ask).toBeVisible({ timeout: 10_000 })
      await trust(page).getByRole('button', { name: 'Run it' }).click()
      const d = await saved
      expect(d.suggestedFilename()).toMatch(kind === 'Mix' ? /\.wav$/ : /-stems\.zip$/)
      expect(await parentRuns(page)).toBeGreaterThan(0)
    })
  }

  test("a gallery viz file's ▶ Play asks before its code runs", async ({ page }) => {
    test.setTimeout(120_000)
    await routeGallery(page)
    await bootApp(page)
    await page.goto('/#gallery=vizz1DDDDDD')
    await expect(page.locator('[data-gallery-detail="vizz1DDDDDD"]')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Add to this project' }).click()
    await expect(page.locator('[data-gallery="overlay"]')).toHaveCount(0)
    await page.waitForTimeout(2000)
    expect(await parentRuns(page), 'adding the file runs nothing').toBe(0)

    const ask = page.getByText(ASK.replace('Alice', 'Dee'))
    await page.locator('[data-testid="viz-chrome-open-preview"]').first().click()
    await expect(ask).toBeVisible({ timeout: 10_000 })
    expect(await parentRuns(page)).toBe(0)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/viz-play-trust-dialog.png` })
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(ask).toHaveCount(0)
    await expect(page.locator('[data-gallery-run-gate="declined"]').first()).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(2000)
    expect(await parentRuns(page), 'Cancel must leave the viz code unrun').toBe(0)

    // The viz's own control asks again (the visual sits behind the code as a
    // backdrop, so its own "Run it…" can't be clicked); yes runs it.
    await page.locator('[data-testid="viz-chrome-open-preview"]').first().click()
    await expect(ask).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Run it', exact: true }).click()
    await expect.poll(() => parentRuns(page), { timeout: 20_000 }).toBeGreaterThan(0)
  })

  // Inline `.viz()` draws in a worker, which `next dev` can't load (an importScripts
  // NetworkError), so this needs a production build, like the frame tests above.
  // The viz code signals that it ran with a request and a console line, both of
  // which a worker can make (it has no page `window` to count on).
  for (const trusted of [false, true]) {
    test(`.viz("name") in your own code ${trusted ? 'CONTROL: mounts the imported viz once trusted' : 'does not mount an imported viz file nobody agreed to run'}`, async ({ page }) => {
      test.setTimeout(120_000)
      test.skip(await isDevServer(page), DEV_SKIP)
      const ran: string[] = []
      page.on('console', (m) => { if (m.text().includes('BLOOM-RAN')) ran.push(m.text()) })
      page.context().on('request', (r) => { if (r.url().includes('__bloom_ran__')) ran.push(r.url()) })
      await page.context().route('**/__bloom_ran__*', (r) => r.fulfill({ status: 204 }))
      await routeGallery(page)
      const code = "console.log('BLOOM-RAN'); fetch('/__bloom_ran__?' + Date.now()).catch(() => {})\nosc(10, 0.1, 0.8).out()"
      await page.route('**/api/gallery/vizz1DDDDDD', (r) => r.fulfill({ json: {
        entry: { id: 'vizz1DDDDDD', title: 'Oscillator Bloom', kind: 'viz', tags: [], authorName: 'Dee', publishedAt: 0, fileCount: 1, hasThumbnail: false },
        manifest: { schemaVersion: 1, project: { name: 'Bloom', sharedAt: 0 }, files: [{ id: 'g_viz1', path: 'bloom.hydra', language: 'hydra', content: code }], fileOrder: {}, subfolderOrder: {} },
      } }))
      await bootApp(page)
      // your own pattern, naming a viz the import is about to bring in
      const mine = '$: s("bd*4").viz("bloom")'
      await seedCode(page, mine)
      await page.goto('/#gallery=vizz1DDDDDD')
      await expect(page.locator('[data-gallery-detail="vizz1DDDDDD"]')).toBeVisible({ timeout: 30_000 })
      await page.getByRole('button', { name: 'Add to this project' }).click()
      await expect(page.locator('[data-gallery="overlay"]')).toHaveCount(0)
      await page.waitForTimeout(2000)
      if (trusted) {
        // as if the person had already said yes to this file
        await page.evaluate(() => {
          localStorage.removeItem('stave.gallery.untrusted')
          localStorage.removeItem('stave.gallery.unplayed')
        })
        await page.reload()
        await page.waitForTimeout(4000)
      }
      await page.locator('[data-workspace-tab="tab-pattern.strudel"]').first().click()
      await expect.poll(() => editorValue(page), { timeout: 15_000 }).toBe(mine)
      await evalCode(page)
      if (trusted) {
        await expect.poll(() => ran.length, { timeout: 20_000 }).toBeGreaterThan(0)
      } else {
        await page.waitForTimeout(8000)
        expect(ran, "your own Play must not run the imported viz file's code").toEqual([])
        await expect(page.getByText('Run code from the gallery?')).toHaveCount(0)
      }
    })
  }

})
