/**
 * A sound that is a pattern is never replaced by one pick (#2226).
 *
 * `.sound("piano gm_electric_guitar_muted")` plays piano for the first half of the
 * bar and the guitar for the second. The Instrument picker used to read that as one
 * long name and replace the whole string with the next pick, which threw away code
 * the user wrote. Here, through the real picker and the Library's Insert:
 *  - several sounds: the picker says how many and which, says why it can't pick,
 *    and the code is unchanged;
 *  - one sound written as a pattern: a pick renames it where it is written and
 *    keeps the rest;
 *  - the Kit picker follows the same rule on `.bank(…)`;
 *  - the Library's Insert, with the cursor on a multi-sound line, writes nothing
 *    and says why.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode } from './_appBoot'

const MULTI = '$: note("48 67 63 [62, 58]").sound("piano gm_electric_guitar_muted")'

async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    const m = (window as unknown as { monaco: { editor: { getEditors: () => Array<{ getModel: () => { getValue: () => string } | null }> } } }).monaco
    return m.editor.getEditors()[0]?.getModel()?.getValue() ?? ''
  })
}

/** Put the editor's cursor on `line`, inside the pattern. */
async function cursorAt(page: Page, line: number, column = 8): Promise<void> {
  await page.evaluate(
    ([l, c]) => {
      const eds = (window as unknown as { monaco: { editor: { getEditors: () => Array<{ setPosition: (p: object) => void; focus: () => void }> } } }).monaco.editor.getEditors()
      eds[0].setPosition({ lineNumber: l, column: c })
      eds[0].focus()
    },
    [line, column] as const,
  )
}

async function openPattern(page: Page) {
  const drawer = page.locator('[data-bottom-panel="root"]')
  await drawer.locator('[data-bottom-panel="toggle"]').click()
  await drawer.locator('role=tab[name="Pattern"]').click()
  return drawer
}

async function setUp(page: Page, doc: string) {
  await bootApp(page)
  await seedCode(page, doc)
  await cursorAt(page, 1)
  return openPattern(page)
}

test.describe('a sound that is a pattern is never replaced by one pick (#2226)', () => {
  test('several sounds: the Instrument picker says which, and writes nothing', async ({ page }) => {
    const drawer = await setUp(page, MULTI)
    const trigger = drawer.locator('[data-mixer-sound-trigger="instrument"]')
    await expect(trigger).toHaveText(/2 sounds: piano, gm_electric_guitar_muted/)

    await trigger.click()
    const menu = page.locator('[data-mixer-sound-menu="instrument"]')
    await expect(menu.locator('[data-mixer-sound-refusal="instrument"]')).toHaveText(
      /pattern of 2 sounds \(piano, gm_electric_guitar_muted\).*change it in the code/,
    )
    // nothing to pick: no list, no search, no Default
    await expect(menu.locator('[data-mixer-sound-option]')).toHaveCount(0)
    await expect(menu.locator('[data-mixer-sound-default]')).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect(await code(page)).toBe(MULTI)
  })

  test('one sound written as a pattern: a pick renames it and keeps the rest', async ({ page }) => {
    const doc = '$: note("c e g").sound("<piano ~ piano>")'
    const drawer = await setUp(page, doc)
    const trigger = drawer.locator('[data-mixer-sound-trigger="instrument"]')
    await expect(trigger).not.toHaveText(/<|~/)

    await trigger.click()
    const menu = page.locator('[data-mixer-sound-menu="instrument"]')
    await menu.locator('[data-mixer-sound-search]').fill('sawtooth')
    await menu.locator('[data-mixer-sound-option="sawtooth"]').click()
    await expect.poll(() => code(page)).toBe('$: note("c e g").sound("<sawtooth ~ sawtooth>")')
  })

  test('one plain sound: replaced exactly as before', async ({ page }) => {
    const drawer = await setUp(page, '$: note("c e g").sound("piano")')
    await drawer.locator('[data-mixer-sound-trigger="instrument"]').click()
    const menu = page.locator('[data-mixer-sound-menu="instrument"]')
    await menu.locator('[data-mixer-sound-search]').fill('sawtooth')
    await menu.locator('[data-mixer-sound-option="sawtooth"]').click()
    await expect.poll(() => code(page)).toBe(`$: note("c e g").sound('sawtooth')`)
  })

  test('the Kit picker: several kits are not replaced either', async ({ page }) => {
    const doc = '$: s("bd sd hh").bank("<RolandTR909 RolandTR808>")'
    const drawer = await setUp(page, doc)
    const trigger = drawer.locator('[data-mixer-sound-trigger="kit"]')
    await expect(trigger).toHaveText(/alternates: RolandTR909, RolandTR808/)
    await trigger.click()
    await expect(page.locator('[data-mixer-sound-refusal="kit"]')).toHaveText(/pattern of 2 kits/)
    await page.keyboard.press('Escape')
    expect(await code(page)).toBe(doc)
  })

  test("the Library's Insert on a multi-sound line writes nothing and says why", async ({ page }) => {
    await bootApp(page)
    await seedCode(page, MULTI)
    await page.getByRole('button', { name: /library/i }).first().click()
    await page.locator('[data-asset-library]').waitFor({ timeout: 15_000 })
    await page.locator('[data-asset-search]').fill('sawtooth')
    const row = page.locator('[data-asset-row="sound:sawtooth"]')
    await row.waitFor({ timeout: 15_000 })
    await cursorAt(page, 1)
    await row.hover()
    await row.locator('[data-asset-insert]').click()

    const toast = page.locator('[data-testid="toast"]').filter({ hasNotText: /^Uncaught / }).last()
    await expect(toast).toContainText('This sound is a pattern of 2 sounds (piano, gm_electric_guitar_muted)')
    expect(await code(page)).toBe(MULTI)
  })
})
