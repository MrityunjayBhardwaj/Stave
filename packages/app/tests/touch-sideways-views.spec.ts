/**
 * A phone held sideways shows one view at a time, chosen from the top bar (#2003).
 *
 * Sideways a phone is about 360 px tall. A top bar, the editor and a bottom panel
 * cannot share that: opened, today's panel left the code 5 px. So sideways there is no
 * bottom strip and no sheet. The top bar carries a switch — Code, Timeline, Pattern,
 * Mixer — and whichever is chosen has everything under the editor's Play bar.
 *
 * The switch and the upright sheet (#2002) read the same state, so turning the phone
 * keeps you where you were: a sheet open on Pattern becomes the Pattern view, and
 * turning back brings the sheet back.
 *
 * Turning is done here by changing the window's size, which is what a turned phone
 * does to a page. What it is not: a real rotation, with the browser's own bars coming
 * and going. That is a real-device check.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp } from './_appBoot'

const PANELS = ['musical-timeline', 'pattern', 'mixer-console']
const UPRIGHT = { width: 412, height: 839 }
const SIDEWAYS = { width: 863, height: 360 }

interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const box = async (page: Page, selector: string): Promise<Box> => {
  const b = await page.locator(selector).first().boundingBox()
  expect(b, `${selector} has no box`).not.toBeNull()
  return b!
}
const screenSize = (page: Page): Promise<{ w: number; h: number }> =>
  page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))

/** is the middle of this element the thing a tap there would land on? */
const onTop = (page: Page, selector: string): Promise<boolean> =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return false
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit !== null && (hit === el || el.contains(hit))
  }, selector)

/** boot, without the dev server's badge: it sits in the bottom-left corner, over the views */
async function boot(page: Page): Promise<void> {
  await bootApp(page)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
}

const PLAY = '[data-testid="strudel-chrome-transport"]'
const PLAY_BAR = '[data-strudel-runtime-chrome="root"]'
const view = (id: string): string => `[data-phone-view-switch] [data-phone-view="${id}"]`
const chosen = (page: Page): Promise<string | null> =>
  page.locator('[data-phone-view-switch] [aria-selected="true"]').getAttribute('data-phone-view')

