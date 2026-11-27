/**
 * _2661-soundfont-reregister — the engine re-registers persisted `.sf2` fonts on
 * every boot, so a font uploaded in one session is playable after a reload with
 * no re-upload.
 *
 * Underscore-prefixed, run directly (not a gate spec), like the #2658 spike.
 *
 * THE TRAP #2661 closes: superdough's registry is module-scoped and rebuilt on
 * every engine init. The GM set survives reloads only because `registerSoundfonts()`
 * re-runs each boot; user fonts need the same, or they work until the first reload
 * and then silently vanish. The engine's `registerUserSoundfonts()` boot step reads
 * the store (#2660) and re-registers each font (#2659).
 *
 * THE OBSERVATION drives a FRESH engine whose `init()` runs that boot step and
 * registers NOTHING explicitly — so the font's presence can only come from the
 * store being read on boot. The negative control (empty store ⇒ absent) rides in
 * the same run, so the positive is not passing against something that is simply
 * always present.
 */
import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { bootApp } from './_appBoot'

const FIXTURE = join(__dirname, 'fixtures', 'vintage-dreams.sf2')

async function waitForProbe(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __staveSoundfontProbe?: unknown }).__staveSoundfontProbe),
    { timeout: 20000 },
  )
}

test('a stored .sf2 is registered on the next engine boot, not before (#2661)', async ({ page }) => {
  const sf2Base64 = readFileSync(FIXTURE).toString('base64')

  await bootApp(page, { e2eHooks: true })
  await waitForProbe(page)

  // Negative control: with the store empty, a fresh engine boot has no sf_vintage.
  const empty = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (window as any).__staveSoundfontProbe
    await p.storeReset()
    return p.bootRegistersFromStore('vintage')
  })
  expect(empty.present, 'empty store ⇒ a fresh boot registers no user font').toBe(false)

  // Persist the font (bytes only — this does NOT register it into any engine).
  await page.evaluate(async (b64) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__staveSoundfontProbe.storePut(b64, 'vintage')
  }, sf2Base64)

  // Full reload: fresh page, fresh module-scoped registry. The font is only in
  // IndexedDB now.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForProbe(page)

  // A fresh engine boot on the reloaded page must pick the font up FROM THE STORE,
  // make it a soundfont the picker can see, and play it — with no re-upload.
  const after = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__staveSoundfontProbe.bootRegistersFromStore('vintage')
  })
  console.log('[reregister] after reload:', JSON.stringify(after))

  expect(after.present, `registered on boot from the store: ${after.error ?? ''}`).toBe(true)
  expect(after.type, 'registered as a soundfont (so the picker groups it)').toBe('soundfont')
  expect(after.inGlobal, 'present in globalThis.soundMap — what the picker reads').toBe(true)
  expect(after.played, 'and it actually plays after the reload').toBeGreaterThan(0)
  expect(
    JSON.stringify(after.skipped),
    'sf_vintage must not be skipped as unknown',
  ).not.toContain('sf_vintage')
})
