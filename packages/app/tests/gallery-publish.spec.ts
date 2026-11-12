import { test, expect, type Page, type Request } from '@playwright/test'

import { bootApp, evalCode, stopCode } from './_appBoot'
import { ADA_SESSION_USER, routeSession } from './_gallery'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/**
 * #2301 / #2305 — Publish to Gallery, driven from the command palette.
 *
 * POST /api/gallery is answered here, and the test reads exactly what the dialog
 * sent: the fields it should carry and nothing it shouldn't.
 *
 * #2319 — publishing needs sign-in. GET /api/gallery/me is answered here too
 * (signed in as Ada, signed out, or no sign-in on the site); no name or email
 * is sent any more — the server takes both from the session. The real sign-in
 * round trip is gallery-sign-in.spec.ts.
 */

const SHOTS = process.env.GALLERY_SHOT_DIR

async function openPublish(page: Page): Promise<void> {
  await page.keyboard.press(`${MOD}+Shift+P`)
  const input = page.getByPlaceholder('Type a command...')
  await input.fill('Publish to Gallery')
  await expect(page.locator('[data-palette-row]', { hasText: 'Publish to Gallery' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('gallery-publish-dialog')).toBeVisible()
}

function answerPublish(page: Page, status = 201, body: unknown = { id: 'AbCdEfGhIjK', manageToken: 'tok-123' }) {
  const seen: Request[] = []
  void page.route('**/api/gallery', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    seen.push(route.request())
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return seen
}

const localShares = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('stave.gallery.shares') ?? '[]'))
const localAuthor = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('stave.gallery.author') ?? 'null'))

