/**
 * Full-song view: muted (`_`) tracks keep their own lane (#737).
 *
 * Mute is a `_` prefix on the statement label (`$:`→`_$:`). The marker is a
 * DISPLAY concern, orthogonal to a track's identity — but the lane-identity
 * deriver used to bake it into the `trackId`, so every muted anon `_$:` collapsed
 * onto the single id `_$` and the whole group rendered as ONE lane. #737 strips
 * the marker before deriving identity (mirroring the display deriver), so a muted
 * track keeps its positional slot and just reads as silenced.
 *
 * This spec drives the REAL flow — load source carrying `_` markers (exactly what
 * a Mixer mute / a #736 solo writes), eval, read the rendered lane headers — and
 * asserts THREE distinct lanes survive. Pre-fix the muted pair collapse to one.
 */
import { test, expect } from '@playwright/test'
import { bootApp, seedCode, evalCode } from './_appBoot'

// Three anon `$:` tracks; the middle two carry the `_` mute marker. Pre-fix all
// three (well, the two muted) collapse to a single `_$` lane.
const CODE = `setcps(130/240)

$: s("bd*4").gain(0.5)

_$: s("hh*8").gain(0.3)

_$: s("~ cp ~ cp").gain(0.4)
`

test('#737 — two muted `_$:` tracks stay as separate lanes (no collapse)', async ({ page }) => {
  // the shared boot waits for the project file to land before seeding (#872)
  await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 340 } })
  await seedCode(page, CODE)
  await evalCode(page)
  await page.locator('[data-full-song-lane]').first().waitFor({ timeout: 10_000 })

  const headers = page.locator('[data-full-song-lane-select]')
  // Three source tracks → three lanes; the two muted ones must NOT merge.
  await expect(headers).toHaveCount(3)

  const keys = await headers.evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-full-song-lane-select')),
  )
  // Every lane key is distinct — the `_` marker is stripped so the muted pair
  // fall on positional `d2`/`d3` rather than a shared `_$`.
  expect(new Set(keys).size).toBe(3)
})
