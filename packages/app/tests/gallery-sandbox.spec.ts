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
 * 4. FRAME POLICY (#2374). Code in the preview can't bring another site into the
 *    frame or nest one inside it, even a page that never finishes loading; the
 *    frames the app shows on purpose still load.
 * 5. A PROJECT PREVIEWS AS ITSELF (#2490). A project's pattern that calls
 *    `.viz("bloom")` draws the project's own `viz/bloom.hydra` inside the frame
 *    (read from the frame's pixels, not its DOM), in Chromium and in WebKit; the
 *    same pattern with the visual left out of the project draws nothing and the
 *    frame says which name it couldn't find.
 * 6. THE PREVIEW DRAWS WHAT PLAYS (#2489). A music file with no visual of its
 *    own draws Stave's piano roll in the frame: its notes are on screen and move
 *    (two shots of the frame's pixels, 700 ms apart), the line reads "bar N of 4"
 *    for a four-bar song and "bar N" for a loop, the frame's own stop and the
 *    page's Stop both clear it, and the frame's messages to the page are the same
 *    states as ever; silence, the control, draws no notes. Chromium and WebKit.
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
 * None of them needs a database or a sign-in. The trust-step tests, and the
 * tests that an embed still loads (#2374), run on either.
 */
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

import { existsSync } from 'node:fs'

import { test, expect, webkit, type Page } from '@playwright/test'
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

const LOOKALIKE = 'Sign in to Stave'

/**
 * #2374 — a site that isn't this one (127.0.0.1 against the tests' localhost).
 * It answers as a hostile site would, with the headers that get past the app's
 * cross-origin isolation, so nothing but the frame policy stands in its way. `/hang`
 * sends its page and holds the connection open, so that page's load never fires.
 */
async function hostileSite(): Promise<{ url: string; hits: string[]; close: () => void }> {
  const hits: string[] = []
  const sockets = new Set<Socket>()
  const server = createServer((req, res) => {
    hits.push(req.url ?? '')
    res.writeHead(200, { 'content-type': 'text/html', 'cross-origin-embedder-policy': 'credentialless', 'cross-origin-resource-policy': 'cross-origin' })
    const body = `<!doctype html><h1>${LOOKALIKE}</h1>${' '.repeat(4096)}`
    if (req.url?.startsWith('/hang')) res.write(body)
    else res.end(body)
  })
  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    hits,
    close: () => {
      for (const s of sockets) s.destroy()
      server.close()
    },
  }
}

/** The browser's console lines for frames the policy refused. */
function frameSrcRefusals(page: Page): string[] {
  const out: string[] = []
  page.on('console', (m) => {
    if (m.text().includes('frame-src')) out.push(m.text().slice(0, 200))
  })
  return out
}

/** Every address that ever entered a frame on this page, however briefly. */
function framesCommitted(page: Page): string[] {
  const out: string[] = []
  page.on('framenavigated', (f) => {
    if (f !== page.mainFrame()) out.push(f.url())
  })
  return out
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

  // #2374 — the app's frame-src policy refuses these before anything is fetched:
  // the frame ends on the browser's own blocked page, whose load closes the
  // preview as above. A page that never finishes loading fires no load of its
  // own, so without the policy that case stays up and this waits in vain.
  for (const [what, navigate] of [
    ['another site', (site: string) => `location.href='${site}/normal'`],
    ['a page that never finishes loading', (site: string) => `location.href='${site}/hang'`],
    ['a data: page', () => `location.href='data:text/html,<h1>${LOOKALIKE}</h1>'`],
    ['a blob: page', () => `location.href=URL.createObjectURL(new Blob(['<h1>${LOOKALIKE}</h1>'],{type:'text/html'}))`],
  ] as const) {
    test(`a preview whose code goes to ${what} shows nothing from it`, async ({ page }) => {
      test.setTimeout(240_000)
      test.skip(await isDevServer(page), DEV_SKIP)
      const hostile = await hostileSite()
      try {
        const refused = frameSrcRefusals(page)
        const committed = framesCommitted(page)
        const nav = await routeEntry(page, 'Navigates', 'nav.strudel', `setTimeout(() => { ${navigate(hostile.url)} }, 1500)\ns('bd ~ ~ ~')`)
        await bootApp(page)
        await page.goto(`/#gallery=${nav.id}`)
        await expect(page.locator(`[data-gallery-detail="${nav.id}"]`)).toBeVisible({ timeout: 30_000 })
        await page.locator('[data-gallery-preview-button]').click()
        await expect(page.locator('[data-gallery-preview-state]')).toHaveText(NAVIGATED_AWAY, { timeout: 90_000 })
        await expect(page.locator('[data-gallery-preview-frame]')).toHaveCount(0)
        expect(hostile.hits, 'the browser never asked that site for anything').toEqual([])
        expect(committed.filter((u) => u.startsWith('data:') || u.startsWith('blob:') || u.startsWith(hostile.url)), 'nothing from it entered the frame').toEqual([])
        expect(refused.length, 'it was the policy that refused it').toBeGreaterThan(0)
      } finally {
        hostile.close()
      }
    })
  }

  // The policy above is read from the page HOLDING a frame, so it doesn't reach
  // a frame the code nests inside the preview; the preview's own page has to carry
  // one too. The film's address is on the app's list, so it's here to tell the
  // player's stricter policy from the app's.
  test("a frame the preview's code nests inside itself shows no site, listed or not", async ({ page }) => {
    test.setTimeout(240_000)
    test.skip(await isDevServer(page), DEV_SKIP)
    const hostile = await hostileSite()
    try {
      const FILM = 'https://www.youtube-nocookie.com/embed/nested'
      await page.route(`${FILM}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>stub film</p>' }))
      const refused = frameSrcRefusals(page)
      const committed = framesCommitted(page)
      const nest = (src: string) => `(() => { const f = document.createElement('iframe'); f.setAttribute('credentialless', ''); f.src = '${src}'; document.body.append(f) })()`
      const code = [`${hostile.url}/normal`, `${hostile.url}/hang`, `data:text/html,<h1>${LOOKALIKE}</h1>`, FILM].map(nest).join(';\n')
      const nested = await routeEntry(page, 'Nests', 'nest.strudel', `setTimeout(() => {\n${code}\n}, 500)\ns('bd ~ ~ ~')`)
      await bootApp(page)
      await page.goto(`/#gallery=${nested.id}`)
      await expect(page.locator(`[data-gallery-detail="${nested.id}"]`)).toBeVisible({ timeout: 30_000 })
      await page.locator('[data-gallery-preview-button]').click()
      await expect.poll(() => previewState(page), { timeout: 90_000 }).toBe('playing')
      await expect.poll(() => refused.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(4)
      expect(hostile.hits, 'the browser never asked that site for anything').toEqual([])
      expect(committed.filter((u) => u.startsWith('data:') || u.startsWith(hostile.url) || u.startsWith(FILM)), 'no nested frame loaded').toEqual([])
      expect(await previewState(page), 'the preview itself carries on').toBe('playing')
    } finally {
      hostile.close()
    }
  })

  // The control for the tests above: the same site, with nothing refusing it, answers.
  test('CONTROL: that hostile site shows its page when nothing refuses it', async ({ page }) => {
    const hostile = await hostileSite()
    try {
      await page.goto(`${hostile.url}/hang`, { waitUntil: 'commit' })
      await expect(page.getByText(LOOKALIKE)).toBeVisible({ timeout: 10_000 })
      expect(hostile.hits).toEqual(['/hang'])
    } finally {
      hostile.close()
    }
  })

  // #2374 — every frame the app shows on purpose still loads under the policy. The
  // preview frame is the tests above; the start screen's film is
  // start-screen-intro.spec.ts. Turnstile only draws in a build with a site key
  // (gallery-publish.spec.ts has that test), so here the frame it makes is made by
  // hand, stubbed with the headers Cloudflare really sends (see TurnstileWidget.tsx).
  test("Turnstile's frame loads on the app page, and the same frame from an unlisted site doesn't", async ({ page }) => {
    test.setTimeout(90_000)
    const stub = { status: 200, contentType: 'text/html', headers: { 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'cross-origin' }, body: '<!doctype html><p id="stub">stub frame</p>' }
    await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill(stub))
    await page.route('https://unlisted.example/**', (route) => route.fulfill(stub))
    const refused = frameSrcRefusals(page)
    await bootApp(page)
    const addFrame = (id: string, src: string) =>
      page.evaluate(([i, s]) => {
        const f = document.createElement('iframe')
        f.id = i
        f.src = s
        document.body.append(f)
      }, [id, src])

    await addFrame('turnstile', 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/stub')
    await expect(page.frameLocator('#turnstile').locator('#stub')).toHaveText('stub frame', { timeout: 10_000 })
    expect(refused).toEqual([])

    // A stubbed answer doesn't get around the policy, so the frame above means something.
    await addFrame('unlisted', 'https://unlisted.example/stub')
    await expect.poll(() => refused.length, { timeout: 10_000 }).toBeGreaterThan(0)
    await expect(page.frameLocator('#unlisted').locator('#stub')).toHaveCount(0)
  })

  // The audio frame has no URL, so frame-src has nothing to say to it: this is
  // the bounce of a sound that needs worklets, the path that opens one (#1758).
  test('a bounce that opens the audio frame still renders under the policy', async ({ page }) => {
    test.setTimeout(180_000)
    const refused = frameSrcRefusals(page)
    const audioFrames: string[] = []
    page.on('frameattached', (f) => audioFrames.push(f.url()))
    await bootApp(page)
    await seedCode(page, '$: note("c3 e3").s("supersaw")')
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByText('Bounce to WAV...').click()
    await page.getByRole('button', { name: '8s' }).click()
    const saved = page.waitForEvent('download', { timeout: 120_000 })
    await page.getByRole('button', { name: 'Start Bounce' }).click()
    expect((await saved).suggestedFilename()).toMatch(/\.wav$/)
    expect(audioFrames.length, 'the bounce opened a frame').toBeGreaterThan(0)
    expect(refused).toEqual([])
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

/*
 * #2495 — what one click does for the preview's sound, under each browser's own
 * autoplay rule (measured first with a standalone page; nothing here relaxes the
 * rule). Chromium takes a click anywhere above the frame, because the frame
 * carries allow="autoplay"; with no click anywhere it never starts. WebKit wants
 * a press in the frame itself, so the frame asks for it, with focus already on its
 * Play.
 *
 * THE TRAP these tests avoid: any Playwright call that runs script in a page
 * (evaluate, waitForFunction, and every locator) gives that page user activation,
 * so a "no click" state read that way has already been clicked. Before the one
 * click under test, these tests touch the page only through the network, the
 * console, and Chromium's DevTools DOM reads (no script); the click is a real
 * mouse event.
 */

/** Chromium only: an element's box centre, read over DevTools (runs no script in the page). */
async function centreOf(page: Page, selector: string, timeout = 60_000): Promise<{ x: number; y: number }> {
  const cdp = await page.context().newCDPSession(page)
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    if (nodeId) {
      try {
        const { model } = await cdp.send('DOM.getBoxModel', { nodeId })
        const [x1, y1, , , x3, y3] = model.content
        if (x3 > x1 && y3 > y1) return { x: (x1 + x3) / 2, y: (y1 + y3) / 2 }
      } catch {
        /* not laid out yet */
      }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`${selector} never appeared`)
}

/**
 * A page of the app's own origin, served by the test, holding the preview's frame
 * exactly as the gallery mounts it (sandbox="allow-scripts", allow="autoplay"). On
 * load it hands the frame a pattern WITH NO CLICK; its button sends it again. It
 * logs every state the frame reports, which is how the test reads it.
 */
const CONTROL_PAGE = `<!doctype html><meta charset="utf-8">
<button id="again" style="position:fixed;left:20px;top:20px;width:200px;height:60px">Play from this page</button>
<iframe id="f" sandbox="allow-scripts" allow="autoplay" src="/gallery-player" style="position:fixed;left:20px;top:120px;width:500px;height:240px"></iframe>
<script>
const f = document.getElementById('f')
const code = ${JSON.stringify(MUSIC_CODE)}
const msg = { play: true, path: 'floor.strudel', files: [{ path: 'floor.strudel', kind: 'strudel', code }] }
addEventListener('message', (e) => {
  if (e.source !== f.contentWindow) return
  console.log('FRAME ' + JSON.stringify(e.data))
  if (e.data && e.data.state === 'ready') f.contentWindow.postMessage(msg, '*')
})
document.getElementById('again').addEventListener('click', () => f.contentWindow.postMessage(msg, '*'))
</script>`

/** The frame's reports, as the control page logs them. */
function frameReports(page: Page): { seen: string[]; until: (pred: (m: { state: string; message?: string }) => boolean, ms?: number) => Promise<void> } {
  const seen: string[] = []
  const waiters: Array<{ pred: (m: { state: string; message?: string }) => boolean; done: () => void }> = []
  page.on('console', (m) => {
    const t = m.text()
    if (!t.startsWith('FRAME ')) return
    seen.push(t.slice(6))
    const msg = JSON.parse(t.slice(6))
    for (const w of waiters) if (w.pred(msg)) w.done()
  })
  return {
    seen,
    until: (pred, ms = 60_000) =>
      seen.some((x) => pred(JSON.parse(x)))
        ? Promise.resolve()
        : new Promise((resolve, reject) => {
            waiters.push({ pred, done: resolve })
            setTimeout(() => reject(new Error(`frame never reported it; saw ${seen.join(' | ')}`)), ms)
          }),
  }
}

/** An artist page holding one music card (musc1CCCCCC, from routeGallery). */
async function routeCarol(page: Page): Promise<void> {
  await page.route('**/api/gallery/authors/carol0000001', (route) =>
    route.fulfill({
      json: {
        author: { authorId: 'carol0000001', name: 'Carol', bio: '', createdAt: 1, updatedAt: 1 },
        entries: [{ id: 'musc1CCCCCC', title: 'Four On The Floor', kind: 'music', tags: ['house'], authorName: 'Carol', authorId: 'carol0000001', publishedAt: Date.UTC(2026, 10, 1), fileCount: 1, hasThumbnail: false }],
        collections: [],
      },
    }),
  )
}

test.describe('one click and the preview\'s sound (#2495)', () => {
  test('Chromium: with no click anywhere the frame never starts; one real click on the page above it does', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    test.skip(await isDevServer(page), DEV_SKIP)
    await page.route('**/__one_click_control', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        // as the app's own pages: the frame is let in under the same policy
        headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' },
        body: CONTROL_PAGE,
      }),
    )
    const reports = frameReports(page)
    await page.goto(`${baseURL}/__one_click_control`)

    // NO CLICK: the pattern went in on load; the frame can't start it and asks.
    await reports.until((m) => m.state === 'stopped' && m.message === 'Press Play in the preview to hear it.')
    await new Promise((r) => setTimeout(r, 2000))
    expect(reports.seen.filter((x) => JSON.parse(x).state === 'playing'), 'nothing played without a click').toEqual([])

    // ONE real click on the page above the frame (not in it): now it plays.
    await page.mouse.click(120, 50)
    await reports.until((m) => m.state === 'playing', 20_000)
    // the pattern ran in the frame (read after the fact)
    expect(await playerFrame(page)!.evaluate(() => (window as unknown as { __galleryRuns?: number }).__galleryRuns ?? 0)).toBeGreaterThan(0)
  })

  test("Chromium: one click on a card's play opens the entry with its preview playing", async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    test.skip(await isDevServer(page), DEV_SKIP)
    await routeGallery(page)
    // an artist page: a page of cards reached by link, so no click comes before the one under test
    await routeCarol(page)
    const errors = consoleErrors(page)
    await page.goto(`${baseURL}/#gallery-author=carol0000001`, { waitUntil: 'domcontentloaded' })
    const play = await centreOf(page, '[data-gallery-card-play="musc1CCCCCC"]')
    await page.mouse.click(play.x, play.y)

    // the entry opened, and its preview plays: no second click anywhere
    await expect(page.locator('[data-gallery-detail="musc1CCCCCC"]')).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => previewState(page), { timeout: 60_000 }).toBe('playing')
    await expect(page.locator('[data-gallery-preview-state]')).toHaveText('Playing in a sealed preview.')
    expect(await playerFrame(page)!.evaluate(() => (window as unknown as { __galleryRuns?: number }).__galleryRuns ?? 0)).toBeGreaterThan(0)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/card-play-entry-playing.png` })
    console.log('console errors:', errors)
  })

  test('WebKit: the frame asks for its own press, with focus moved into it, and Enter plays', async ({ page: probe, baseURL }) => {
    test.setTimeout(120_000)
    test.skip(await isDevServer(probe), DEV_SKIP)
    test.skip(!existsSync(webkit.executablePath()), "WebKit isn't installed here (CI installs Chromium only): npx playwright install webkit")
    const browser = await webkit.launch()
    try {
      const page = await (await browser.newContext({ baseURL })).newPage()
      await routeGallery(page)
      await page.goto('/#gallery=musc1CCCCCC', { waitUntil: 'domcontentloaded' })
      // In WebKit the gallery page's own activation doesn't reach the frame (that is
      // what is measured), so reading this page with locators can't help it start.
      await page.locator('[data-gallery-preview-button]').click({ timeout: 60_000 })
      await expect(page.locator('[data-gallery-preview-state="stopped"]')).toHaveText('Press Play in the preview to hear it.', { timeout: 60_000 })
      // focus moved into the frame, so a key press is the press it needs. (Not onto
      // its Play: WebKit refuses focus() to a frame nobody has pressed. Reading the
      // frame here would press it, so it isn't read until after.)
      await expect(page.locator('[data-gallery-preview-frame]')).toBeFocused()
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/webkit-needs-a-press.png` })
      await new Promise((r) => setTimeout(r, 1500))
      expect(await previewState(page), 'still waiting for the press').toBe('stopped')
      await page.keyboard.press('Enter')
      await expect.poll(() => previewState(page), { timeout: 20_000 }).toBe('playing')
    } finally {
      await browser.close()
    }
  })

  // #2547 — the same, from one click on a card's play: the page asked this frame
  // to start, so its answer (it needs a press) moves focus into it.
  test("WebKit: one click on a card's play, then the frame has focus and Enter plays", async ({ page: probe, baseURL }) => {
    test.setTimeout(120_000)
    test.skip(await isDevServer(probe), DEV_SKIP)
    test.skip(!existsSync(webkit.executablePath()), "WebKit isn't installed here (CI installs Chromium only): npx playwright install webkit")
    const browser = await webkit.launch()
    try {
      const page = await (await browser.newContext({ baseURL })).newPage()
      await routeGallery(page)
      await routeCarol(page)
      await page.goto('/#gallery-author=carol0000001', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-gallery-card-play="musc1CCCCCC"]').click({ timeout: 60_000 })
      await expect(page.locator('[data-gallery-detail="musc1CCCCCC"]')).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('[data-gallery-preview-state="stopped"]')).toHaveText('Press Play in the preview to hear it.', { timeout: 60_000 })
      await expect(page.locator('[data-gallery-preview-frame]')).toBeFocused()
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/webkit-card-play-needs-a-press.png` })
      await new Promise((r) => setTimeout(r, 1500))
      expect(await previewState(page), 'still waiting for the press').toBe('stopped')
      await page.keyboard.press('Enter')
      await expect.poll(() => previewState(page), { timeout: 20_000 }).toBe('playing')
    } finally {
      await browser.close()
    }
  })

  // #2547 — the frame runs the entry's code, which can post the frame's "needs a
  // press" message itself. Unasked (here: long after it answered that it plays),
  // that moves nothing: focus stays where you left it on the page.
  test("an entry's code that posts the frame's needs-a-press message itself can't pull focus into its frame", async ({ page }) => {
    test.setTimeout(120_000)
    test.skip(await isDevServer(page), DEV_SKIP)
    await routeGallery(page)
    const THIEF = `${MUSIC_CODE.split('\n')[0]}
setTimeout(() => parent.postMessage({ state: 'stopped', message: 'Press Play in the preview to hear it.' }, '*'), 2500)
s('bd*4')`
    const { id } = await routeEntry(page, 'Focus Thief', 'thief.strudel', THIEF)
    await page.goto(`/#gallery=${id}`, { waitUntil: 'domcontentloaded' })
    const button = page.locator('[data-gallery-preview-button]')
    await button.click({ timeout: 60_000 })
    await expect.poll(() => previewState(page), { timeout: 60_000 }).toBe('playing')
    // where you are on the page: the gallery's own button, with focus
    await button.focus()
    await expect(button).toBeFocused()
    // the code's own message arrives (the page shows it) ...
    await expect(page.locator('[data-gallery-preview-state="stopped"]')).toHaveText('Press Play in the preview to hear it.', { timeout: 20_000 })
    // ... and focus has not moved
    await new Promise((r) => setTimeout(r, 300))
    await expect(page.locator('[data-gallery-preview-frame]')).not.toBeFocused()
    await expect(button).toBeFocused()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/unasked-needs-click-keeps-focus.png` })
  })
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
      // #2343 — behind the question, the Bounce dialog says it is waiting, not rendering
      await expect(page.locator('[data-bounce-asking]')).toHaveText('Waiting for your answer before running this code…')
      await expect(page.getByText(/^Rendering/)).toHaveCount(0)
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
    // #2473 — the added file opens in front of the gallery tab
    await expect(page.locator('[data-gallery="tab"]')).toHaveCount(0)
    await page.waitForTimeout(2000)
    expect(await parentRuns(page), 'adding the file runs nothing').toBe(0)

    const ask = page.getByText(ASK.replace('Alice', 'Dee'))
    const vizPlay = page.locator('[data-testid="viz-chrome-open-preview"]').first()
    await vizPlay.click()
    await expect(ask).toBeVisible({ timeout: 10_000 })
    expect(await parentRuns(page)).toBe(0)
    // #2343 — nothing is running yet, so the control offers Play, not Pause
    await expect(vizPlay).toHaveText('\u25B6 Play')
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
    // now it runs, and the control offers Pause
    await expect(vizPlay).toHaveText('\u23F8 Pause', { timeout: 10_000 })
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
      // #2473 — the added file opens in front of the gallery tab
      await expect(page.locator('[data-gallery="tab"]')).toHaveCount(0)
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

// ─── #2490 a project previews as itself ─────────────────────────────────────

/** The project's visual: a flat magenta, a colour nothing else in the preview uses. */
const BLOOM = 's.solid(1, 0, 1).out()'
const BLOOM_PATTERN = `${MUSIC_CODE.split('\n')[0]}\n$: s("bd*4, hh*8").viz("bloom")`

/** Serve a project entry (GET only), as the gallery serves one. */
async function routeProject(page: Page, title: string, files: Array<{ path: string; language: string; content: string }>): Promise<{ id: string }> {
  const id = newId()
  const now = Date.now()
  const withIds = files.map((f, i) => ({ id: `p${i}`, ...f }))
  const body = {
    entry: { id, title, kind: 'project', tags: ['sandbox-test'], authorName: 'Peg', publishedAt: now, fileCount: files.length, hasThumbnail: false },
    manifest: { schemaVersion: 1, project: { name: title, sharedAt: now }, files: withIds, fileOrder: { '': withIds.map((f) => f.id) }, subfolderOrder: {} },
  }
  await page.route(`**/api/gallery/${id}`, (route) => (route.request().method() === 'GET' ? route.fulfill({ json: body }) : route.fallback()))
  return { id }
}

/**
 * The share of a screenshot's pixels near magenta, counted on the gallery page
 * (a decoded PNG is plain data there, whatever the frame's origin).
 */
async function magentaShare(page: Page, png: Buffer): Promise<{ share: number; pixels: number }> {
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob()
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const g = c.getContext('2d')!
    g.drawImage(bmp, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let hit = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] > 200) hit++
    const pixels = d.length / 4
    return { share: hit / pixels, pixels }
  }, png.toString('base64'))
}

const frameLoc = (page: Page) => page.frameLocator('[data-gallery-preview-frame]')

/**
 * Open the entry, press its Preview, and get it playing: in Chromium the page's
 * click starts it; in WebKit the frame asks for its own press, given by Enter.
 */
async function previewToPlaying(page: Page, id: string, engine: 'chromium' | 'webkit'): Promise<void> {
  await page.goto(`/#gallery=${id}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator(`[data-gallery-detail="${id}"]`)).toBeVisible({ timeout: 60_000 })
  await page.locator('[data-gallery-preview-button]').click({ timeout: 60_000 })
  if (engine === 'webkit') {
    await expect(page.locator('[data-gallery-preview-state="stopped"]')).toHaveText('Press Play in the preview to hear it.', { timeout: 60_000 })
    await expect(page.locator('[data-gallery-preview-frame]')).toBeFocused()
    await page.keyboard.press('Enter')
  }
  await expect.poll(() => previewState(page), { timeout: 150_000 }).toBe('playing')
}

/** The project's pattern draws the project's own visual; without the visual, nothing is drawn and the frame says why. */
async function projectPreviewsAsItself(page: Page, engine: 'chromium' | 'webkit'): Promise<void> {
  const withViz = await routeProject(page, 'Bloom Project', [
    { path: 'main.strudel', language: 'strudel', content: BLOOM_PATTERN },
    { path: 'viz/bloom.hydra', language: 'hydra', content: BLOOM },
    { path: 'README.md', language: 'markdown', content: '# bloom' },
  ])
  const without = await routeProject(page, 'Bloomless Project', [
    { path: 'main.strudel', language: 'strudel', content: BLOOM_PATTERN },
    { path: 'README.md', language: 'markdown', content: '# no visual here' },
  ])

  // WITH the visual: it is mounted in the frame and its colour is on screen
  await previewToPlaying(page, withViz.id, engine)
  const visual = frameLoc(page).locator('[data-gallery-player-visual="viz/bloom.hydra"]')
  await expect(visual).toHaveCount(1, { timeout: 30_000 })
  await expect(visual.locator('canvas')).not.toHaveCount(0, { timeout: 30_000 })
  await expect(frameLoc(page).locator('[data-gallery-player-missing]')).toHaveCount(0)
  let drawn = { share: 0, pixels: 0 }
  await expect
    .poll(async () => (drawn = await magentaShare(page, await page.locator('[data-gallery-preview-frame]').screenshot())).share, { timeout: 30_000 })
    .toBeGreaterThan(0.3)
  console.log(`${engine} with the visual: magenta ${(drawn.share * 100).toFixed(1)}% of ${drawn.pixels} frame pixels`)
  expect(await playerFrame(page)!.evaluate(() => self.origin)).toBe('null')
  expect(await previewState(page), 'the visual errored after starting').toBe('playing')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${engine}-project-own-visual.png` })

  // WITHOUT it (the control): the same pattern plays, draws nothing, and says which name it looked for
  await previewToPlaying(page, without.id, engine)
  await expect(frameLoc(page).locator('[data-gallery-player-missing]')).toHaveText(
    'This pattern calls .viz("bloom"), and this entry has no visual by that name.',
    { timeout: 30_000 },
  )
  await expect(frameLoc(page).locator('[data-gallery-player-visual]')).toHaveCount(0)
  await page.waitForTimeout(1500)
  const none = await magentaShare(page, await page.locator('[data-gallery-preview-frame]').screenshot())
  console.log(`${engine} without the visual: magenta ${(none.share * 100).toFixed(2)}% of ${none.pixels} frame pixels`)
  expect(none.pixels).toBeGreaterThan(1000)
  expect(none.share).toBeLessThan(0.001)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${engine}-project-visual-missing.png` })
}

test.describe("a project previews as itself, its pattern's visual from its own files (#2490)", () => {
  test('Chromium', async ({ page }) => {
    test.setTimeout(300_000)
    test.skip(await isDevServer(page), DEV_SKIP)
    const errors = consoleErrors(page)
    await routeGallery(page)
    await projectPreviewsAsItself(page, 'chromium')
    console.log('CONSOLE ERRORS\n' + errors.join('\n'))
    expect(errors.filter((e) => e.startsWith('pageerror:'))).toEqual([])
  })

  test('WebKit', async ({ page: probe, baseURL }) => {
    test.setTimeout(300_000)
    test.skip(await isDevServer(probe), DEV_SKIP)
    test.skip(!existsSync(webkit.executablePath()), "WebKit isn't installed here (CI installs Chromium only): npx playwright install webkit")
    const browser = await webkit.launch()
    try {
      const page = await (await browser.newContext({ baseURL })).newPage()
      await routeGallery(page)
      await projectPreviewsAsItself(page, 'webkit')
    } finally {
      await browser.close()
    }
  })
})

// ─── #2579 / #2580 / #2581 the preview's own words, its Stop, its notes ──────

/**
 * #2579 — code that plays and, every 200ms, posts the player's own "stopped"
 * message with a sentence in the gallery's voice. Its top-level counter shows
 * how many times a frame ran it; its pattern keeps the scheduler busy.
 */
const LIAR_SAYS = 'Sign in again to keep listening'
const LIAR = `${MUSIC_CODE.split('\n')[0]}
setInterval(() => parent.postMessage({ state: 'stopped', message: '${LIAR_SAYS}' }, '*'), 200)
s('bd*4, hh*8')`

/** #2579 — the liar's words show labelled; one Stop removes its frame; ▶ again starts a fresh one. */
async function stopRemovesALiar(page: Page, engine: 'chromium' | 'webkit'): Promise<void> {
  const { id } = await routeEntry(page, 'Liar', 'liar.strudel', LIAR)
  await page.goto(`/#gallery=${id}`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator(`[data-gallery-detail="${id}"]`)).toBeVisible({ timeout: 60_000 })
  const button = page.locator('[data-gallery-preview-button]')
  await button.click({ timeout: 60_000 })
  const line = page.locator('[data-gallery-preview-state]')
  // the code's sentence shows only as the code's words
  await expect(line).toHaveText(`The code reported that it stopped: ${LIAR_SAYS}`, { timeout: 150_000 })
  const frame = playerFrame(page)!
  expect(await frame.evaluate(() => (window as unknown as { __galleryRuns?: number }).__galleryRuns ?? 0), 'the code is running in the frame').toBeGreaterThan(0)
  // whatever it claims, the page's button is Stop
  await expect(button).toHaveAttribute('aria-label', 'Stop preview')
  // read the shown text for a second: it is never the code's sentence alone
  const seen = new Set<string>()
  for (let i = 0; i < 10; i++) {
    seen.add((await line.textContent()) ?? '')
    await page.waitForTimeout(100)
  }
  expect([...seen].filter((t) => t === LIAR_SAYS)).toEqual([])
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${engine}-liar-labelled.png` })

  // ONE press: the frame is gone, so nothing it ran is still running
  const framesBefore = page.frames().filter((f) => f.url().includes('/gallery-player')).length
  await button.click()
  await expect(page.locator('[data-gallery-preview-frame]')).toHaveCount(0)
  expect(page.frames().filter((f) => f.url().includes('/gallery-player')), `was ${framesBefore}`).toEqual([])
  expect(frame.isDetached(), "the old frame's document is detached").toBe(true)
  await expect(line).toHaveText('Stopped.')
  // and stays stopped: the code that kept posting can't post anymore
  await page.waitForTimeout(800)
  await expect(line).toHaveText('Stopped.')
  await expect(button).toHaveAttribute('aria-label', 'Preview')

  // ▶ again starts clean: a fresh frame that loads, gets the code, and runs it once
  await button.click()
  await expect(line).toHaveText(`The code reported that it stopped: ${LIAR_SAYS}`, { timeout: 150_000 })
  const fresh = playerFrame(page)!
  expect(fresh).not.toBe(frame)
  expect(await fresh.evaluate(() => (window as unknown as { __galleryRuns?: number }).__galleryRuns ?? 0)).toBe(1)
  await button.click()
  await expect(page.locator('[data-gallery-preview-frame]')).toHaveCount(0)
}

/** #2580 — while it plays, one status line is seen and announced: the page's. */
async function oneStatusLine(page: Page, engine: 'chromium' | 'webkit'): Promise<void> {
  await previewToPlaying(page, 'musc1CCCCCC', engine)
  const pageLine = page.locator('[data-gallery-preview-state]')
  await expect(pageLine).toHaveText('Playing in a sealed preview.')
  await expect(pageLine).toBeVisible()
  await expect(pageLine).toHaveAttribute('role', 'status')
  // the frame's own line is there (for the player on its own) but not drawn, nor read out
  const frameLine = frameLoc(page).locator('[data-gallery-player-status]')
  await expect(frameLine).toHaveCount(1)
  await expect(frameLine).toBeHidden()
  // every visible line, page and frame together, that says it plays: one
  const onPage = await page.getByText(/^Playing/).filter({ visible: true }).count()
  const inFrame = await frameLoc(page).getByText(/^Playing/).filter({ visible: true }).count()
  expect({ onPage, inFrame }).toEqual({ onPage: 1, inFrame: 0 })
  // and what a screen reader gets from the frame has no second status in it
  const tree = await frameLoc(page).locator('main').ariaSnapshot()
  expect(tree).not.toMatch(/Playing/)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${engine}-one-status-line.png` })
}

/** Run `fn` on a WebKit page (CI installs Chromium only, so it skips there). */
async function inWebKit(probe: Page, baseURL: string | undefined, fn: (page: Page) => Promise<void>): Promise<void> {
  test.skip(await isDevServer(probe), DEV_SKIP)
  test.skip(!existsSync(webkit.executablePath()), "WebKit isn't installed here (CI installs Chromium only): npx playwright install webkit")
  const browser = await webkit.launch()
  try {
    const page = await (await browser.newContext({ baseURL })).newPage()
    await routeGallery(page)
    await fn(page)
  } finally {
    await browser.close()
  }
}

test.describe("the preview doesn't take its frame's word (#2579, #2580, #2581)", () => {
  test('#2579 a frame that says it stopped while it plays: its words are labelled, and one Stop removes it (Chromium)', async ({ page }) => {
    test.setTimeout(240_000)
    test.skip(await isDevServer(page), DEV_SKIP)
    await routeGallery(page)
    await stopRemovesALiar(page, 'chromium')
  })

  test('#2579 the same in WebKit', async ({ page: probe, baseURL }) => {
    test.setTimeout(240_000)
    await inWebKit(probe, baseURL, (page) => stopRemovesALiar(page, 'webkit'))
  })

  test("#2580 while a preview plays, one status line shows: the page's (Chromium)", async ({ page }) => {
    test.setTimeout(240_000)
    test.skip(await isDevServer(page), DEV_SKIP)
    await routeGallery(page)
    await oneStatusLine(page, 'chromium')
  })

  test('#2580 the same in WebKit', async ({ page: probe, baseURL }) => {
    test.setTimeout(240_000)
    await inWebKit(probe, baseURL, (page) => oneStatusLine(page, 'webkit'))
  })

  test('#2580 CONTROL: the player opened on its own shows its status line', async ({ page }) => {
    test.skip(await isDevServer(page), DEV_SKIP)
    await page.goto('/gallery-player')
    await expect(page.locator('[data-gallery-player-status]')).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('[data-gallery-player-status]')).toHaveText('Preview ready.')
  })

  test('#2581 a pattern with five visuals draws four and says so; with four, no note', async ({ page }) => {
    test.setTimeout(300_000)
    test.skip(await isDevServer(page), DEV_SKIP)
    await routeGallery(page)
    const names = ['va', 'vb', 'vc', 'vd', 've']
    const visuals = names.map((n) => ({ path: `viz/${n}.hydra`, language: 'hydra', content: BLOOM }))
    const pattern = (k: number) => `${MUSIC_CODE.split('\n')[0]}\n${names.slice(0, k).map((n) => `$: s("bd*4").viz("${n}")`).join('\n')}`
    const five = await routeProject(page, 'Five Visuals', [{ path: 'main.strudel', language: 'strudel', content: pattern(5) }, ...visuals])
    const four = await routeProject(page, 'Four Visuals', [{ path: 'main.strudel', language: 'strudel', content: pattern(4) }, ...visuals])

    await previewToPlaying(page, five.id, 'chromium')
    await expect(frameLoc(page).locator('[data-gallery-player-visual]')).toHaveCount(4, { timeout: 30_000 })
    const note = frameLoc(page).locator('[data-gallery-player-capped]')
    await expect(note).toHaveText('This pattern calls for 5 visuals; the preview draws the first 4.', { timeout: 30_000 })
    await expect(note).toBeVisible()
    await page.waitForTimeout(1000)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/five-visuals-note.png` })

    // CONTROL: four visuals, all drawn, no note
    await previewToPlaying(page, four.id, 'chromium')
    await expect(frameLoc(page).locator('[data-gallery-player-visual]')).toHaveCount(4, { timeout: 30_000 })
    await page.waitForTimeout(1000)
    await expect(frameLoc(page).locator('[data-gallery-player-capped]')).toHaveCount(0)
  })
})

// ─── #2489 the preview draws what is playing ─────────────────────────────────

/** A four-bar song of pitched notes (two sections of two bars), and silence as the control. */
const SONG = `${MUSIC_CODE.split('\n')[0]}
arrange([2, note("c3 e3 g3 b3")], [2, note("a2 c3 e3 g3")]).s("sawtooth")`
const LOOP = `${MUSIC_CODE.split('\n')[0]}
note("c3 e3 g3 b3").s("sawtooth")`
const QUIET = `${MUSIC_CODE.split('\n')[0]}
silence`

/** The page-bound messages every frame sends, recorded on the gallery page as they arrive. */
const RECORD_FRAME_MESSAGES = () => {
  const w = window as unknown as { __frameMsgs: string[] }
  w.__frameMsgs = []
  addEventListener('message', (e) => {
    const f = document.querySelector('[data-gallery-preview-frame]') as HTMLIFrameElement | null
    if (f && e.source === f.contentWindow) w.__frameMsgs.push(JSON.stringify(e.data))
  })
}
const frameMessages = (page: Page) => page.evaluate(() => (window as unknown as { __frameMsgs: string[] }).__frameMsgs.slice())

/**
 * Two shots of the roll: how many pixels in each are a note's colour (saturated:
 * the roll's notes are purple, orange, cyan, green; its playhead and the
 * background are grey), and how many pixels changed between them.
 */
async function rollPixels(page: Page, a: Buffer, b: Buffer): Promise<{ notesA: number; notesB: number; changed: number; pixels: number }> {
  return page.evaluate(
    async ([a64, b64]) => {
      const read = async (b: string) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b}`)).blob())
        const c = document.createElement('canvas')
        c.width = bmp.width
        c.height = bmp.height
        const g = c.getContext('2d')!
        g.drawImage(bmp, 0, 0)
        return g.getImageData(0, 0, c.width, c.height).data
      }
      const [da, db] = [await read(a64), await read(b64)]
      const sat = (d: Uint8ClampedArray, i: number) => Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 40
      let notesA = 0
      let notesB = 0
      let changed = 0
      const n = Math.min(da.length, db.length)
      for (let i = 0; i < n; i += 4) {
        if (sat(da, i)) notesA++
        if (sat(db, i)) notesB++
        if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60) changed++
      }
      return { notesA, notesB, changed, pixels: n / 4 }
    },
    [a.toString('base64'), b.toString('base64')],
  )
}

