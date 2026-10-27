/**
 * Timeline, Pattern and Mixer on a phone held upright open as a sheet over the code
 * (#2002).
 *
 * On a desktop the panel takes its height out of the editor's, and a 4 px edge resizes
 * it. On a phone there is no height to share and no edge a finger can find. So upright
 * on a phone the strip of tab names at the bottom of the screen is tall enough to hit,
 * a tab opens its panel as a sheet lying OVER the code at half height, and the strip
 * pulls the sheet to any height between closed and full (under the editor's Play bar).
 * It stays where it is let go, unless that is within a fifth of the screen of either
 * end: then it closes, or goes full (#2260). The editor underneath never changes size, so
 * closing the sheet leaves the code exactly where it was.
 *
 * The pulls here are made with the mouse's pointer, which runs the same pointer
 * handlers a finger does. What that cannot say is how a real finger's pull feels, or
 * whether the browser claims the gesture for its own scrolling first: a real-device
 * check.
 *
 * A tablet is not a phone, and a phone held sideways gets a different layout (#2003):
 * the last test says the tablet's panel is still the desktop's.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp } from './_appBoot'

const UPRIGHT_PHONES = ['phone', 'iphone']
const TABS = ['musical-timeline', 'pattern', 'mixer-console']

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
const sheet = (page: Page): Promise<Box> => box(page, '[data-bottom-panel="root"]')
const strip = (page: Page): Promise<Box> => box(page, '[data-bottom-panel="header"]')
const editor = (page: Page): Promise<Box> => box(page, '.monaco-editor')
const screenHeight = (page: Page): Promise<number> => page.evaluate(() => window.innerHeight)

/** is the middle of this element the thing a tap there would land on? */
const onTop = (page: Page, selector: string): Promise<boolean> =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return false
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit !== null && (hit === el || el.contains(hit))
  }, selector)

/** press on the strip's handle, move `dy` px (negative is up), let go */
async function pull(page: Page, dy: number): Promise<void> {
  const handle = await box(page, '[data-bottom-panel="sheet-handle"]')
  const x = handle.x + handle.width / 2
  const y = handle.y + handle.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(x, y + (dy * i) / 6)
  await page.mouse.up()
}

/**
 * Boot, then take the dev server's own badge off the page. `next dev` draws a round
 * badge in the bottom-left corner, which on a phone is exactly where the Timeline tab
 * now is, and a tap there lands on the badge. A built app has no badge; this spec is
 * about the app.
 */
async function boot(page: Page): Promise<void> {
  await bootApp(page)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
}

const PLAY = '[data-testid="strudel-chrome-transport"]'
const TOP_BAR = '[data-phone-top-bar]'

