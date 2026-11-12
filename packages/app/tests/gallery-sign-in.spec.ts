import { test, expect, devices, type APIRequestContext, type Page } from '@playwright/test'

import { bootApp } from './_appBoot'

/**
 * #2319 — signing in to publish, end to end against the real server: the real
 * Auth.js routes, the real session cookie, the real gallery store.
 *
 * GitHub and Google can't be driven from a test, so this signs in with the
 * test-only provider, which the server offers ONLY when started with
 * STAVE_AUTH_TEST_LOGIN=1 (and an AUTH_SECRET) outside production. Without it
 * every test here SKIPS, saying why — which is what happens in the browser
 * gate, whose server doesn't set the flag. To run it:
 *
 *   STAVE_AUTH_TEST_LOGIN=1 AUTH_SECRET=dev-only-secret npm run dev -- -p 3331
 *   STAVE_E2E_PORT=3331 npx playwright test tests/gallery-sign-in.spec.ts --project=chromium
 *
 * Screenshots go to $GALLERY_SHOT_DIR when it is set.
 */

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const SHOTS = process.env.GALLERY_SHOT_DIR
const RUN = Date.now().toString(36)
const FIRST = `ada-${RUN}`
const SECOND = `eve-${RUN}`

async function testLoginOffered(request: APIRequestContext): Promise<boolean> {
  const res = await request.get('/api/gallery/me')
  if (!res.ok()) return false
  const me = (await res.json()) as { signInAvailable: boolean; providers: Array<{ id: string }> }
  return me.signInAvailable && me.providers.some((p) => p.id === 'test-login')
}

test.beforeEach(async ({ request }) => {
  test.skip(
    !(await testLoginOffered(request)),
    'sign-in is unavailable on this server: start it with STAVE_AUTH_TEST_LOGIN=1 and AUTH_SECRET (the gate does not)',
  )
})

/** Every console error and page error, so the spec can say none were new. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}

/** Errors that come from this feature: sign-in, the session, the gallery routes. */
const ours = (errors: string[]) => errors.filter((e) => /auth|session|gallery|sign.?in|publish|401|403|500/i.test(e))

