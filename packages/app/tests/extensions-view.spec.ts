import { test, expect, type Page } from '@playwright/test'
import { bootApp, waitForEditorLoaded } from './_appBoot'

/**
 * #2511 — the Extensions view, through the real gestures, with a test-only extension.
 *
 * The extension (`e2e-tone`, a Strudel sound made by an audio worklet) is listed only when
 * the page is an end-to-end run (`__STAVE_E2E__`). Without the flag the shipped list is
 * empty, so the Extensions icon is absent: the first test checks that.
 *
 * With the flag: click the Extensions icon, click Switch on, and with no reload a bounce
 * has the tone and live playback has it; the switch survives a reload; a row opens the
 * extension's page as a tab and the page's switch and the row's agree; switched off, the
 * sound is "not found" again.
 *
 * Sound is read through `window.__staveBounceProbe` (its own engine over the page's one
 * Strudel sound map): the count of non-zero samples in a 16-bit WAV.
 */

test.use({
  // the live arm records the real graph, so the context must start without a click
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
})

const ID = 'e2e-tone'
const SOUND = 'e2etone'
const CODE = `note("c4 e4 g4 c5").s("${SOUND}")`
const SECS = 2

type Report = { ok: boolean; error?: string; skipped?: Array<{ reason: string; count: number }>; wav?: string }
type Outcome = { ok: boolean; error?: string; wav?: string }

function nonZero(b64: string | undefined): number {
  if (!b64) return 0
  const buf = Buffer.from(b64, 'base64')
  const channels = buf.readUInt16LE(22)
  let off = 12
  while (off + 8 <= buf.length && buf.toString('ascii', off, off + 4) !== 'data') off += 8 + buf.readUInt32LE(off + 4)
  const start = off + 8
  const frames = Math.floor(buf.readUInt32LE(off + 4) / (2 * channels))
  let n = 0
  for (let i = 0; i < frames * channels; i++) if (buf.readInt16LE(start + i * 2) !== 0) n++
  return n
}

async function probeReady(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as { __staveBounceProbe?: unknown }).__staveBounceProbe), undefined, {
    timeout: 60_000,
  })
}

function report(page: Page): Promise<Report> {
  return page.evaluate(
    ([c, s]) =>
      (window as unknown as { __staveBounceProbe: { offlineReport(c: string, s: number): Promise<Report> } }).__staveBounceProbe.offlineReport(
        c as string,
        s as number,
      ),
    [CODE, SECS] as const,
  )
}

function probe(page: Page, method: 'exportLikeButton' | 'recordLive'): Promise<Outcome> {
  return page.evaluate(
    ([m, c, s]) =>
      (window as unknown as { __staveBounceProbe: Record<string, (c: string, s: number) => Promise<Outcome>> }).__staveBounceProbe[m as string](
        c as string,
        s as number,
      ),
    [method, CODE, SECS] as const,
  )
}

/** How many notes the render skipped because the sound was not found. */
async function notFoundCount(page: Page): Promise<number> {
  const r = await report(page)
  if (!r.ok) {
    // With every note left out the take is silent, and the render refuses it, naming why.
    const m = r.error?.match(new RegExp(`(\\d+) × sound ${SOUND} not found`))
    if (m) return Number(m[1])
    throw new Error(`render failed: ${r.error}`)
  }
  return (r.skipped ?? []).filter((s) => s.reason.includes(`sound ${SOUND} not found`)).reduce((a, s) => a + s.count, 0)
}

async function openExtensionsView(page: Page): Promise<void> {
  await page.locator('[data-activity-bar] [data-panel-id="extensions"]').click()
  await expect(page.locator('[data-extensions-panel]')).toBeVisible()
}

const row = (page: Page) => page.locator(`[data-extension-row="${ID}"]`)

test('without the end-to-end flag nothing is listed, so there is no Extensions icon', async ({ page }) => {
  await bootApp(page)
  // the rail is up (its other panels are there) …
  await expect(page.locator('[data-activity-bar] [data-panel-id="library"]')).toBeVisible()
  // … and the Extensions icon is not
  await expect(page.locator('[data-activity-bar] [data-panel-id="extensions"]')).toHaveCount(0)
})

