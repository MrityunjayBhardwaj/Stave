/**
 * Phase 3 E2E — code-surface backdrop (#39), backdrop quality ladder (#41).
 */

import { test, expect } from '@playwright/test'
import { clearPinnedBackdrop } from './_appBoot'

async function gotoApp(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.locator('[data-workspace-shell="root"]').waitFor({
    timeout: 15000,
  })
  await page.locator('.monaco-editor').waitFor({ timeout: 15000 })
  // these arms start from a project with no backdrop; the Starter pins one (#2240)
  await clearPinnedBackdrop(page)
}

// #773 — open a hydra viz tab via the file tree (reliable; the default
// workspace has no hydra tab), then set it as the group backdrop through the
// ⚙ viz-settings popover.
async function openHydraAndSetBackdrop(page: import('@playwright/test').Page) {
  const hydra = page.locator('[data-file-tree-item*="hydra"]').first()
  await hydra.dblclick()
  const gear = page.locator('[data-testid="viz-chrome-settings"]').first()
  await gear.waitFor({ timeout: 10000 })
  await gear.click()
  await page.locator('[data-testid="viz-preview-mode-backdrop"]').first().click()
}

test.describe('Code surface backdrop (#39)', () => {
  test('data-stave-backdrop attr flips on + off with backdrop state', async ({
    page,
  }) => {
    await gotoApp(page)

    const panel = page
      .locator('[data-stave-code-panel="true"]')
      .first()
    await expect(panel).toHaveAttribute('data-stave-backdrop', 'off')

    // Open a hydra tab and set it as backdrop → the code panel flips to
    // backdrop mode.
    await openHydraAndSetBackdrop(page)
    await expect(panel).toHaveAttribute('data-stave-backdrop', 'on', {
      timeout: 5000,
    })
  })
})

test.describe('Backdrop quality ladder (#41)', () => {
  test('data-backdrop-quality reflects the stored setting', async ({ page }) => {
    // Seed quarter before visiting — backdrop mounts read the value
    // through onBackdropQualityChange subscription, which fires from
    // initial read at subscription time. Setting before load is the
    // most deterministic way to exercise the render path.
    await page.goto('/')
    await page.evaluate(() => {
      window.localStorage.setItem('stave:backdropQuality', 'quarter')
    })
    await page.reload()
    await page.locator('[data-workspace-shell="root"]').waitFor({
      timeout: 15000,
    })
    await page.locator('.monaco-editor').waitFor({ timeout: 15000 })

    // Pin a backdrop (⚙ → preview=backdrop) to exercise the render.
    await openHydraAndSetBackdrop(page)

    const backdrop = page.locator('[data-workspace-background]').first()
    await expect(backdrop).toBeVisible({ timeout: 5000 })
    await expect(backdrop).toHaveAttribute(
      'data-backdrop-quality',
      'quarter',
    )

    await page.evaluate(() => {
      window.localStorage.removeItem('stave:backdropQuality')
    })
  })
})
