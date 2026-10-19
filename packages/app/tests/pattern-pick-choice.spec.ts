/**
 * #2118 — a line chosen by `pick` opens in the Pattern tab, and an edit stays in it.
 *
 * Before the fix the panel bound the chain's first call, the chooser, so a cursor in
 * one of the lines left the grid in standby and the chooser's numbers showed up as
 * `roll 1` / `roll 2` knobs. The unit suite covers the lookup; this covers what the
 * musician does: click into a line, see that line, click a cell, and find only that
 * line changed in the code.
 */
import { test, expect, type Page } from '@playwright/test'

const LINE_2 = '<[e1 ~ e1 ~ ~ e2 ~ d2 ~ b1 ~ ~ g1 ~ a1 b1] [a1 ~ a1 ~ ~ a2 ~ g2 ~ e2 ~ ~ c#2 ~ d2 d#2]>'
const SONG = `const roll = (n, seed) => irand(n).early(seed * 13.7).segment(1).slow(64)
const bass = roll(3, 1).pick([
  "<[e1 ~ ~ e2 ~ ~ e1 ~ g1 ~ a1 ~ ~ b1 d2 ~] [a1 ~ ~ a2 ~ ~ a1 ~ c#2 ~ e2 ~ g1 ~ f#1 ~]>",
  "${LINE_2}",
  "<[e1 ~ ~ ~ e2 e1 ~ ~ e1 ~ g1 a1 ~ b1 ~ d2] [a1 ~ ~ ~ a2 a1 ~ ~ a1 ~ c#2 e2 ~ g2 ~ e2]>"
]).note().s("gm_slap_bass_1")
  .lpf("<2500!20 600!4 2500!8>").gain(1)

$: bass`

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

test.describe('#2118 — a line chosen by pick', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page)
    await seed(page, SONG)
    await clickInto(page, 'e1 ~ e1 ~ ~ e2')
  })

  test('opens as its own piano roll, with its 16 notes', async ({ page }) => {
    const drawer = page.locator('[data-bottom-panel="root"]')
    await expect(drawer.locator('[data-roll-cell] [data-roll-fill]')).toHaveCount(16)
  })

  test("shows the track's controls, not the chooser's numbers", async ({ page }) => {
    const drawer = page.locator('[data-bottom-panel="root"]')
    await expect(drawer.locator('[data-roll-cell]').first()).toBeVisible()
    await expect(drawer.getByText(/^roll [12]$/)).toHaveCount(0)
  })

  test('a click on an empty cell changes that line and nothing else', async ({ page }) => {
    const drawer = page.locator('[data-bottom-panel="root"]')
    await drawer.locator('[data-roll-cell="45:0"]').click()
    await expect.poll(() => code(page)).not.toBe(SONG)
    const after = await code(page)
    const changed = SONG.split('\n').flatMap((l, i) => (l === after.split('\n')[i] ? [] : [i + 1]))
    expect({ changed, line4: after.split('\n')[3] }).toEqual({
      changed: [4],
      line4: `  "${LINE_2.replace('<[e1 ', '<[[e1,a2] ')}",`,
    })
  })
})
