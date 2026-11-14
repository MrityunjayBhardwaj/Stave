import { test, expect, type Page } from '@playwright/test'
import { bootApp, waitForEditorLoaded } from './_appBoot'

/**
 * #2556 — extension settings, the way VS Code does it, through the real gestures.
 *
 * The test-only extension (`e2eTone.ts`) declares one setting of each type, and uses all
 * four for a label it puts in the bar under each code editor: on/off shows it, text is what
 * it says, the choice sets capitals, the number sets its size. So a test can see a change
 * reach the running extension with no reload.
 *
 * The issue's "Done when", one test each:
 *  - its settings show in Settings under its name only while it is switched on, and its
 *    page's Settings button opens Settings on them (`@ext:e2e-tone` in the search box);
 *  - a change reaches the running extension with no reload, and survives a reload;
 *  - put back to default works, and an unchanged value follows a changed default (the page
 *    can set the label's default before any script runs, standing in for a new version);
 *  - search in Settings finds an extension setting, by its label and by its description.
 *
 * Screenshots of each state go to the test's output folder.
 */

const TONE = 'e2e-tone'
const STORAGE = 'stave:extension-settings'

/**
 * Before any page script: the extensions switched on (once, the way a saved switch is) and,
 * when the test has asked for one in this tab's session, the label's default as a new
 * version would ship it.
 */
async function atLoad(page: Page, ids: string[]): Promise<void> {
  await page.addInitScript((v) => {
    if (!sessionStorage.getItem('seeded')) {
      window.localStorage.setItem('stave:extensions', JSON.stringify(v))
      sessionStorage.setItem('seeded', '1')
    }
    const d = sessionStorage.getItem('e2e-tone-label-default')
    if (d !== null) (window as unknown as { __STAVE_E2E_TONE_LABEL_DEFAULT__?: string }).__STAVE_E2E_TONE_LABEL_DEFAULT__ = d
  }, ids)
}

