/**
 * Pattern-grid coverage — #468 (`-` rest) + #469 (numeric note/degree).
 *
 * Observes in the real browser that patterns which previously fell to standby
 * now bind to the editable grid, and that editing a numeric pattern writes
 * back numbers (not note names) so it round-trips.
 *
 * Discriminating: without the parser changes, every `s("bd - bd")` /
 * `note("60 …")` / `n("0 …")` below falls to standby, so the cell assertions
 * (and the numeric write-back) fail.
 */
import { test, expect, type Page } from '@playwright/test'
import { pinLcmGrid } from './_appBoot'


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

async function openPattern(page: Page) {
  const drawer = page.locator('[data-bottom-panel="root"]')
  await drawer.locator('[data-bottom-panel="toggle"]').click()
  await drawer.locator('role=tab[name="Pattern"]').click()
  return drawer
}

test.describe('#468 — `-` rest binds the grid', () => {
  test('sequencer: `s("bd - bd")` binds with the `-` as a silent slot (LCM grid)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd - bd")')
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    await expect(grid).toHaveCount(1) // not standby
    await expect(grid.locator('[data-seq-cell="0:0"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-seq-cell="0:1"]')).toHaveAttribute('aria-pressed', 'false')
    await expect(grid.locator('[data-seq-cell="0:2"]')).toHaveAttribute('aria-pressed', 'true')
  })

  test('piano roll: `note("c3 - e3")` binds with the `-` as a rest', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 - e3")')
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(grid).toHaveCount(1)
    await expect(grid.locator('[data-roll-cell="48:0"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-roll-cell="52:2"]')).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('#469 — numeric patterns bind the Piano Roll', () => {
  test('MIDI `note("60 62 64")` renders on numeric rows', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("60 62 64")')
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(grid).toHaveCount(1)
    await expect(grid.locator('[data-roll-cell="60:0"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-roll-cell="62:1"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-roll-cell="64:2"]')).toHaveAttribute('aria-pressed', 'true')
  })

  test('degree `n("0 1 2")` renders on numeric rows', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: n("0 1 2")')
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(grid).toHaveCount(1)
    await expect(grid.locator('[data-roll-cell="0:0"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-roll-cell="1:1"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-roll-cell="2:2"]')).toHaveAttribute('aria-pressed', 'true')
  })

  test('placing a note in a numeric pattern writes back a NUMBER, not a note name', async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("60 ~ 64")')
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(grid).toHaveCount(1)
    await grid.locator('[data-roll-cell="62:1"]').click() // place 62 in the empty middle slot
    await page.waitForTimeout(120)
    expect(await strudelValue(page)).toBe('$: note("60 62 64")')
  })
})

test.describe('#467 — `[group]*n` multiplier binds the grid', () => {
  test('sequencer: `s("[bd hh]*2")` binds as the expanded 4-step sequence (LCM grid)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("[bd hh]*2")')
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    await expect(grid).toHaveCount(1) // previously fell to standby
    // bd lane: cols 0 + 2; hh lane: cols 1 + 3 (sd hh sd hh → bd hh bd hh here).
    await expect(grid.locator('[data-seq-cell="0:0"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-seq-cell="0:1"]')).toHaveAttribute('aria-pressed', 'false')
    await expect(grid.locator('[data-seq-cell="0:2"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-seq-cell="1:1"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-seq-cell="1:3"]')).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('#467 — bare note names (no octave) bind the Piano Roll', () => {
  test('`note("c e g")` binds on the octave-3 rows (c3=48, e3=52, g3=55)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c e g")')
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(grid).toHaveCount(1) // previously fell to standby ("not a note name")
    await expect(grid.locator('[data-roll-cell="48:0"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-roll-cell="52:1"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-roll-cell="55:2"]')).toHaveAttribute('aria-pressed', 'true')
  })
})
