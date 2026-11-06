/**
 * A step write in a refined view keeps the columns on screen (#2410).
 *
 * Slots ×2 draws `c3 ~ e3 ~` at 8 columns. A click on a rest's second half splits it
 * (`[~ c3]`), and the text now spells those 8 columns itself, so the view's ×2 must be
 * dropped; kept, it doubles the grid again under the pointer. Both panels, both grid modes:
 * Exact writes through the step writer, LCM through the column writer.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'
import { slotsControl, preset } from './_resolutionControl'

async function refineAndSplit(page: Page, mode: 'exact' | 'lcm', code: string, panel: string, cells: string, at: string): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 520 }, gridMode: mode })
  await seedCode(page, code)
  const drawer = page.locator('[data-bottom-panel="root"]')
  const grid = drawer.locator(panel)
  await expect(grid.locator(cells)).toHaveCount(4, { timeout: 10_000 })
  await (await preset(slotsControl(drawer), 8)).click()
  await expect(grid.locator(cells)).toHaveCount(8)
  await grid.locator(at).click()
  return grid
}

for (const mode of ['exact', 'lcm'] as const) {
  test(`the piano roll, ${mode}: the split is written and the 8 columns stay 8`, async ({ page }) => {
    const roll = await refineAndSplit(page, mode, '$: note("c3 ~ e3 ~")', '[data-bottom-panel-tab="piano-roll"]', '[data-roll-cell^="48:"]', '[data-roll-cell="48:3"]')
    await expect.poll(() => editorValue(page)).toBe('$: note("c3 [~ c3] e3 ~")')
    await page.waitForTimeout(300)
    await expect(roll.locator('[data-roll-cell^="48:"]')).toHaveCount(8)
  })

  test(`the step grid, ${mode}: the split is written and the 8 columns stay 8`, async ({ page }) => {
    const grid = await refineAndSplit(page, mode, '$: s("bd ~ sd ~")', '[data-bottom-panel-tab="sequencer"]', '[data-seq-cell^="0:"]', '[data-seq-cell="0:3"]')
    await expect.poll(() => editorValue(page)).toBe('$: s("bd [~ bd] sd ~")')
    await page.waitForTimeout(300)
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(8)
  })
}