test.describe('the panel is a sheet on a phone held upright (#2002)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!UPRIGHT_PHONES.includes(testInfo.project.name), 'upright phones only; see the last test for a tablet')
  })

  test('the strip sits at the bottom of the screen, with tabs and a handle a finger can hit', async ({ page }) => {
    await boot(page)
    const s = await strip(page)
    expect(Math.round(s.y + s.height)).toBe(await screenHeight(page))
    for (const id of TABS) {
      const tab = await box(page, `[data-bottom-panel="header"] [data-tab-id="${id}"]`)
      expect(tab.height, `${id} tab height`).toBeGreaterThanOrEqual(44)
      expect(tab.width, `${id} tab width`).toBeGreaterThanOrEqual(44)
    }
    const handle = await box(page, '[data-bottom-panel="sheet-handle"]')
    expect(handle.height).toBeGreaterThanOrEqual(44)
    expect(handle.width).toBeGreaterThanOrEqual(44)
    await expect(page.locator('[data-bottom-panel="body"]')).toHaveCount(0)
  })

  test('each tab opens its panel at half height, over the code, with the top bar and Play still there', async ({ page }) => {
    await boot(page)
    const before = await editor(page)
    const height = await screenHeight(page)
    const topBar = await box(page, TOP_BAR)
    const area = height - (topBar.y + topBar.height)

    for (const id of TABS) {
      await page.locator(`[data-bottom-panel="header"] [data-tab-id="${id}"]`).tap()
      await expect(page.locator('[data-bottom-panel="root"]')).toHaveAttribute('data-sheet', 'half')
      await expect(page.locator(`[data-bottom-panel-tab="${id}"]`), `${id} did not open`).toBeVisible()

      const s = await sheet(page)
      // half of what is under the top bar, give or take, and reaching the bottom of the screen
      expect(s.height / area, `${id}: the sheet's share of the screen`).toBeGreaterThan(0.4)
      expect(s.height / area, `${id}: the sheet's share of the screen`).toBeLessThan(0.6)
      expect(Math.round(s.y + s.height)).toBe(height)
      // OVER the code: the editor is the size it was, and the sheet's top edge is inside it
      const now = await editor(page)
      expect(now.height, `${id}: the editor changed height`).toBe(before.height)
      expect(now.y).toBe(before.y)
      expect(s.y).toBeLessThan(now.y + now.height)
      // code above the sheet can still be tapped into
      expect(s.y - now.y).toBeGreaterThan(100)
      expect(await onTop(page, TOP_BAR)).toBe(true)
      expect(await onTop(page, PLAY)).toBe(true)
    }
  })

  test('pulling the handle all the way up goes to full height under Play; all the way down closes it', async ({ page }) => {
    await boot(page)
    await page.locator('[data-bottom-panel="header"] [data-tab-id="pattern"]').tap()
    const root = page.locator('[data-bottom-panel="root"]')
    await expect(root).toHaveAttribute('data-sheet', 'half')
    const half = await sheet(page)

    // twice half is past full, and the finger stays on the screen
    await pull(page, -half.height)
    await expect(root).toHaveAttribute('data-sheet', 'full')
    const full = await sheet(page)
    expect(full.height).toBeGreaterThan(half.height + 100)
    // it stops under the editor's bar, so Play and the top bar are still there to press
    const playBar = await box(page, '[data-strudel-runtime-chrome="root"]')
    expect(Math.abs(full.y - (playBar.y + playBar.height))).toBeLessThanOrEqual(2)
    expect(await onTop(page, PLAY)).toBe(true)
    expect(await onTop(page, TOP_BAR)).toBe(true)
    await expect(page.locator('[data-bottom-panel-tab="pattern"]')).toBeVisible()

    await pull(page, full.height - 60)
    await expect(root).toHaveAttribute('data-sheet', 'closed')
    await expect(page.locator('[data-bottom-panel="body"]')).toHaveCount(0)
    const s = await strip(page)
    expect(Math.round(s.y + s.height)).toBe(await screenHeight(page))
  })

  test('the sheet stays where it is let go; only near either end does it go the rest of the way (#2260)', async ({ page }) => {
    await boot(page)
    await page.locator('[data-bottom-panel="header"] [data-tab-id="pattern"]').tap()
    const root = page.locator('[data-bottom-panel="root"]')
    await expect(root).toHaveAttribute('data-sheet', 'half')
    const zone = (await screenHeight(page)) / 5
    const closed = Math.round((await strip(page)).height) + 1 // the strip and its top border
    await pull(page, -(await sheet(page)).height)
    await expect(root).toHaveAttribute('data-sheet', 'full')
    const full = Math.round((await sheet(page)).height)
    expect(full - closed, 'room for a middle that snaps to neither end').toBeGreaterThan(2 * zone + 40)

    /** pull the sheet from where it is to `target` px tall */
    const pullTo = async (target: number): Promise<void> => pull(page, (await sheet(page)).height - target)

    // let go in the middle: it stays there, at the height it was let go
    const middle = Math.round((closed + full) / 2)
    await pullTo(middle)
    await expect(root).toHaveAttribute('data-sheet', 'free')
    expect(Math.abs((await sheet(page)).height - middle)).toBeLessThanOrEqual(2)
    await expect(page.locator('[data-bottom-panel-tab="pattern"]')).toBeVisible()
    // a second pull starts from there, not from half
    await pull(page, -30)
    await expect(root).toHaveAttribute('data-sheet', 'free')
    expect(Math.abs((await sheet(page)).height - (middle + 30))).toBeLessThanOrEqual(2)

    // let go just outside the zone under full: still where it was let go
    await pullTo(full - zone - 12)
    await expect(root).toHaveAttribute('data-sheet', 'free')
    // inside it: the rest of the way up
    await pullTo(full - zone + 12)
    await expect(root).toHaveAttribute('data-sheet', 'full')
    expect(Math.round((await sheet(page)).height)).toBe(full)

    // just outside the zone over the strip: where it was let go
    await pullTo(closed + zone + 12)
    await expect(root).toHaveAttribute('data-sheet', 'free')
    // inside it: closed
    await pullTo(closed + zone - 12)
    await expect(root).toHaveAttribute('data-sheet', 'closed')
    await expect(page.locator('[data-bottom-panel="body"]')).toHaveCount(0)

    // and a tab opens it at half again, not where it was last let go
    await page.locator('[data-bottom-panel="header"] [data-tab-id="pattern"]').tap()
    await expect(root).toHaveAttribute('data-sheet', 'half')
  })

  test('a drag inside a panel belongs to the panel: the sheet does not move', async ({ page }) => {
    await boot(page)
    for (const id of TABS) {
      await page.locator(`[data-bottom-panel="header"] [data-tab-id="${id}"]`).tap()
      const root = page.locator('[data-bottom-panel="root"]')
      await expect(root).toHaveAttribute('data-sheet', 'half')
      const before = await sheet(page)
      const body = await box(page, '[data-bottom-panel="body"]')
      const x = body.x + body.width / 2
      const y = body.y + body.height / 2
      for (const dy of [-120, 120]) {
        await page.mouse.move(x, y)
        await page.mouse.down()
        for (let i = 1; i <= 6; i++) await page.mouse.move(x + 10, y + (dy * i) / 6)
        await page.mouse.up()
        await expect(root, `${id}: a ${dy} px drag inside moved the sheet`).toHaveAttribute('data-sheet', 'half')
        const after = await sheet(page)
        expect(Math.round(after.y)).toBe(Math.round(before.y))
        expect(Math.round(after.height)).toBe(Math.round(before.height))
      }
    }
  })

  test('closing the sheet leaves the editor the size it was and the code where it was', async ({ page }) => {
    await boot(page)
    const scrollTop = (): Promise<number> =>
      page.evaluate(() => {
        const m = (window as unknown as { monaco: { editor: { getEditors: () => Array<{ getScrollTop: () => number }> } } }).monaco
        return m.editor.getEditors()[0].getScrollTop()
      })
    // a file long enough to scroll, scrolled part-way down
    await page.evaluate(() => {
      const m = (window as unknown as {
        monaco: { editor: { getEditors: () => Array<{ getModel: () => { setValue: (v: string) => void }; setScrollTop: (n: number) => void }> } }
      }).monaco
      const ed = m.editor.getEditors()[0]
      ed.getModel().setValue(Array.from({ length: 200 }, (_, i) => `// line ${i + 1}`).join('\n'))
      ed.setScrollTop(900)
    })
    await expect.poll(scrollTop).toBe(900)
    const before = await editor(page)

    await page.locator('[data-bottom-panel="header"] [data-tab-id="mixer-console"]').tap()
    await expect(page.locator('[data-bottom-panel="root"]')).toHaveAttribute('data-sheet', 'half')
    await pull(page, -(await sheet(page)).height)
    await expect(page.locator('[data-bottom-panel="root"]')).toHaveAttribute('data-sheet', 'full')
    await page.locator('[data-bottom-panel="toggle"]').tap()
    await expect(page.locator('[data-bottom-panel="root"]')).toHaveAttribute('data-sheet', 'closed')

    const after = await editor(page)
    expect(after.height).toBe(before.height)
    expect(after.y).toBe(before.y)
    expect(await scrollTop()).toBe(900)
  })
})

test.describe('the panel on a tablet (#2002)', () => {
  test("a tablet's panel is the desktop's: a 28 px strip, and opening it takes height from the editor", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet', 'phones are covered above')
    await boot(page)
    const root = page.locator('[data-bottom-panel="root"]')
    await expect(root).not.toHaveAttribute('data-sheet', /.*/)
    await expect(page.locator('[data-bottom-panel="sheet-handle"]')).toHaveCount(0)
    expect(Math.round((await strip(page)).height)).toBe(28)
    const before = await editor(page)
    await page.locator('[data-bottom-panel="header"] [data-tab-id="pattern"]').tap()
    await expect(page.locator('[data-bottom-panel="body"]')).toBeVisible()
    const after = await editor(page)
    expect(Math.round(before.height - after.height)).toBe(240 - 29)
  })
})
