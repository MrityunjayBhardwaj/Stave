import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { bootApp } from './_appBoot'

/**
 * #2545 — Keyboard Shortcuts shows the keys extensions use, and each extension's page has
 * a Keys tab with the same "give it back to Stave" choice, through the real gestures.
 *
 * The issue's "How we'll know it works", one test each:
 *  - a test-only extension (`e2eTone.ts`) declares a key on a Stave command's chord (Toggle
 *    Sidebar's, on every platform): the row appears with its Source, the Stave command has
 *    the conflict badge, the Source filter narrows the list, and the key runs no Stave
 *    command inside the code;
 *  - "Give back to Stave" makes the Stave command run in the code again, and the
 *    extension's page shows the same choice;
 *  - switched off, the rows and badges are gone and the saved shortcuts are byte-for-byte
 *    the same;
 *  - Vim's real keys (run as Windows, where Vim's Ctrl keys are Stave's Ctrl keys): its
 *    rows, the badge on Toggle Sidebar, Ctrl+P handed back by default, and a toggle on its
 *    page showing in Keyboard Shortcuts and the other way round, with no reload.
 *
 * Screenshots of each state go to the test's output folder.
 */

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const TONE = 'e2e-tone'
const SHORTCUTS = JSON.stringify({ 'stave.view.splitRight': 'mod+alt+\\' })

/** Switch these extensions on before the page loads, the way a saved switch does; and the person's own shortcut. */
async function atLoad(page: Page | BrowserContext, ids: string[]): Promise<void> {
  await page.addInitScript(
    ([v, shortcuts]) => {
      if (sessionStorage.getItem('seeded')) return
      window.localStorage.setItem('stave:extensions', JSON.stringify(v))
      window.localStorage.setItem('stave:keybindings', shortcuts)
      sessionStorage.setItem('seeded', '1')
    },
    [ids, SHORTCUTS] as const,
  )
}

