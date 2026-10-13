/**
 * The Pattern tab's side panel can be put away (#2044).
 *
 * The tab pins a 220 px panel on its right: the track's volume and pan, Slots, the
 * instrument or kit, Snap, the knobs. A menu button at the top right corner of the tab,
 * in the row with the tab names, hides it so the grid has the whole width, and shows it
 * again. The choice is remembered. The button belongs to the Pattern tab: Timeline and
 * Mixer do not show it.
 *
 * A phone has no side panel here and no button; `touch-pattern-tab.spec.ts` says so.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'

const CODE = '$: s("bd ~ sd ~").gain(0.8)\n'

const panel = (page: Page) => page.locator('[data-bottom-panel-tab="pattern"]')
const grid = (page: Page) => panel(page).locator('[data-pattern-grid]')
const side = (page: Page) => panel(page).locator('[data-pattern-mixer]')
const toggle = (page: Page) => page.locator('[data-bottom-panel="header"] [data-pattern-side-toggle]')
const width = async (page: Page, of: ReturnType<typeof grid>): Promise<number> => Math.round((await of.boundingBox())!.width)

/** put the cursor in the pattern, so the tab shows its grid */
async function focusPattern(page: Page): Promise<void> {
  await page.evaluate(() => {
    const m = (window as unknown as {
      monaco: { editor: { getEditors: () => Array<{ getModel: () => { getLanguageId: () => string } | null; setPosition: (p: { lineNumber: number; column: number }) => void; focus: () => void }> } }
    }).monaco
    const ed = m.editor.getEditors().find((e) => e.getModel()?.getLanguageId() === 'strudel')!
    ed.setPosition({ lineNumber: 1, column: 8 })
    ed.focus()
  })
}

test.describe('Pattern tab: hiding and showing the side panel (#2044)', () => {
  test('the button hides the side panel and the grid takes its width; pressing again brings both back', async ({ page }) => {
    await bootApp(page, { drawer: { tabId: 'pattern' } })
    await seedCode(page, CODE)
    await focusPattern(page)
    await expect(side(page)).toBeVisible()

    const tabWidth = await width(page, panel(page))
    const gridBefore = await width(page, grid(page))
    expect(await width(page, side(page))).toBe(220)
    expect(gridBefore + 220).toBe(tabWidth)

    // at the top right of the tab: in the header row, to the right of every tab name
    const button = (await toggle(page).boundingBox())!
    const header = (await page.locator('[data-bottom-panel="header"]').boundingBox())!
    const lastTab = (await page.locator('[data-bottom-panel="header"] [role="tab"]').last().boundingBox())!
    expect(button.x).toBeGreaterThan(lastTab.x + lastTab.width)
    expect(button.x).toBeGreaterThan(header.x + header.width - 80)
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')

    await toggle(page).click()
    await expect(side(page)).toHaveCount(0)
    expect(await width(page, grid(page))).toBe(tabWidth)
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')

    await toggle(page).click()
    await expect(side(page)).toBeVisible()
    expect(await width(page, grid(page))).toBe(gridBefore)
  })

  test('the choice survives a reload', async ({ page }) => {
    await bootApp(page, { drawer: { tabId: 'pattern' } })
    await expect(side(page)).toBeVisible()
    await toggle(page).click()
    await expect(side(page)).toHaveCount(0)

    await page.reload()
    await expect(panel(page)).toBeVisible({ timeout: 30_000 })
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(side(page)).toHaveCount(0)

    // and so does showing it again
    await toggle(page).click()
    await page.reload()
    await expect(panel(page)).toBeVisible({ timeout: 30_000 })
    await expect(side(page)).toBeVisible()
  })

  test('only the Pattern tab shows the button', async ({ page }) => {
    await bootApp(page, { drawer: { tabId: 'pattern' } })
    await expect(toggle(page)).toBeVisible()
    const header = page.locator('[data-bottom-panel="header"]')
    for (const name of ['Timeline', 'Mixer']) {
      await header.locator(`role=tab[name="${name}"]`).click()
      await expect(toggle(page), `${name} tab`).toHaveCount(0)
    }
    await header.locator('role=tab[name="Pattern"]').click()
    await expect(toggle(page)).toBeVisible()
  })

  test('with the side panel hidden the grid still edits the code', async ({ page }) => {
    await bootApp(page, { drawer: { tabId: 'pattern', height: 360 } })
    await seedCode(page, CODE)
    await focusPattern(page)
    await toggle(page).click()
    await expect(side(page)).toHaveCount(0)

    // the second step of the kick row is a rest: click it on
    const cells = grid(page).locator('[data-step-cell], [data-sequencer-cell], [aria-pressed]')
    await expect(cells.first()).toBeVisible()
    const off = grid(page).locator('[aria-pressed="false"]').first()
    await off.click()
    await expect.poll(() => editorValue(page)).not.toBe(CODE)
  })
})
