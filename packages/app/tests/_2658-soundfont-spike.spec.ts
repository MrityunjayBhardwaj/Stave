/**
 * _2658-soundfont-spike — the gating spike for custom `.sf2` support (#2658).
 *
 * Underscore-prefixed and NOT in the browser-gate manifest on purpose: it is a
 * spike, run directly (`pnpm --filter @stave/app exec playwright test
 * _2658-soundfont-spike`), not part of the normal gate. It drives the app's
 * `__staveSoundfontProbe`, which:
 *   1. parses a real `.sf2` (Vintage Dreams Waves v2) via sfumato,
 *   2. registers it as `s("sf_vintage")` through superdough's registry,
 *   3. offline-renders a three-note arpeggio on it,
 * and reports whether the custom font actually PLAYED through the real graph.
 *
 * The question this answers by observation: does a sfumato-parsed `.sf2` play —
 * and does the render encode non-silent audio? The WAV is written to
 * test-results so it can be listened to for pitch.
 */
import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURE = join(__dirname, 'fixtures', 'vintage-dreams.sf2')
const OUT_DIR = join(__dirname, '..', 'test-results', 'soundfont-spike')

test('an uploaded .sf2 registers and plays through the real render graph (#2658)', async ({ page }) => {
  const sf2Base64 = readFileSync(FIXTURE).toString('base64')

  await page.addInitScript(() => {
    ;(window as unknown as { __STAVE_E2E__?: boolean }).__STAVE_E2E__ = true
  })
  await page.goto('/')
  await page.locator('[data-workspace-shell="root"]').waitFor({ timeout: 20000 })

  // The probe attaches in a client effect once the shell mounts.
  await page.waitForFunction(
    () => Boolean((window as unknown as { __staveSoundfontProbe?: unknown }).__staveSoundfontProbe),
    { timeout: 20000 },
  )

  const result = await page.evaluate(async (b64) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__staveSoundfontProbe.run(b64, 'vintage')
  }, sf2Base64)

  // Surface the whole report on failure — the error string is the diagnosis.
  console.log('[spike] report:', JSON.stringify({ ...result, wav: result.wav ? `${result.wav.length} b64 chars` : undefined }, null, 2))

  expect(result.ok, `probe error: ${result.error}`).toBe(true)
  expect(result.presetCount ?? 0, 'font should expose at least one preset').toBeGreaterThan(0)
  // haps were scheduled, and none of them were skipped as an unknown sound.
  expect(result.haps ?? 0, 'the arpeggio should schedule haps').toBeGreaterThan(0)
  expect(result.played ?? 0, 'the custom font should have played, not been skipped').toBeGreaterThan(0)
  const skippedKeys = JSON.stringify(result.skipped ?? [])
  expect(skippedKeys, 'sf_vintage must not appear in the skipped list').not.toContain('sf_vintage')

  // A real bounce: more than a bare WAV header.
  expect((result.wav ?? '').length, 'WAV should be substantial, not an empty header').toBeGreaterThan(10000)

  // Write the WAV out so it can be listened to for pitch/timbre.
  mkdirSync(OUT_DIR, { recursive: true })
  const wavPath = join(OUT_DIR, 'sf-vintage-arp.wav')
  writeFileSync(wavPath, Buffer.from(result.wav!, 'base64'))
  console.log('[spike] wrote WAV:', wavPath)

  // Pitch check: one clean sustained A4 (MIDI 69 = 440 Hz). A whole-file f0 on
  // the arpeggio is ambiguous across three overlapping notes; a single long note
  // reads the font's actual tuning. Written for earshot to measure f0.
  const single = await page.evaluate(async (b64) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).__staveSoundfontProbe.run(b64, 'vintage', 'note("69").s("sf_vintage").gain(1).slow(2)')
  }, sf2Base64)
  expect(single.ok, `single-note probe error: ${single.error}`).toBe(true)
  expect(single.played ?? 0).toBeGreaterThan(0)
  const singlePath = join(OUT_DIR, 'sf-vintage-a4.wav')
  writeFileSync(singlePath, Buffer.from(single.wav!, 'base64'))
  console.log('[spike] wrote single-note WAV:', singlePath)
})
