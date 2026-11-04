import { test, expect, type Page, type Request } from '@playwright/test'

import { bootApp, evalCode, stopCode } from './_appBoot'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/**
 * #2301 / #2305 — Publish to Gallery, driven from the command palette.
 *
 * The gallery's server routes are not on this branch, so POST /api/gallery is
 * answered here, and the test reads exactly what the dialog sent: the fields it
 * should carry, nothing it shouldn't, the email included (the server keeps it
 * private; the browser still has to send it).
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
    await expect(dialog).toContainText('Your email stays private')
    await expect(dialog).toContainText('clearing site data loses it')
    // the title starts as the project's name
    await expect(page.getByTestId('gallery-publish-title')).not.toHaveValue('')

    // #2305 — a frame of the running viz, shown so the author sees what goes with it
    const img = page.getByTestId('gallery-publish-thumbnail-img')
    await expect(img).toBeVisible({ timeout: 15_000 })
    const shown = await img.evaluate((i: HTMLImageElement) => ({ w: i.naturalWidth, src: i.src }))
    expect(shown.w).toBeLessThanOrEqual(480)
    if (SHOTS) await dialog.screenshot({ path: `${SHOTS}/gallery-publish-dialog.png` })

    await page.getByTestId('gallery-publish-name').fill('Ada')
    await page.getByTestId('gallery-publish-email').fill('ada@example.com')
    await page.getByTestId('gallery-publish-title').fill('Night drive')
    await page.getByTestId('gallery-publish-tags').fill('ambient, Drums, ambient')
    await page.getByTestId('gallery-publish-submit').click()

    const toast = page.locator('[data-testid="toast"]', { hasText: 'Published "Night drive"' })
    await expect(toast).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toHaveCount(0)
    await stopCode(page)

    expect(seen).toHaveLength(1)
    const body = seen[0].postDataJSON() as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['authorEmail', 'authorName', 'kind', 'manifest', 'tags', 'thumbnail', 'title'])
    expect(body).toMatchObject({
      title: 'Night drive',
      kind: 'project',
      tags: ['ambient', 'Drums'],
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
    })
    const manifest = body.manifest as { schemaVersion: number; files: unknown[] }
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.files.length).toBeGreaterThan(1)
    // the picture sent is the one shown
    expect(body.thumbnail).toBe(shown.src)
    expect(String(body.thumbnail)).toMatch(/^data:image\/(webp|png);base64,/)

    const shares = await localShares(page)
    expect(shares).toHaveLength(1)
    expect(shares[0]).toMatchObject({ id: 'AbCdEfGhIjK', title: 'Night drive', kind: 'project', manageToken: 'tok-123' })
    expect(await localAuthor(page)).toEqual({ name: 'Ada', email: 'ada@example.com' })
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/#gallery=AbCdEfGhIjK$/)
  })

  test('a music entry sends one file and no picture; the remembered author is filled in', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('stave.gallery.author', JSON.stringify({ name: 'Ada', email: 'ada@example.com' }))
    })
    await bootApp(page)
    const seen = answerPublish(page)
    await openPublish(page)
    await expect(page.getByTestId('gallery-publish-name')).toHaveValue('Ada')
    await expect(page.getByTestId('gallery-publish-email')).toHaveValue('ada@example.com')

    await page.getByTestId('gallery-publish-kind-music').click()
    await expect(page.getByTestId('gallery-publish-thumbnail')).toContainText('card with the title')
    const fileId = await page.getByTestId('gallery-publish-file').inputValue()
    await page.getByTestId('gallery-publish-submit').click()
    await expect(page.locator('[data-testid="toast"]', { hasText: 'Published' })).toBeVisible({ timeout: 10_000 })

    const body = seen[0].postDataJSON() as { kind: string; thumbnail?: string; manifest: { files: Array<{ id: string; language: string }> } }
    expect(body.kind).toBe('music')
    expect(body.thumbnail).toBeUndefined()
    expect(body.manifest.files.map((f) => f.id)).toEqual([fileId])
    expect(['strudel', 'sonicpi']).toContain(body.manifest.files[0].language)
  })

  test('a bad email is caught before upload, and a server refusal is shown and nothing is kept', async ({ page }) => {
    await bootApp(page)
    const seen = answerPublish(page, 429, { error: 'slow down' })
    await openPublish(page)
    await page.getByTestId('gallery-publish-name').fill('Ada')
    await page.getByTestId('gallery-publish-email').fill('ada-at-example')
    await page.getByTestId('gallery-publish-submit').click()
    await expect(page.getByTestId('gallery-publish-errors')).toContainText("doesn't look complete")
    expect(seen).toHaveLength(0)

    await page.getByTestId('gallery-publish-email').fill('ada@example.com')
    await page.getByTestId('gallery-publish-submit').click()
    await expect(page.getByTestId('gallery-publish-errors')).toContainText('published several times')
    expect(seen).toHaveLength(1)
    await expect(page.getByTestId('gallery-publish-submit')).toBeEnabled()
    expect(await localShares(page)).toEqual([])
    expect(await localAuthor(page)).toBeNull()
  })
})