async function openPublish(page: Page): Promise<void> {
  await page.keyboard.press(`${MOD}+Shift+P`)
  await page.getByPlaceholder('Type a command...').fill('Publish to Gallery')
  await expect(page.locator('[data-palette-row]', { hasText: 'Publish to Gallery' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('gallery-publish-dialog')).toBeVisible()
}

/** Sign in through the account menu: the test provider asks for an id (a prompt), then redirects back. */
async function signInFromMenu(page: Page, id: string): Promise<void> {
  await page.getByTestId('menubar-account').click()
  page.once('dialog', (d) => void d.accept(id))
  await page.locator('[data-stave-menu-item]', { hasText: 'Sign in with Test account' }).click()
  await expect(page.getByTestId('menubar-account')).toHaveText(`Test ${id}`, { timeout: 30_000 })
}

/** Sign a context in without the UI (for the phone context): the same Auth.js callback the UI posts to. */
async function signInByApi(request: APIRequestContext, id: string): Promise<void> {
  const { csrfToken } = (await (await request.get('/api/auth/csrf')).json()) as { csrfToken: string }
  const res = await request.post('/api/auth/callback/test-login', {
    form: { csrfToken, id, name: `Test ${id}`, login: id, email: `${id}@test-login.invalid`, as: 'github', callbackUrl: '/' },
    maxRedirects: 0,
  })
  expect(res.status()).toBe(302)
  expect(res.headers()['location']).not.toContain('error')
}

test.describe('Signing in to publish (#2319)', () => {
  test.describe.configure({ mode: 'serial' })
  let firstAuthorId = ''

  test('signed out, Publish asks you to sign in; signing in comes back to the dialog; publishing lands on your profile', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const errors = watchErrors(page)
    await bootApp(page)

    // ── signed out: the menu offers sign-in, and so does the dialog ──
    await expect(page.getByTestId('menubar-account')).toHaveText('Sign in')
    await openPublish(page)
    const gate = page.getByTestId('gallery-publish-signin')
    await expect(gate).toContainText('Sign in to publish to the gallery.')
    await expect(page.getByTestId('gallery-publish-submit')).toHaveCount(0)
    if (SHOTS) await page.getByTestId('gallery-publish-dialog').screenshot({ path: `${SHOTS}/1-signed-out-publish-prompt.png` })

    // ── sign in from the dialog: a full-page redirect, back to #publish ──
    page.once('dialog', (d) => void d.accept(FIRST))
    await page.getByTestId('gallery-publish-signin-test-login').click()
    await page.waitForURL((u) => u.hash === '' && u.pathname === '/', { timeout: 30_000 })
    const dialog = page.getByTestId('gallery-publish-dialog')
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('gallery-publish-as')).toContainText(`Publishing as Test ${FIRST} (GitHub @${FIRST})`)
    // the #publish fragment was taken off the URL once used
    expect(new URL(page.url()).hash).toBe('')
    await expect(page.getByTestId('gallery-publish-name')).toHaveCount(0)
    await expect(page.getByTestId('gallery-publish-email')).toHaveCount(0)
    if (SHOTS) await dialog.screenshot({ path: `${SHOTS}/3-signed-in-publish-dialog.png` })

    // ── publish for real ──
    await page.getByTestId('gallery-publish-title').fill(`Signed-in song ${RUN}`)
    await page.getByTestId('gallery-publish-kind-music').click()
    await page.getByTestId('gallery-publish-submit').click()
    await expect(page.locator('[data-testid="toast"]', { hasText: `Published "Signed-in song ${RUN}"` })).toBeVisible({
      timeout: 15_000,
    })
    await expect(dialog).toHaveCount(0)

    // ── the menu shows who you are; My Profile opens your profile with the badge ──
    await page.getByTestId('menubar-account').click()
    await expect(page.locator('[data-stave-menu-item]', { hasText: 'My Profile' })).toBeVisible()
    await expect(page.locator('[data-stave-menu-item]', { hasText: 'Sign Out' })).toBeVisible()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-menu-signed-in.png`, clip: { x: 0, y: 0, width: 1280, height: 140 } })
    await page.locator('[data-stave-menu-item]', { hasText: 'My Profile' }).click()

    const profile = page.locator('[data-gallery-profile]')
    await expect(profile).toBeVisible({ timeout: 15_000 })
    firstAuthorId = (await profile.getAttribute('data-gallery-profile')) ?? ''
    expect(firstAuthorId).not.toBe('')
    await expect(profile.locator('[data-gallery-verified="github"]')).toHaveText(`GitHub @${FIRST}`)
    await expect(profile.locator('[data-gallery-verified-link]')).toHaveAttribute('href', `https://github.com/${FIRST}`)
    await expect(profile).toContainText(`Signed-in song ${RUN}`)
    await expect(profile.locator('[data-gallery-edit-profile]')).toBeVisible()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-profile-with-badge.png` })

    // The email is nowhere on the page or in what the session route sends it.
    expect(await page.content()).not.toContain(`${FIRST}@test-login.invalid`)
    const me = await page.evaluate(async () => (await fetch('/api/gallery/me')).text())
    expect(me).toContain(firstAuthorId)
    expect(me).not.toContain('@test-login.invalid')

    // ── sign out ──
    await page.keyboard.press('Escape')
    await page.getByTestId('menubar-account').click()
    await page.locator('[data-stave-menu-item]', { hasText: 'Sign Out' }).click()
    await expect(page.getByTestId('menubar-account')).toHaveText('Sign in', { timeout: 30_000 })
    const after = (await page.evaluate(async () => (await fetch('/api/gallery/me')).json())) as { user: unknown }
    expect(after.user).toBeNull()

    console.log(`[gallery-sign-in] console/page errors (${errors.length}):\n${errors.join('\n')}`)
    expect(ours(errors)).toEqual([])
  })

  test('a second account sees the first one\'s profile but no Edit', async ({ page }) => {
    test.skip(!firstAuthorId, 'needs the first test to have published')
    const errors = watchErrors(page)
    await bootApp(page)
    await signInFromMenu(page, SECOND)

    await page.evaluate((id) => {
      window.location.hash = `#gallery-author=${id}`
    }, firstAuthorId)
    const profile = page.locator(`[data-gallery-profile="${firstAuthorId}"]`)
    await expect(profile).toBeVisible({ timeout: 15_000 })
    await expect(profile.locator('[data-gallery-verified="github"]')).toHaveText(`GitHub @${FIRST}`)
    await expect(profile.locator('[data-gallery-edit-profile]')).toHaveCount(0)
    await expect(profile.locator('[data-gallery-new-collection]')).toHaveCount(0)

    // and the server agrees: a PUT from this session is refused
    const status = await page.evaluate(
      async (id) =>
        (
          await fetch(`/api/gallery/authors/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Mallory', bio: '' }),
          })
        ).status,
      firstAuthorId,
    )
    expect(status).toBe(403)

    console.log(`[gallery-sign-in] second account errors (${errors.length}):\n${errors.join('\n')}`)
    // The refused PUT logs a 403 on purpose; anything else of ours is new.
    expect(ours(errors).filter((e) => !/403/.test(e))).toEqual([])
  })

  test('on a phone the drawer has the account menu', async ({ browser }) => {
    const context = await browser.newContext({ ...devices['Pixel 7'] })
    const page = await context.newPage()
    await signInByApi(context.request, `${FIRST}`)
    await bootApp(page)
    await page.locator('[data-phone-top="drawer"]').click()
    await expect(page.locator('[data-phone-drawer-layer]')).toBeVisible()
    await page.locator(`[data-phone-drawer-tab="phone-menu"]`).click()
    const account = page.locator('[data-phone-menu="account"]')
    await expect(account).toContainText(`Test ${FIRST}`)
    await expect(account.locator('[data-stave-menu-item]', { hasText: 'My Profile' })).toBeVisible()
    await expect(account.locator('[data-stave-menu-item]', { hasText: 'Sign Out' })).toBeVisible()
    await account.scrollIntoViewIfNeeded()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-phone-drawer.png` })
    await context.close()
  })
})
