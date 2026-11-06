import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue, pinLcmGrid } from './_appBoot'
import { expectNoRefusalReported, expectRefusalReported } from './_console'

// The tests titled `(LCM grid)` pin the shared-grid writer's results (Settings › Grid, #2294).
pinLcmGrid(test)

/**
 * #1822 — after Slots ×2 (a view-only change) the piano roll refused every delete,
 * by click and by key, with "Couldn't delete that note". The expected document is
 * what the SAME delete writes at the pattern's own resolution, recorded first.
 */

const ROLL = '[data-bottom-panel-tab="piano-roll"]'
const MELODY = '$: note("e4 d4 c4 d4 e4 e4 e4@2")'

async function open(page: Page, code: string): Promise<void> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 620 } })
  await seedCode(page, code)
  await expect(page.locator(`${ROLL} [data-roll-cell]`).first()).toBeVisible({ timeout: 10_000 })
}

/** Slots ×2 — a view-only change; asserted to have doubled the columns. */
async function refine(page: Page): Promise<void> {
  const current = page.locator('[data-resolution-current]').first()
  const before = Number(await current.getAttribute('data-resolution-current'))
  await page.locator('[data-resolution-double]').first().click()
  await expect(current).toHaveAttribute('data-resolution-current', String(before * 2))
}

/** The delete of d4 (step 2) at the pattern's own 8 columns, by click. */
async function deleteAtOne(page: Page): Promise<string> {
  await open(page, MELODY)
  await page.locator(`${ROLL} [data-roll-cell="62:1"]`).click({ position: { x: 3, y: 5 } })
  await expect.poll(() => editorValue(page), { timeout: 5_000 }).not.toBe(MELODY)
  return editorValue(page)
}

test.describe('a delete on a refined view (#1822)', () => {
  test('a click at Slots ×2 deletes the note, as it does at the pattern’s own resolution', async ({ page }) => {
    const want = await deleteAtOne(page)
    await seedCode(page, MELODY)
    await refine(page)
    // d4 at step 2 is columns 2–3 at ×2.
    await page.locator(`${ROLL} [data-roll-cell="62:2"]`).click({ position: { x: 3, y: 5 } })
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(want)
    await expectNoRefusalReported(page)
  })

  test('Delete on the held half at Slots ×2 deletes it too', async ({ page }) => {
    const want = await deleteAtOne(page)
    await seedCode(page, MELODY)
    await refine(page)
    await page.locator(`${ROLL} [data-roll-cell="62:3"]`).focus()
    await page.keyboard.press('Delete')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(want)
    await expectNoRefusalReported(page)
  })

  test('the delete the document cannot keep (#1340) is still refused at ×2 (LCM grid)', async ({ page }) => {
    const code = '$: note("<g1, c1> - <c3, g4 - - >")'
    await open(page, code)
    await refine(page)
    // g4 sits in column 2 of the document, column 4 at ×2.
    await page.locator(`${ROLL} [data-roll-cell="67:4"]`).click({ position: { x: 3, y: 5 } })
    await page.waitForTimeout(600)
    expect(await editorValue(page)).toBe(code)
    await expectRefusalReported(page, "Couldn't delete that note")
  })
})
