import { test, expect, type Page, type Request } from '@playwright/test'

import { bootApp, seedCode } from './_appBoot'
import { ADA_SESSION_USER, routeSession } from './_gallery'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/**
 * #2364 — making a private link signed out asks for the "are you human" check;
 * signed in it stays one click.
 *
 * Needs a server started with Cloudflare's always-pass test keys, and the same
 * site key in this runner's environment (a server without them is covered by
 * share-short-link.spec.ts, where nothing changes):
 *
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
 *   TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
 *   STAVE_AUTH_TEST_LOGIN=1 AUTH_SECRET=dev-only-secret
 *   STAVE_RATE_LIMIT_LINK=100000   (every signed-out visitor is one address locally)
 */

const SHORT = /^http:\/\/[^/]+\/s\/[A-Za-z0-9_-]{11}#[A-Za-z0-9_-]{22}$/
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
const BODY = new Uint8Array(64)
BODY[0] = 1

test.skip(!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, 'Turnstile test keys are not set on this run')

async function fromFileMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.locator('[data-stave-menu-item]', { hasText: /^Share/ }).hover()
  await page.locator('[data-stave-menu-item]', { hasText: 'Copy Private Link' }).click()
}

async function fromPalette(page: Page): Promise<void> {
  await page.keyboard.press(`${MOD}+Shift+P`)
  await page.getByPlaceholder('Type a command...').fill('Copy Private Link')
  await expect(page.locator('[data-palette-row]', { hasText: 'Copy Private Link' })).toBeVisible()
  await page.keyboard.press('Enter')
}

const toast = (page: Page, text: string | RegExp) => page.locator('[data-testid="toast"]', { hasText: text }).last()
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

/** Every POST to /api/share the page makes, and whether Cloudflare's script was ever asked for. */
function watch(page: Page) {
  const posts: Request[] = []
  const cloudflare: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/share') posts.push(r)
    if (r.url().startsWith('https://challenges.cloudflare.com/')) cloudflare.push(r.url())
  })
  return { posts, cloudflare }
}

async function boot(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await bootApp(page)
  await seedCode(page, 's("bd ~ sd ~") // the check')
}

async function signInFromMenu(page: Page, id: string): Promise<void> {
  await page.getByTestId('menubar-account').click()
  page.once('dialog', (d) => void d.accept(id))
  await page.locator('[data-stave-menu-item]', { hasText: 'Sign in with Test account' }).click()
  await expect(page.getByTestId('menubar-account')).toHaveText(`Test ${id}`, { timeout: 30_000 })
}

