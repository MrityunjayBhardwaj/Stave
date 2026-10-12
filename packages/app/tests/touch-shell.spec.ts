/**
 * The shell on a phone and on a tablet (#2000, #2001, pinned by #2014).
 *
 * On a phone the desktop's row — rail, side panel, editor — left the code about a
 * hundred pixels, and the menu bar ran off the right edge of the screen. So on a phone
 * the editor takes the whole width, the rail and side panel and menus live in a drawer
 * that opens over it, and the top bar holds four things a finger can hit.
 *
 * A tablet is not a phone: it keeps the desktop's rail, side panel and menu bar, and
 * the last test says so.
 *
 * This file also runs on an iPhone under WebKit, where the layout engine differs.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp } from './_appBoot'

const PHONES = ['phone', 'phone-sideways', 'iphone']
/** every panel the desktop's rail opens */
const RAIL_PANELS = ['explorer', 'search', 'snapshots', 'library', 'console']

const screenWidth = (page: Page): Promise<number> => page.evaluate(() => window.innerWidth)

/** visible buttons in the top strip of the page that are not wholly on screen */
function topControlsOffScreen(page: Page): Promise<{ total: number; off: string[] }> {
  return page.evaluate(() => {
    const strip = [...document.querySelectorAll('button, [role="button"]')].filter((b) => {
      const r = b.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.top < 40
    })
    const off = strip.filter((b) => {
      const r = b.getBoundingClientRect()
      return r.left < -0.5 || r.right > window.innerWidth + 0.5
    })
    return { total: strip.length, off: off.map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim().slice(0, 30)) }
  })
}

