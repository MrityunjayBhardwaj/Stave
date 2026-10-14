import { expect, test, type Page } from '@playwright/test'

import { bootApp, evalCode, seedCode, stopCode } from './_appBoot'

/**
 * Whether Play takes the phone's audio is a setting (#2015). On: Play tells the
 * browser it PLAYS audio (heard through the silent switch; other apps' music stops).
 * Off: it plays alongside other apps (`ambient`).
 *
 * Chromium has no `navigator.audioSession` (Safari's API), so the page gets a
 * stand-in that records the type the page sets. The switch is flipped through the
 * real Settings dialog; Play and Stop are the real shortcuts.
 *
 * ONE assertion per test: a second `expect` never runs once the first fails.
 */

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } })
  })
  await bootApp(page)
}

const sessionType = (page: Page) =>
  page.evaluate(() => (navigator as unknown as { audioSession: { type: string } }).audioSession.type)

async function play(page: Page): Promise<void> {
  await seedCode(page, '$: s("bd*2")\n')
  await evalCode(page)
  await page.waitForTimeout(500)
}

async function flipSetting(page: Page): Promise<void> {
  await page.getByText('File', { exact: true }).click()
  await page.getByText('Editor Settings...', { exact: true }).click()
  await page.getByRole('button', { name: 'Sound', exact: true }).click()
  await page.locator('[data-testid="setting-takesPhoneAudio"]').click()
  await page.keyboard.press('Escape')
}

test.describe('Play through the silent switch (a setting)', () => {
  test('on by default: Play says it plays audio', async ({ page }) => {
    await boot(page)
    await play(page)
    await stopCode(page)
    expect(await sessionType(page)).toBe('playback')
  })

  test('turned off while playing, other apps are let back in at once', async ({ page }) => {
    await boot(page)
    await play(page)
    await flipSetting(page)
    const type = await sessionType(page)
    await stopCode(page)
    expect(type).toBe('ambient')
  })

  test('off survives a reload: the next Play plays alongside other apps', async ({ page }) => {
    await boot(page)
    await flipSetting(page)
    await boot(page)
    await play(page)
    await stopCode(page)
    expect(await sessionType(page)).toBe('ambient')
  })
})
