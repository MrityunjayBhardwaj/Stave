/**
 * _2660-soundfont-store — the IndexedDB blob store for uploaded `.sf2` files.
 *
 * Underscore-prefixed and NOT in the browser-gate manifest on purpose: run
 * directly (`STAVE_E2E_PORT=3100 pnpm --filter @stave/app exec playwright test
 * _2660-soundfont-store`), like the #2658 spike.
 *
 * THE CLAIM #2660 makes is that an uploaded font SURVIVES A RELOAD. No unit test
 * can say that — `@stave/editor` has no `fake-indexeddb`, and jsdom has no
 * IndexedDB — so the store is observed in a real browser here, through the
 * soundfont probe's store methods.
 *
 * ⚠ The reload arm is the one that matters and the one a same-session round-trip
 * silently skips: an in-memory Map passes "store then read back" perfectly; only
 * a reload tells a store from a cache. So the persistence test goes through
 * `page.reload()` and asserts the bytes come back byte-for-byte.
 */
import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { bootApp } from './_appBoot'

const FIXTURE = join(__dirname, 'fixtures', 'vintage-dreams.sf2')

/** The probe attaches in a client effect once the shell mounts; wait for it. */
async function waitForProbe(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __staveSoundfontProbe?: unknown }).__staveSoundfontProbe),
    { timeout: 20000 },
  )
}

test('an uploaded .sf2 survives a reload (#2660)', async ({ page }) => {
  const sf2Base64 = readFileSync(FIXTURE).toString('base64')

  await bootApp(page, { e2eHooks: true })
  await waitForProbe(page)

  // Clean slate, then store the font and read back the store's own account of it.
  const put = await page.evaluate(async (b64) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (window as any).__staveSoundfontProbe
    await p.storeReset()
    return p.storePut(b64, 'vintage')
  }, sf2Base64)
  expect(put.name, 'stored under its sanitized name').toBe('vintage')
  expect(put.size, 'stored size equals the fixture byte length').toBe(readFileSync(FIXTURE).byteLength)

  // THE reload. addInitScript re-sets __STAVE_E2E__ on this navigation too.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForProbe(page)

  // The bytes come back byte-for-byte after the reload.
  const got = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__staveSoundfontProbe.storeGet('vintage') as Promise<string | null>
  })
  expect(got, 'the stored .sf2 is retrievable, byte-for-byte, after a reload').toBe(sf2Base64)
})

test('the store lists fonts by name and removes them (#2660)', async ({ page }) => {
  const sf2Base64 = readFileSync(FIXTURE).toString('base64')

  await bootApp(page, { e2eHooks: true })
  await waitForProbe(page)

  const listed = await page.evaluate(async (b64) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (window as any).__staveSoundfontProbe
    await p.storeReset()
    await p.storePut(b64, 'alpha')
    await p.storePut(b64, 'beta')
    const two = await p.storeList()
    await p.storeRemove('alpha')
    const one = await p.storeList()
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      two: two.map((m: any) => m.name).sort(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      one: one.map((m: any) => m.name),
    }
  }, sf2Base64)

  expect(listed.two, 'both fonts are listed by name').toEqual(['alpha', 'beta'])
  expect(listed.one, 'the removed font is gone; the other remains').toEqual(['beta'])
})
