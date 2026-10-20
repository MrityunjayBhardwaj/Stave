/**
 * #2120 — a rhythm line in `.struct(…)` opens in the Pattern tab, and a step click
 * stays in it.
 *
 * Before the fix a cursor in a rhythm line bound the chords (`chord(vamp)`), so the
 * line the musician was looking at could not be edited from the grid. The unit suite
 * covers the lookup; this covers the gesture: click into the line, see its steps,
 * click one, and find only that line changed in the code.
 */
import { test, expect, type Page } from '@playwright/test'

const LINE_2 = '~ x x ~ x ~ x x ~ x ~ x x ~ x ~'
const SONG = `const roll = (n, seed) => irand(n).early(seed * 13.7).segment(1).slow(64)
const vamp = "<Em9 A13>"
const clavM = "<1 1 0 1>"
const clav = chord(vamp).voicing()
  .struct(roll(3, 3).pick([
    "x ~ x x ~ x ~ x x ~ x ~ ~ x ~ x",
    "${LINE_2}",
    "x x ~ x ~ x x ~ x ~ ~ x ~ x x ~"
  ]))
  .s("gm_clavinet").clip(0.25).lpf(3000).gain(0.4).mask(clavM)

$: clav`

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:bottomPanel.height', '440')
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.activeTabId', 'pattern')
    } catch {
      /* ignore */
    }
  })
  await page.goto('/')
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () =>
      ((window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco?.editor?.getEditors?.()
        ?.length ?? 0) > 0,
    { timeout: 20_000 },
  )
}

async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    type Ed = { getModel: () => { getLanguageId?: () => string; getValue: () => string; setValue: (s: string) => void } | null }
    const eds = (window as unknown as { monaco: { editor: { getEditors: () => Ed[] } } }).monaco.editor.getEditors()
    return (eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]).getModel()!.getValue()
  })
}

async function seed(page: Page, doc: string): Promise<void> {
  await page.evaluate((c) => {
    type Ed = { getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null }
    const eds = (window as unknown as { monaco: { editor: { getEditors: () => Ed[] } } }).monaco.editor.getEditors()
    ;(eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]).getModel()!.setValue(c)
  }, doc)
}

/** A real click into the code, a few characters into the first line holding `text`.
 *  The point comes from the editor rather than a `.view-line` element, which Monaco
 *  swaps out while it redraws the freshly seeded text. */
async function clickInto(page: Page, text: string): Promise<void> {
  const point = await page.evaluate((t) => {
    type Ed = {
      getModel: () => { getLanguageId?: () => string; getValue: () => string } | null
      getScrolledVisiblePosition: (p: { lineNumber: number; column: number }) => { left: number; top: number; height: number } | null
      getDomNode: () => HTMLElement | null
    }
    const eds = (window as unknown as { monaco: { editor: { getEditors: () => Ed[] } } }).monaco.editor.getEditors()
    const ed = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    const lineNumber = ed.getModel()!.getValue().split('\n').findIndex((l) => l.includes(t)) + 1
    const at = ed.getScrolledVisiblePosition({ lineNumber, column: 8 })
    const rect = ed.getDomNode()!.getBoundingClientRect()
    return at && { x: rect.left + at.left, y: rect.top + at.top + at.height / 2 }
  }, text)
  if (!point) throw new Error(`line holding ${text} is not on screen`)
  await page.mouse.click(point.x, point.y)
}

test.describe('#2120 — a .struct rhythm line', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page)
    await seed(page, SONG)
    await clickInto(page, LINE_2)
  })

  test('opens as a one-lane step grid with its own hits', async ({ page }) => {
    const drawer = page.locator('[data-bottom-panel="root"]')
    await expect(drawer.locator('[data-seq-cell^="0:"]')).toHaveCount(16)
    await expect(drawer.locator('[data-seq-cell^="1:"]')).toHaveCount(0)
    await expect(drawer.locator('[data-seq-cell^="0:"][aria-pressed="true"]')).toHaveCount(LINE_2.split(' ').filter((s) => s === 'x').length)
  })

  test('a click on an empty step changes that line and nothing else', async ({ page }) => {
    const drawer = page.locator('[data-bottom-panel="root"]')
    await drawer.locator('[data-seq-cell="0:0"]').click()
    await expect.poll(() => code(page)).not.toBe(SONG)
    const after = await code(page)
    const changed = SONG.split('\n').flatMap((l, i) => (l === after.split('\n')[i] ? [] : [i + 1]))
    expect({ changed, line7: after.split('\n')[6] }).toEqual({
      changed: [7],
      line7: `    "${LINE_2.replace(/^~/, 'x')}",`,
    })
  })
})
