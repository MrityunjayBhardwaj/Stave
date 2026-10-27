/**
 * Full-song view: per-voice sub-rows in an expanded lane (#424) — Playwright
 * observation (AnviDev observe gate).
 *
 * The pure layer (scene voice-grouping, laneLayout sub-rows, per-voice draw
 * baseline) is unit-tested; FullSongTimeline.voices.test covers the gutter in
 * jsdom with crafted events. This drives the REAL app against the real evaluated
 * starter song to confirm the end-to-end behaviour:
 *   1. The starter has at least one percussive multi-sample lane (a `$:` drum
 *      stack → ONE lane, distinct `s` per voice).
 *   2. Expanding that lane splits it into a sub-row PER VOICE: the lane reports
 *      `data-full-song-voices` ≥ 2 and renders an indented `[data-full-song-voice]`
 *      label for each voice, under the lane's own header row (#2226).
 *   3. The canvas backing height grows to fit the sub-rows.
 *   4. No console/page errors; screenshot of the split lane (parity reference vs
 *      the live monitor's leaf-voice sub-rows).
 *
 * INPUT NOTE: the song is the Starter Stave opened with until #2240, seeded
 * (a drum stack of three voices) — assertions are GENERIC (≥1 lane splits into ≥2
 * voices), never a fixed sample set or pixel.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, evalCode, STARTER_UNTIL_2240 } from './_appBoot'

async function canvasHeight(page: Page): Promise<number> {
  return page.locator('[data-full-song-canvas]').evaluate((el) => (el as HTMLCanvasElement).height)
}

test('full-song view: expanding a drum lane splits it into per-voice sub-rows (#424)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 360 } })
  await seedCode(page, STARTER_UNTIL_2240)
  await evalCode(page)
  await page.waitForTimeout(1800)

  // Enter the full-song view.
  // Song canvas is the only timeline view now (#497/U5) -- wait for it.
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-lane]').first().waitFor({ timeout: 10_000 })

  const heightCollapsed = await canvasHeight(page)
  expect(heightCollapsed).toBeGreaterThan(0)
  await page.screenshot({ path: 'test-results/full-song-voices-collapsed.png' })

  // Expand every lane, then read each lane's voice count. Searching all lanes
  // keeps the assertion generic — we don't hard-code WHICH starter lane is the
  // drum stack, only that at least one splits into ≥2 voices.
  const caretCount = await page.locator('[data-full-song-lane-expand]').count()
  for (let i = 0; i < caretCount; i++) {
    await page.locator('[data-full-song-lane-expand]').nth(i).click()
    await page.waitForTimeout(40)
  }
  await page.waitForTimeout(150)

  // Diagnostic dump — laneKey → voice count + the sub-row voice labels.
  const lanes = await page.locator('[data-full-song-lane]').evaluateAll((els) =>
    els.map((e) => ({
      key: e.getAttribute('data-full-song-lane'),
      voices: e.getAttribute('data-full-song-voices'),
      subLabels: Array.from(e.querySelectorAll('[data-full-song-voice]')).map((v) =>
        v.getAttribute('data-full-song-voice'),
      ),
      text: (e.textContent ?? '').trim(),
    })),
  )
  console.log('LANE/VOICE STRUCTURE:', JSON.stringify(lanes, null, 2))

  // (1)+(2) At least one lane is a multi-voice (drum) lane that split.
  const multi = lanes.filter((l) => Number(l.voices) >= 2)
  expect(
    multi.length,
    `expected ≥1 lane with ≥2 voices in the starter song; saw: ${JSON.stringify(lanes.map((l) => ({ k: l.key, v: l.voices })))}`,
  ).toBeGreaterThanOrEqual(1)

  // That lane renders an indented sub-label per voice, the first included (#2226:
  // it used to share the header's row, and the track name cut it off).
  for (const l of multi) {
    expect(l.subLabels.length).toBe(Number(l.voices))
    expect(l.subLabels.every((s) => s && s.length > 0)).toBe(true)
  }

  // (3) The canvas grew to fit the sub-rows.
  expect(await canvasHeight(page)).toBeGreaterThan(heightCollapsed)

  await page.screenshot({ path: 'test-results/full-song-voices-expanded.png' })

  // (4) No errors.
  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})
