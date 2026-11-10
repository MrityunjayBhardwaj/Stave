import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

import { bootApp } from './_appBoot'

/**
 * #2368 — a profile can't name itself as Stave. Real server, real Auth.js session
 * (the test-only provider), real database, real profile editor.
 *
 * Like gallery-sign-in.spec.ts, it SKIPS (saying why) unless the server was
 * started with STAVE_AUTH_TEST_LOGIN=1 and an AUTH_SECRET, which the browser
 * gate's server is not. To run it:
 *
 *   STAVE_AUTH_TEST_LOGIN=1 AUTH_SECRET=dev-only-secret npm run dev -- -p 3443
 *   STAVE_E2E_PORT=3443 npx playwright test tests/gallery-reserved-names.spec.ts --project=chromium --retries=0
 *
 * Screenshots go to $GALLERY_SHOT_DIR when it is set.
 */

const SHOTS = process.env.GALLERY_SHOT_DIR
const RUN = Date.now().toString(36)
const REFUSAL = 'that name is kept for the people who run Stave, so please choose a different one'

test.beforeEach(async ({ request }) => {
  const res = await request.get('/api/gallery/me')
  const me = res.ok() ? ((await res.json()) as { signInAvailable: boolean; providers: Array<{ id: string }> }) : null
  test.skip(
    !me?.signInAvailable || !me.providers.some((p) => p.id === 'test-login'),
    'sign-in is unavailable on this server: start it with STAVE_AUTH_TEST_LOGIN=1 and AUTH_SECRET (the gate does not)',
  )
})

/** The Auth.js callback the sign-in UI posts to; `request` shares the page's cookies. */
async function signIn(request: APIRequestContext, id: string, name: string, login: string): Promise<void> {
  const { csrfToken } = (await (await request.get('/api/auth/csrf')).json()) as { csrfToken: string }
  const res = await request.post('/api/auth/callback/test-login', {
    form: { csrfToken, id, name, login, email: `${id}@test-login.invalid`, as: 'github', callbackUrl: '/' },
    maxRedirects: 0,
  })
  expect(res.status()).toBe(302)
  expect(res.headers()['location']).not.toContain('error')
}

async function openMyProfile(page: Page): Promise<string> {
  await page.getByTestId('menubar-account').click()
  await page.locator('[data-stave-menu-item]', { hasText: 'My Profile' }).click()
  const profile = page.locator('[data-gallery-profile]')
  await expect(profile).toBeVisible({ timeout: 15_000 })
  return (await profile.getAttribute('data-gallery-profile')) ?? ''
}

const profileName = (page: Page) => page.locator('[data-gallery-profile] .sg-profile-name').first()

test.describe('Reserved names (#2368)', () => {
  test('a refused rename says what to do in the editor; a good rename then saves', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const id = `rename-${RUN}`
    await signIn(request, id, `Ada ${RUN}`, id)
    await page.context().addCookies((await request.storageState()).cookies)
    await bootApp(page)
    const authorId = await openMyProfile(page)
    await expect(profileName(page)).toHaveText(`Ada ${RUN}`)

    const puts: number[] = []
    page.on('response', (r) => {
      if (r.request().method() === 'PUT' && r.url().includes(`/api/gallery/authors/${authorId}`)) puts.push(r.status())
    })

    await page.locator('[data-gallery-edit-profile]').click()
    const editor = page.locator('[data-gallery-profile-editor]')
    const nameBox = editor.getByLabel('Display name')
    const errors = editor.locator('[data-gallery-form-errors]')
    const save = editor.getByRole('button', { name: 'Save' })

    // ── each of these is refused where the other errors show, and the editor stays open ──
    for (const bad of ['Stave', 'S t a v e', 'ＳＴＡＶＥ', 'Ѕtave', 'stave-team', 'The Stave Team']) {
      await nameBox.fill(bad)
      await save.click()
      await expect(errors).toHaveText(`Sorry, ${REFUSAL}.`)
      await expect(editor).toBeVisible()
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/reserved-name-refused.png` })

    // ── the server says the same on its own, without the form's help ──
    const direct = await page.evaluate(
      async ({ authorId, name }) => {
        const res = await fetch(`/api/gallery/authors/${authorId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, bio: '' }),
        })
        return { status: res.status, body: await res.json() }
      },
      { authorId, name: 'Ѕtave' },
    )
    expect(direct).toEqual({ status: 400, body: { error: REFUSAL } })
    puts.length = 0

    // ── a real name that starts the same way saves ──
    await nameBox.fill('Stavros')
    await save.click()
    await expect(profileName(page)).toHaveText('Stavros')
    await expect(editor).toHaveCount(0)
    expect(puts).toEqual([200])
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/reserved-name-good-rename.png` })

    // ── and it is what the server now holds ──
    const page2 = await (await request.get(`/api/gallery/authors/${authorId}`)).json()
    expect(page2.author.name).toBe('Stavros')
  })

  test('an account really named Stave signs in and gets the normal fallback, then can edit its profile', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const id = `stave-${RUN}`
    await signIn(request, id, 'Stave', 'stave')
    await page.context().addCookies((await request.storageState()).cookies)
    await bootApp(page)
    await openMyProfile(page)
    await expect(profileName(page)).toHaveText('New artist')
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/reserved-name-fallback.png` })

    await page.locator('[data-gallery-edit-profile]').click()
    const editor = page.locator('[data-gallery-profile-editor]')
    await editor.getByLabel('Display name').fill('Mjay')
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(profileName(page)).toHaveText('Mjay')
  })
})

