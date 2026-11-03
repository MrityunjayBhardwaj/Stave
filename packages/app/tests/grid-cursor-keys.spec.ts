import { test, expect, type Page, type Locator } from '@playwright/test'

/**
 * #1802 — the grids are ARIA grids with one tab stop and an arrow-key cursor, and
 * keys place and remove notes. Every keyboard edit is compared with the SAME edit
 * made by the mouse on the same pattern first, never with a predicted string.
 * The patterns are the ones the issue measured on main.
 */

const ROLL = '$: note("c3@2 ~ ~ ~ ~ ~ ~")'
const SEQ = '$: s("bd _ ~ ~ ~ ~ ~ ~")'

async function boot(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () =>
      ((window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco?.editor?.getEditors?.()
        ?.length ?? 0) > 0,
    { timeout: 20_000 },
  )
}

type Ed = {
  getModel: () => { getLanguageId?: () => string; getValue: () => string; setValue: (s: string) => void } | null
  focus: () => void
  setPosition: (p: { lineNumber: number; column: number }) => void
}

async function setCode(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco?.editor?.getEditors?.() ??
      []) as Ed[]
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.getModel()?.setValue(c)
    t?.setPosition({ lineNumber: 1, column: 6 })
    t?.focus()
  }, code)
  await page.waitForTimeout(250)
}

function source(page: Page): Promise<string> {
  return page.evaluate(() => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco?.editor?.getEditors?.() ??
      []) as Ed[]
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    return t?.getModel()?.getValue() ?? ''
  })
}

async function openPattern(page: Page, tab: 'piano-roll' | 'sequencer', first: string): Promise<Locator> {
  const drawer = page.locator('[data-bottom-panel="root"]')
  if (!(await drawer.locator('role=tab[name="Pattern"]').isVisible())) {
    await drawer.locator('[data-bottom-panel="toggle"]').click()
  }
  await drawer.locator('role=tab[name="Pattern"]').click()
  const panel = drawer.locator(`[data-bottom-panel-tab="${tab}"]`)
  await expect(panel.locator(first)).toBeVisible({ timeout: 10_000 })
  return panel
}

/** What a mouse click on `cell` writes, then the pattern put back. */
async function byMouse(page: Page, cell: Locator, restore: string): Promise<string> {
  await cell.click({ position: { x: 3, y: 5 } })
  await expect.poll(() => source(page), { timeout: 5_000 }).not.toBe(restore)
  const want = await source(page)
  await setCode(page, restore)
  return want
}

/** Tab into the grid from the element just before it; returns the focused cell's marker. */
async function focusedCell(page: Page, attr: string): Promise<string | null> {
  return page.evaluate((a) => document.activeElement?.getAttribute(a) ?? null, attr)
}

async function unchanged(page: Page, want: string): Promise<void> {
  await page.waitForTimeout(600)
  expect(await source(page)).toBe(want)
}

test.describe('piano roll', () => {
  test('is a grid of rows and gridcells with ONE tab stop, on the first note', async ({ page }) => {
    await boot(page)
    await setCode(page, ROLL)
    const roll = await openPattern(page, 'piano-roll', '[data-roll-cell="48:0"]')
    const grid = roll.getByRole('grid', { name: 'Piano roll' })
    await expect(grid).toBeVisible()
    const rows = grid.getByRole('row')
    const nRows = await rows.count()
    expect(nRows).toBeGreaterThan(1)
    const cells = grid.getByRole('gridcell')
    const nCells = await cells.count()
    expect(nCells % nRows).toBe(0)
    expect(await roll.locator('[data-roll-cell]').count()).toBe(nCells)
    // One cell in the tab order, not one per cell.
    await expect(roll.locator('[data-roll-cell][tabindex="0"]')).toHaveCount(1)
    await expect(roll.locator('[data-roll-cell]:not([tabindex="-1"])')).toHaveCount(1)
    await expect(roll.locator('[data-roll-cell][tabindex="0"]')).toHaveAttribute('data-roll-cell', '48:0')
    // Tab from the cell leaves the grid; Shift+Tab comes back to the same cell.
    await roll.locator('[data-roll-cell="48:0"]').focus()
    await page.keyboard.press('Tab')
    expect(await focusedCell(page, 'data-roll-cell')).toBeNull()
    await page.keyboard.press('Shift+Tab')
    expect(await focusedCell(page, 'data-roll-cell')).toBe('48:0')
  })

  test('arrows move a cursor that is focused and selected; a held column says so', async ({ page }) => {
    await boot(page)
    await setCode(page, ROLL)
    const roll = await openPattern(page, 'piano-roll', '[data-roll-cell="48:0"]')
    await roll.locator('[data-roll-cell="48:0"]').focus()
    await page.keyboard.press('ArrowRight')
    expect(await focusedCell(page, 'data-roll-cell')).toBe('48:1')
    const cell = roll.locator('[role="gridcell"]', { has: page.locator('[data-roll-cell="48:1"]') })
    await expect(cell).toHaveAttribute('aria-selected', 'true')
    await expect(roll.locator('[data-roll-cell="48:1"]')).toHaveAttribute('aria-label', 'c3 step 2, held from step 1')
    await expect(roll.locator('[data-roll-cell="48:1"]')).toHaveAttribute('tabindex', '0')
    await page.keyboard.press('ArrowUp')
    expect(await focusedCell(page, 'data-roll-cell')).toBe('49:1')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('End')
    expect(await focusedCell(page, 'data-roll-cell')).toMatch(/^48:\d+$/)
    const last = await focusedCell(page, 'data-roll-cell')
    await page.keyboard.press('ArrowRight') // clamped: no wrap
    expect(await focusedCell(page, 'data-roll-cell')).toBe(last)
    await page.keyboard.press('Home')
    expect(await focusedCell(page, 'data-roll-cell')).toBe('48:0')
    await unchanged(page, ROLL)
  })

  test("' and Enter write what a click writes; Delete on a held column removes the note like a click", async ({ page }) => {
    await boot(page)
    await setCode(page, ROLL)
    const roll = await openPattern(page, 'piano-roll', '[data-roll-cell="48:0"]')
    const placed = await byMouse(page, roll.locator('[data-roll-cell="48:3"]'), ROLL)
    const removed = await byMouse(page, roll.locator('[data-roll-cell="48:1"]'), ROLL)

    await roll.locator('[data-roll-cell="48:0"]').focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press("'")
    await expect.poll(() => source(page), { timeout: 5_000 }).toBe(placed)
    // The same key again is the second click: the note comes back off.
    await page.keyboard.press('Enter')
    await expect.poll(() => source(page), { timeout: 5_000 }).toBe(ROLL)

    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight') // 48:1, a column c3@2 sounds through
    await page.keyboard.press('Delete')
    await expect.poll(() => source(page), { timeout: 5_000 }).toBe(removed)
    // Nothing under the cursor now: Delete does nothing (and says nothing).
    await page.keyboard.press('Delete')
    await unchanged(page, removed)
  })
})