test.describe('the check in front of a private link (#2364)', () => {
  for (const [door, open] of [['File → Share', fromFileMenu], ['the command palette', fromPalette]] as const) {
    test(`signed out, from ${door}: the check runs, its token goes along, and the link is copied`, async ({ page }) => {
      const seen = watch(page)
      await boot(page)
      await open(page)
      await toast(page, 'Private link copied').waitFor({ timeout: 30_000 })
      await expect(page.getByTestId('share-check-dialog')).toHaveCount(0)
      expect(seen.cloudflare.length).toBeGreaterThan(0)
      expect(seen.posts).toHaveLength(1)
      expect(seen.posts[0].headers()['cf-turnstile-response']).toBe(DUMMY_TOKEN)
      expect(await clipboard(page)).toMatch(SHORT)
    })
  }

  test('signed in: one click, no check, and Cloudflare is never contacted', async ({ page }) => {
    const seen = watch(page)
    await boot(page)
    await signInFromMenu(page, `check-${Date.now().toString(36)}`)
    await seedCode(page, 's("bd ~ sd ~") // signed in')
    await fromFileMenu(page)
    await toast(page, 'Private link copied').waitFor({ timeout: 30_000 })
    expect(seen.posts).toHaveLength(1)
    expect(seen.posts[0].headers()['cf-turnstile-response']).toBeUndefined()
    expect(seen.cloudflare).toEqual([])
    expect(await clipboard(page)).toMatch(SHORT)
  })

  test('the page thinks it is signed in but the server reads no session: the check runs then', async ({ page }) => {
    const seen = watch(page)
    await routeSession(page, ADA_SESSION_USER)
    await boot(page)
    await fromFileMenu(page)
    await toast(page, 'Private link copied').waitFor({ timeout: 30_000 })
    expect(seen.posts.map((p) => p.headers()['cf-turnstile-response'])).toEqual([undefined, DUMMY_TOKEN])
    expect(await clipboard(page)).toMatch(SHORT)
  })

  test('a failed sign-in lookup asks for the check rather than skipping it', async ({ page }) => {
    const seen = watch(page)
    await page.route('**/api/gallery/me', (route) => route.fulfill({ status: 503, body: 'down' }))
    await boot(page)
    await fromFileMenu(page)
    await toast(page, 'Private link copied').waitFor({ timeout: 30_000 })
    expect(seen.posts.map((p) => p.headers()['cf-turnstile-response'])).toEqual([DUMMY_TOKEN])
  })

  test('the server, asked directly: no token or a session it can\'t read is 403, and a real session is 201', async ({ page, playwright, baseURL }) => {
    await boot(page)
    const origin = { origin: baseURL as string, 'content-type': 'application/octet-stream' }
    const signedOut = await playwright.request.newContext({ baseURL })
    const none = await signedOut.post('/api/share', { headers: origin, data: Buffer.from(BODY) })
    expect(none.status()).toBe(403)
    expect(((await none.json()) as { error: string }).error).toContain('are you human')

    const junk = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { cookie: 'authjs.session-token=not-a-real-session' },
    })
    expect((await junk.post('/api/share', { headers: origin, data: Buffer.from(BODY) })).status()).toBe(403)

    await signInFromMenu(page, `direct-${Date.now().toString(36)}`)
    const session = await page.context().request.post('/api/share', { headers: origin, data: Buffer.from(BODY) })
    expect(session.status()).toBe(201)
    await signedOut.dispose()
    await junk.dispose()
  })

  test('the browser refuses the clipboard after the wait: a Copy button finishes the job', async ({ page }) => {
    await page.addInitScript(() => {
      const real = navigator.clipboard.writeText.bind(navigator.clipboard)
      let first = true
      navigator.clipboard.writeText = (text: string) => {
        if (first) {
          first = false
          return Promise.reject(new DOMException('no user gesture', 'NotAllowedError'))
        }
        return real(text)
      }
    })
    await boot(page)
    await fromFileMenu(page)
    await page.getByRole('button', { name: 'Copy', exact: true }).click({ timeout: 30_000 })
    await toast(page, 'Private link copied').waitFor({ timeout: 20_000 })
    expect(await clipboard(page)).toMatch(SHORT)
  })

  test('refused by the server: a plain message, the long link, and the token is not sent twice', async ({ page }) => {
    const seen = watch(page)
    await page.route('**/api/share', (route) =>
      route.fulfill({ status: 403, json: { error: 'the "are you human" check didn\'t pass; please try it again' } }),
    )
    await boot(page)
    await fromFileMenu(page)
    await toast(page, 'check didn\'t pass, so this is the long one').waitFor({ timeout: 30_000 })
    expect(seen.posts).toHaveLength(1)
    expect(await clipboard(page)).toContain('/#share=')

    // The next try is a new check, not the old token.
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.locator('[data-stave-menu-item]', { hasText: /^Share/ }).hover()
    await page.locator('[data-stave-menu-item]', { hasText: 'Copy Private Link' }).click()
    await expect.poll(() => seen.posts.length, { timeout: 30_000 }).toBe(2)
  })

  test('the check can be closed, or passed over for the long link, and neither uploads', async ({ page }) => {
    // Hold the widget back so the dialog stays up to be used.
    await page.route('https://challenges.cloudflare.com/**', () => {})
    const seen = watch(page)
    await boot(page)
    await fromFileMenu(page)
    await expect(page.getByTestId('share-check-dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('share-check-dialog')).toHaveCount(0)
    await page.waitForTimeout(1000) // long enough for a long link to have been built and copied
    await expect(page.locator('[data-testid="toast"]', { hasText: /link copied|Share failed/ })).toHaveCount(0)

    await fromPalette(page)
    await page.getByTestId('share-check-long').click()
    await toast(page, 'which carries the project itself').waitFor({ timeout: 20_000 })
    expect(await clipboard(page)).toContain('/#share=')
    expect(seen.posts).toHaveLength(0)
  })

  test('a blocked check says so, and the long link is still there', async ({ page }) => {
    await page.route('https://challenges.cloudflare.com/**', (route) => route.abort())
    await boot(page)
    await fromFileMenu(page)
    const widget = page.getByTestId('share-check-turnstile')
    await expect(widget).toHaveAttribute('data-turnstile-status', 'unloaded', { timeout: 20_000 })
    await expect(widget.getByRole('alert')).toContainText("couldn't load")
    await page.getByTestId('share-check-long').click()
    await toast(page, 'which carries the project itself').waitFor({ timeout: 20_000 })
  })
})
