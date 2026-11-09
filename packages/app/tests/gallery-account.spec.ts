import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'

import { bootApp } from './_appBoot'

/**
 * #2320 / #2321 — what a browser published before sign-in comes into the
 * account when it signs in, and My shares follows the account to another device.
 * Real server, real Auth.js session (the test-only provider), real stores.
 *
 * "Browser A" and "browser B" are separate browser contexts: no shared cookies
 * or localStorage, which is what two devices are to the app.
 *
 * Publishing now needs sign-in, so a profile from BEFORE sign-in can't be made
 * through the routes any more. #2352 — the records are in the dev server's
 * Postgres (PGlite), which only the server's own process may open, so the
 * fixture asks the server to make them: POST /api/test-seed, a
 * TEST-ONLY route that answers 404 unless the test sign-in is allowed (the
 * flag, and never a production build). It makes a key-held profile with a bio,
 * one entry with its manage token, and one collection, and hands back the keys.
 * Browser A is then given the keys that publish would have left in its
 * localStorage. The private link is made for real, signed out, through File →
 * Share → Copy Private Link.
 *
 * Like gallery-sign-in.spec.ts, it SKIPS (saying why) unless the server was
 * started with STAVE_AUTH_TEST_LOGIN=1 and an AUTH_SECRET, which the browser
 * gate's server is not. To run it:
 *
 *   STAVE_AUTH_TEST_LOGIN=1 AUTH_SECRET=dev-only-secret npm run dev -- -p 3341
 *   STAVE_E2E_PORT=3341 npx playwright test tests/gallery-account.spec.ts --project=chromium --workers=1
 *
 * #2329 — the account lists a private link by id, name and date only, never
 * its key. Browser A, which made the link, can copy it again from its own
 * copy; browser B sees the row and can revoke it, but has no Copy again.
 *
 * Screenshots go to $GALLERY_SHOT_DIR when it is set.
 */

const SHOTS = process.env.GALLERY_SHOT_DIR
const RUN = Date.now().toString(36)
const USER = `claim-${RUN}`

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

function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  return errors
}
const ours = (errors: string[]) => errors.filter((e) => /auth|session|gallery|sign.?in|claim|share|401|403|500/i.test(e))

/** A profile, an entry and a collection as the key-based publish (before sign-in) left them, made by the server. */
async function seedPreSignInAuthor(request: APIRequestContext) {
  const title = `Before sign-in ${RUN}`
  const res = await request.post('/api/test-seed', { data: { title, collectionTitle: `Old EP ${RUN}` } })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as { authorId: string; authorKey: string; entryId: string; manageToken: string; collectionId: string; title: string }
}

/** #2329 / #2352 — every account-link row the dev server stored (every account), every column. */
async function storedAccountLinks(request: APIRequestContext): Promise<Array<Record<string, unknown>>> {
  const res = await request.get('/api/test-seed')
  expect(res.status()).toBe(200)
  return ((await res.json()) as { accountLinks: Array<Record<string, unknown>> }).accountLinks
}

async function copyPrivateLink(page: Page): Promise<string> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.locator('[data-stave-menu-item]', { hasText: /^Share/ }).hover()
  await page.locator('[data-stave-menu-item]', { hasText: 'Copy Private Link' }).click()
  await page.locator('[data-testid="toast"]', { hasText: 'Private link copied' }).last().waitFor({ timeout: 20_000 })
  return page.evaluate(() => navigator.clipboard.readText())
}

async function signInFromMenu(page: Page, id: string): Promise<void> {
  await page.getByTestId('menubar-account').click()
  page.once('dialog', (d) => void d.accept(id))
  await page.locator('[data-stave-menu-item]', { hasText: 'Sign in with Test account' }).click()
  await expect(page.getByTestId('menubar-account')).toHaveText(`Test ${id}`, { timeout: 30_000 })
}

async function signInByApi(request: APIRequestContext, id: string): Promise<void> {
  const { csrfToken } = (await (await request.get('/api/auth/csrf')).json()) as { csrfToken: string }
  const res = await request.post('/api/auth/callback/test-login', {
    form: { csrfToken, id, name: `Test ${id}`, login: id, email: `${id}@test-login.invalid`, as: 'github', callbackUrl: '/' },
    maxRedirects: 0,
  })
  expect(res.status()).toBe(302)
  expect(res.headers()['location']).not.toContain('error')
}

async function openMyShares(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByText('Community Gallery...', { exact: true }).click()
  // #2473 — on a desktop the gallery opens as a workspace tab
  await expect(page.locator('[data-gallery="tab"]')).toBeVisible()
  await page.locator('[data-gallery-tab="mine"]').click()
}

async function newDevice(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  return { context, page: await context.newPage() }
}

