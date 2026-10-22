/**
 * Save a Song timeline lane's type (Waveform or Bars) through its header menu,
 * the gesture a musician uses (#1738).
 *
 * #2079 — a lane with no saved type draws as Bars unless it plays a long
 * recording, so a spec about a synth's render or a short take's shape saves
 * Waveform first, by hand, as a musician who wants to see it would.
 */
import { expect, type Page } from '@playwright/test'

export async function chooseDisplay(page: Page, laneKey: string, display: 'waveform' | 'bars'): Promise<void> {
  await page.locator(`[data-full-song-lane-name="${laneKey}"]`).click({ button: 'right' })
  const menu = page.locator(`[data-full-song-lane-menu="${laneKey}"]`)
  await menu.locator('[data-full-song-lane-menu-type]').hover()
  await menu.locator(`[data-full-song-lane-menu-display="${display}"]`).click()
  await expect(menu).toHaveCount(0)
}

/** The type the lane's header menu shows as checked; closes the menu again. */
export async function shownDisplay(page: Page, laneKey: string): Promise<string | null> {
  await page.locator(`[data-full-song-lane-name="${laneKey}"]`).click({ button: 'right' })
  const menu = page.locator(`[data-full-song-lane-menu="${laneKey}"]`)
  await menu.locator('[data-full-song-lane-menu-type]').hover()
  const checked = menu.locator('[data-full-song-lane-menu-display][aria-checked="true"]')
  await expect(checked).toHaveCount(1)
  const got = await checked.getAttribute('data-full-song-lane-menu-display')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  return got
}
