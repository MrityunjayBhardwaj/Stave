/**
 * Viz editor chrome bar layout (#773). The bar was consolidated: the ⚙ viz-
 * settings gear replaced the set-bg pill, and the source dropdown moved OFF the
 * bar into the popover.
 *
 * Bar order (#2046): ▶ Play → ↻ live → ⚙ settings → spacer. The live toggle sits next
 * to Play — the two you press while working — and the gear is at the end. (It was
 * Play → ⚙ → ↻ until then, the gear splitting the pair.)
 */
import { test, expect, type Page } from '@playwright/test'

const SHOTS = process.env.CHROME_SHOTS_DIR ?? '/tmp'

async function openVizFile(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('[data-workspace-shell="root"]').waitFor({ timeout: 15000 })
  await page.locator('.monaco-editor').waitFor({ timeout: 15000 })
  // Open a bundled .p5 preset via the file tree (bundled p5 fileIds contain "p5").
  const item = page.locator('[data-file-tree-item*="p5"]').first()
  await item.waitFor({ timeout: 10000 })
  await item.dblclick()
  await page.locator('[data-workspace-chrome="viz"]').first().waitFor({ timeout: 10000 })
}

test('bar shows ⚙ settings + ↻ live; source is off the bar (#773)', async ({ page }) => {
  await openVizFile(page)
  const chrome = page.locator('[data-workspace-chrome="viz"]').first()

  // Gear + live present on the bar.
  await expect(chrome.locator('[data-testid="viz-chrome-settings"]')).toHaveCount(1)
  await expect(chrome.locator('[data-testid="viz-chrome-live-toggle"]')).toHaveCount(1)
  // Source dropdown is NOT on the bar anymore (it lives in the popover).
  await expect(chrome.locator('[data-testid="viz-chrome-source"]')).toHaveCount(0)

  // DOM order: play → live → settings, with the flex spacer trailing (left-aligned).
  const order = await chrome.evaluate((el) => {
    const kids = Array.from(el.children)
    const idxOf = (sel: string) => kids.findIndex((k) => (k as HTMLElement).matches(sel) || k.querySelector(sel) != null)
    const spacerIdx = kids.findIndex(
      (k) => (k as HTMLElement).style.flex === '1' || (k as HTMLElement).style.flexGrow === '1',
    )
    return {
      play: idxOf('[data-testid="viz-chrome-open-preview"]'),
      settings: idxOf('[data-testid="viz-chrome-settings"]'),
      live: idxOf('[data-testid="viz-chrome-live-toggle"]'),
      spacer: spacerIdx,
    }
  })

  expect(order.play).toBeGreaterThanOrEqual(0)
  expect(order.live).toBeGreaterThan(order.play)
  expect(order.settings).toBeGreaterThan(order.live)
  expect(order.spacer).toBeGreaterThan(order.settings)

  // and on screen, left to right, with nothing overlapping
  const left = async (id: string): Promise<{ x: number; right: number }> => {
    const b = (await chrome.locator(`[data-testid="${id}"]`).boundingBox())!
    return { x: b.x, right: b.x + b.width }
  }
  const play = await left('viz-chrome-open-preview')
  const live = await left('viz-chrome-live-toggle')
  const gear = await left('viz-chrome-settings')
  expect(live.x).toBeGreaterThanOrEqual(play.right)
  expect(gear.x).toBeGreaterThanOrEqual(live.right)

  // the settings popover still opens under the gear, wherever the gear is
  await chrome.locator('[data-testid="viz-chrome-settings"]').click()
  const popover = page.locator('[data-testid="viz-settings-popover"]')
  await expect(popover).toBeVisible()
  const pop = (await popover.boundingBox())!
  const gearBox = (await chrome.locator('[data-testid="viz-chrome-settings"]').boundingBox())!
  expect(pop.y).toBeGreaterThanOrEqual(gearBox.y + gearBox.height - 1)
  expect(Math.abs(pop.x - gearBox.x)).toBeLessThan(40)
  await page.keyboard.press('Escape')

  await page.screenshot({ path: `${SHOTS}/viz-chrome-order.png` })
})