const settings = (page: Page) => page.getByTestId('settings-shell')
const byTest = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`)
const group = (page: Page) => byTest(page, `settings-ext-group-${TONE}`)
const control = (page: Page, id: string) => byTest(page, `ext-setting-${TONE}-${id}`)
const row = (page: Page, id: string) => page.locator(`[data-ext-setting="${TONE}.${id}"]`)
const label = (page: Page) => page.locator('[data-workspace-view="editor"] [data-e2e-tone-label]')
const stored = (page: Page) =>
  page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? 'null'), STORAGE) as Promise<Record<string, Record<string, unknown>> | null>

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByText('Editor Settings...').click()
  await expect(settings(page)).toBeVisible({ timeout: 4000 })
  await expect(page.getByTestId('settings-tab-settings')).toHaveAttribute('aria-selected', 'true')
}

async function closeSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(settings(page)).toHaveCount(0)
}

async function openExtensionsView(page: Page): Promise<void> {
  if (!(await page.locator('[data-extensions-panel]').isVisible())) {
    await page.locator('[data-activity-bar] [data-panel-id="extensions"]').click()
  }
  await expect(page.locator('[data-extensions-panel]')).toBeVisible()
}

/** Open the test extension's page, on "What it adds". */
async function openPage(page: Page): Promise<void> {
  await openExtensionsView(page)
  await page.locator(`[data-extension-row="${TONE}"]`).click()
  const view = page.locator(`[data-extension-page="${TONE}"]`)
  await expect(view).toBeVisible()
  await view.locator('[data-extension-section="adds"]').click()
  await expect(view.locator(`[data-extension-adds-settings="${TONE}"]`)).toBeVisible()
}

/**
 * Open Settings on its Extensions section from the File menu, with the code editor still
 * showing under the window (an extension's page is a tab of its own, so it would hide the
 * label this test reads).
 */
async function openExtensionsSection(page: Page): Promise<void> {
  await openSettings(page)
  await byTest(page, 'settings-nav-extensions').click()
  await expect(group(page)).toBeVisible()
}

/** Open Settings through the extension page's Settings button. */
async function openFromPage(page: Page): Promise<void> {
  await openPage(page)
  await page.locator(`[data-extension-settings-button="${TONE}"]`).click()
  await expect(settings(page)).toBeVisible({ timeout: 4000 })
  await expect(byTest(page, 'settings-search')).toHaveValue(`@ext:${TONE}`)
}

test('its settings show under its name only while it is on; the page’s Settings button opens them, filtered', async ({ page }) => {
  test.setTimeout(120_000)
  await atLoad(page, [])
  await bootApp(page, { e2eHooks: true })

  // Off: the Extensions section has nothing of it.
  await openSettings(page)
  await byTest(page, 'settings-nav-extensions').click()
  await expect(byTest(page, 'settings-section-extensions')).toBeVisible()
  await expect(group(page)).toHaveCount(0)
  await expect(byTest(page, 'settings-ext-empty')).toContainText('No extension that is switched on has settings')
  await page.screenshot({ path: test.info().outputPath('1-extensions-section-off.png') })
  await closeSettings(page)

  // Its page lists the settings with their defaults while it is off (the manifest is data).
  await openPage(page)
  const adds = page.locator(`[data-extension-adds-settings="${TONE}"]`)
  await expect(adds.locator('[data-adds-setting-default="showLabel"]')).toHaveText('Off')
  await expect(adds.locator('[data-adds-setting-default="labelText"]')).toHaveText('“Test tone is on”')
  await expect(adds.locator('[data-adds-setting-default="labelCase"]')).toHaveText('As typed')
  await expect(adds.locator('[data-adds-setting-default="labelSize"]')).toHaveText('12')
  await expect(page.locator(`[data-extension-page="${TONE}"] [data-adds-kind="Settings"]`)).toContainText('4 settings')

  // Off, its Settings button opens Settings saying it is off, with nothing to change.
  await page.locator(`[data-extension-settings-button="${TONE}"]`).click()
  await expect(byTest(page, 'settings-search')).toHaveValue(`@ext:${TONE}`)
  await expect(byTest(page, 'settings-ext-empty')).toHaveText('Test tone is switched off. Switch it on to see and change its settings.')
  await expect(group(page)).toHaveCount(0)
  await closeSettings(page)

  // Switch it on from its page: the button opens its group, one control per type, and nothing else.
  await page.locator(`[data-extension-switch="${TONE}"][data-extension-switch-in="page"]`).click()
  await expect(page.locator(`[data-extension-page="${TONE}"]`)).toHaveAttribute('data-on', 'true')
  await page.locator(`[data-extension-page="${TONE}"]`).screenshot({ path: test.info().outputPath('2-page-settings-button-and-adds.png') })
  await openFromPage(page)
  await expect(group(page)).toBeVisible()
  await expect(group(page).locator('.ext-grp-title')).toHaveText('Test tone')
  await expect(control(page, 'showLabel')).toHaveAttribute('role', 'switch')
  await expect(control(page, 'labelText')).toHaveAttribute('type', 'text')
  await expect(control(page, 'labelCase')).toHaveJSProperty('tagName', 'SELECT')
  await expect(control(page, 'labelSize')).toHaveAttribute('type', 'number')
  await expect(page.locator('[data-testid^="settings-section-"]')).toHaveCount(1)
  await page.screenshot({ path: test.info().outputPath('3-settings-filtered-to-test-tone.png') })

  // Cleared, the File menu opens Settings unfiltered.
  await closeSettings(page)
  await openSettings(page)
  await expect(byTest(page, 'settings-search')).toHaveValue('')
  await byTest(page, 'settings-nav-extensions').click()
  await expect(group(page)).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('4-extensions-section-on.png') })
  await closeSettings(page)

  // Off again: its settings leave Settings.
  await page.locator(`[data-extension-switch="${TONE}"][data-extension-switch-in="page"]`).click()
  await expect(page.locator(`[data-extension-page="${TONE}"]`)).toHaveAttribute('data-on', 'false')
  await openSettings(page)
  await byTest(page, 'settings-nav-extensions').click()
  await expect(group(page)).toHaveCount(0)
})

test('a change reaches the running extension with no reload, and survives a reload', async ({ page }) => {
  test.setTimeout(120_000)
  await atLoad(page, [TONE])
  await bootApp(page, { e2eHooks: true })
  await expect(label(page)).toHaveCount(0)
  const loads = await page.evaluate(() => performance.getEntriesByType('navigation').length)

  await openExtensionsSection(page)
  // on/off: the label appears under the code at once
  await control(page, 'showLabel').click()
  await expect(label(page)).toHaveText('Test tone is on')
  // text, choice, number: each reaches it at once
  await control(page, 'labelText').fill('hello from settings')
  await expect(label(page)).toHaveText('hello from settings')
  await control(page, 'labelCase').selectOption('upper')
  await expect(label(page)).toHaveText('HELLO FROM SETTINGS')
  await control(page, 'labelSize').fill('20')
  await expect(label(page)).toHaveCSS('font-size', '20px')
  await expect(row(page, 'labelCase')).toHaveAttribute('data-default', 'false')
  await page.screenshot({ path: test.info().outputPath('5-changed-values.png') })
  await closeSettings(page)
  await page.locator('[data-workspace-view="editor"] [data-editor-bar]').first().screenshot({ path: test.info().outputPath('6-label-under-the-code.png') })
  // no reload happened
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(loads)
  expect(await stored(page)).toEqual({ [TONE]: { showLabel: true, labelText: 'hello from settings', labelCase: 'upper', labelSize: 20 } })

  // after a reload: the extension starts with them, and Settings shows them
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForEditorLoaded(page)
  await expect(label(page)).toHaveText('HELLO FROM SETTINGS')
  await expect(label(page)).toHaveCSS('font-size', '20px')
  await openSettings(page)
  await byTest(page, 'settings-nav-extensions').click()
  await expect(control(page, 'showLabel')).toBeChecked()
  await expect(control(page, 'labelText')).toHaveValue('hello from settings')
  await expect(control(page, 'labelCase')).toHaveValue('upper')
  await expect(control(page, 'labelSize')).toHaveValue('20')
})

test('put back to default works, and an unchanged value follows a changed default', async ({ page }) => {
  test.setTimeout(120_000)
  await atLoad(page, [TONE])
  await bootApp(page, { e2eHooks: true })
  await openExtensionsSection(page)
  await control(page, 'showLabel').click()
  await control(page, 'labelCase').selectOption('upper')
  await control(page, 'labelText').fill('mine')
  await expect(label(page)).toHaveText('MINE')
  // only what differs from the default is stored
  expect(await stored(page)).toEqual({ [TONE]: { showLabel: true, labelCase: 'upper', labelText: 'mine' } })

  // put back: the extension hears it at once, and the stored value is gone
  await byTest(page, `ext-setting-reset-${TONE}-labelCase`).click()
  await expect(label(page)).toHaveText('mine')
  await expect(control(page, 'labelCase')).toHaveValue('asTyped')
  await expect(row(page, 'labelCase')).toHaveAttribute('data-default', 'true')
  await expect(byTest(page, `ext-setting-reset-${TONE}-labelCase`)).toHaveCount(0)
  await byTest(page, `ext-setting-reset-${TONE}-labelText`).click()
  await expect(label(page)).toHaveText('Test tone is on')
  await expect(control(page, 'labelText')).toHaveValue('Test tone is on')
  expect(await stored(page)).toEqual({ [TONE]: { showLabel: true } })
  await page.screenshot({ path: test.info().outputPath('7-after-reset.png') })
  await closeSettings(page)

  // a new version changes the label's default: the unchanged label follows it; the changed switch stays the person's
  await page.evaluate(() => sessionStorage.setItem('e2e-tone-label-default', 'A new default'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForEditorLoaded(page)
  await expect(label(page)).toHaveText('A new default')
  await openExtensionsSection(page)
  await expect(control(page, 'labelText')).toHaveValue('A new default')
  await expect(row(page, 'labelText')).toHaveAttribute('data-default', 'true')
  await expect(control(page, 'showLabel')).toBeChecked()
  await closeSettings(page)
  // its page lists the new default
  await openPage(page)
  await expect(page.locator(`[data-extension-adds-settings="${TONE}"] [data-adds-setting-default="labelText"]`)).toHaveText('“A new default”')
  expect(await stored(page)).toEqual({ [TONE]: { showLabel: true } })
})

test('search in Settings finds an extension setting by its label and by its description', async ({ page }) => {
  test.setTimeout(90_000)
  await atLoad(page, [TONE])
  await bootApp(page, { e2eHooks: true })
  await openSettings(page)
  const search = byTest(page, 'settings-search')

  // by its label
  await search.fill('label size')
  await expect(group(page)).toBeVisible()
  await expect(group(page).locator('[data-ext-setting]')).toHaveCount(1)
  await expect(row(page, 'labelSize')).toBeVisible()

  // by words only in its description
  await search.fill('capitals')
  await expect(group(page).locator('[data-ext-setting]')).toHaveCount(1)
  await expect(row(page, 'labelCase')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('8-search-by-description.png') })

  // a word in Stave's own settings and none of its: its group is not shown
  await search.fill('minimap')
  await expect(byTest(page, 'settings-section-appearance')).toBeVisible()
  await expect(group(page)).toHaveCount(0)

  // @ext plus words narrows within it
  await search.fill(`@ext:${TONE} size`)
  await expect(group(page).locator('[data-ext-setting]')).toHaveCount(1)
  await expect(row(page, 'labelSize')).toBeVisible()
  await expect(byTest(page, 'settings-section-appearance')).toHaveCount(0)
})