test.describe('Your shares follow your account (#2320, #2321)', () => {
  test.describe.configure({ mode: 'serial' })
  let seed: Awaited<ReturnType<typeof seedPreSignInAuthor>>
  let linkId = ''
  let linkKey = ''
  let accountAuthorId = ''
  let deviceA: { context: BrowserContext; page: Page } | null = null

  test.afterAll(async () => {
    await deviceA?.context.close()
  })

  test('browser A: what it published before sign-in comes into the account', async ({ browser, request }) => {
    seed = await seedPreSignInAuthor(request)
    deviceA = await newDevice(browser)
    const { page } = deviceA
    const errors = watchErrors(page)
    await bootApp(page)
    await expect(page.getByTestId('menubar-account')).toHaveText('Sign in')

    // Signed out: a real private link, kept in this browser.
    const url = await copyPrivateLink(page)
    linkId = new URL(url).pathname.split('/').pop()!
    linkKey = new URL(url).hash.slice(1)
    expect(linkKey).toMatch(/^[A-Za-z0-9_-]{22}$/)
    // ...and the keys a pre-sign-in publish left here.
    await page.evaluate((s) => {
      localStorage.setItem('stave.gallery.author', JSON.stringify({ name: 'Old me', email: '', authorId: s.authorId, authorKey: s.authorKey }))
      localStorage.setItem(
        'stave.gallery.shares',
        JSON.stringify([{ id: s.entryId, title: s.title, kind: 'music', publishedAt: Date.now(), manageToken: s.manageToken }]),
      )
    }, seed)

    // Signing in reloads; the claim runs once and says what came in.
    await signInFromMenu(page, USER)
    const toast = page.locator('[data-testid="toast"]', { hasText: 'into your account' })
    await expect(toast).toContainText('Brought 1 entry, 1 collection and 1 private link into your account.', { timeout: 20_000 })
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-claim-toast.png` })

    // Marked claimed (keys kept), so the next load sends nothing.
    const marks = await page.evaluate(() => ({
      author: JSON.parse(localStorage.getItem('stave.gallery.author') ?? 'null'),
      shares: JSON.parse(localStorage.getItem('stave.gallery.shares') ?? '[]'),
      links: JSON.parse(localStorage.getItem('stave.share.links') ?? '[]'),
    }))
    accountAuthorId = marks.author.claimedBy
    expect(accountAuthorId).toBeTruthy()
    expect(marks.author.authorKey).toBe(seed.authorKey)
    expect(marks.shares[0].claimedBy).toBe(accountAuthorId)
    expect(marks.links.find((l: { id: string }) => l.id === linkId).claimedBy).toBe(accountAuthorId)

    // My shares: everything under the account, nothing "only in this browser".
    await openMyShares(page)
    await expect(page.locator('[data-gallery-mine-source="account"]')).toBeVisible()
    await expect(page.locator(`[data-gallery-mine="${seed.entryId}"]`)).toHaveAttribute('data-gallery-home', 'account', { timeout: 15_000 })
    await expect(page.locator(`[data-gallery-link="${linkId}"]`)).toHaveAttribute('data-gallery-home', 'account')
    await expect(page.locator(`[data-gallery-my-collection="${seed.collectionId}"]`)).toBeVisible()
    await expect(page.locator('[data-gallery-browser-only]')).toHaveCount(0)
    await expect(page.locator('[data-gallery-links-note]')).toContainText('only you can see this list')
    await expect(page.locator('[data-gallery-links-note]')).toContainText("A link's key is kept only in the browser that made it")
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-my-shares-signed-in.png` })

    // #2329 — A made the link, so it has Copy again (from its own copy) and Revoke.
    const linkRow = page.locator(`[data-gallery-link="${linkId}"]`)
    await expect(linkRow.getByRole('button', { name: 'Copy again' })).toBeVisible()
    await expect(linkRow.getByRole('button', { name: 'Revoke' })).toBeVisible()
    await expect(linkRow.locator('[data-gallery-link-elsewhere]')).toHaveCount(0)
    if (SHOTS) await page.locator('[data-gallery-section="private"]').screenshot({ path: `${SHOTS}/a-private-links.png` })
    await page.evaluate(() => navigator.clipboard.writeText(''))
    await linkRow.getByRole('button', { name: 'Copy again' }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(url)

    // #2329 — what the real server stored for the account: no key, no `#`, only the
    // account, id, name and date (#2352: the account_links table has no other column).
    // This run's key is in no row of the whole store.
    const rows = await storedAccountLinks(page.request)
    const thisLink = rows.filter((r) => r.share_id === linkId)
    expect(thisLink).toHaveLength(1)
    expect(Object.keys(thisLink[0]).sort()).toEqual(['account_id', 'created_at', 'project_name', 'share_id'])
    const ofAccount = rows.filter((r) => r.account_id === thisLink[0].account_id)
    expect(ofAccount.length).toBeGreaterThanOrEqual(1)
    for (const r of rows) expect(JSON.stringify(r)).not.toContain(linkKey)
    for (const r of ofAccount) expect(JSON.stringify(r)).not.toContain('#')
    // ...and My shares' own answer carries no key either.
    const myShares = await page.request.get('/api/gallery/me/shares')
    expect(myShares.status()).toBe(200)
    const mySharesText = await myShares.text()
    expect(mySharesText).toContain(linkId)
    expect(mySharesText).not.toContain(linkKey)
    expect(mySharesText).not.toContain('#')

    // The old profile link opens the account's profile (in the open gallery tab).
    await page.evaluate((id) => {
      window.location.hash = `#gallery-author=${id}`
    }, seed.authorId)
    const profile = page.locator(`[data-gallery-profile="${accountAuthorId}"]`)
    await expect(profile).toBeVisible({ timeout: 15_000 })
    await expect(profile).toContainText(seed.title)
    await expect(profile).toContainText(`Old EP ${RUN}`)
    await expect(profile.locator('[data-gallery-edit-profile]')).toBeVisible()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-old-profile-follows.png` })

    // A reload doesn't claim again: no second toast.
    const claims: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/gallery/claim')) claims.push(r.method())
    })
    await page.reload()
    await expect(page.getByTestId('menubar-account')).toHaveText(`Test ${USER}`, { timeout: 30_000 })
    await page.waitForTimeout(1500)
    expect(claims).toEqual([])

    console.log(`[gallery-account] A errors (${errors.length}):\n${errors.join('\n')}`)
    expect(ours(errors)).toEqual([])
  })

  test('browser B, same account: sees the same, revokes the link; A sees it gone', async ({ browser }) => {
    test.skip(!linkId || !deviceA, 'needs the claim test')
    const b = await newDevice(browser)
    const errors = watchErrors(b.page)
    try {
      await signInByApi(b.context.request, USER)
      await bootApp(b.page)
      await expect(b.page.getByTestId('menubar-account')).toHaveText(`Test ${USER}`, { timeout: 30_000 })
      await openMyShares(b.page)
      const entry = b.page.locator(`[data-gallery-mine="${seed.entryId}"]`)
      const link = b.page.locator(`[data-gallery-link="${linkId}"]`)
      await expect(entry).toHaveAttribute('data-gallery-home', 'account', { timeout: 15_000 })
      await expect(link).toHaveAttribute('data-gallery-home', 'account')
      await expect(b.page.locator(`[data-gallery-my-collection="${seed.collectionId}"]`)).toBeVisible()
      // This browser holds no keys at all.
      expect(await b.page.evaluate(() => localStorage.getItem('stave.share.links'))).toBeNull()
      if (SHOTS) await b.page.screenshot({ path: `${SHOTS}/3-my-shares-browser-b.png` })

      // #2329 — the account never had the key, so B sees the row and can revoke it, but can't copy it.
      await expect(link.locator('[data-gallery-link-elsewhere]')).toHaveText(
        "Made on another device. The link's key is only kept there.",
      )
      await expect(link.getByRole('button', { name: 'Copy again' })).toHaveCount(0)
      await expect(link.getByRole('button', { name: 'Revoke' })).toBeVisible()
      if (SHOTS) await b.page.locator('[data-gallery-section="private"]').screenshot({ path: `${SHOTS}/b-private-links.png` })

      // Revoke through the session (no key here).
      await link.getByRole('button', { name: 'Revoke' }).click()
      await b.page.getByRole('button', { name: 'Revoke', exact: true }).last().click() // the confirm
      await expect(link).toHaveCount(0, { timeout: 15_000 })
      expect((await b.context.request.get(`/api/share/${linkId}`)).status()).toBe(404)
      console.log(`[gallery-account] B errors (${errors.length}):\n${errors.join('\n')}`)
      expect(ours(errors)).toEqual([])
    } finally {
      await b.context.close()
    }

    // Browser A, reopening My shares: the link is gone from the account's list.
    const a = deviceA!.page
    await a.reload()
    await expect(a.getByTestId('menubar-account')).toHaveText(`Test ${USER}`, { timeout: 30_000 })
    await openMyShares(a)
    await expect(a.locator(`[data-gallery-mine="${seed.entryId}"]`)).toHaveAttribute('data-gallery-home', 'account', { timeout: 15_000 })
    // A still holds its own (now dead) key for the link, but the account took it and no
    // longer lists it, so this browser's stale copy isn't offered again.
    await expect(a.locator(`[data-gallery-link="${linkId}"]`)).toHaveCount(0)
    if (SHOTS) await a.screenshot({ path: `${SHOTS}/5-browser-a-after-revoke.png` })
  })
})
