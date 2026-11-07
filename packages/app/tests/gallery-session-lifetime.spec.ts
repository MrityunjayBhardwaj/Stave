import { test, expect, type BrowserContext, type Page, type Response } from '@playwright/test'
import { encode } from 'next-auth/jwt'

import { bootApp } from './_appBoot'

/**
 * #2367 — a gallery session lasts 7 days and is renewed while you're active, against
 * the real server: the real Auth.js routes and the real cookie in a real browser.
 *
 * Nothing here waits a week. "Issued N days ago" means a genuine Auth.js cookie,
 * made by its own encode() with this process's clock moved back N days, using the
 * server's AUTH_SECRET: the server then reads it exactly as it would a cookie that
 * really is that old. A cookie's Expires is read from what the browser stored.
 *
 * Needs a server with the test sign-in; without it (the browser gate), or without
 * AUTH_SECRET here, every test SKIPS, saying why. To run it:
 *
 *   STAVE_AUTH_TEST_LOGIN=1 AUTH_SECRET=dev-only-secret npm run dev -- -p 3442
 *   AUTH_SECRET=dev-only-secret STAVE_E2E_PORT=3442 npx playwright test tests/gallery-session-lifetime.spec.ts --project=chromium
 */

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const RUN = Date.now().toString(36)
const DAY = 24 * 60 * 60 * 1000
const SEVEN_DAYS = 7 * DAY
const COOKIE = 'authjs.session-token'
const SECRET = process.env.AUTH_SECRET
/** A cookie's Expires should land this close to where it's expected: the test takes time to run. */
const SLOP = 60_000

/** Run `fn` with Date reading `offsetMs` from now. */
async function atClockOffset<T>(offsetMs: number, fn: () => Promise<T>): Promise<T> {
  const RealDate = Date
  class ShiftedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length) super(...(args as [number]))
      else super(RealDate.now() + offsetMs)
    }
    static now() {
      return RealDate.now() + offsetMs
    }
  }
  globalThis.Date = ShiftedDate as DateConstructor
  try {
    return await fn()
  } finally {
    globalThis.Date = RealDate
  }
}

/** A real session cookie for test account `id`, issued `daysAgo` days ago, lasting `lifetime`. */
function issuedDaysAgo(id: string, daysAgo: number, lifetime = SEVEN_DAYS): Promise<string> {
  return atClockOffset(-daysAgo * DAY, () =>
    encode({
      token: {
        name: `Test ${id}`,
        email: `${id}@test-login.invalid`,
        account: { provider: 'test-login', providerAccountId: id, badge: 'github', login: id },
      },
      secret: SECRET!,
      salt: COOKIE,
      maxAge: lifetime / 1000,
    }),
  )
}

