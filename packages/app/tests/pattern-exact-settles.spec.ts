/**
 * The Exact step grid settles when it opens no grid (#2527).
 *
 * #2478 left an effect that set new state on every render whenever the grid opened nothing
 * (no pattern under the cursor, or one it refuses): the page re-rendered until React stopped it
 * with "Maximum update depth exceeded", and the Song panel and the Mixer never mounted. A real
 * page, the Pattern tab open, the console read.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode } from './_appBoot'

function collectRenderLoops(page: Page): string[] {
  const seen: string[] = []
  const note = (t: string): void => {
    if (/Maximum update depth/i.test(t)) seen.push(t.slice(0, 160))
  }
  page.on('console', (m) => note(m.text()))
  page.on('pageerror', (e) => note(e.message))
  return seen
}

test.describe('the Exact step grid settles when it opens no grid (#2527)', () => {
  for (const [what, code] of [
    ['no pattern at all', '// nothing to play yet'],
    ['a pattern the grid does not open', '$: note("c3 e3 g3").s("piano")'],
  ] as const) {
    test(`${what}: no render loop, and the page stays usable`, async ({ page }) => {
      const loops = collectRenderLoops(page)
      await bootApp(page, { drawer: { tabId: 'pattern', height: 460 } })
      await seedCode(page, code)
      // CONTROL: the drawer really is on the Pattern tab, so the step grid had its chance to run
      await expect(page.locator('[data-bottom-panel-tab="pattern"]')).toBeVisible()
      await page.waitForTimeout(1500)
      expect(loops, 'React stopped a render loop').toEqual([])
      // and a grid pattern still opens afterwards
      await seedCode(page, '$: s("bd ~ sd ~")')
      await expect(page.locator('[data-exact-grid] [data-seq-cell]').first()).toBeVisible()
      expect(loops).toEqual([])
    })
  }

  test('the Song tab on an arranged song: its view mounts, with no render loop behind it', async ({ page }) => {
    const loops = collectRenderLoops(page)
    // the exact setup of the Song specs that broke (#2527): Song tab open, a song typed and run
    await page.addInitScript(() => {
      try {
        localStorage.setItem('stave:bottomPanel.height', '340')
        localStorage.setItem('stave:bottomPanel.open', 'true')
        localStorage.setItem('stave:bottomPanel.activeTabId', 'musical-timeline')
      } catch {
        /* private mode */
      }
    })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
    // TYPED, as a person does: the text passes through half-written patterns (`arrange([2, s("bd`)
    // under the cursor, which the Pattern tab, mounted behind the Song tab, tries and cannot open
    await page.waitForFunction(() => ((window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco?.editor?.getEditors?.()?.length ?? 0) > 0)
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`)
    await page.keyboard.press('Backspace')
    await page.keyboard.type('arrange([2, s("bd")], [2, s("hh")])', { delay: 8 })
    await page.waitForTimeout(400)
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Enter`)
    await expect(page.locator('[data-full-song="root"]')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(1000)
    expect(loops, 'React stopped a render loop').toEqual([])
  })
})
