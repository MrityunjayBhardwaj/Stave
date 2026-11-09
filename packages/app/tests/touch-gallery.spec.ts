/**
 * Community gallery on a phone (#2300): reachable from the phone's menu, fills
 * the screen, and an entry can be read and opened by tapping.
 *
 * #2473 — phones keep the full-screen gallery; a tablet isn't a phone, so there
 * the gallery opens as a workspace tab. Which one each project gets is fixed
 * here by project name, not by re-deriving the app's phone rule.
 */
import { test, expect } from '@playwright/test'
import { editorValue, waitForEditorLoaded } from './_appBoot'
import { COUNTER_LINE, MUSIC_CODE, routeGallery } from './_gallery'

test('the gallery opens from a #gallery link, browses, and opens an entry by tapping', async ({ page }) => {
  await routeGallery(page)
  const phone = ['phone', 'phone-sideways'].includes(test.info().project.name)
  await page.goto('/#gallery=musc1CCCCCC')
  // On a tablet the link opens the gallery TAB in front, so no code editor is
  // drawn to wait for; nothing is seeded here, so the shell being up is enough.
  if (phone) await waitForEditorLoaded(page)
  else await page.locator('[data-bottom-panel="root"]').waitFor({ state: 'attached', timeout: 30_000 })
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })

  const gallery = phone ? page.getByRole('dialog', { name: 'Community Gallery' }) : page.locator('[data-gallery="tab"]')
  await expect(page.locator('[data-gallery="overlay"]')).toHaveCount(phone ? 1 : 0)
  await expect(page.locator('[data-workspace-tab="app-gallery"]')).toHaveCount(phone ? 0 : 1)
  await expect(page.locator('[data-gallery-detail="musc1CCCCCC"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[data-gallery-code="floor.strudel"]')).toContainText(COUNTER_LINE)

  // it fits the screen, and on a narrow one it takes the whole width
  const vp = page.viewportSize()!
  const box = (await gallery.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5)
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5)
  if (phone && vp.width <= 640) expect(box.width).toBeGreaterThanOrEqual(vp.width - 1)
  if (process.env.GALLERY_SHOTS) await page.screenshot({ path: `${process.env.GALLERY_SHOTS}/phone-detail-${test.info().project.name}.png` })

  // #2491 — the main actions sit in a sheet at the bottom of the gallery, while the page scrolls under it
  const sheetBox = (await page.locator('[data-gallery-actions]').boundingBox())!
  const pageBox = (await page.locator('.sg-entry-page').boundingBox())!
  // (only when narrow: a wide page, a phone held sideways too, has the actions in its side column)
  if (pageBox.width <= 760) expect(Math.abs(sheetBox.y + sheetBox.height - (pageBox.y + pageBox.height))).toBeLessThan(2)
  else expect(sheetBox.x).toBeGreaterThan(pageBox.x + pageBox.width / 2)
  await page.locator('[data-gallery-crumb="gallery"]').tap()
  // #2486 — search, then the filter with the sort beside it, on one row
  const search = page.getByLabel('Search the gallery')
  const filters = page.locator('[data-gallery-filter]')
  const sort = page.locator('[data-gallery-sort]')
  await expect(page.locator('[data-gallery-card]')).toHaveCount(4)
  const [sb, fb, ob] = [await search.boundingBox(), await filters.first().boundingBox(), await sort.boundingBox()]
  expect(fb!.y).toBeGreaterThan(sb!.y + sb!.height - 1)
  expect(Math.abs(ob!.y + ob!.height / 2 - (fb!.y + fb!.height / 2))).toBeLessThan(8)
  expect(ob!.x + ob!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5)
  await page.locator('[data-gallery-filter="project"]').tap()
  await expect(page.locator('[data-gallery-card]')).toHaveCount(2)
  await sort.selectOption({ label: 'Oldest' })
  await expect
    .poll(() => page.locator('[data-gallery-card]').evaluateAll((els) => els.map((el) => el.getAttribute('data-gallery-card'))))
    .toEqual(['proj2BBBBBB', 'proj1AAAAAA'])
  if (process.env.GALLERY_SHOTS) await page.screenshot({ path: `${process.env.GALLERY_SHOTS}/phone-grid-${test.info().project.name}.png` })

  await page.locator('[data-gallery-card="proj1AAAAAA"]').tap()
  await page.getByRole('button', { name: 'Open as new project' }).tap()
  // the overlay closes; a tab isn't carried into the new project's layout
  await expect(page.locator(phone ? '[data-gallery="overlay"]' : '[data-workspace-tab="app-gallery"]')).toHaveCount(0)
  await expect.poll(() => editorValue(page), { timeout: 20_000 }).toBe(MUSIC_CODE)
  expect(await page.evaluate(() => (window as unknown as { __galleryRuns?: number }).__galleryRuns ?? 0)).toBe(0)
})
