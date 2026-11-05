/**
 * Community gallery on a phone (#2300): reachable from the phone's menu, fills
 * the screen, and an entry can be read and opened by tapping.
 */
import { test, expect } from '@playwright/test'
import { editorValue, waitForEditorLoaded } from './_appBoot'
import { COUNTER_LINE, MUSIC_CODE, routeGallery } from './_gallery'

test('the gallery opens from a #gallery link, browses, and opens an entry by tapping', async ({ page }) => {
  await routeGallery(page)
  await page.goto('/#gallery=musc1CCCCCC')
  await waitForEditorLoaded(page)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })

  const overlay = page.locator('[data-gallery="overlay"]')
  await expect(page.locator('[data-gallery-detail="musc1CCCCCC"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-gallery-code="floor.strudel"]')).toContainText(COUNTER_LINE)

  // it fits the screen, and on a narrow one it takes the whole width
  const vp = page.viewportSize()!
  const box = (await page.getByRole('dialog', { name: 'Community Gallery' }).boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5)
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5)
  if (vp.width <= 640) expect(box.width).toBeGreaterThanOrEqual(vp.width - 1)
  if (process.env.GALLERY_SHOTS) await page.screenshot({ path: `${process.env.GALLERY_SHOTS}/phone-detail-${test.info().project.name}.png` })

  await page.getByRole('button', { name: '← Back to the gallery' }).tap()
  await page.locator('[data-gallery-tab="project"]').tap()
  await expect(page.locator('[data-gallery-card]')).toHaveCount(2)
  if (process.env.GALLERY_SHOTS) await page.screenshot({ path: `${process.env.GALLERY_SHOTS}/phone-grid-${test.info().project.name}.png` })

  await page.locator('[data-gallery-card="proj1AAAAAA"]').tap()
  await page.getByRole('button', { name: 'Open as new project' }).tap()
  await expect(overlay).toHaveCount(0)
  await expect.poll(() => editorValue(page), { timeout: 20_000 }).toBe(MUSIC_CODE)
  expect(await page.evaluate(() => (window as unknown as { __galleryRuns?: number }).__galleryRuns ?? 0)).toBe(0)
})