test('switch the test extension on from the view: sound with no reload, kept after a reload, gone once off', async ({ page }) => {
  test.setTimeout(240_000)
  await bootApp(page, { e2eHooks: true })
  await probeReady(page)

  // Off at first: the sound is not found.
  expect(await notFoundCount(page)).toBeGreaterThan(0)

  await openExtensionsView(page)
  await expect(page.locator(`[data-extension-group="builtin"] [data-extension-row="${ID}"]`)).toBeVisible()
  await expect(row(page)).toHaveAttribute('data-on', 'false')
  await expect(page.locator(`[data-extension-languages="${ID}"]`).first()).toHaveText('Strudel')

  // A marker that a reload would wipe.
  await page.evaluate(() => {
    ;(window as unknown as { __noReload?: number }).__noReload = 1
  })

  await row(page).locator(`[data-extension-switch="${ID}"]`).click()
  await expect(row(page)).toHaveAttribute('data-on', 'true')
  await expect(page.locator(`[data-extension-group="on"] [data-extension-row="${ID}"]`)).toBeVisible()

  // Switching on loads the code and the worklet; wait for the sound to be there.
  await expect.poll(() => notFoundCount(page), { timeout: 30_000 }).toBe(0)
  const bounce = await probe(page, 'exportLikeButton')
  expect(bounce.ok, bounce.error).toBe(true)
  expect(nonZero(bounce.wav)).toBeGreaterThan(10_000)
  const live = await probe(page, 'recordLive')
  expect(live.ok, live.error).toBe(true)
  expect(nonZero(live.wav)).toBeGreaterThan(10_000)
  expect(await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload)).toBe(1)
  test.info().annotations.push({ type: 'non-zero samples', description: `bounce ${nonZero(bounce.wav)}, live ${nonZero(live.wav)}` })

  // The switch survives a reload: on at load, and the sound plays.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForEditorLoaded(page)
  await probeReady(page)
  await openExtensionsView(page)
  await expect(row(page)).toHaveAttribute('data-on', 'true')
  await expect.poll(() => notFoundCount(page), { timeout: 30_000 }).toBe(0)
  const afterReload = await probe(page, 'exportLikeButton')
  expect(nonZero(afterReload.wav)).toBeGreaterThan(10_000)

  // A row opens the extension's page as a tab, and the page's switch agrees with the row's.
  await row(page).click()
  const pageView = page.locator(`[data-extension-page="${ID}"]`)
  await expect(pageView).toBeVisible()
  await expect(page.getByText('Extension: Test tone')).toBeVisible()
  await expect(pageView).toHaveAttribute('data-on', 'true')
  await expect(page.locator(`[data-extension-state="${ID}"]`)).toHaveText('On — takes effect at once, no reload')

  await pageView.locator(`[data-extension-switch="${ID}"]`).click()
  await expect(pageView).toHaveAttribute('data-on', 'false')
  await expect(row(page)).toHaveAttribute('data-on', 'false')
  await expect(page.locator(`[data-extension-state="${ID}"]`)).toHaveText('Off — its code has not been loaded')

  // Switched off: the sound is "not found" again.
  await expect.poll(() => notFoundCount(page), { timeout: 30_000 }).toBeGreaterThan(0)

  // And from the row, back on: the page follows.
  await row(page).locator(`[data-extension-switch="${ID}"]`).click()
  await expect(pageView).toHaveAttribute('data-on', 'true')
})

test('an extension that fails to switch on says so on its row and page, until it is switched off (#2552)', async ({ page }) => {
  test.setTimeout(180_000)
  // The test tone's Strudel part loads its audio worklet from a blob: URL. Refuse those,
  // so switching it on fails the way a broken download would; Stave's own worklets load
  // as usual.
  await page.addInitScript(() => {
    const add = AudioWorklet.prototype.addModule
    AudioWorklet.prototype.addModule = function (url: string | URL, options?: WorkletOptions) {
      if (String(url).startsWith('blob:')) return Promise.reject(new Error('worklet download refused by the test'))
      return add.call(this, url, options)
    }
  })
  await bootApp(page, { e2eHooks: true })
  await probeReady(page)
  await openExtensionsView(page)

  await row(page).locator(`[data-extension-switch="${ID}"]`).click()
  await expect(row(page)).toHaveAttribute('data-on', 'true')
  await expect(row(page)).toHaveAttribute('data-failed', 'true', { timeout: 30_000 })
  await expect(row(page).locator('[data-extension-badge="failed"]')).toHaveText("couldn't switch on")
  await expect(row(page).locator('[data-extension-badge="on"]')).toHaveCount(0)

  await row(page).click()
  const pageView = page.locator(`[data-extension-page="${ID}"]`)
  await expect(pageView).toHaveAttribute('data-failed', 'true')
  await expect(page.locator(`[data-extension-state="${ID}"]`)).toHaveText(
    /^Couldn't switch on: Its Strudel part failed: .*worklet download refused by the test.* The Console has the details\.$/,
  )
  await expect(page.locator(`[data-extension-status="${ID}"]`)).toHaveText("Couldn't switch on")
  await page.screenshot({ path: test.info().outputPath('failed-page.png') })
  // the sound is not there
  expect(await notFoundCount(page)).toBeGreaterThan(0)

  // Switched off, the failure is no longer shown.
  await pageView.locator(`[data-extension-switch="${ID}"]`).click()
  await expect(pageView).toHaveAttribute('data-on', 'false')
  await expect(pageView).not.toHaveAttribute('data-failed', 'true')
  await expect(row(page)).not.toHaveAttribute('data-failed', 'true')
  await expect(page.locator(`[data-extension-state="${ID}"]`)).toHaveText('Off — its code has not been loaded')

  // What it adds: the leftovers in plain words.
  await pageView.locator('[data-extension-section="adds"]').click()
  await expect(page.locator('[data-extension-leftovers]')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('adds-page.png') })
})
