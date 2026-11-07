/**
 * An import lands in the project that is open (#2288).
 *
 * Opening a share link and pressing Import adds the share's files to the project you
 * have open, under `shared/<when it was shared>/`, and opens the share's last file. The
 * files that were there stay as they were, and importing the same share twice gives two
 * folders, not one overwritten.
 *
 * WHY A BROWSER TEST. The placement is unit-tested (`importPlacement.test.ts`); only the
 * app shows that the confirm writes into the open project's files, that the tree shows
 * the folder, and that the editor opens the right file.
 */
import { test, expect, type Page } from '@playwright/test'
import { gzipSync } from 'node:zlib'
import { waitForEditorLoaded, editorValue } from './_appBoot'
import { folderNameFor } from '../src/importPlacement'

const SHARED_AT = new Date(2026, 10, 3, 14, 5).getTime()
const FILES = [
  { id: 'one', path: 'first.strudel', language: 'strudel', content: '$: s("bd sd") // first' },
  { id: 'two', path: 'second.strudel', language: 'strudel', content: '$: s("hh*4") // second' },
  { id: 'three', path: 'last.strudel', language: 'strudel', content: '$: note("c3 e3") // last' },
]

function shareLink(): string {
  const manifest = {
    schemaVersion: 1,
    project: { name: 'Three files', sharedAt: SHARED_AT },
    files: FILES,
    fileOrder: { '': FILES.map((f) => f.id) },
    subfolderOrder: {},
  }
  const b64 = gzipSync(Buffer.from(JSON.stringify(manifest))).toString('base64')
  return `/#share=${b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

/** every file path in the open project, read from the workspace the app writes */
const paths = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const rows = [...document.querySelectorAll('[data-file-tree-item]')]
    return rows.map((r) => r.textContent ?? '')
  })

/** open the link as a fresh page load: changing only the `#` of an open page does not reload it */
async function openLink(page: Page): Promise<void> {
  await page.goto('about:blank')
  await page.goto(shareLink(), { waitUntil: 'domcontentloaded' })
}

async function importLink(page: Page): Promise<void> {
  await openLink(page)
  await waitForEditorLoaded(page)
  await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 30_000 })
}

test.describe('an import lands in the open project (#2288)', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('the files go under shared/<when>/, the last one opens, and what was there stays', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForEditorLoaded(page)
    const before = await paths(page)
    expect(before.length).toBeGreaterThan(0)

    await importLink(page)
    const folder = `shared/${folderNameFor(SHARED_AT)}`
    // the last file of the share is the one in the editor
    await expect.poll(() => editorValue(page), { timeout: 20_000 }).toBe(FILES[2].content)
    await expect(page.locator(`[data-folder-path="${folder}"]`)).toHaveCount(1)
    // one tab for the last file — the others are in the tree, not each opened
    const tabs = page.locator('[data-tab-kind="editor"]')
    await expect(tabs.filter({ hasText: 'last.strudel' })).toHaveCount(1)
    await expect(tabs.filter({ hasText: 'first.strudel' })).toHaveCount(0)
    await expect(tabs.filter({ hasText: 'second.strudel' })).toHaveCount(0)
    await expect(tabs.filter({ hasText: 'last.strudel' })).toHaveAttribute('data-tab-active', 'true')
    await expect(page.locator('[data-testid="toast"]', { hasText: `into ${folder}` }).last()).toBeVisible()
    // the project's own files are all still there
    const after = await paths(page)
    for (const name of before) expect(after).toContain(name)
    // the address is cleared, so a refresh doesn't ask again
    await expect.poll(() => new URL(page.url()).hash).toBe('')
  })

  test('importing the same share again makes a second folder instead of overwriting the first', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForEditorLoaded(page)
    const when = folderNameFor(SHARED_AT)
    await importLink(page)
    await expect(page.locator(`[data-folder-path="shared/${when}"]`)).toHaveCount(1)
    await importLink(page)
    await expect(page.locator(`[data-folder-path="shared/${when} (2)"]`)).toHaveCount(1, { timeout: 20_000 })
    await expect(page.locator(`[data-folder-path="shared/${when}"]`)).toHaveCount(1)
  })

  test('declining the import changes nothing', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForEditorLoaded(page)
    const before = await paths(page)
    const code = await editorValue(page)
    await openLink(page)
    await waitForEditorLoaded(page)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click({ timeout: 30_000 })
    await expect(page.locator('[data-folder-path^="shared"]')).toHaveCount(0)
    expect(await paths(page)).toEqual(before)
    expect(await editorValue(page)).toBe(code)
  })
})
