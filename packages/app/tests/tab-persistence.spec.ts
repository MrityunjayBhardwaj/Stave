import { test, expect, type Page } from '@playwright/test'

// Issue #175 — workspace shell state persistence.
//   1. Fresh load (no persisted state) opens the template's tabs — the Starter's
//      song and its backdrop's code (#2240) — not the wall of 11 that mapping
//      every preset file to a tab used to.
//   2. Tabs the user opens via the file tree survive a refresh, in order.
//   3. Closing a tab persists across refresh.
//
// The shell's state lives in localStorage under `stave:workspace:${projectId}:state`.
// To exercise "fresh load" deterministically we wipe ANY key with the
// `stave:workspace:` prefix before each test (also clears any pre-existing
// project state from prior dev sessions).

/**
 * One-shot wipe of any persisted shell state from prior dev sessions.
 * Runs ONCE, before the page is loaded with the app — `page.addInitScript`
 * would re-run on every navigation (including page.reload()) and erase the
 * very state we want to verify survives a refresh.
 */
async function wipeShellStateOnce(page: Page): Promise<void> {
  await page.goto('about:blank')
  await page.evaluate(() => {
    try {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('stave:workspace:')) keys.push(k)
      }
      for (const k of keys) localStorage.removeItem(k)
    } catch {
      // Private mode etc. — non-fatal for the test.
    }
  })
}

test.beforeEach(async ({ page }) => {
  await wipeShellStateOnce(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)
})

/** The files open as tabs right now (tab ids are `tab-<fileId>`). */
async function openFileIds(page: Page): Promise<Set<string>> {
  const ids = await page.locator('[data-workspace-tab]').evaluateAll((els) =>
    els.map((e) => (e.getAttribute('data-workspace-tab') ?? '').replace(/^tab-/, '')),
  )
  return new Set(ids)
}

/** Open (double-click) the first file in the tree that is not open yet. */
async function openAnotherFile(page: Page): Promise<string | null> {
  const open = await openFileIds(page)
  const treeItems = page.locator('[data-file-tree-item]')
  const count = await treeItems.count()
  for (let i = 0; i < count; i++) {
    const fileId = (await treeItems.nth(i).getAttribute('data-file-tree-item'))!
    if (open.has(fileId)) continue
    // FileTree opens a file on double-click (preview = single click, pin = double).
    await treeItems.nth(i).dblclick()
    return fileId
  }
  return null
}

test('fresh load opens the Starter\'s two tabs (the song active), not 11', async ({ page }) => {
  const tabs = page.locator('[data-workspace-tab]')
  await expect(tabs).toHaveCount(2, { timeout: 6000 })
  // Active editor tab.
  await expect(tabs.first()).toHaveAttribute('data-tab-kind', 'editor')
  await expect(tabs.first()).toHaveAttribute('data-tab-active', 'true')
})

test('opening another file via the file tree persists across refresh', async ({ page }) => {
  const start = (await openFileIds(page)).size
  expect(await openAnotherFile(page)).not.toBeNull()
  await expect(page.locator('[data-workspace-tab]')).toHaveCount(start + 1, { timeout: 6000 })

  // Refresh — persistence kicks in.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)

  // Same tabs after the refresh.
  await expect(page.locator('[data-workspace-tab]')).toHaveCount(start + 1)
})

test('closing a tab persists across refresh', async ({ page }) => {
  // Open one more tab so the one we close is ours.
  const start = (await openFileIds(page)).size
  expect(await openAnotherFile(page)).not.toBeNull()
  await expect(page.locator('[data-workspace-tab]')).toHaveCount(start + 1, { timeout: 6000 })

  // Close the just-opened (active) tab via its ✕ button. The shell
  // renders one per tab with a stable testid: `tab-close-${tab.id}`.
  const activeTab = page.locator('[data-workspace-tab][data-tab-active="true"]')
  const activeTabId = await activeTab.getAttribute('data-workspace-tab')
  expect(activeTabId).toBeTruthy()
  await page.locator(`[data-testid="tab-close-${activeTabId}"]`).click()
  await expect(page.locator('[data-workspace-tab]')).toHaveCount(start, { timeout: 6000 })

  // Refresh — the close must have been persisted.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)
  await expect(page.locator('[data-workspace-tab]')).toHaveCount(start)
})