test.describe('Publish to Gallery (#2301)', () => {
  test('publishes the project with a picture of the running viz, and keeps the key here', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await routeSession(page, ADA_SESSION_USER)
    await bootApp(page)
    // The starter pins a viz behind its song; playing it gives the dialog a frame to take.
    // Wait until that viz has drawn, read the same way the dialog reads it.
    await evalCode(page)
    await page.waitForFunction(
      () => {
        const c = document.querySelector<HTMLCanvasElement>('[data-testid^="compiled-viz-mount-"] canvas')
        if (!c || !c.width) return false
        const t = document.createElement('canvas')
        t.width = 16
        t.height = 16
        const x = t.getContext('2d')!
        x.drawImage(c, 0, 0, 16, 16)
        const d = x.getImageData(0, 0, 16, 16).data
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8 && (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8)) return true
        return false
      },
      null,
      { timeout: 30_000 },
    )
    const seen = answerPublish(page)

    await openPublish(page)
    const dialog = page.getByTestId('gallery-publish-dialog')
    await expect(page.getByTestId('gallery-publish-as')).toContainText('Publishing as Ada (GitHub @ada)')
    await expect(page.getByTestId('gallery-publish-name')).toHaveCount(0)
    await expect(page.getByTestId('gallery-publish-email')).toHaveCount(0)
    // the title starts as the project's name
    await expect(page.getByTestId('gallery-publish-title')).not.toHaveValue('')

    // #2305 — a frame of the running viz, shown so the author sees what goes with it
    const img = page.getByTestId('gallery-publish-thumbnail-img')
    await expect(img).toBeVisible({ timeout: 15_000 })
    const shown = await img.evaluate((i: HTMLImageElement) => ({ w: i.naturalWidth, src: i.src }))
    expect(shown.w).toBeLessThanOrEqual(480)
    if (SHOTS) await dialog.screenshot({ path: `${SHOTS}/gallery-publish-dialog.png` })

    await page.getByTestId('gallery-publish-title').fill('Night drive')
    await page.getByTestId('gallery-publish-tags').fill('ambient, Drums, ambient')
    await page.getByTestId('gallery-publish-submit').click()

    const toast = page.locator('[data-testid="toast"]', { hasText: 'Published "Night drive"' })
    await expect(toast).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toHaveCount(0)
    await stopCode(page)

    expect(seen).toHaveLength(1)
    const body = seen[0].postDataJSON() as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['kind', 'manifest', 'recording', 'tags', 'thumbnail', 'title'])
    // #2487 — what the patterns play, recorded here by the author's own Stave
    const rec = body.recording as { v: number; cover: string | null; contents: { patterns: number }; files: Array<{ path: string; cycles: number; lanes: unknown[]; events: unknown[] }> }
    expect(rec.v).toBe(1)
    expect(rec.contents.patterns).toBeGreaterThan(0)
    expect(rec.files.length).toBeGreaterThan(0)
    expect(rec.files[0].events.length).toBeGreaterThan(0)
    expect(rec.files.map((f) => f.path)).toContain(rec.cover)
    expect(body).toMatchObject({ title: 'Night drive', kind: 'project', tags: ['ambient', 'Drums'] })
    const manifest = body.manifest as { schemaVersion: number; files: unknown[] }
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.files.length).toBeGreaterThan(1)
    // the picture sent is the one shown
    expect(body.thumbnail).toBe(shown.src)
    expect(String(body.thumbnail)).toMatch(/^data:image\/(webp|png);base64,/)

    const shares = await localShares(page)
    expect(shares).toHaveLength(1)
    expect(shares[0]).toMatchObject({ id: 'AbCdEfGhIjK', title: 'Night drive', kind: 'project', manageToken: 'tok-123' })
    // #2319 — the session is the identity; nothing about the author is kept here.
    expect(await localAuthor(page)).toBeNull()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/#gallery=AbCdEfGhIjK$/)
  })

  test('a music entry sends one file and no picture', async ({ page }) => {
    await routeSession(page, ADA_SESSION_USER)
    await bootApp(page)
    const seen = answerPublish(page)
    await openPublish(page)
    await expect(page.getByTestId('gallery-publish-as')).toBeVisible()

    await page.getByTestId('gallery-publish-kind-music').click()
    await expect(page.getByTestId('gallery-publish-thumbnail')).toContainText('draws what it plays')
    const fileId = await page.getByTestId('gallery-publish-file').inputValue()
    await page.getByTestId('gallery-publish-submit').click()
    await expect(page.locator('[data-testid="toast"]', { hasText: 'Published' })).toBeVisible({ timeout: 10_000 })

    const body = seen[0].postDataJSON() as { kind: string; thumbnail?: string; manifest: { files: Array<{ id: string; language: string }> } }
    expect(body.kind).toBe('music')
    expect(body.thumbnail).toBeUndefined()
    expect(body.manifest.files.map((f) => f.id)).toEqual([fileId])
    // #2487 — and what it plays, its one file the cover
    const rec = (body as unknown as { recording: { cover: string; files: Array<{ path: string; lanes: unknown[]; events: unknown[] }> } }).recording
    expect(rec.files).toHaveLength(1)
    expect(rec.cover).toBe(rec.files[0].path)
    expect(rec.files[0].lanes.length).toBeGreaterThan(0)
    expect(['strudel', 'sonicpi']).toContain(body.manifest.files[0].language)
  })

  // #2330 — only against a server started with NEXT_PUBLIC_TURNSTILE_SITE_KEY
  // (Cloudflare's always-pass test key 1x00000000000000000000AA): the widget
  // loads under the app's cross-origin isolation, hands out a token, and the
  // token goes with the publish in the cf-turnstile-response header.
  test('#2330 with Turnstile set up, the check loads in the dialog and its token goes with the publish', async ({ page }) => {
    await routeSession(page, ADA_SESSION_USER)
    await bootApp(page)
    const seen = answerPublish(page)
    await openPublish(page)
    const widget = page.getByTestId('gallery-publish-turnstile')
    test.skip((await widget.count()) === 0, 'Turnstile is not set up on this server')

    // The widget is Cloudflare's iframe, inside a closed shadow root, so it is
    // found among the page's frames rather than by selector. Until it hands out
    // a token, Publish waits; the test key passes on its own.
    await expect
      .poll(() => page.frames().some((f) => f.url().startsWith('https://challenges.cloudflare.com/')), { timeout: 20_000 })
      .toBe(true)
    await expect(widget).toHaveAttribute('data-turnstile-status', 'ready')
    await expect(page.getByTestId('gallery-publish-submit')).toBeEnabled({ timeout: 20_000 })
    expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true)
    if (SHOTS) await page.getByTestId('gallery-publish-dialog').screenshot({ path: `${SHOTS}/publish-turnstile.png` })
    await page.getByTestId('gallery-publish-title').fill('Night drive')
    await page.getByTestId('gallery-publish-submit').click()
    await expect(page.getByTestId('gallery-publish-dialog')).toHaveCount(0)
    expect(seen).toHaveLength(1)
    expect(seen[0].headers()['cf-turnstile-response']).toBe('XXXX.DUMMY.TOKEN.XXXX')
  })

  test('a blank title is caught before upload, and a server refusal is shown and nothing is kept', async ({ page }) => {
    await routeSession(page, ADA_SESSION_USER)
    await bootApp(page)
    // #2330 — the server's own 429 message is what the dialog shows.
    const seen = answerPublish(page, 429, {
      error: "you've published 10 times in an hour, which is the most allowed; try again in 23 minutes",
    })
    await openPublish(page)
    await page.getByTestId('gallery-publish-title').fill('   ')
    await page.getByTestId('gallery-publish-submit').click()
    await expect(page.getByTestId('gallery-publish-errors')).toContainText('Add a title.')
    expect(seen).toHaveLength(0)

    await page.getByTestId('gallery-publish-title').fill('Night drive')
    await page.getByTestId('gallery-publish-submit').click()
    await expect(page.getByTestId('gallery-publish-errors')).toContainText(
      "you've published 10 times in an hour, which is the most allowed; try again in 23 minutes",
    )
    expect(seen).toHaveLength(1)
    await expect(page.getByTestId('gallery-publish-submit')).toBeEnabled()
    expect(await localShares(page)).toEqual([])
    expect(await localAuthor(page)).toBeNull()
  })

  test('#2319 signed out, the dialog asks you to sign in, offering only the configured providers', async ({ page }) => {
    await routeSession(page, null, [{ id: 'github', name: 'GitHub' }])
    await bootApp(page)
    const seen = answerPublish(page)
    await openPublish(page)
    const gate = page.getByTestId('gallery-publish-signin')
    await expect(gate).toContainText('Sign in to publish to the gallery.')
    await expect(page.getByTestId('gallery-publish-signin-github')).toHaveText('Sign in with GitHub')
    await expect(page.getByTestId('gallery-publish-signin-google')).toHaveCount(0)
    await expect(page.getByTestId('gallery-publish-submit')).toHaveCount(0)
    expect(seen).toHaveLength(0)
  })

  test('#2319 with no sign-in set up on the site, the dialog says so and offers none', async ({ page }) => {
    await routeSession(page, 'unavailable')
    await bootApp(page)
    await openPublish(page)
    await expect(page.getByTestId('gallery-publish-signin-unavailable')).toContainText("sign-in isn't set up on this site")
    await expect(page.locator('[data-testid^="gallery-publish-signin-"]')).toHaveCount(1)
    await expect(page.getByTestId('gallery-publish-submit')).toHaveCount(0)
  })
})
