/**
 * Backdrop via the ⚙ viz-settings popover (#773, reshaped from #37/#771).
 *
 * The viz chrome's backdrop control is now the ⚙ gear → viz-settings popover,
 * whose `preview: [off | side | backdrop]` segment places this viz. Only viz
 * file tabs show the gear; pattern files get none.
 *
 * Covers:
 *   - Gear absent on pattern tabs, present + 'off' on viz tabs.
 *   - preview=backdrop mounts the backdrop layer with the right fileId; the
 *     gear reports data-preview-mode="backdrop"; backdrop controls appear;
 *     preview=off clears it.
 *   - Backdrop survives tab switches (file-pinned model).
 *   - Selection persists across page reload (#38 unchanged).
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

async function clickHydraTab(page: import('@playwright/test').Page) {
  // Try existing tabs first (persistence may have restored one).
  const allTabs = page.locator('[data-workspace-tab]')
  const count = await allTabs.count()
  for (let i = 0; i < count; i++) {
    const text = await allTabs.nth(i).textContent()
    if (text && /\.hydra/.test(text)) {
      await allTabs.nth(i).click()
      await page.waitForTimeout(300)
      return
    }
  }
  // Issue #175 — the default workspace now opens a single Strudel tab,
  // not the 11-tab wall. Open a hydra preset via the file tree. File-tree
  // items expose the fileId on `data-file-tree-item` and the visible name
  // on the row; bundled hydra fileIds contain "hydra" — match on that.
  const hydraItem = page
    .locator('[data-file-tree-item*="hydra"]')
    .first()
  if ((await hydraItem.count()) === 0) {
    throw new Error('no hydra preset file in default project')
  }
  await hydraItem.dblclick()
  await page.waitForTimeout(500)
}

// #773 — set THIS viz file as the group backdrop via the ⚙ viz-settings
// popover: open the gear, pick preview=backdrop.
async function setBackdrop(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="viz-chrome-settings"]').first().click()
  await page.locator('[data-testid="viz-settings-popover"]').waitFor({
    timeout: 2000,
  })
  await page.locator('[data-testid="viz-preview-mode-backdrop"]').first().click()
}

test.describe('Backdrop via viz-settings popover (#773)', () => {
  test('settings gear absent on pattern tabs, present on viz tabs', async ({ page }) => {
    await gotoApp(page)
    await page
      .locator('[data-workspace-tab]', { hasText: 'pattern.strudel' })
      .click()
    await expect(
      page.locator('[data-testid="viz-chrome-settings"]'),
    ).toHaveCount(0)

    await clickHydraTab(page)
    const gear = page.locator('[data-testid="viz-chrome-settings"]').first()
    await expect(gear).toBeVisible()
    await expect(gear).toHaveAttribute('data-preview-mode', 'off')
  })

  test('preview=backdrop mounts the backdrop; controls appear; preview=off clears it', async ({ page }) => {
    await gotoApp(page)
    await clickHydraTab(page)

    await expect(page.locator('[data-workspace-background]')).toHaveCount(0)

    await setBackdrop(page)

    const backdrop = page.locator('[data-workspace-background]').first()
    await expect(backdrop).toBeVisible({ timeout: 5000 })
    const gear = page.locator('[data-testid="viz-chrome-settings"]').first()
    await expect(gear).toHaveAttribute('data-preview-mode', 'backdrop')
    const bgFileId = await backdrop.getAttribute('data-background-file-id')
    expect(bgFileId).toBeTruthy()

    // Backdrop controls surface in the popover while in backdrop mode.
    const popover = page.locator('[data-testid="viz-settings-popover"]')
    await expect(popover.locator('[data-testid="viz-settings-quality"]')).toBeVisible()
    await expect(popover.locator('[data-testid="viz-settings-vizspan"]')).toBeVisible()

    // preview=off clears the backdrop.
    await popover.locator('[data-testid="viz-preview-mode-off"]').click()
    await expect(page.locator('[data-workspace-background]')).toHaveCount(0)
    await expect(gear).toHaveAttribute('data-preview-mode', 'off')
  })

  test('play/pause button pauses + resumes the BACKDROP (#781)', async ({ page }) => {
    await gotoApp(page)
    await clickHydraTab(page)
    await setBackdrop(page)

    const backdrop = page.locator('[data-workspace-background]').first()
    await expect(backdrop).toBeVisible({ timeout: 5000 })
    // Live by default.
    await expect(backdrop).toHaveAttribute('data-backdrop-live', 'true')

    // The play/pause button shows in backdrop mode (before the ⚙ gear).
    const transport = page.locator('[data-testid="viz-chrome-open-preview"]').first()
    await expect(transport).toBeVisible()
    await expect(transport).toHaveAttribute('data-preview-mode', 'backdrop')
    await expect(transport).toContainText('Pause')

    // Pause → backdrop freezes (data-backdrop-live flips to false).
    await transport.click()
    await expect(backdrop).toHaveAttribute('data-backdrop-live', 'false')
    await expect(transport).toContainText('Play')

    // Play → resumes.
    await transport.click()
    await expect(backdrop).toHaveAttribute('data-backdrop-live', 'true')
    await expect(transport).toContainText('Pause')
  })

  test('backdrop is PER-TAB (#347) — clears on switch to a tab without one, restores on return', async ({
    page,
  }) => {
    await gotoApp(page)
    await clickHydraTab(page)

    await setBackdrop(page)
    await expect(
      page.locator('[data-workspace-background]').first(),
    ).toBeVisible({ timeout: 5000 })

    // Switch to the pattern tab — it has no backdrop of its own → pane clears.
    await page
      .locator('[data-workspace-tab]', { hasText: 'pattern.strudel' })
      .click()
    await page.waitForTimeout(400)
    await expect(page.locator('[data-workspace-background]')).toHaveCount(0)

    // Back to the hydra tab → its own backdrop is restored.
    await clickHydraTab(page)
    await expect(
      page.locator('[data-workspace-background]').first(),
    ).toBeVisible({ timeout: 2000 })
  })

  test('selection persists across page reload (#38)', async ({ page }) => {
    await gotoApp(page)
    await clickHydraTab(page)

    await setBackdrop(page)
    const backdrop = page.locator('[data-workspace-background]').first()
    await expect(backdrop).toBeVisible({ timeout: 5000 })
    const fileIdBefore = await backdrop.getAttribute('data-background-file-id')

    await page.reload()
    await page.locator('[data-workspace-shell="root"]').waitFor({
      timeout: 15000,
    })
    await page.locator('.monaco-editor').waitFor({ timeout: 15000 })

    const backdropAfter = page.locator('[data-workspace-background]').first()
    await expect(backdropAfter).toBeVisible({ timeout: 5000 })
    const fileIdAfter = await backdropAfter.getAttribute(
      'data-background-file-id',
    )
    expect(fileIdAfter).toBe(fileIdBefore)
  })

  // #783 — the primary is a pure play/pause (NOT an "open onto the side"
  // shortcut). A fresh viz file shows "▶ Play" and, since the default placement
  // is backdrop, clicking PLAYS it as the backdrop (not a side split).
  test('fresh viz file shows "▶ Play" that activates the BACKDROP by default (#783)', async ({
    page,
  }) => {
    await gotoApp(page)
    await clickHydraTab(page)

    const primary = page.locator('[data-testid="viz-chrome-open-preview"]').first()
    await expect(primary).toBeVisible()
    await expect(primary).toHaveAttribute('data-button-state', 'idle')
    await expect(primary).toHaveAttribute('data-preview-mode', 'off')
    await expect(primary).toContainText('Play')
    await expect(primary).not.toContainText('Preview')

    // No side preview pane exists yet.
    const sideBefore = await page.locator('[data-workspace-tab]').count()

    // Click Play → the BACKDROP mounts (not a side split); button flips to
    // the backdrop pause transport.
    await primary.click()
    await expect(page.locator('[data-workspace-background]').first()).toBeVisible({
      timeout: 5000,
    })
    await expect(primary).toHaveAttribute('data-preview-mode', 'backdrop')
    await expect(primary).toContainText('Pause')
    // It did NOT open a side preview tab.
    expect(await page.locator('[data-workspace-tab]').count()).toBe(sideBefore)

    // #783 — the backdrop must be VISIBLE, not opacity 0. Regression: a fresh
    // profile read Number(null)===0 as a valid opacity and rendered the viz
    // fully transparent behind the editor ("background not working").
    const bgOpacity = await page.evaluate(() => {
      const bg = document.querySelector('[data-workspace-background]')
      return bg ? getComputedStyle(bg).opacity : null
    })
    expect(bgOpacity).not.toBeNull()
    expect(Number(bgOpacity)).toBeGreaterThan(0)
  })

  // #782 — backdrop controls used to vanish entirely off backdrop mode. Now
  // they're always rendered, disabled/greyed until preview=backdrop.
  test('⚙ popover shows backdrop controls disabled in off mode, enabled in backdrop (#782)', async ({
    page,
  }) => {
    await gotoApp(page)
    await clickHydraTab(page)

    // Open the popover in the default 'off' mode.
    await page.locator('[data-testid="viz-chrome-settings"]').first().click()
    const popover = page.locator('[data-testid="viz-settings-popover"]')
    await popover.waitFor({ timeout: 2000 })
    await expect(popover).toHaveAttribute('data-mode', 'off')

    // Controls PRESENT but disabled (data-disabled="true").
    for (const tid of [
      'viz-settings-opacity',
      'viz-settings-quality',
      'viz-settings-crop',
      'viz-settings-reveal',
      'viz-settings-vizspan',
    ]) {
      const el = popover.locator(`[data-testid="${tid}"]`)
      await expect(el).toBeVisible()
      await expect(el).toHaveAttribute('data-disabled', 'true')
      await expect(el).toBeDisabled()
    }

    // Switch to backdrop → the same controls enable.
    await popover.locator('[data-testid="viz-preview-mode-backdrop"]').click()
    await expect(popover).toHaveAttribute('data-mode', 'backdrop')
    for (const tid of [
      'viz-settings-opacity',
      'viz-settings-quality',
      'viz-settings-crop',
      'viz-settings-reveal',
      'viz-settings-vizspan',
    ]) {
      const el = popover.locator(`[data-testid="${tid}"]`)
      await expect(el).toHaveAttribute('data-disabled', 'false')
      await expect(el).toBeEnabled()
    }
  })

  // #785 — closing the viz FILE tab tears down its backdrop (and its audio,
  // asserted in the WorkspaceShell unit test — audio can't be observed here).
  test('closing the viz file tab clears its backdrop (#785)', async ({ page }) => {
    await gotoApp(page)
    await clickHydraTab(page)

    // Play → backdrop.
    await page.locator('[data-testid="viz-chrome-open-preview"]').first().click()
    await expect(page.locator('[data-workspace-background]').first()).toBeVisible({
      timeout: 5000,
    })

    // Close the hydra EDITOR tab via its × button.
    const editorTab = page
      .locator('[data-workspace-tab][data-tab-kind="editor"]')
      .filter({ hasText: 'hydra' })
      .first()
    const tabId = await editorTab.getAttribute('data-workspace-tab')
    await page.locator(`[data-testid="tab-close-${tabId}"]`).click()

    // Backdrop layer is gone, and the viz chrome is gone with the tab. What
    // chrome remains belongs to the tab now active: the Starter's Sunset Drive
    // tab (#2240) is a viz file too, and shows its own gear when active.
    await expect(page.locator('[data-workspace-background]')).toHaveCount(0)
    await expect(page.locator('[data-workspace-tab]').filter({ hasText: 'hydra' })).toHaveCount(0)
    const active = page.locator('[data-workspace-tab][data-tab-active="true"]')
    const activeIsViz = /\.(p5|hydra|glsl)\b/.test((await active.first().innerText()) ?? '')
    await expect(page.locator('[data-testid="viz-chrome-settings"]')).toHaveCount(activeIsViz ? 1 : 0)
  })

  // #787 — a playing backdrop FOLLOWS its viz file tab when the tab is dragged
  // to another pane, and closing the moved tab still stops the sample audio.
  // Audio can't be heard headlessly, so the assertion tracks AudioContext
  // lifecycle: the sample source's stop() closes its context.
  test('backdrop + audio follow a moved viz tab; close after move stops audio (#787)', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __ctxs: AudioContext[] }
      w.__ctxs = []
      const Orig = window.AudioContext
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).AudioContext = class extends Orig {
        constructor(...args: ConstructorParameters<typeof Orig>) {
          super(...args)
          w.__ctxs.push(this)
        }
      }
    })
    await gotoApp(page)
    await clickHydraTab(page)

    // ⚙ → pin the "Sample sound" source, then ▶ Play → backdrop + audio.
    await page.locator('[data-testid="viz-chrome-settings"]').first().click()
    const src = page.locator('[data-testid="viz-chrome-source"]')
    await src.waitFor({ timeout: 2000 })
    await src.selectOption('file:__sample__')
    await page.keyboard.press('Escape')
    await page.locator('[data-testid="viz-chrome-open-preview"]').first().click()

    const backdrop = page.locator('[data-workspace-background]')
    await expect(backdrop.first()).toBeVisible({ timeout: 5000 })
    const originalGroupId = await backdrop
      .first()
      .getAttribute('data-workspace-background')
    // Count the running contexts the VIZ owns — i.e. every context EXCEPT the
    // app's shared one (`getAudioContext()`, superdough's).
    //
    // This used to count every running AudioContext and require ZERO after the
    // close. That is the wrong requirement: sample audition now runs through the
    // SHARED context, so opening the preview lazily creates it, and an
    // AudioContext can never be reopened once closed — tearing it down on a tab
    // close would permanently kill all app audio. Observed: the viz's own context
    // IS closed on close (state "closed"); the survivor is `getAudioContext()`
    // itself, still ticking, exactly as it should. The old assertion turned that
    // correct behaviour into a red (#875).
    const runningVizCtxs = () =>
      page.evaluate(() => {
        const w = window as unknown as {
          __ctxs: AudioContext[]
          getAudioContext?: () => AudioContext
        }
        let shared: AudioContext | null = null
        try {
          shared = w.getAudioContext?.() ?? null
        } catch {
          shared = null
        }
        return w.__ctxs.filter((c) => c !== shared && c.state === 'running').length
      })
    /** The shared context must SURVIVE the close — the opposite regression. */
    const sharedAlive = () =>
      page.evaluate(() => {
        const w = window as unknown as { getAudioContext?: () => AudioContext }
        try {
          return w.getAudioContext?.()?.state !== 'closed'
        } catch {
          return false
        }
      })
    expect(await runningVizCtxs()).toBeGreaterThan(0)

    // Drag the hydra EDITOR tab to the east quadrant of its group → new pane.
    const editorTab = page
      .locator('[data-workspace-tab][data-tab-kind="editor"]')
      .filter({ hasText: 'hydra' })
      .first()
    const groupEl = page.locator(
      `[data-workspace-group="${originalGroupId}"]`,
    )
    const box = await groupEl.boundingBox()
    if (!box) throw new Error('group bounding box unavailable')
    await editorTab.dragTo(groupEl, {
      targetPosition: { x: box.width - 30, y: Math.round(box.height / 2) },
    })

    // Bug1: exactly ONE backdrop, and it moved WITH the tab to the new group.
    await expect(backdrop).toHaveCount(1)
    const movedGroupId = await editorTab.evaluate((el) =>
      el
        .closest('[data-workspace-group]')
        ?.getAttribute('data-workspace-group'),
    )
    expect(movedGroupId).not.toBe(originalGroupId)
    await expect(backdrop.first()).toHaveAttribute(
      'data-workspace-background',
      movedGroupId!,
    )
    // The chrome in the new pane sees the live backdrop (Pause transport, not
    // a fresh idle Play) — the gesture that used to break close's teardown.
    await expect(
      page.locator('[data-testid="viz-chrome-open-preview"]').first(),
    ).toHaveAttribute('data-button-state', 'running')
    // The move itself never interrupted the audio.
    expect(await runningVizCtxs()).toBeGreaterThan(0)

    // Bug2: closing the moved tab clears the backdrop AND stops the VIZ's audio.
    const tabId = await editorTab.getAttribute('data-workspace-tab')
    await page.locator(`[data-testid="tab-close-${tabId}"]`).click()
    await expect(backdrop).toHaveCount(0)
    await expect
      .poll(runningVizCtxs, { timeout: 3000 })
      .toBe(0)
    // ...and it did NOT take the app's shared audio context down with it. That
    // context can never be reopened, so tearing it down on a tab close would kill
    // all audio for the rest of the session — the regression in the other
    // direction, which the previous assertion would have DEMANDED.
    expect(await sharedAlive()).toBe(true)
  })
})
