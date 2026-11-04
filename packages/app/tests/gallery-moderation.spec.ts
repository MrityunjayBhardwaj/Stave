import { test, expect, devices, type APIRequestContext, type Browser, type Page } from '@playwright/test'

import { bootApp } from './_appBoot'

/**
 * #2331 — moderation by admin ACCOUNTS, end to end against the real server: the
 * real Auth.js session, the real gallery store, the real moderation routes.
 *
 * A user publishes; someone else reports it; the admin (a test account listed in
 * STAVE_GALLERY_ADMINS) opens the gallery's Moderation tab, takes the entry down
 * with a reason, and sees it in the action log. A non-admin sees no Moderation
 * tab, and the routes refuse them.
 *
 * Needs the test-only sign-in AND the admin listed. Without either, every test
 * here SKIPS, saying why (the browser gate's server sets neither). To run it:
 *
 *   STAVE_AUTH_TEST_LOGIN=1 AUTH_SECRET=dev-only-secret STAVE_GALLERY_ADMINS=test-login:gallery-admin \
 *     npm run dev -- -p 3354
 *   STAVE_E2E_PORT=3354 npx playwright test tests/gallery-moderation.spec.ts --project=chromium --workers=1
 *
 * STAVE_E2E_GALLERY_ADMIN overrides the admin's test account id (default
 * gallery-admin). Screenshots go to $GALLERY_SHOT_DIR when it is set.
 */

const SHOTS = process.env.GALLERY_SHOT_DIR
const RUN = Date.now().toString(36)
const ADMIN = process.env.STAVE_E2E_GALLERY_ADMIN || 'gallery-admin'
const AUTHOR = `pub-${RUN}`
const REPORTER = `rep-${RUN}`
const TITLE = `Needs a look ${RUN}`
const REASON = `copied without credit (${RUN})`

type Me = { signInAvailable: boolean; providers: Array<{ id: string }>; isAdmin?: boolean; user: { accountId?: string } | null }

/** Sign a context in without the UI: the same Auth.js callback the menu posts to. */
async function signInByApi(request: APIRequestContext, id: string): Promise<void> {
  const { csrfToken } = (await (await request.get('/api/auth/csrf')).json()) as { csrfToken: string }
  const res = await request.post('/api/auth/callback/test-login', {
    form: { csrfToken, id, name: `Test ${id}`, login: id, email: `${id}@test-login.invalid`, as: 'github', callbackUrl: '/' },
    maxRedirects: 0,
  })
  expect(res.status()).toBe(302)
  expect(res.headers()['location']).not.toContain('error')
}

async function me(request: APIRequestContext): Promise<Me> {
  return (await (await request.get('/api/gallery/me')).json()) as Me
}

/** A fresh browser context signed in as `id`. */
async function signedIn(browser: Browser, id: string, opts: Parameters<Browser['newContext']>[0] = {}) {
  const context = await browser.newContext(opts)
  await signInByApi(context.request, id)
  return { context, page: await context.newPage() }
}

async function openGallery(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByText('Community Gallery...', { exact: true }).click()
  await expect(page.locator('[data-gallery="overlay"]')).toBeVisible()
}