test.describe('the shell on a phone (#2000, #2001)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!PHONES.includes(testInfo.project.name), 'a tablet keeps the desktop shell; see the last test')
  })

  test('the editor is as wide as the screen, with no rail or side panel beside it', async ({ page }) => {
    await bootApp(page)
    const editor = page.locator('.monaco-editor').first()
    await expect(editor).toBeVisible()
    const box = await editor.boundingBox()
    const width = await screenWidth(page)
    expect(width).toBeGreaterThan(300)
    expect(Math.round(box!.x)).toBe(0)
    expect(Math.round(box!.width)).toBe(width)
    await expect(page.locator('[data-activity-bar]')).toHaveCount(0)
    await expect(page.locator('[data-phone-drawer]')).toHaveCount(0)
  })

  test('the top bar is four things, each on screen and big enough for a finger', async ({ page }) => {
    await bootApp(page)

    // nothing in the top strip of the page runs off the screen — whatever is drawn there
    const strip = await topControlsOffScreen(page)
    expect(strip.total).toBeGreaterThan(0)
    expect(strip.off).toEqual([])

    const bar = page.locator('[data-phone-top-bar]')
    await expect(bar).toBeVisible()
    const width = await screenWidth(page)
    for (const part of ['drawer', 'lamp', 'play']) {
      const control = bar.locator(`[data-phone-top="${part}"]`)
      await expect(control, part).toBeVisible()
      const box = await control.boundingBox()
      expect(box!.height, `${part} height`).toBeGreaterThanOrEqual(44)
      expect(box!.width, `${part} width`).toBeGreaterThanOrEqual(44)
      expect(box!.x, `${part} left`).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width, `${part} right`).toBeLessThanOrEqual(width)
    }
    // the file's name, and under it where the song is and how fast
    await expect(bar.locator('[data-phone-top="file"]')).not.toHaveText('')
    await expect(bar.locator('[data-phone-top="readout"]')).toHaveText(/(BAR|CYC) .+ · .+ (BPM|CPS)/)
    // the desktop's menu bar is not drawn as well
    await expect(page.getByRole('button', { name: 'File', exact: true })).toHaveCount(0)
  })

  test('the drawer holds every panel the rail opens, and closes on a tap beside it', async ({ page }) => {
    await bootApp(page)
    const drawer = page.locator('[data-phone-drawer]')
    await page.locator('[data-phone-top="drawer"]').tap()
    await expect(drawer).toBeVisible()

    // it opens on the files
    await expect(drawer.locator('[data-phone-drawer-body]')).toHaveAttribute('data-phone-drawer-body', 'explorer')
    await expect(drawer.locator('[data-file-tree-item]').first()).toBeVisible()

    const tabs = await drawer.locator('[data-phone-drawer-tab]').evaluateAll((els) => els.map((e) => e.getAttribute('data-phone-drawer-tab')))
    for (const id of RAIL_PANELS) expect(tabs, `the drawer has no ${id} tab`).toContain(id)

    for (const id of RAIL_PANELS) {
      const tab = drawer.locator(`[data-phone-drawer-tab="${id}"]`)
      const box = await tab.boundingBox()
      expect(box!.height, `${id} tab height`).toBeGreaterThanOrEqual(44)
      await tab.tap()
      const body = drawer.locator(`[data-phone-drawer-body="${id}"]`)
      await expect(body, `${id} did not open`).toBeVisible()
      // the panel itself is in there, not an empty frame
      expect(await body.evaluate((b) => b.querySelectorAll('*').length), `${id} is empty`).toBeGreaterThan(3)
    }

    // the drawer does not cover the whole screen: there is something beside it to tap
    const drawerBox = await drawer.boundingBox()
    const width = await screenWidth(page)
    expect(drawerBox!.width).toBeLessThan(width)
    await page.touchscreen.tap(Math.round((drawerBox!.width + width) / 2), 200)
    await expect(drawer).toHaveCount(0)
  })

  test('picking a file closes the drawer', async ({ page }) => {
    await bootApp(page)
    await page.locator('[data-phone-top="drawer"]').tap()
    const drawer = page.locator('[data-phone-drawer]')
    await expect(drawer).toBeVisible()
    await drawer.locator('[data-file-tree-item]').first().tap()
    await expect(drawer).toHaveCount(0)
    // and the editor is still there, full width, behind where it was
    const box = await page.locator('.monaco-editor').first().boundingBox()
    expect(Math.round(box!.width)).toBe(await screenWidth(page))
  })

  test('the menus are in the drawer, and an item there does what the menu bar item does', async ({ page }) => {
    await bootApp(page)
    await page.locator('[data-phone-top="drawer"]').tap()
    const drawer = page.locator('[data-phone-drawer]')
    await drawer.locator('[data-phone-drawer-tab="phone-menu"]').tap()

    for (const menu of ['file', 'edit', 'view', 'help']) {
      await expect(drawer.locator(`[data-phone-menu="${menu}"]`), `no ${menu} menu`).toHaveCount(1)
    }
    const labels = await drawer.locator('[data-stave-menu-item]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()))
    for (const label of ['New Project...', 'Open Project...', 'Export as .zip', 'Bounce to WAV...', 'Editor Settings...', 'Undo', 'Start Screen']) {
      expect(labels.some((l) => l.startsWith(label)), `"${label}" is not in the drawer`).toBe(true)
    }
    // the rest of the desktop's readout is here too
    await expect(drawer.locator('[data-stave-transport-lcd]')).toBeVisible()
    // …all of it: the audio lamp is the last cell, and it is inside the drawer
    const audio = await drawer.locator('[data-stave-audio-health]').boundingBox()
    const drawerEdge = await drawer.boundingBox()
    expect(audio!.x + audio!.width).toBeLessThanOrEqual(drawerEdge!.x + drawerEdge!.width)

    // every row is tall enough to hit
    const heights = await drawer.locator('[data-stave-menu-item]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
    expect(heights.length).toBeGreaterThan(10)
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44)

    // an item runs, and the drawer gets out of the way of what it opened
    await drawer.locator('[data-stave-menu-item]', { hasText: 'Editor Settings...' }).tap()
    await expect(drawer).toHaveCount(0)
    await expect(page.locator('[role="dialog"][aria-label="Stave settings"]')).toBeVisible()
  })

  test('the status lamp opens the Console in the drawer', async ({ page }) => {
    await bootApp(page)
    await page.locator('[data-phone-top="lamp"]').tap()
    await expect(page.locator('[data-phone-drawer] [data-phone-drawer-body="console"]')).toBeVisible()
  })
})

test.describe('the shell on a tablet (#2000, #2001)', () => {
  test('a tablet keeps the rail, the side panel and the menu bar', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet', 'phones are covered above')
    await bootApp(page)
    await expect(page.locator('[data-activity-bar]')).toBeVisible()
    await expect(page.locator('[data-sidebar]').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible()
    await expect(page.locator('[data-phone-top-bar]')).toHaveCount(0)
    await expect(page.locator('[data-phone-drawer]')).toHaveCount(0)
    // the widths it has today: a 44 px rail, and an editor that is not the whole screen
    const rail = await page.locator('[data-activity-bar]').boundingBox()
    expect(Math.round(rail!.width)).toBe(44)
    const editor = await page.locator('.monaco-editor').first().boundingBox()
    expect(editor!.width).toBeLessThan((await screenWidth(page)) - 44)
  })
})
