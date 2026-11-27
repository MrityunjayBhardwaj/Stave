/**
 * _2659-soundfont-routing — proves the PRODUCTION custom-`.sf2` handler (#2659)
 * routes through superdough's chain, not straight to `ctx.destination`.
 *
 * Underscore-prefixed and NOT in the browser-gate manifest on purpose: run directly
 * (`STAVE_E2E_PORT=3100 pnpm --filter @stave/app exec playwright test
 * _2659-soundfont-routing`), like the #2658 spike.
 *
 * THE OBSERVATION. The spike (#2658) handler called sfumato's `startPresetNote`,
 * which self-connects to `ctx.destination` — so `.gain()`, `.room()`, `.pan()` and
 * the recording tap were ALL bypassed. The #2659 handler instead returns the zone
 * graph's terminal node for superdough to route. The falsifiable consequence: with
 * routing fixed, orbit gain is now in-path, so `note(...).gain(0.25)` must be
 * audibly QUIETER than `.gain(1)`. Under the old bypass the two renders were
 * identical. We render both and compare loudness. If they match, routing is broken.
 */
import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURE = join(__dirname, 'fixtures', 'vintage-dreams.sf2')
const OUT_DIR = join(__dirname, '..', 'test-results', 'soundfont-routing')

test('a custom .sf2 routes through the orbit gain/FX chain, not to destination (#2659)', async ({
  page,
}) => {
  const sf2Base64 = readFileSync(FIXTURE).toString('base64')

  await page.addInitScript(() => {
    ;(window as unknown as { __STAVE_E2E__?: boolean }).__STAVE_E2E__ = true
  })
  await page.goto('/')
  await page.locator('[data-workspace-shell="root"]').waitFor({ timeout: 20000 })
  await page.waitForFunction(
    () => Boolean((window as unknown as { __staveSoundfontProbe?: unknown }).__staveSoundfontProbe),
    { timeout: 20000 },
  )

  const render = (code: string) =>
    page.evaluate(
      async ({ b64, code }) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__staveSoundfontProbe.run(b64, 'vintage', code),
      { b64: sf2Base64, code },
    )

  // Same sustained A4, loud vs. quiet. Only the orbit gain differs.
  const loud = await render('note("69").s("sf_vintage").gain(1).slow(2)')
  const quiet = await render('note("69").s("sf_vintage").gain(0.25).slow(2)')

  for (const [label, r] of [
    ['loud', loud],
    ['quiet', quiet],
  ] as const) {
    expect(r.ok, `${label} probe error: ${r.error}`).toBe(true)
    expect(r.played ?? 0, `${label}: the font should play`).toBeGreaterThan(0)
    expect((r.wav ?? '').length, `${label}: WAV should be substantial`).toBeGreaterThan(10000)
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const loudPath = join(OUT_DIR, 'sf-vintage-a4-gain1.wav')
  const quietPath = join(OUT_DIR, 'sf-vintage-a4-gain025.wav')
  writeFileSync(loudPath, Buffer.from(loud.wav!, 'base64'))
  writeFileSync(quietPath, Buffer.from(quiet.wav!, 'base64'))
  console.log('[routing] wrote', loudPath, 'and', quietPath)

  // Peak-sample proxy for loudness, computed in-page from the decoded buffers so the
  // assertion is self-contained. (earshot LUFS on the two files is the richer check,
  // done outside the spec.) Routing-fixed ⇒ quiet peak is a real fraction of loud.
  const peaks = await page.evaluate(
    async ({ loudB64, quietB64 }) => {
      const toBytes = (b64: string) => {
        const bin = atob(b64)
        const u = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
        return u.buffer
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AC: any = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext
      const peakOf = async (b64: string) => {
        const ctx = new AC(2, 44100, 44100)
        const buf = await ctx.decodeAudioData(toBytes(b64))
        let peak = 0
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const d = buf.getChannelData(ch)
          for (let i = 0; i < d.length; i++) {
            const a = Math.abs(d[i])
            if (a > peak) peak = a
          }
        }
        return peak
      }
      return { loud: await peakOf(loudB64), quiet: await peakOf(quietB64) }
    },
    { loudB64: loud.wav!, quietB64: quiet.wav! },
  )
  console.log('[routing] peaks:', JSON.stringify(peaks))

  // Both audible...
  expect(peaks.loud, 'loud render should be clearly audible').toBeGreaterThan(0.01)
  expect(peaks.quiet, 'quiet render should still be audible').toBeGreaterThan(0.001)
  // ...and the quiet one is genuinely quieter. If gain were bypassed (the spike bug)
  // the ratio would be ~1.0. Routing through orbit gain makes it clearly < 1.
  const ratio = peaks.quiet / peaks.loud
  console.log('[routing] quiet/loud peak ratio:', ratio.toFixed(3))
  expect(ratio, 'gain(0.25) must be audibly quieter than gain(1) — proves in-path orbit gain').toBeLessThan(
    0.8,
  )
})
