/**
 * Grid visual identity — Logic-parity chrome (#430 / #471 / #428).
 *
 * Real-browser proof of the visual-identity look-cut:
 *  - Sequencer shows named drum-voice rows (Kick/Snare/Hi-Hat) instead of raw
 *    `bd`/`sd`/`hh` (#471). The per-voice colour dots were removed in #589 —
 *    the track's single identity colour now lives in the PatternTrackChip, so a
 *    separate per-voice palette would read as a second, conflicting colour code.
 *  - Piano Roll shows a graphical keyboard gutter with C-labels (#430).
 *  - Note Color = Velocity recolours notes/cells by gain, observed via computed
 *    background colour, not inferred (#428). The toggle moved from the grid
 *    header into the editor Settings tab (#602); setting it there must recolour
 *    the live grid (the editor↔app same-document sync).
 */
import { test, expect, type Page } from '@playwright/test'
import { pinLcmGrid } from './_appBoot'


pinLcmGrid(test)
async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 15_000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 15_000 },
  )
}

async function setStrudelCode(page: Page, code: string): Promise<void> {
  const ok = await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null
      focus: () => void
      setPosition: (p: { lineNumber: number; column: number }) => void
    }>
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    if (!target) return false
    target.getModel()?.setValue(c)
    target.setPosition({ lineNumber: 1, column: 8 })
    target.focus()
    return true
  }, code)
  expect(ok).toBe(true)
  await page.waitForTimeout(200)
}

async function openPattern(page: Page) {
  const drawer = page.locator('[data-bottom-panel="root"]')
  await drawer.locator('[data-bottom-panel="toggle"]').click()
  await drawer.locator('role=tab[name="Pattern"]').click()
  return drawer
}

/** Set Note Colour through the real Settings gesture (#602 moved it off the grid
 *  header; #739 then moved Settings itself into the unified shell).
 *
 *  Two premises here are load-bearing and both used to be wrong:
 *   - `exact` on the File button — getByRole's name match is a case-insensitive
 *     SUBSTRING, so a bare 'File' ALSO matches the "New file" (+) button in the
 *     file-tree header, and the click dies on a strict-mode violation.
 *   - the shell renders ONE section at a time behind a nav, and closes with a
 *     Close button (not Escape). Note colour lives under "Pattern & Timeline",
 *     so the field simply is not in the DOM until that nav item is clicked. */
async function setNoteColor(page: Page, mode: 'off' | 'velocity'): Promise<void> {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByText('Editor Settings...').click()
  await page.getByTestId('settings-shell').waitFor({ timeout: 5000 })
  await page.getByTestId('settings-nav-pattern').click()
  const select = page.getByTestId('setting-noteColor')
  await select.waitFor({ timeout: 5000 })
  await select.selectOption(mode)
  // scoped + exact for the same reason as the File button: an accessible name is
  // a substring match, and other surfaces carry a "Close …" label.
  await page
    .getByTestId('settings-shell')
    .getByRole('button', { name: 'Close', exact: true })
    .click() // don't cover the grid
  await page.waitForTimeout(150)
}

test.describe('Grid visual identity (#430/#471/#428)', () => {
  test('Sequencer shows named drum-voice rows; per-voice dots removed (#471/#589)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, 's("bd ~ sd ~, hh*8")')
    await openPattern(page)

    // Friendly voice names, not raw tokens.
    await expect(page.locator('[data-seq-voice="bd"]')).toContainText('Kick')
    await expect(page.locator('[data-seq-voice="sd"]')).toContainText('Snare')
    await expect(page.locator('[data-seq-voice="hh"]')).toContainText('Hi-Hat')

    // The per-voice colour dots were removed (#589) — track identity is the chip.
    await expect(page.locator('[data-seq-voice-dot]')).toHaveCount(0)

    await page.screenshot({ path: 'test-results/grid-identity-sequencer.png' })
  })

  test('Piano Roll shows a graphical keyboard with C-labels (#430)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, 'note("c3 e3 g3 c4")')
    await openPattern(page)

    // Keyboard keys render, with both white and black keys.
    const keys = page.locator('[data-roll-key]')
    expect(await keys.count()).toBeGreaterThan(0)
    expect(await page.locator('[data-roll-key][data-roll-key-black="true"]').count()).toBeGreaterThan(0)

    // C rows are labelled (C is always a white key).
    await expect(page.locator('[data-roll-key]', { hasText: 'C3' }).first()).toBeVisible()
    await expect(page.locator('[data-roll-key]', { hasText: 'C4' }).first()).toBeVisible()

    await page.screenshot({ path: 'test-results/grid-identity-pianoroll.png' })
  })

  test('Note Color = Velocity (set in Settings) recolours cells live (#428/#602) (LCM grid)', async ({ page }) => {
    // Sequencer: a per-column gain difference → cells of different velocity get
    // different colours under Velocity mode. The mode is now set in the editor
    // Settings tab (#602), and the live grid must recolour from that change.
    await boot(page)
    await setStrudelCode(page, 's("bd bd bd bd").gain("1 0.2 1 0.2")')
    await openPattern(page)

    const fills = page.locator('[data-seq-fill]')
    expect(await fills.count()).toBeGreaterThan(1)

    // the toggle is gone from the grid header (moved to Settings)
    await expect(page.locator('[data-note-color-mode]')).toHaveCount(0)

    // Off mode → all cells share the voice colour.
    await setNoteColor(page, 'off')
    const offColors = await fills.evaluateAll((els) =>
      els.map((e) => getComputedStyle(e as HTMLElement).backgroundColor),
    )
    expect(new Set(offColors).size).toBe(1)

    // Velocity mode (set in Settings) → loud vs soft columns differ in colour.
    await setNoteColor(page, 'velocity')
    const velColors = await fills.evaluateAll((els) =>
      els.map((e) => getComputedStyle(e as HTMLElement).backgroundColor),
    )
    expect(new Set(velColors).size).toBeGreaterThan(1)

    await page.screenshot({ path: 'test-results/grid-identity-velocity.png' })
  })
})