test.describe('sequencer', () => {
  test('is a grid with ONE tab stop among its cells', async ({ page }) => {
    await boot(page)
    await setCode(page, SEQ)
    const seq = await openPattern(page, 'sequencer', '[data-seq-cell="0:0"]')
    const grid = seq.getByRole('grid', { name: 'Step sequencer' })
    await expect(grid.getByRole('row')).toHaveCount(1)
    await expect(grid.getByRole('gridcell')).toHaveCount(8)
    await expect(grid.getByRole('rowheader')).toHaveCount(1)
    await expect(seq.locator('[data-seq-cell][tabindex="0"]')).toHaveCount(1)
    await expect(seq.locator('[data-seq-cell]:not([tabindex="-1"])')).toHaveCount(1)
  })

  test("arrows + ' write what a click writes, on an empty and a held column; Delete clears a hit", async ({ page }) => {
    await boot(page)
    await setCode(page, SEQ)
    const seq = await openPattern(page, 'sequencer', '[data-seq-cell="0:0"]')
    const placed = await byMouse(page, seq.locator('[data-seq-cell="0:3"]'), SEQ)
    const cleared = await byMouse(page, seq.locator('[data-seq-cell="0:0"]'), SEQ)
    // 0:1 is held by `bd _`: part of the `bd` step, not a step of its own, so a click
    // there writes nothing (#2292) — and neither does the key
    await expect(seq.locator('[data-seq-cell="0:1"]')).toHaveAttribute('aria-disabled', 'true')

    await seq.locator('[data-seq-cell="0:0"]').focus()
    await page.keyboard.press('ArrowRight')
    expect(await focusedCell(page, 'data-seq-cell')).toBe('0:1')
    await expect(seq.locator('[role="gridcell"]', { has: page.locator('[data-seq-cell="0:1"]') })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.keyboard.press("'")
    await page.waitForTimeout(300)
    expect(await source(page)).toBe(SEQ)
    await setCode(page, SEQ)
    await seq.locator('[data-seq-cell="0:1"]').focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press("'")
    await expect.poll(() => source(page), { timeout: 5_000 }).toBe(placed)
    await page.keyboard.press("'")
    await expect.poll(() => source(page), { timeout: 5_000 }).toBe(SEQ)

    await page.keyboard.press('Home')
    await page.keyboard.press('Backspace')
    await expect.poll(() => source(page), { timeout: 5_000 }).toBe(cleared)
  })

  test('the cursor survives an edit but not a move to another pattern', async ({ page }) => {
    await boot(page)
    const two = `${SEQ}\n$: s("hh ~ ~ ~ ~ ~ ~ ~")`
    await setCode(page, two)
    const seq = await openPattern(page, 'sequencer', '[data-seq-cell="0:0"]')
    const tabStop = (): Promise<string | null> =>
      seq.locator('[data-seq-cell][tabindex="0"]').getAttribute('data-seq-cell')
    await seq.locator('[data-seq-cell="0:3"]').focus()
    await page.keyboard.press("'")
    await expect.poll(() => source(page), { timeout: 5_000 }).not.toBe(two)
    // The edit re-parses the pattern; the cursor stays where the key was pressed.
    await page.waitForTimeout(400)
    expect(await tabStop()).toBe('0:3')
    // Another statement is another pattern: its cursor starts at the first cell.
    await page.evaluate(() => {
      const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco?.editor?.getEditors?.() ??
        []) as Ed[]
      const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
      t?.setPosition({ lineNumber: 2, column: 6 })
    })
    await expect(seq.locator('[data-seq-cell="0:0"]')).toBeVisible()
    await expect.poll(tabStop, { timeout: 5_000 }).toBe('0:0')
  })

  test('Enter on "remove voice" is still the button\'s, not a toggle', async ({ page }) => {
    await boot(page)
    await setCode(page, '$: s("bd ~ ~ ~, hh ~ hh ~")')
    const seq = await openPattern(page, 'sequencer', '[data-seq-cell="0:0"]')
    const before = await source(page)
    await seq.locator('[data-seq-remove-voice="hh"]').focus()
    await page.keyboard.press('Enter')
    // The voice goes (the button's own action) and no cell toggled with it.
    await expect.poll(() => source(page), { timeout: 5_000 }).not.toBe(before)
    expect(await source(page)).not.toContain('hh')
    expect(await source(page)).toContain('bd')
  })
})
