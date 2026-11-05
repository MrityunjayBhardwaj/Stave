/**
 * Piano Roll — a gesture on a pattern whose notes do not sit on whole columns (#1092).
 *
 * `@n` is a relative WEIGHT, so `note("c4@1.5 e4@1.2")` is 2.7 columns long and `e4`
 * starts at 1.5. The writer spelled every gap as a run of bare `~`, and a bare `~` is
 * exactly one column — so a 1.5-column gap came back as 2, the lane came back longer
 * than the pattern, and Strudel (which scales each comma-lane to its own total) moved a
 * note the user never touched.
 *
 * Observed here in the real app rather than only in the writer's own tests, because the
 * thing that has to be true is about the USER'S DOCUMENT: after dragging one note, the
 * other note's text must still say what it said, and no arithmetic noise may appear in
 * the line.
 */
import { test, expect, type Page } from '@playwright/test'
import { pinLcmGrid } from './_appBoot'

// The tests titled `(LCM grid)` pin the shared-grid writer's results (Settings › Grid, #2294).
pinLcmGrid(test)

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 15_000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } })
        .monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 15_000 },
  )
}

async function setStrudelCode(page: Page, code: string): Promise<void> {
  const ok = await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } })
      .monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null
      focus: () => void
      setPosition: (p: { lineNumber: number; column: number }) => void
    }>
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    if (!target) return false
    target.getModel()?.setValue(c)
    target.setPosition({ lineNumber: 1, column: 1 })
    target.focus()
    return true
  }, code)
  expect(ok).toBe(true)
  await page.waitForTimeout(150)
}

async function strudelValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } })
      .monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; getValue: () => string } | null
    }>
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    return target?.getModel()?.getValue() ?? ''
  })
}

async function openRoll(page: Page) {
  const drawer = page.locator('[data-bottom-panel="root"]')
  await drawer.locator('[data-bottom-panel="toggle"]').click()
  await drawer.locator('role=tab[name="Pattern"]').click()
  return drawer
}

async function enlargeDrawer(page: Page): Promise<void> {
  const handle = page.locator('[data-bottom-panel="resize-handle"]')
  const hb = await handle.boundingBox()
  if (!hb) return
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + hb.width / 2, hb.y - 320, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(200)
}

// midi: c4=60, e4=64
test.describe('Piano Roll — fractional column widths (#1092)', () => {
  test('dragging one note leaves the other note`s text untouched, and writes no float (LCM grid)', async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c4@1.5 e4@1.2")')
    const drawer = await openRoll(page)
    await enlargeDrawer(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(grid).toHaveCount(1)

    // the pattern is 2.7 columns long, so c4 heads column 0 and e4 heads column 1
    const from = await grid.locator('[data-roll-cell="60:0"]').boundingBox()
    const to = await grid.locator('[data-roll-cell="60:1"]').boundingBox()
    expect(from).not.toBeNull()
    expect(to).not.toBeNull()
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
    await page.mouse.down()
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(120)

    const after = await strudelValue(page)

    // 1. the note the user did NOT touch keeps its own text exactly
    expect(after).toContain('e4@1.2')

    // 2. no arithmetic noise reaches the document — this is what `e4@1.2000000000000002`
    //    looked like, and it is corruption of the user's text whether or not it re-parses
    expect(after).not.toMatch(/\d\.\d{6,}/)

    // 3. the gap the drag opened is spelled at its true width, which a bare `~` cannot do
    expect(after).toContain('~@')
  })

  test('CONTROL — the same drag on a whole-column pattern is unchanged', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c4 ~ ~ ~")')
    const drawer = await openRoll(page)
    await enlargeDrawer(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    const from = await grid.locator('[data-roll-cell="60:0"]').boundingBox()
    const to = await grid.locator('[data-roll-cell="60:1"]').boundingBox()
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
    await page.mouse.down()
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(120)

    // no weighted rest anywhere: a whole-column pattern still spells whole columns
    const after = await strudelValue(page)
    expect(after).toBe('$: note("~ c4 ~ ~")')
    expect(after).not.toContain('@')
  })
})
