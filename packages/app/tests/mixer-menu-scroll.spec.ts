/**
 * A Mixer menu and a scroll of the panel it sits in (#2088).
 *
 * The sound menu is placed from its trigger's position, so a scroll that moves
 * the trigger must not leave it floating. It used to close on ANY outside
 * scroll — and the browser delivers `scroll` a frame late, so a wheel flick
 * just before the click closed the menu the moment it opened (0 of 5 opens on
 * main). Now: a scroll that did not move the trigger is ignored, one that moved
 * it carries the menu along, one that took it out of view closes it.
 *
 * Driven with the real wheel and the real click. A trackpad's momentum is the
 * device case this stands in for.
 */
import { test, expect, type Page } from '@playwright/test'

import { bootApp, seedCode } from './_appBoot'

const TRIGGER = '[data-mixer-sound-trigger="instrument"]'
const MENU = '[data-mixer-sound-menu="instrument"]'

async function openPatternTab(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 })
  await bootApp(page)
  await seedCode(page, 'note("c3 e3 g3")')
  const drawer = page.locator('[data-bottom-panel="root"]')
  await drawer.locator('[data-bottom-panel="toggle"]').click()
  await drawer.locator('role=tab[name="Pattern"]').click()
  await page.locator(TRIGGER).waitFor()
}

async function bodyBox(page: Page) {
  const box = await page.locator('[data-mixer-body]').boundingBox()
  if (!box) throw new Error('no mixer body')
  return box
}

test('a wheel scroll just before the click does not close the menu it opens', async ({ page }) => {
  await openPatternTab(page)
  const body = await bodyBox(page)
  // The fixture must actually scroll, or the arm proves nothing.
  expect(await page.locator('[data-mixer-body]').evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(40)

  let opened = 0
  for (let trial = 0; trial < 5; trial++) {
    await page.keyboard.press('Escape')
    await page.locator('[data-mixer-body]').evaluate((el) => { el.scrollTop = 0 })
    await page.waitForTimeout(250)
    await page.mouse.move(body.x + body.width / 2, body.y + 20)
    await page.mouse.wheel(0, 40)
    const t = await page.locator(TRIGGER).boundingBox()
    if (!t) throw new Error('no trigger')
    await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2)
    await page.waitForTimeout(400)
    if (await page.locator(MENU).isVisible()) opened++
  }
  expect(opened).toBe(5)
})

test('scrolling the panel carries the open menu with its trigger, and closes it once the trigger is out of view', async ({ page }) => {
  await openPatternTab(page)
  const body = await bodyBox(page)
  await page.locator(TRIGGER).click()
  await expect(page.locator(MENU)).toBeVisible()

  const gap = async () => {
    const t = await page.locator(TRIGGER).boundingBox()
    const m = await page.locator(MENU).boundingBox()
    if (!t || !m) throw new Error('missing box')
    return { triggerTop: t.y, menuTopMinusTriggerBottom: m.y - (t.y + t.height) }
  }
  const before = await gap()

  // A small scroll: the trigger moves but stays in view. Wheel in the strip at
  // the bottom of the panel — the open menu flips up over the rest of it, and a
  // wheel over the menu scrolls its own list instead.
  const m = await page.locator(MENU).boundingBox()
  const wheelAt = { x: body.x + 20, y: body.y + body.height - 8 }
  expect(wheelAt.y).toBeGreaterThan(m!.y + m!.height)
  await page.mouse.move(wheelAt.x, wheelAt.y)
  await page.mouse.wheel(0, 30)
  await page.waitForTimeout(300)
  const after = await gap()
  expect(after.triggerTop).toBeLessThan(before.triggerTop - 10)
  await expect(page.locator(MENU)).toBeVisible()
  // still attached: the same distance below its trigger as when it opened
  expect(Math.abs(after.menuTopMinusTriggerBottom - before.menuTopMinusTriggerBottom)).toBeLessThan(2)

  // Scroll the trigger out of the panel's view: the menu closes.
  await page.mouse.move(wheelAt.x, wheelAt.y)
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(300)
  const t = await page.locator(TRIGGER).boundingBox()
  expect(t!.y + t!.height).toBeLessThanOrEqual(body.y + 1)
  await expect(page.locator(MENU)).toHaveCount(0)
})
