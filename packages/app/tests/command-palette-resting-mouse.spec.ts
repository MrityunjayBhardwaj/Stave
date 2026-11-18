import { test, expect, type Page } from '@playwright/test'

import { bootApp } from './_appBoot'
import { ADA_SESSION_USER, routeSession } from './_gallery'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/**
 * #2614 — the command palette's highlight follows the mouse only when the mouse
 * moves. A pointer resting where the palette opens used to take the highlight
 * (the browser reports the row under a still pointer as hovered when rows are
 * drawn beneath it), so Enter ran that row instead of the top match, or, when
 * the list had filtered past it, ran nothing at all.
 *
 * Signed in, so "File: Publish to Gallery…" opens its dialog: the top match for
 * "Pu", and an effect anyone can see.
 */

test.use({ viewport: { width: 1280, height: 800 } })

/** Where the mouse rests: over the palette's list, a few rows down, once it opens. */
const REST = { x: 640, y: 330 }

const INPUT = 'Type a command...'
const row = (page: Page, text: string) => page.locator('[data-palette-row]', { hasText: text })
const highlighted = (page: Page) => page.locator('[data-palette-row][data-palette-active]')

/** Open the palette with the mouse resting over it, and prove it rests on a lower row. */
async function openUnderRestingMouse(page: Page): Promise<void> {
  await page.mouse.move(REST.x, REST.y)
  await page.keyboard.press(`${MOD}+Shift+P`)
  await expect(page.getByPlaceholder(INPUT)).toBeFocused()
  // the precondition the bug needs: the still pointer is over a row below the top one
  // (polled: the palette draws its full list a render after it opens)
  await expect.poll(
    () => page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)?.closest('[data-palette-row]')
      return el ? Number(el.getAttribute('data-palette-row')) : -1
    }, REST),
    { message: 'the resting pointer should be over a row below the top one' },
  ).toBeGreaterThan(0)
}

test.describe('command palette with a resting mouse (#2614)', () => {
  test.beforeEach(async ({ page }) => {
    await routeSession(page, ADA_SESSION_USER)
    await bootApp(page)
  })

  test('typing at a person\'s speed keeps the top match highlighted, and Enter runs it', async ({ page }) => {
    await openUnderRestingMouse(page)
    await page.keyboard.type('Pu', { delay: 70 })
    await expect(row(page, 'Search Documentation')).toBeVisible()
    // several rows match, and one of them now sits under the pointer
    expect(await page.locator('[data-palette-row]').count()).toBeGreaterThan(1)
    await expect(highlighted(page)).toHaveCount(1)
    await expect(highlighted(page)).toHaveAttribute('data-palette-row', '0')
    await expect(highlighted(page)).toContainText('Publish to Gallery')

    await page.keyboard.press('Enter')
    await expect(page.getByTestId('gallery-publish-dialog')).toBeVisible()
    await expect(page.getByTestId('docs-search-modal')).toHaveCount(0)
  })

  test('moving the mouse onto a row still highlights it, and Enter runs that row', async ({ page }) => {
    await openUnderRestingMouse(page)
    await page.keyboard.type('Pu', { delay: 70 })
    const docs = row(page, 'Search Documentation')
    const box = (await docs.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 })
    await expect(highlighted(page)).toContainText('Search Documentation')

    await page.keyboard.press('Enter')
    await expect(page.getByTestId('docs-search-modal')).toBeVisible()
    await expect(page.getByTestId('gallery-publish-dialog')).toHaveCount(0)
  })
})