/** Errors from this feature; a refused call logs a 403 on purpose, so that's filtered by the caller. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}
const ours = (errors: string[]) => errors.filter((e) => /auth|session|gallery|moderat|admin|40[03]|500/i.test(e))

test.beforeEach(async ({ playwright, baseURL }) => {
  const probe = await playwright.request.newContext({ baseURL })
  try {
    const first = await me(probe)
    test.skip(
      !(first.signInAvailable && first.providers.some((p) => p.id === 'test-login')),
      'sign-in is unavailable on this server: start it with STAVE_AUTH_TEST_LOGIN=1 and AUTH_SECRET (the gate does not)',
    )
    await signInByApi(probe, ADMIN)
    const asAdmin = await me(probe)
    test.skip(
      asAdmin.isAdmin !== true,
      `the test account "${ADMIN}" is not an admin here: start the server with STAVE_GALLERY_ADMINS=test-login:${ADMIN}`,
    )
  } finally {
    await probe.dispose()
  }
})

test.describe('Moderation by admin accounts (#2331)', () => {
  test.describe.configure({ mode: 'serial' })
  let entryId = ''

  test('a user publishes, someone reports it, the admin takes it down with a reason and sees it in the log', async ({ browser }) => {
    // ── a user publishes ──
    const author = await signedIn(browser, AUTHOR)
    const manifest = {
      schemaVersion: 1,
      project: { name: TITLE, sharedAt: Date.now() },
      files: [{ id: 'f0', path: 'song.strudel', language: 'strudel', content: 's("bd sd")' }],
      fileOrder: { '': ['f0'] },
      subfolderOrder: {},
    }
    const pub = await author.context.request.post('/api/gallery', {
      data: { title: TITLE, kind: 'music', tags: ['moderation'], manifest },
    })
    expect(pub.status()).toBe(201)
    entryId = ((await pub.json()) as { id: string }).id
    expect((await me(author.context.request)).isAdmin).toBe(false)

    // ── another user reports it ──
    const reporter = await signedIn(browser, REPORTER)
    const rep = await reporter.context.request.post(`/api/gallery/${entryId}/report`, { data: { reason: 'this is copied from my track' } })
    expect(rep.status()).toBe(202)
    await reporter.context.close()

    // ── the admin opens Moderation ──
    const admin = await signedIn(browser, ADMIN, { viewport: { width: 1280, height: 900 } })
    const errors = watchErrors(admin.page)
    await bootApp(admin.page)
    await openGallery(admin.page)
    const tab = admin.page.locator('[data-gallery-tab="moderation"]')
    await expect(tab).toBeVisible({ timeout: 15_000 })
    await tab.click()
    const row = admin.page.locator(`[data-gallery-flagged="${entryId}"]`)
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row).toContainText(TITLE)
    await expect(row.locator('[data-gallery-report-reason]')).toContainText(['this is copied from my track'])
    if (SHOTS) await admin.page.locator('.sg-modal').screenshot({ path: `${SHOTS}/1-moderation-tab.png` })

    // ── take it down, with a reason ──
    await row.locator(`[data-gallery-take-down="${entryId}"]`).click()
    const input = admin.page.getByPlaceholder('e.g. hateful title, copied without credit')
    await expect(input).toBeVisible()
    await input.fill(REASON)
    if (SHOTS) await admin.page.screenshot({ path: `${SHOTS}/2-take-down-reason.png` })
    await input.press('Enter')
    await expect(admin.page.locator('[data-testid="toast"]', { hasText: `Took down "${TITLE}"` })).toBeVisible({ timeout: 15_000 })
    await expect(row).toHaveCount(0, { timeout: 15_000 })

    // ── the log names the admin and the reason ──
    const logged = admin.page.locator(`[data-gallery-log-action="take-down-entry"][data-gallery-log-target="${entryId}"]`)
    await expect(logged).toBeVisible({ timeout: 15_000 })
    await expect(logged).toContainText(`Test ${ADMIN}`)
    await expect(logged).toContainText(REASON)
    await logged.scrollIntoViewIfNeeded()
    if (SHOTS) await admin.page.locator('.sg-modal').screenshot({ path: `${SHOTS}/3-action-log.png` })

    // ── and it's gone for everyone ──
    expect((await author.context.request.get(`/api/gallery/${entryId}`)).status()).toBe(410)
    const log = (await (await admin.context.request.get('/api/gallery/admin/log')).json()) as {
      actions: Array<{ action: string; target: string; reason: string; admin: { provider: string; accountId: string } }>
    }
    expect(log.actions.find((a) => a.target === entryId)).toMatchObject({
      action: 'take-down-entry',
      reason: REASON,
      admin: { provider: 'test-login', accountId: ADMIN },
    })
    const logText = JSON.stringify(log)
    expect(logText).not.toContain('@test-login.invalid')

    console.log(`[gallery-moderation] admin errors (${errors.length}):\n${errors.join('\n')}`)
    expect(ours(errors)).toEqual([])
    await author.context.close()
    await admin.context.close()
  })

  test('a non-admin sees no Moderation tab, and the routes refuse them', async ({ browser }) => {
    const user = await signedIn(browser, AUTHOR, { viewport: { width: 1280, height: 900 } })
    await bootApp(user.page)
    await openGallery(user.page)
    // The session has loaded once My shares speaks for the account.
    await user.page.locator('[data-gallery-tab="mine"]').click()
    await expect(user.page.locator('[data-gallery-mine-source="account"]')).toBeVisible({ timeout: 15_000 })
    await expect(user.page.locator('[data-gallery-tab="moderation"]')).toHaveCount(0)
    // Control: the tab bar really rendered.
    await expect(user.page.locator('[data-gallery-tab="project"]')).toBeVisible()

    const r = user.context.request
    expect((await r.get('/api/gallery/admin/reports')).status()).toBe(403)
    expect((await r.get('/api/gallery/reports')).status()).toBe(403)
    expect((await r.get('/api/gallery/admin/log')).status()).toBe(403)
    expect(
      (await r.get('/api/gallery/admin/reports', { headers: { 'x-stave-admin-key': 'anything-at-all' } })).status(),
    ).toBe(403)
    await user.context.close()
  })

  test('on a phone the Moderation tab fits and its buttons are reachable', async ({ browser }) => {
    // Something to show: a fresh entry, reported.
    const author = await signedIn(browser, AUTHOR)
    const pub = await author.context.request.post('/api/gallery', {
      data: {
        title: `Phone check ${RUN}`,
        kind: 'music',
        tags: [],
        manifest: {
          schemaVersion: 1,
          project: { name: 'Phone', sharedAt: Date.now() },
          files: [{ id: 'f0', path: 'p.strudel', language: 'strudel', content: 's("hh*4")' }],
          fileOrder: { '': ['f0'] },
          subfolderOrder: {},
        },
      },
    })
    expect(pub.status()).toBe(201)
    const id = ((await pub.json()) as { id: string }).id
    await author.context.request.post(`/api/gallery/${id}/report`, {
      data: { reason: 'a long reason that has to wrap on a narrow phone screen without pushing the buttons off the edge' },
    })
    await author.context.close()

    const admin = await signedIn(browser, ADMIN, { ...devices['Pixel 7'] })
    await bootApp(admin.page)
    // On a phone the menu bar is in the drawer; open the overlay the way the View menu does.
    await admin.page.evaluate(() => window.dispatchEvent(new CustomEvent('stave:open-gallery')))
    await expect(admin.page.locator('[data-gallery="overlay"]')).toBeVisible({ timeout: 15_000 })
    await admin.page.locator('[data-gallery-tab="moderation"]').click()
    const row = admin.page.locator(`[data-gallery-flagged="${id}"]`)
    await expect(row).toBeVisible({ timeout: 15_000 })
    const width = admin.page.viewportSize()!.width
    for (const sel of [`[data-gallery-take-down="${id}"]`, `[data-gallery-dismiss="${id}"]`]) {
      const box = (await admin.page.locator(sel).boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5)
    }
    const rowBox = (await row.boundingBox())!
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(width + 0.5)
    if (SHOTS) await admin.page.screenshot({ path: `${SHOTS}/4-phone-moderation.png` })

    // Tidy: dismiss it, with a reason, from the phone.
    await admin.page.locator(`[data-gallery-dismiss="${id}"]`).click()
    const input = admin.page.getByPlaceholder('e.g. reviewed, nothing wrong')
    await input.fill('checked on a phone')
    await input.press('Enter')
    await expect(row).toHaveCount(0, { timeout: 15_000 })
    await expect(admin.page.locator(`[data-gallery-log-action="dismiss-report"][data-gallery-log-target="${id}"]`)).toBeVisible()
    await admin.context.close()
  })
})
