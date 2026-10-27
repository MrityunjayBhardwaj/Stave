/**
 * The Pattern tab on a phone does not pin the side panel; a tablet keeps it (#1990,
 * pinned by #2014). On a phone the panel is a slim rail that slides it in over the grid
 * (#2252).
 *
 * The side panel is 220 px wide. On a phone held upright that is more than half the
 * screen, so the grid has nearly all of it, less a 30 px rail. A tablet is not a phone:
 * it keeps the desktop's layout. Turning the phone sideways does not make it a tablet —
 * the rule measures the screen, not the window.
 */
import { test, expect } from '@playwright/test'
import { bootApp, editorValue, seedCode } from './_appBoot'

const RAIL = '[data-pattern-side-rail]'
const DRAWER = '[data-pattern-side-drawer]'
const SCRIM = '[data-pattern-side-scrim]'

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
    // a real panel, not a collapsed one whose two widths agree at zero. On a phone it is
    // the whole screen across (#2000); on a tablet the rail and side panel sit beside it.
    const screen = await page.evaluate(() => window.innerWidth)
    if (onTablet) expect(panelBox!.width).toBeGreaterThan(300)
    else expect(Math.round(panelBox!.width)).toBe(screen)

    // the button that puts the side panel away (#2044) goes where the side panel goes
    const sideToggle = page.locator('[data-bottom-panel="header"] [data-pattern-side-toggle]')
    if (onTablet) {
      await expect(sideToggle).toBeVisible()
      await expect(side).toBeVisible()
      const sideBox = await side.boundingBox()
      expect(Math.round(sideBox!.width)).toBe(220)
      expect(Math.round(gridBox!.width + sideBox!.width)).toBe(Math.round(panelBox!.width))
    } else {
      await expect(sideToggle).toHaveCount(0)
      await expect(side).toHaveCount(0)
      // the grid and the collapsed rail share the width (#2252)
      const railBox = await panel.locator(RAIL).boundingBox()
      expect(Math.round(railBox!.width)).toBe(30)
      expect(Math.round(gridBox!.width + railBox!.width)).toBe(Math.round(panelBox!.width))
    }
  })

  test('a phone slides the side panel in over the grid; a tap on the dimmed grid only closes it (#2252)', async ({ page }, testInfo) => {
    const onTablet = testInfo.project.name === 'tablet'
    await bootApp(page, { drawer: { tabId: 'pattern' } })
    // the dev server's badge sits in the bottom-left corner, over the panel
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    const code = '$: s("bd ~ ~ ~ sd ~ ~ ~ bd ~ hh ~ sd ~ ~ hh")\n'
    await seedCode(page, code)
    await page.evaluate(() => {
      const m = (window as unknown as {
        monaco: { editor: { getEditors: () => Array<{ setPosition: (p: { lineNumber: number; column: number }) => void }> } }
      }).monaco
      m.editor.getEditors()[0].setPosition({ lineNumber: 1, column: 12 })
    })

    const panel = page.locator('[data-bottom-panel-tab="pattern"]')
    const grid = panel.locator('[data-pattern-grid]')
    await expect(panel.locator('[role="gridcell"]').first()).toBeVisible()
    if (onTablet) {
      await expect(panel.locator(RAIL)).toHaveCount(0)
      await expect(panel.locator(DRAWER)).toHaveCount(0)
      return
    }

    const drawer = panel.locator(DRAWER)
    await expect(drawer).toHaveAttribute('data-pattern-side-drawer', 'closed')
    await expect(drawer).toBeHidden()
    const gridBefore = await grid.boundingBox()

    await panel.locator(RAIL).tap()
    await expect(drawer).toHaveAttribute('data-pattern-side-drawer', 'open')
    // the same panel as the desktop column: its strip, its picker, its knobs
    await expect(drawer.locator('[data-mixer-panel]')).toBeVisible()
    await page.waitForTimeout(400) // the slide
    const panelBox = await panel.boundingBox()
    const drawerBox = await drawer.boundingBox()
    // over the grid, not beside it: the grid keeps its width and place
    expect(await grid.boundingBox()).toEqual(gridBefore)
    expect(Math.round(drawerBox!.x + drawerBox!.width)).toBe(Math.round(panelBox!.x + panelBox!.width))
    // a strip of the grid stays in view on the left
    const strip = drawerBox!.x - panelBox!.x
    expect(strip).toBeGreaterThan(40)

    // a tap on the dimmed grid closes the drawer and edits nothing. Sideways a step is
    // still in view beside the drawer and the tap lands right on it; upright the strip
    // holds the row names, and the tap lands there at the first row's height.
    const cells = await panel.locator('[role="gridcell"]').evaluateAll((els) =>
      els.map((c) => {
        const r = c.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }),
    )
    expect(cells.length).toBeGreaterThan(0)
    const step = cells.find((c) => c.x < drawerBox!.x - 4)
    const x = step ? step.x : panelBox!.x + strip / 2
    const y = step ? step.y : cells[0].y
    await expect(panel.locator(SCRIM)).toBeVisible()
    await page.touchscreen.tap(x, y)
    await expect(drawer).toHaveAttribute('data-pattern-side-drawer', 'closed')
    await page.waitForTimeout(300)
    expect(await editorValue(page)).toBe(code)
    // on the sideways phone a step is in view: say so, so the stronger arm cannot quietly vanish
    if (testInfo.project.name === 'phone-sideways') expect(step).toBeTruthy()

    if (step) {
      // and the step is a step again once the drawer is closed: the same tap now toggles it
      await page.touchscreen.tap(x, y)
      await expect.poll(() => editorValue(page)).not.toBe(code)
    }
  })
})
