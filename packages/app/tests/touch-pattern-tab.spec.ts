/**
 * The Pattern tab on a phone is the grid alone; a tablet keeps the side panel (#1990,
 * pinned by #2014).
 *
 * The side panel is 220 px wide. On a phone held upright that is more than half the
 * screen, so the grid has it all there and the knobs stay in the Mixer tab. A tablet is
 * not a phone: it keeps the desktop's layout. Turning the phone sideways does not make
 * it a tablet — the rule measures the screen, not the window.
 */
import { test, expect } from '@playwright/test'
import { bootApp } from './_appBoot'

test.describe('Pattern tab on a touch device (#1990)', () => {
  test('a phone shows the grid alone; a tablet keeps the side panel', async ({ page }, testInfo) => {
    const onTablet = testInfo.project.name === 'tablet'
    await bootApp(page, { drawer: { tabId: 'pattern' } })

    const panel = page.locator('[data-bottom-panel-tab="pattern"]')
    await expect(panel).toBeVisible()
    const grid = panel.locator('[data-pattern-grid]')
    const side = panel.locator('[data-pattern-mixer]')
    await expect(grid).toBeVisible()

    const panelBox = await panel.boundingBox()
    const gridBox = await grid.boundingBox()
    expect(panelBox).not.toBeNull()
    expect(gridBox).not.toBeNull()
    // a real panel, not a collapsed one whose two widths agree at zero
    expect(panelBox!.width).toBeGreaterThan(100)

    if (onTablet) {
      await expect(side).toBeVisible()
      const sideBox = await side.boundingBox()
      expect(Math.round(sideBox!.width)).toBe(220)
      expect(Math.round(gridBox!.width + sideBox!.width)).toBe(Math.round(panelBox!.width))
    } else {
      await expect(side).toHaveCount(0)
      expect(Math.round(gridBox!.width)).toBe(Math.round(panelBox!.width))
    }
  })
})