test.describe('a phone held sideways: one view at a time (#2003)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-sideways', 'a phone held sideways only')
  })

  test('the top bar has a four-way switch a finger can hit, and there is no strip at the bottom', async ({ page }) => {
    await boot(page)
    const { w } = await screenSize(page)
    for (const id of ['code', ...PANELS]) {
      const b = await box(page, view(id))
      expect(b.height, `${id} height`).toBeGreaterThanOrEqual(44)
      expect(b.width, `${id} width`).toBeGreaterThanOrEqual(44)
      expect(b.x, `${id} left`).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width, `${id} right`).toBeLessThanOrEqual(w)
    }
    await expect(page.locator(view('code'))).toHaveText('Code')
    await expect(page.locator(view('musical-timeline'))).toHaveText('Timeline')
    await expect(page.locator(view('pattern'))).toHaveText('Pattern')
    await expect(page.locator(view('mixer-console'))).toHaveText('Mixer')
    expect(await chosen(page)).toBe('code')
    // no strip of tab names, and no sheet handle
    await expect(page.locator('[data-bottom-panel="header"]')).toHaveCount(0)
    await expect(page.locator('[data-bottom-panel="sheet-handle"]')).toHaveCount(0)
    // nothing in the top bar runs off the screen
    const off = await page.evaluate(() =>
      [...document.querySelectorAll('[data-phone-top-bar] button')].filter((b) => {
        const r = b.getBoundingClientRect()
        return r.left < -0.5 || r.right > window.innerWidth + 0.5
      }).length,
    )
    expect(off).toBe(0)
  })

  test('each of the four views has everything under the Play bar, and Play is there in all four', async ({ page }) => {
    await boot(page)
    const { w, h } = await screenSize(page)
    const bar = await box(page, PLAY_BAR)
    const under = bar.y + bar.height

    // Code: the editor runs to the bottom of the screen
    const code = await box(page, '.monaco-editor')
    expect(Math.round(code.y)).toBe(Math.round(under))
    expect(Math.round(code.y + code.height)).toBe(h)
    expect(Math.round(code.width)).toBe(w)
    expect(await onTop(page, PLAY)).toBe(true)

    for (const id of PANELS) {
      await page.locator(view(id)).tap()
      expect(await chosen(page)).toBe(id)
      const panel = page.locator(`[data-bottom-panel-tab="${id}"]`)
      await expect(panel, `${id} did not open`).toBeVisible()
      const root = await box(page, '[data-bottom-panel="root"]')
      expect(Math.abs(root.y - under), `${id}: top edge against the Play bar`).toBeLessThanOrEqual(2)
      expect(Math.round(root.y + root.height), `${id}: bottom edge`).toBe(h)
      expect(Math.round(root.width)).toBe(w)
      // the panel itself has the room, not a frame around it
      const inner = await box(page, `[data-bottom-panel-tab="${id}"]`)
      expect(inner.height, `${id}: the panel's own height`).toBeGreaterThan(root.height - 4)
      expect(await onTop(page, PLAY), `${id}: Play is covered`).toBe(true)
      expect(await onTop(page, '[data-phone-top-bar]')).toBe(true)
    }

    // and back to the code
    await page.locator(view('code')).tap()
    expect(await chosen(page)).toBe('code')
    await expect(page.locator('[data-bottom-panel="body"]')).toHaveCount(0)
    const again = await box(page, '.monaco-editor')
    expect(Math.round(again.height)).toBe(Math.round(code.height))
  })

  test('turning the phone keeps the view: a sheet on Pattern is the Pattern view, and back', async ({ page }) => {
    await page.setViewportSize(UPRIGHT)
    await boot(page)
    await page.locator('[data-bottom-panel="header"] [data-tab-id="pattern"]').tap()
    await expect(page.locator('[data-bottom-panel="root"]')).toHaveAttribute('data-sheet', 'half')

    await page.setViewportSize(SIDEWAYS)
    await expect(page.locator('[data-phone-view-switch]')).toBeVisible()
    expect(await chosen(page)).toBe('pattern')
    await expect(page.locator('[data-bottom-panel-tab="pattern"]')).toBeVisible()
    await expect(page.locator('[data-bottom-panel="header"]')).toHaveCount(0)

    // choose another view sideways; upright again it is that one's sheet
    await page.locator(view('mixer-console')).tap()
    await page.setViewportSize(UPRIGHT)
    await expect(page.locator('[data-phone-view-switch]')).toHaveCount(0)
    await expect(page.locator('[data-bottom-panel="root"]')).toHaveAttribute('data-sheet', 'half')
    await expect(page.locator('[data-bottom-panel-tab="mixer-console"]')).toBeVisible()

    // Code sideways is a closed sheet upright
    await page.setViewportSize(SIDEWAYS)
    await page.locator(view('code')).tap()
    await page.setViewportSize(UPRIGHT)
    await expect(page.locator('[data-bottom-panel="root"]')).toHaveAttribute('data-sheet', 'closed')
  })

  test('turning the phone leaves the code where it was', async ({ page }) => {
    await boot(page)
    const scrollTop = (): Promise<number> =>
      page.evaluate(() => {
        const m = (window as unknown as { monaco: { editor: { getEditors: () => Array<{ getScrollTop: () => number }> } } }).monaco
        return m.editor.getEditors()[0].getScrollTop()
      })
    await page.evaluate(() => {
      const m = (window as unknown as {
        monaco: { editor: { getEditors: () => Array<{ getModel: () => { setValue: (v: string) => void }; setScrollTop: (n: number) => void }> } }
      }).monaco
      const ed = m.editor.getEditors()[0]
      ed.getModel().setValue(Array.from({ length: 300 }, (_, i) => `// line ${i + 1}`).join('\n'))
      ed.setScrollTop(900)
    })
    await expect.poll(scrollTop).toBe(900)
    await page.setViewportSize(UPRIGHT)
    await expect(page.locator('[data-phone-view-switch]')).toHaveCount(0)
    expect(await scrollTop()).toBe(900)
    await page.setViewportSize(SIDEWAYS)
    await expect(page.locator('[data-phone-view-switch]')).toBeVisible()
    expect(await scrollTop()).toBe(900)
  })

  test('the drawer keeps every panel and gives its whole height to one row of tabs and the panel', async ({ page }) => {
    await boot(page)
    const { h } = await screenSize(page)
    await page.locator('[data-phone-top="drawer"]').tap()
    const drawer = page.locator('[data-phone-drawer]')
    await expect(drawer).toBeVisible()
    const tabs = await drawer.locator('[data-phone-drawer-tab]').evaluateAll((els) => els.map((e) => e.getAttribute('data-phone-drawer-tab')))
    for (const id of ['explorer', 'search', 'snapshots', 'library', 'console', 'phone-menu']) expect(tabs, `no ${id} tab`).toContain(id)
    // one row above the panel, not two: the close button is on the tabs' row
    const body = await box(page, '[data-phone-drawer-body]')
    expect(body.y, 'height spent above the panel').toBeLessThanOrEqual(50)
    expect(Math.round(body.y + body.height)).toBe(h)
    const close = await box(page, '[data-phone-drawer-close]')
    const firstTab = await box(page, '[data-phone-drawer-tab]')
    expect(Math.abs(close.y - firstTab.y)).toBeLessThanOrEqual(2)
    expect(close.height).toBeGreaterThanOrEqual(44)
    await page.locator('[data-phone-drawer-close]').tap()
    await expect(drawer).toHaveCount(0)
  })
})

test.describe('the view switch is a sideways phone\'s only (#2003)', () => {
  test('an upright phone and a tablet have no view switch', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone-sideways', 'covered above')
    await boot(page)
    await expect(page.locator('[data-phone-view-switch]')).toHaveCount(0)
    // and the panel's strip of tab names is still there to open it
    await expect(page.locator('[data-bottom-panel="header"]')).toBeVisible()
  })
})
