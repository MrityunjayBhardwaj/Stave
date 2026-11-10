import { test, expect } from '@playwright/test'

/**
 * #2402 — the privacy policy has to be readable and findable, or Google's
 * consent screen check and the people it is for can't use it. The layout's
 * loading screen covers every page until the app removes it, and this page has
 * no app, so "visible" here means nothing is sitting on top of it.
 */

test('reads without any script, with the loading screen out of the way', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 390, height: 700 } })
  const page = await context.newPage()
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible()
  await expect(page.locator('#stave-preloader')).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Changes to this page' })).toBeAttached()
  await context.close()
})

test('with scripts on, nothing covers the page and it scrolls to its last section', async ({ page }) => {
  await page.goto('/privacy')
  const last = page.getByRole('heading', { name: 'Changes to this page' })
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport()
  const onTop = await last.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return document.elementFromPoint(r.left + 4, r.top + 4) === el
  })
  expect(onTop).toBe(true)
})

test('the home page links to the policy in its server HTML', async ({ request }) => {
  const html = await (await request.get('/')).text()
  expect(html).toContain('href="/privacy"')
})
