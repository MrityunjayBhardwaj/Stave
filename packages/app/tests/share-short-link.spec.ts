import { test, expect, type Browser, type Page } from '@playwright/test'

import { bootApp, editorValue, seedCode, waitForEditorLoaded } from './_appBoot'

/**
 * #2248 — Copy Share Link copies a short link, `/s/<id>#<key>`, and that link opens
 * the project in a browser that has never seen it.
 *
 * The second browser is a NEW context: no IndexedDB, no localStorage, nothing shared
 * with the first. So a project found there came through the link and the store.
 * The dev server's store is a folder in the OS temp dir (see api/share/store.ts).
 */

const SHORT = /^http:\/\/[^/]+\/s\/[A-Za-z0-9_-]{11}#[A-Za-z0-9_-]{22}$/

async function copyShareLink(page: Page): Promise<{ url: string; toast: string }> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.locator('[data-stave-menu-item]', { hasText: 'Copy Share Link' }).click()
  const toast = page.locator('[data-testid="toast"]', { hasText: 'Share link copied' }).last()
  await toast.waitFor({ timeout: 20_000 })
  const url = await page.evaluate(() => navigator.clipboard.readText())
  return { url, toast: (await toast.textContent()) ?? '' }
}

/** Open `url` in a fresh browser and import what it offers. */
async function openElsewhere(browser: Browser, url: string): Promise<Page> {
  const other = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  const { pathname, hash } = new URL(url)
  await other.goto(pathname + hash, { waitUntil: 'domcontentloaded' })
  await waitForEditorLoaded(other)
  return other
}

async function lastToast(page: Page): Promise<string> {
  const toast = page.locator('[data-testid="toast"]').filter({ hasNotText: /^Uncaught / }).last()
  await toast.waitFor({ timeout: 20_000 })
  return (await toast.textContent()) ?? ''
}

test.describe('short share links (#2248)', () => {
  test('Copy Share Link copies a short link that opens the project in another browser', async ({ page, browser }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await bootApp(page)
    const code = 's("bd ~ sd ~").gain(0.7) // shared by short link'
    await seedCode(page, code)

    const { url, toast } = await copyShareLink(page)
    expect(url).toMatch(SHORT)
    expect(url.length).toBeLessThan(80)
    expect(toast).not.toContain('long one')

    const other = await openElsewhere(browser, url)
    await other.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 30_000 })
    await expect.poll(() => editorValue(other), { timeout: 20_000 }).toBe(code)
    // the address goes back to the app's own page, so a refresh doesn't ask again
    await expect.poll(() => new URL(other.url()).pathname).toBe('/')
    expect(new URL(other.url()).hash).toBe('')
    await other.context().close()
  })

  test('a short link without its key says so instead of opening empty', async ({ page }) => {
    await bootApp(page)
    await seedCode(page, 's("hh*4") // keyless')
    const { url } = await copyShareLink(page)
    await page.goto(new URL(url).pathname, { waitUntil: 'domcontentloaded' })
    await waitForEditorLoaded(page)
    expect(await lastToast(page)).toContain('missing its key')
  })

  test('a short link nobody made says it was not found', async ({ page }) => {
    await page.goto(`/s/AAAAAAAAAAA#${'A'.repeat(22)}`, { waitUntil: 'domcontentloaded' })
    await waitForEditorLoaded(page)
    expect(await lastToast(page)).toContain("wasn't found")
  })

  test('when the store cannot take it, the long link is copied and still opens', async ({ page, browser }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await bootApp(page)
    const code = 's("cp*2") // shared by the long link'
    await seedCode(page, code)
    await page.route('**/api/share', (route) => route.fulfill({ status: 503, body: 'not set up' }))

    const { url, toast } = await copyShareLink(page)
    expect(url).toContain('/#share=')
    expect(toast).toContain('long one')

    const other = await openElsewhere(browser, url)
    await other.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 30_000 })
    await expect.poll(() => editorValue(other), { timeout: 20_000 }).toBe(code)
    await other.context().close()
  })

  // #2250 — the site's firewall answers 429 past 10 uploads in 10 minutes from one
  // visitor. The person still gets a working link, and is told why it's the long one.
  test('past the short-link limit, the long link is copied and the toast says why', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await bootApp(page)
    await seedCode(page, 's("hh*4") // shared past the limit')
    await page.route('**/api/share', (route) => route.fulfill({ status: 429, body: 'Too Many Requests' }))

    const { url, toast } = await copyShareLink(page)
    expect(url).toContain('/#share=')
    expect(toast).toContain('several short links in the last few minutes')
  })
})