const LABEL = /^▶ main\.strudel · bar (\d+)( of (\d+))?$/

/** Play a music entry, see its notes drawn and moving, read its bar, stop it; then the silent control. */
async function previewDrawsWhatPlays(page: Page, engine: 'chromium' | 'webkit'): Promise<void> {
  await page.addInitScript(RECORD_FRAME_MESSAGES)
  const song = await routeProject(page, 'Four Bar Song', [{ path: 'main.strudel', language: 'strudel', content: SONG }])
  const loop = await routeProject(page, 'Loop', [{ path: 'main.strudel', language: 'strudel', content: LOOP }])
  const quiet = await routeProject(page, 'Quiet', [{ path: 'main.strudel', language: 'strudel', content: QUIET }])

  // THE SONG: the roll is up, drawing notes that move, with "bar N of 4" under it
  await previewToPlaying(page, song.id, engine)
  const roll = frameLoc(page).locator('[data-gallery-player-roll="pianoroll"]')
  await expect(roll.locator('canvas')).not.toHaveCount(0, { timeout: 30_000 })
  const label = frameLoc(page).locator('[data-gallery-player-roll-label]')
  await expect(label).toHaveText(LABEL, { timeout: 15_000 })
  await page.waitForTimeout(800)
  const shotA = await roll.screenshot()
  const barA = Number(LABEL.exec((await label.textContent()) ?? '')![1])
  await page.waitForTimeout(700)
  const shotB = await roll.screenshot()
  const px = await rollPixels(page, shotA, shotB)
  console.log(`${engine} song: note pixels ${px.notesA} then ${px.notesB}, ${px.changed} changed in 700 ms, of ${px.pixels}`)
  expect(px.notesA).toBeGreaterThan(500)
  expect(px.notesB).toBeGreaterThan(500)
  expect(px.changed).toBeGreaterThan(200)
  await expect(label).toHaveText(new RegExp(`^▶ main\\.strudel · bar \\d+ of 4$`))
  // the bar moves on with the music (a bar is 2 s at the default tempo)
  await expect.poll(async () => Number(LABEL.exec((await label.textContent()) ?? '')![1]), { timeout: 6_000 }).not.toBe(barA)
  const barB = Number(LABEL.exec((await label.textContent()) ?? '')![1])
  console.log(`${engine} song: label went from bar ${barA} to bar ${barB} of 4`)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${engine}-roll-song.png` })
  await expect(frameLoc(page).locator('[data-gallery-player-visual]')).toHaveCount(0)

  // the frame's own stop (the message the page may still send) clears the roll and its line
  await page.evaluate(() => (document.querySelector('[data-gallery-preview-frame]') as HTMLIFrameElement).contentWindow!.postMessage({ stop: true }, '*'))
  await expect(roll).toHaveCount(0, { timeout: 10_000 })
  await expect(label).toHaveCount(0)
  await expect(frameLoc(page).locator('[data-gallery-player-viz] canvas')).toHaveCount(0)
  // the page's Stop removes the frame, roll and all
  await page.locator('[data-gallery-preview-button]').click()
  await expect(page.locator('[data-gallery-preview-frame]')).toHaveCount(0)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${engine}-roll-after-stop.png` })

  // the frame told the page nothing new: the same states, in the same shapes
  const first = await frameMessages(page)
  const expected = engine === 'webkit'
    ? ['{"state":"ready"}', '{"state":"stopped","message":"Press Play in the preview to hear it."}', '{"state":"playing"}', '{"state":"stopped"}']
    : ['{"state":"ready"}', '{"state":"playing"}', '{"state":"stopped"}']
  console.log(`${engine} frame -> page: ${first.join(' ')}`)
  expect(first).toEqual(expected)

  // A LOOP: "bar N" with no total
  await previewToPlaying(page, loop.id, engine)
  await expect(frameLoc(page).locator('[data-gallery-player-roll-label]')).toHaveText(/^▶ main\.strudel · bar \d+$/, { timeout: 15_000 })
  console.log(`${engine} loop: ${await frameLoc(page).locator('[data-gallery-player-roll-label]').textContent()}`)

  // CONTROL — silence: the roll is up, and draws no notes
  await previewToPlaying(page, quiet.id, engine)
  const qroll = frameLoc(page).locator('[data-gallery-player-roll="pianoroll"]')
  await expect(qroll.locator('canvas')).not.toHaveCount(0, { timeout: 30_000 })
  await page.waitForTimeout(1000)
  const qa = await qroll.screenshot()
  await page.waitForTimeout(700)
  const qpx = await rollPixels(page, qa, await qroll.screenshot())
  console.log(`${engine} silence: note pixels ${qpx.notesA} then ${qpx.notesB}, ${qpx.changed} changed in 700 ms, of ${qpx.pixels}`)
  expect(qpx.pixels).toBeGreaterThan(1000)
  expect(qpx.notesA).toBe(0)
  expect(qpx.notesB).toBe(0)
  // nothing moves but what the page lays over the frame (a few dozen pixels, against tens of thousands above)
  expect(qpx.changed).toBeLessThan(500)
}

test.describe('#2489 the preview draws what is playing', () => {
  test('Chromium', async ({ page }) => {
    test.setTimeout(300_000)
    test.skip(await isDevServer(page), DEV_SKIP)
    const errors = consoleErrors(page)
    await routeGallery(page)
    await previewDrawsWhatPlays(page, 'chromium')
    console.log('CONSOLE ERRORS\n' + errors.join('\n'))
    expect(errors.filter((e) => e.startsWith('pageerror:'))).toEqual([])
  })

  test('WebKit', async ({ page: probe, baseURL }) => {
    test.setTimeout(300_000)
    await inWebKit(probe, baseURL, (page) => previewDrawsWhatPlays(page, 'webkit'))
  })
})