/** Put a session cookie in the browser, with `browserExpiresMs` as its Expires (default: far off). */
async function holdCookie(context: BrowserContext, value: string, browserExpiresMs = Date.now() + 60 * DAY): Promise<void> {
  await context.addCookies([
    { name: COOKIE, value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax', expires: browserExpiresMs / 1000 },
  ])
}

async function sessionCookie(context: BrowserContext) {
  return (await context.cookies()).find((c) => c.name === COOKIE)
}

/** Load the app and hand back the page's own read of /api/gallery/me. */
async function bootAndRead(page: Page): Promise<Response> {
  const read = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/gallery/me')
  await bootApp(page)
  return read
}

async function openPublish(page: Page): Promise<void> {
  await page.keyboard.press(`${MOD}+Shift+P`)
  await page.getByPlaceholder('Type a command...').fill('Publish to Gallery')
  await expect(page.locator('[data-palette-row]', { hasText: 'Publish to Gallery' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('gallery-publish-dialog')).toBeVisible()
}

async function signOutFromMenu(page: Page): Promise<void> {
  await page.getByTestId('menubar-account').click()
  await page.locator('[data-stave-menu-item]', { hasText: 'Sign out' }).click()
}

const expectSignedInAs = (page: Page, id: string) => expect(page.getByTestId('menubar-account')).toHaveText(`Test ${id}`, { timeout: 30_000 })
const expectSignedOut = (page: Page) => expect(page.getByTestId('menubar-account')).toContainText('Sign in', { timeout: 30_000 })

test.beforeEach(async ({ request }) => {
  const me = await (await request.get('/api/gallery/me')).json().catch(() => null)
  const offered = me?.signInAvailable && me.providers.some((p: { id: string }) => p.id === 'test-login')
  test.skip(!offered, 'sign-in is unavailable on this server: start it with STAVE_AUTH_TEST_LOGIN=1 and AUTH_SECRET (the gate does not)')
  test.skip(!SECRET, 'needs AUTH_SECRET here too, the same as the server, to make cookies of a given age')
})

test.describe('How long a gallery session lasts (#2367)', () => {
  test('signing in for real gives 7 days, and using the app the same day sets no cookie', async ({ page, context }) => {
    const id = `fresh-${RUN}`
    await bootApp(page)
    await page.getByTestId('menubar-account').click()
    page.once('dialog', (d) => void d.accept(id))
    await page.locator('[data-stave-menu-item]', { hasText: 'Sign in with Test account' }).click()
    await expectSignedInAs(page, id)

    const issued = await sessionCookie(context)
    expect(Math.abs(issued!.expires * 1000 - (Date.now() + SEVEN_DAYS))).toBeLessThan(SLOP)

    const read = await bootAndRead(page)
    expect(read.status()).toBe(200)
    expect((await read.allHeaders())['set-cookie']).toBeUndefined()
    expect((await sessionCookie(context))!.value).toBe(issued!.value)
  })

  test('active: a cookie two days old is renewed by simply opening the app', async ({ page, context }) => {
    const id = `active-${RUN}`
    const old = await issuedDaysAgo(id, 2)
    await holdCookie(context, old, Date.now() + 5 * DAY)

    const authRequests: string[] = []
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/auth/session') authRequests.push(r.url())
    })
    const read = await bootAndRead(page)
    await expectSignedInAs(page, id)

    const headers = await read.allHeaders()
    expect(headers['set-cookie']).toContain(`${COOKIE}=`)
    expect(headers['set-cookie']).not.toMatch(/csrf|callback-url/)
    // An answer with a Set-Cookie must never be cacheable, and the app's isolation headers stay.
    expect(headers['cache-control']).toBe('no-store')
    expect(headers['cross-origin-opener-policy']).toBe('same-origin')
    expect(headers['cross-origin-embedder-policy']).toBe('credentialless')
    expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true)

    const held = await sessionCookie(context)
    expect(held!.value).not.toBe(old)
    expect(Math.abs(held!.expires * 1000 - (Date.now() + SEVEN_DAYS))).toBeLessThan(SLOP)
    expect(authRequests).toEqual([])

    // The renewed cookie is good, and doesn't renew again the same day.
    const again = await bootAndRead(page)
    await expectSignedInAs(page, id)
    expect((await again.allHeaders())['set-cookie']).toBeUndefined()
  })

  test('not active: a cookie 8 days old is the normal signed-out state, in the menu and the publish dialog', async ({ page, context }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    // The browser still holds it and still sends it, as a stolen copy would be: the server refuses it.
    await holdCookie(context, await issuedDaysAgo(`idle-${RUN}`, 8))
    const read = await bootAndRead(page)
    expect(read.status()).toBe(200)
    expect((await read.json()).user).toBeNull()
    expect((await read.allHeaders())['set-cookie']).toBeUndefined()
    await expectSignedOut(page)

    await openPublish(page)
    await expect(page.getByTestId('gallery-publish-signin')).toBeVisible()
    await expect(page.getByTestId('gallery-publish-signin-test-login')).toBeVisible()
    expect(errors.filter((e) => /auth|session|gallery|sign.?in|publish/i.test(e))).toEqual([])
  })

  test('not active: when the browser drops the expired cookie, it is signed out too', async ({ page, context }) => {
    await holdCookie(context, await issuedDaysAgo(`dropped-${RUN}`, 1), Date.now() + 2000)
    await page.waitForTimeout(2500)
    expect(await sessionCookie(context)).toBeUndefined()
    const read = await bootAndRead(page)
    expect(read.status()).toBe(200)
    expect((await read.json()).user).toBeNull()
    await expectSignedOut(page)
  })

  test('the session ending while the publish dialog is open swaps it for the sign-in offer', async ({ page, context }) => {
    const id = `midway-${RUN}`
    await holdCookie(context, await issuedDaysAgo(id, 0))
    await bootAndRead(page)
    await expectSignedInAs(page, id)
    await openPublish(page)
    await expect(page.getByTestId('gallery-publish-as')).toBeVisible()

    await context.clearCookies({ name: COOKIE })
    await page.getByTestId('gallery-publish-dialog').getByRole('button', { name: /^publish/i }).click()
    await expect(page.getByTestId('gallery-publish-signin')).toBeVisible({ timeout: 30_000 })
  })

  test('a 30-day cookie from before this change comes down to 7 days on its first read', async ({ page, context }) => {
    const id = `legacy-${RUN}`
    await holdCookie(context, await issuedDaysAgo(id, 20, 30 * DAY), Date.now() + 10 * DAY)
    await bootAndRead(page)
    await expectSignedInAs(page, id)
    const held = await sessionCookie(context)
    expect(Math.abs(held!.expires * 1000 - (Date.now() + SEVEN_DAYS))).toBeLessThan(SLOP)
  })

  /**
   * The race: another tab's read, due to renew, is on its way back while you sign out.
   * Its response is held here, so it's certain to arrive after the sign-out would have
   * finished; if it lands after, its Set-Cookie brings the session back. It takes two
   * tabs: in one tab the sign-out's own redirect cancels the read, lock or no lock.
   */
  async function holdReads(context: BrowserContext, holdMs: number): Promise<void> {
    await context.route('**/api/gallery/me', async (route) => {
      const response = await route.fetch()
      await new Promise((r) => setTimeout(r, holdMs))
      await route.fulfill({ response }).catch(() => {})
    })
  }

  test('signing out in one tab while another tab\'s renewal is on its way back stays signed out', async ({ page, context }) => {
    const id = `tabs-${RUN}`
    await holdCookie(context, await issuedDaysAgo(id, 0))
    await bootAndRead(page)
    await expectSignedInAs(page, id)

    await holdCookie(context, await issuedDaysAgo(id, 2))
    await holdReads(context, 2000)
    const other = await context.newPage()
    const otherRead = other.waitForRequest((r) => new URL(r.url()).pathname === '/api/gallery/me')
    void other.goto('/').catch(() => {})
    await otherRead

    await page.bringToFront()
    await signOutFromMenu(page)
    await expectSignedOut(page)
    await context.unroute('**/api/gallery/me')
    await other.waitForTimeout(500)

    expect(await sessionCookie(context)).toBeUndefined()
    await other.close()
  })
})