// #2450 — the six in the issue, as escapes so the list can be read.
const INVISIBLE = ['​', '‍', '⁠', '­', 'ㅤ', '⠀']
const BLANK_FORM = 'Your name needs a letter, number or symbol you can see.'
const BLANK_SERVER = 'name has nothing you can see in it, so please add a letter, number or symbol'

test.describe('Names with nothing visible in them (#2450)', () => {
  test('the editor and the server refuse each one; the name stays as it was', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const id = `blank-${RUN}`
    await signIn(request, id, `Ada ${RUN}`, id)
    await page.context().addCookies((await request.storageState()).cookies)
    await bootApp(page)
    const authorId = await openMyProfile(page)

    await page.locator('[data-gallery-edit-profile]').click()
    const editor = page.locator('[data-gallery-profile-editor]')
    const nameBox = editor.getByLabel('Display name')
    const errors = editor.locator('[data-gallery-form-errors]')
    for (const bad of INVISIBLE) {
      await nameBox.fill(bad)
      await editor.getByRole('button', { name: 'Save' }).click()
      await expect(errors).toHaveText(BLANK_FORM)
      await expect(editor).toBeVisible()
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/blank-name-refused.png` })

    const direct = await page.evaluate(
      async ({ authorId, names }) => {
        const out: Array<{ status: number; error: string }> = []
        for (const name of names) {
          const res = await fetch(`/api/gallery/authors/${authorId}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, bio: '' }),
          })
          out.push({ status: res.status, error: ((await res.json()) as { error: string }).error })
        }
        return out
      },
      { authorId, names: INVISIBLE },
    )
    expect(direct).toEqual(INVISIBLE.map(() => ({ status: 400, error: BLANK_SERVER })))
    const held = await (await request.get(`/api/gallery/authors/${authorId}`)).json()
    expect(held.author.name).toBe(`Ada ${RUN}`)
  })

  // #2465 — a name like that stored before the rule shows as "Unnamed artist":
  // on its card, its entry's page and its profile. The seed route writes it
  // straight onto the row, as no door can now.
  test('one stored before the rule shows as Unnamed artist on the card, the entry and the profile', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const title = `Blank author ${RUN}`
    const res = await request.post('/api/test-seed', { data: { title, collectionTitle: `Blank EP ${RUN}`, authorName: 'ㅤ' } })
    expect(res.status(), await res.text()).toBe(201)
    const { entryId, authorId } = (await res.json()) as { entryId: string; authorId: string }

    await bootApp(page)
    await page.getByRole('button', { name: 'View', exact: true }).click()
    await page.getByText('Community Gallery...', { exact: true }).click()
    await page.locator('[data-gallery-filter="music"]').click()
    const card = page.locator(`[data-gallery-card="${entryId}"]`)
    await expect(card.locator(`[data-gallery-author-link="${authorId}"]`)).toHaveText('Unnamed artist', { timeout: 30_000 })
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/blank-name-card.png` })

    await card.click()
    const detail = page.locator(`[data-gallery-detail="${entryId}"]`)
    await expect(detail.locator(`[data-gallery-author-link="${authorId}"]`)).toHaveText('Unnamed artist')
    await detail.locator(`[data-gallery-author-link="${authorId}"]`).click()
    await expect(profileName(page)).toHaveText('Unnamed artist')
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/blank-name-profile.png` })
  })

  test('an account whose name shows nothing signs in under its login', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const id = `blank-login-${RUN}`
    await signIn(request, id, 'ㅤ', id)
    await page.context().addCookies((await request.storageState()).cookies)
    await bootApp(page)
    await openMyProfile(page)
    await expect(profileName(page)).toHaveText(id)
  })
})
