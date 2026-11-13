import { test, expect, type Page } from '@playwright/test'
import { gzipSync } from 'node:zlib'

/**
 * #2586 — a pane emptied by closing its tabs goes away, however many tabs the
 * action closed. Close All (tab menu) on a pane's two tabs used to leave the pane
 * behind, empty: each close saw the pane as it was before the action started.
 * The empty pane Split makes on purpose stays.
 */

test.setTimeout(120_000)

function shareHash(): string {
  const files = ['a', 'b', 'c'].map((n) => ({ id: n, path: `${n}.strudel`, language: 'strudel', content: `s("bd")` }))
  const manifest = { schemaVersion: 1, project: { name: 'pane closes when emptied', sharedAt: Date.now() }, files, fileOrder: { '': ['a', 'b', 'c'] }, subfolderOrder: {} }
  return '#share=' + gzipSync(Buffer.from(JSON.stringify(manifest))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const panes = (p: Page) => p.locator('[data-workspace-group]')
const tabsOf = (p: Page, i: number) => panes(p).nth(i).locator('[data-workspace-tab]')

async function boot(page: Page): Promise<void> {
  page.on('dialog', (d) => d.accept())
  await page.goto(`/${shareHash()}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 60_000 })
  await page.locator('[data-file-tree-item]').filter({ hasText: 'a.strudel' }).first().dblclick()
  await expect(panes(page)).toHaveCount(1, { timeout: 15_000 })
}

/** split right and open `names` in the new pane, each kept (not an italic preview) */
async function rightPaneWith(page: Page, names: string[]): Promise<void> {
  await page.locator('[data-testid^="group-split-"]').first().click()
  await expect(panes(page)).toHaveCount(2)
  await panes(page).nth(1).click({ position: { x: 50, y: 80 } })
  for (const n of names) {
    await page.locator('[data-file-tree-item]').filter({ hasText: n }).first().dblclick()
    const tab = tabsOf(page, 1).filter({ hasText: n }).first()
    await expect(tab).toHaveCount(1, { timeout: 15_000 })
    await tab.dblclick()
  }
  await expect(tabsOf(page, 1)).toHaveCount(names.length)
}

async function fromTabMenu(page: Page, tab: string, item: string): Promise<void> {
  await tabsOf(page, 1).filter({ hasText: tab }).first().click({ button: 'right' })
  await page.locator('[data-stave-ctx-item]', { hasText: new RegExp(`^${item}$`) }).first().click()
}

test('Close All on the right pane\'s two tabs closes the pane', async ({ page }) => {
  await boot(page)
  await rightPaneWith(page, ['b.strudel', 'c.strudel'])
  await fromTabMenu(page, 'b.strudel', 'Close All')
  await expect(panes(page)).toHaveCount(1)
  await expect(tabsOf(page, 0).filter({ hasText: 'a.strudel' })).toHaveCount(1)
})

test('Close Others keeps the pane with the one tab, and Split\'s empty pane stays', async ({ page }) => {
  await boot(page)
  await rightPaneWith(page, ['b.strudel', 'c.strudel'])
  await fromTabMenu(page, 'b.strudel', 'Close Others')
  await expect(panes(page)).toHaveCount(2)
  await expect(tabsOf(page, 1)).toHaveText([/b\.strudel/])
  await page.locator('[data-testid^="group-split-"]').first().click()
  await expect(panes(page)).toHaveCount(3)
  await page.waitForTimeout(500)
  await expect(panes(page)).toHaveCount(3)
})
