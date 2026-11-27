/**
 * _2662-soundfont-upload — bringing a `.sf2` in through the real Library gesture.
 *
 * Underscore-prefixed, run directly (not a gate spec), like the #2658 spike.
 *
 * Every step is the real gesture: the font arrives through the Library's Upload
 * input (the same hidden `<input type=file>` the button clicks), and what is
 * asserted is what the app then holds — the sound is live in the registry the
 * picker reads, it is listed under Sounds → User (not buried in the 125 built-in
 * GM fonts), and the toast names it.
 *
 * ⚠ Vacuous-pass guard: a `.sf2` persisted by an earlier run would be re-registered
 * at boot by #2661, so the font could be present before this test uploads anything.
 * The store is therefore reset and the page reloaded first, and the font asserted
 * ABSENT before the upload — the positive is not passing against a leftover.
 */
import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { bootApp } from './_appBoot'

const FIXTURE = join(__dirname, 'fixtures', 'vintage-dreams.sf2')

type W = {
  __staveSoundfontProbe?: { storeReset(): Promise<void> }
  soundMap?: { get?: () => Record<string, unknown> }
}

/** Wait until the engine has warmed up and published its soundMap (GM set present). */
async function waitEngine(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const sm = (window as unknown as W).soundMap?.get?.()
      return Boolean(sm && Object.keys(sm).some((k) => k.startsWith('gm_')))
    },
    { timeout: 30000 },
  )
}

const hasKey = (page: Page, key: string) =>
  page.evaluate((k) => Boolean((window as unknown as W).soundMap?.get?.()?.[k]), key)

/** The Library is a toggled sidebar panel — open it if it isn't already. */
async function openLibrary(page: Page): Promise<void> {
  if (await page.locator('[data-asset-library]').count()) return
  await page.getByRole('button', { name: /library/i }).first().click()
  await page.locator('[data-asset-library]').waitFor({ timeout: 15000 })
}

test('uploading an .sf2 registers it live and lists it under Sounds → User (#2662)', async ({
  page,
}) => {
  const bytes = readFileSync(FIXTURE)

  await bootApp(page, { e2eHooks: true })
  await openLibrary(page)
  await page.waitForFunction(
    () => Boolean((window as unknown as { __staveSoundfontProbe?: unknown }).__staveSoundfontProbe),
    { timeout: 20000 },
  )
  await waitEngine(page)

  // Clean slate: clear any persisted fonts, then reload so this boot's #2661 step
  // re-registers from an EMPTY store — sf_vintage must not be live yet.
  await page.evaluate(() => (window as unknown as W).__staveSoundfontProbe!.storeReset())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await openLibrary(page)
  await waitEngine(page)
  expect(await hasKey(page, 'sf_vintage'), 'negative control: absent before upload').toBe(false)

  // The real gesture: drop the bytes into the Library's upload input. The name
  // (not the source path) decides the key, so name it `vintage.sf2`.
  await page
    .locator('[data-add-audio-input]')
    .setInputFiles({ name: 'vintage.sf2', mimeType: 'application/octet-stream', buffer: bytes })

  // The import finishes when the button re-enables.
  await expect(page.locator('[data-add-audio]')).toBeEnabled({ timeout: 20000 })

  // Registered live in the registry the picker reads.
  await page.waitForFunction(() => Boolean((window as unknown as W).soundMap?.get?.()?.sf_vintage), {
    timeout: 20000,
  })
  expect(await hasKey(page, 'sf_vintage'), 'registered live after upload').toBe(true)

  // The toast names the font.
  await expect(page.locator('[data-add-audio-message]')).toContainText('soundfont', { timeout: 10000 })

  // Listed under Sounds → User (not among the built-in GM fonts).
  await page.locator('[data-filter="asset-type-filter"] [data-chip="sound"]').click()
  await page.locator('[data-filter="asset-source-filter"] [data-chip="user"]').click()
  await page.locator('[data-asset-search]').fill('vintage')
  await expect(
    page.locator('[data-asset-row^="sound:"]', { hasText: 'Vintage' }).first(),
  ).toBeVisible({ timeout: 10000 })

  // Visual record of the redesigned header (title line, Upload + Record below).
  await page
    .locator('[data-asset-library]')
    .screenshot({ path: join(__dirname, '..', 'test-results', 'soundfont-upload', 'library.png') })
})