const shortcuts = (page: Page) => page.evaluate(() => window.localStorage.getItem('stave:keybindings'))
const sidePanel = (page: Page) => page.locator('[data-side-panel]')
const settings = (page: Page) => page.getByTestId('settings-shell')
const byTest = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`)

async function openKeys(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByText('Keyboard Shortcuts...').click()
  await expect(settings(page)).toBeVisible({ timeout: 4000 })
  await expect(page.getByTestId('settings-tab-keys')).toHaveAttribute('aria-selected', 'true')
}

async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(settings(page)).toHaveCount(0)
}

async function clickCode(page: Page): Promise<void> {
  await page.locator('[data-workspace-view="editor"] .monaco-editor .view-lines').first().click()
}

async function openExtensionsView(page: Page): Promise<void> {
  if (!(await page.locator('[data-extensions-panel]').isVisible())) {
    await page.locator('[data-activity-bar] [data-panel-id="extensions"]').click()
  }
  await expect(page.locator('[data-extensions-panel]')).toBeVisible()
}

/** Open an extension's page on its Keys tab. */
async function openKeysTab(page: Page, id: string): Promise<void> {
  await openExtensionsView(page)
  await page.locator(`[data-extension-row="${id}"]`).click()
  const view = page.locator(`[data-extension-page="${id}"]`)
  await expect(view).toBeVisible()
  await view.locator('[data-extension-section="keys"]').click()
  await expect(view.locator(`[data-extension-keys="${id}"]`)).toBeVisible()
}

test('a test extension’s key: its row and Source, the badge, the filter; given back it runs Stave’s command; off, all gone', async ({ page }) => {
  test.setTimeout(150_000)
  await atLoad(page, [TONE])
  await bootApp(page, { e2eHooks: true })
  expect(await shortcuts(page)).toBe(SHORTCUTS)
  await expect(sidePanel(page)).toHaveCount(1)

  // Inside the code, ⌘B / Ctrl+B is the extension's: the sidebar stays.
  await clickCode(page)
  await page.keyboard.press(`${MOD}+b`)
  await page.waitForTimeout(300)
  await expect(sidePanel(page)).toHaveCount(1)

  await openKeys(page)
  const row = byTest(page, `ext-key-${TONE}-mod+b`)
  await expect(row).toBeVisible()
  await expect(row).toHaveAttribute('data-given-back', 'false')
  await expect(byTest(page, `source-${TONE}-mod+b`)).toHaveText('Test tone')
  await expect(byTest(page, `ext-where-${TONE}-mod+b`)).toHaveText('inside the code · Test tone uses it')
  await expect(byTest(page, 'source-stave.view.toggleSidebar')).toHaveText('Stave')
  await expect(byTest(page, 'source-stave.view.splitRight')).toHaveText('You')
  await expect(byTest(page, 'ext-conflict-stave.view.toggleSidebar')).toHaveText('Inside the code, Test tone uses this key')
  await row.scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('1-tone-row-and-badge.png') })
  await byTest(page, 'ext-conflict-stave.view.toggleSidebar').scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('2-tone-badge-on-toggle-sidebar.png') })

  // The Source filter: the extension alone, then You alone.
  await byTest(page, `source-filter-extension:${TONE}`).click()
  await expect(row).toBeVisible()
  await expect(byTest(page, 'source-stave.view.toggleSidebar')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('3-filter-test-tone.png') })
  await byTest(page, 'source-filter-you').click()
  await expect(byTest(page, 'source-stave.view.splitRight')).toBeVisible()
  await expect(row).toHaveCount(0)
  await expect(byTest(page, 'source-stave.view.toggleSidebar')).toHaveCount(0)
  await byTest(page, 'source-filter-all').click()

  // Give it back: the badge goes, and inside the code the key toggles the sidebar again.
  await byTest(page, `ext-toggle-${TONE}-mod+b`).click()
  await expect(row).toHaveAttribute('data-given-back', 'true')
  await expect(byTest(page, `ext-toggle-${TONE}-mod+b`)).toHaveText('Use in Test tone')
  await expect(byTest(page, 'ext-conflict-stave.view.toggleSidebar')).toHaveCount(0)
  await closeSettings(page)
  await clickCode(page)
  await page.keyboard.press(`${MOD}+b`)
  await expect(sidePanel(page)).toHaveCount(0)
  await page.keyboard.press(`${MOD}+b`)
  await expect(sidePanel(page)).toHaveCount(1)

  // The extension's page shows the same choice.
  await openKeysTab(page, TONE)
  const pageRow = page.locator(`[data-extension-page="${TONE}"] [data-extension-key="mod+b"]`)
  await expect(pageRow).toHaveAttribute('data-given-back', 'true')
  await expect(pageRow.locator('[data-extension-key-toggle]')).toHaveText('Use in Test tone')
  await page.screenshot({ path: test.info().outputPath('4-tone-page-keys.png') })
  // … and taking it back there brings the badge back in Keyboard Shortcuts.
  await pageRow.locator('[data-extension-key-toggle]').click()
  await expect(pageRow).toHaveAttribute('data-given-back', 'false')
  await openKeys(page)
  await expect(byTest(page, 'ext-conflict-stave.view.toggleSidebar')).toBeVisible()
  await closeSettings(page)

  // Switched off from its page: rows, badges, nav item and filter choice gone.
  const view = page.locator(`[data-extension-page="${TONE}"]`)
  await view.locator(`[data-extension-switch="${TONE}"]`).click()
  await expect(view).toHaveAttribute('data-on', 'false')
  await openKeys(page)
  await expect(byTest(page, 'source-stave.view.toggleSidebar')).toHaveText('Stave')
  await expect(page.locator('[data-testid^="ext-key-"]')).toHaveCount(0)
  await expect(page.locator('[data-testid^="ext-conflict-"]')).toHaveCount(0)
  await expect(byTest(page, `keys-nav-extension:${TONE}`)).toHaveCount(0)
  await expect(byTest(page, `source-filter-extension:${TONE}`)).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('5-tone-off.png') })
  await closeSettings(page)
  // and the key is Stave's again everywhere: back to the code tab
  await page.locator('[data-workspace-group]').getByText('pattern.strudel', { exact: true }).click()
  await clickCode(page)
  await page.keyboard.press(`${MOD}+b`)
  await expect(sidePanel(page)).toHaveCount(0)

  expect(await shortcuts(page)).toBe(SHORTCUTS)
})

test.describe('Vim’s real keys, off a Mac, where its Ctrl keys are Stave’s Ctrl keys', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  })

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32', configurable: true })
    })
  })

  test('its rows and the badge; a toggle on its page shows in Keyboard Shortcuts and the other way round, no reload', async ({ page }) => {
    test.setTimeout(150_000)
    await atLoad(page, ['vim'])
    await bootApp(page)
    await expect(page.locator('[data-vim-bar]').first()).toBeVisible({ timeout: 30_000 })
    await page.evaluate(() => {
      ;(window as unknown as { __noReload?: number }).__noReload = 1
    })

    await openKeys(page)
    // every key Vim declares is a row (21), under its own nav item
    await expect(page.locator('[data-testid^="ext-key-vim-"]')).toHaveCount(21)
    await expect(byTest(page, 'keys-nav-extension:vim')).toContainText('21')
    await expect(byTest(page, 'source-vim-ctrl+r')).toHaveText('Vim')
    // Ctrl+B is Vim's page up and Stave's Toggle Sidebar: marked
    await expect(byTest(page, 'ext-conflict-stave.view.toggleSidebar')).toHaveText('Inside the code, Vim uses this key')
    // Ctrl+P is handed back by default: no badge on quick open, and its row says so
    await expect(byTest(page, 'ext-conflict-stave.quickOpen')).toHaveCount(0)
    await expect(byTest(page, 'ext-key-vim-ctrl+p')).toHaveAttribute('data-given-back', 'true')
    await expect(byTest(page, 'ext-toggle-vim-ctrl+p')).toHaveText('Use in Vim')
    await byTest(page, 'ext-conflict-stave.view.toggleSidebar').scrollIntoViewIfNeeded()
    await page.screenshot({ path: test.info().outputPath('6-vim-badge.png') })
    await byTest(page, 'keys-nav-extension:vim').click()
    await expect(byTest(page, 'keys-section-extension:vim')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('7-vim-rows.png') })
    await byTest(page, 'source-filter-extension:vim').click()
    await expect(byTest(page, 'source-filter-extension:vim')).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: test.info().outputPath('8-vim-filter.png') })

    // In Keyboard Shortcuts, give Ctrl+B back …
    await byTest(page, 'ext-toggle-vim-ctrl+b').click()
    await expect(byTest(page, 'ext-key-vim-ctrl+b')).toHaveAttribute('data-given-back', 'true')
    await closeSettings(page)

    // … and Vim's page says so at once
    await openKeysTab(page, 'vim')
    const vimPage = page.locator('[data-extension-page="vim"]')
    await expect(vimPage.locator('[data-extension-key]')).toHaveCount(21)
    const ctrlB = vimPage.locator('[data-extension-key="ctrl+b"]')
    await expect(ctrlB).toHaveAttribute('data-given-back', 'true')
    await expect(vimPage.locator('[data-extension-key-where="ctrl+b"]')).toContainText('Given back to Stave (your choice)')
    await expect(vimPage.locator('[data-extension-key="ctrl+p"]')).toHaveAttribute('data-given-back', 'true')
    await expect(vimPage.locator('[data-extension-key-toggle="ctrl+p"]')).toHaveText('Use in Vim')
    await page.screenshot({ path: test.info().outputPath('9-vim-page-keys.png') })

    // On the page, give Ctrl+B to Vim again, and Ctrl+P too: Keyboard Shortcuts follows.
    await ctrlB.locator('[data-extension-key-toggle]').click()
    await expect(ctrlB).toHaveAttribute('data-given-back', 'false')
    await vimPage.locator('[data-extension-key-toggle="ctrl+p"]').click()
    await expect(vimPage.locator('[data-extension-key="ctrl+p"]')).toHaveAttribute('data-given-back', 'false')
    await openKeys(page)
    await expect(byTest(page, 'ext-key-vim-ctrl+b')).toHaveAttribute('data-given-back', 'false')
    await expect(byTest(page, 'ext-conflict-stave.view.toggleSidebar')).toBeVisible()
    await expect(byTest(page, 'ext-conflict-stave.quickOpen')).toHaveText('Inside the code, Vim uses this key')
    await closeSettings(page)
    await vimPage.locator('[data-extension-key-toggle="ctrl+p"]').click()
    await expect(vimPage.locator('[data-extension-key="ctrl+p"]')).toHaveAttribute('data-given-back', 'true')

    // Switched off: Vim's rows and badges go.
    await vimPage.locator('[data-extension-switch="vim"]').click()
    await expect(vimPage).toHaveAttribute('data-on', 'false')
    await openKeys(page)
    await expect(page.locator('[data-testid^="ext-key-"]')).toHaveCount(0)
    await expect(page.locator('[data-testid^="ext-conflict-"]')).toHaveCount(0)
    await closeSettings(page)

    expect(await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload)).toBe(1)
    expect(await shortcuts(page)).toBe(SHORTCUTS)
  })
})
