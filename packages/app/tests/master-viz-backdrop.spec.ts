import { test, expect, type Page } from '@playwright/test'
import { bootApp, editorValue, evalCode, seedCode } from './_appBoot'
import { vizPixelStats } from './_vizFrames'

// #2382 / #2383 — the three steps of one report, end to end in the real app:
//   1. `all(x => x.viz("Name", {...}))` with NO `backdrop: true` sets the
//      background, and its options reach the sketch (`stave.options`);
//   2. picking a viz from the pattern bar's "set bg" keeps the options already
//      written on that master line (it used to add a second, option-less line);
//   3. deleting `.viz(...)` from a track and playing again removes its inline viz.
//
// The options are observed in PIXELS, not inferred: the bundled `spiral.p5` is
// swapped for a probe that paints solid red when `stave.options.theme` is
// 'transparent', blue for any other options and green for none. Read through
// the compositor (`vizPixelStats`) — the canvas lives in a worker (#875).
// Synth notes only: drum samples don't load headless, and a failed eval would
// never forward the backdrop (the eval-success gate).

const PROBE = `function setup() { createCanvas(stave.width, stave.height) }
function draw() {
  const o = stave.options || {}
  if (o.theme === 'transparent') background(255, 0, 0)
  else if (Object.keys(o).length) background(0, 0, 255)
  else background(0, 255, 0)
}
`
const BG = '[data-workspace-background]'
const TRACK = '$: note("c e g").s("sawtooth")'

async function swapSpiralForProbe(page: Page): Promise<void> {
  const id = await page.evaluate(
    (code) => (window as unknown as { __staveOverrideVizFile?: (n: string, c: string) => string | null })
      .__staveOverrideVizFile?.('spiral', code) ?? null,
    PROBE,
  )
  expect(id).not.toBeNull()
}

/** fraction of the backdrop canvas that is the probe's solid red / blue */
const red = (page: Page) => async () =>
  (await vizPixelStats(page, `${BG} canvas`, { rMin: 121, gMax: 79, bMax: 89 })).frac
const blue = (page: Page) => async () =>
  (await vizPixelStats(page, `${BG} canvas`, { bMin: 121, rMax: 79, gMax: 89 })).frac

async function play(page: Page): Promise<void> {
  await evalCode(page)
  await page.waitForTimeout(1500)
}

test.beforeEach(async ({ page }) => {
  await bootApp(page, { e2eHooks: true })
  await swapSpiralForProbe(page)
})

test('a .viz() on the master all() line, with no backdrop flag, is the background — options included', async ({ page }) => {
  await seedCode(page, `${TRACK}\nall(x => x.viz("spiral", { delay: 0.8, theme: 'transparent', emit: true, followers: 0 }))`)
  await play(page)

  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
  await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)
  // it belongs to no track, so it never becomes an inline zone
  await expect(page.locator('[data-viz-zone-track]')).toHaveCount(0)
})

test('set bg renames the master viz in place and keeps its options', async ({ page }) => {
  await seedCode(page, `${TRACK}\nall(x => x.viz("scope", { theme: 'transparent', emit: true }))`)
  await play(page)

  await page.locator('[data-testid="strudel-chrome-bg-toggle"]').click()
  const picker = page.locator('[data-testid="backdrop-popover-picker"]')
  const spiral = await picker.locator('option').evaluateAll(
    (os) => os.map((o) => [o.getAttribute('value'), o.textContent ?? ''] as const).find(([, t]) => /spiral/i.test(t))?.[0] ?? null,
  )
  expect(spiral).not.toBeNull()
  await picker.selectOption(spiral!)
  await page.keyboard.press('Escape')

  // ONE master line, renamed, options intact — not a second `{ backdrop: true }` line
  await expect.poll(() => editorValue(page)).toBe(
    `${TRACK}\nall(x => x.viz("spiral", { theme: 'transparent', emit: true }))`,
  )
  await play(page)
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
  await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)
  expect(await blue(page)()).toBeLessThan(0.05)
})

test('deleting .viz(...) from a track and playing again removes its inline viz', async ({ page }) => {
  await seedCode(page, `${TRACK}.viz("spiral", { theme: 'transparent' })`)
  await play(page)
  await expect(page.locator('[data-viz-zone-track]')).toHaveCount(1, { timeout: 8000 })

  await seedCode(page, TRACK)
  await play(page)
  await expect(page.locator('[data-viz-zone-track]')).toHaveCount(0, { timeout: 8000 })

  // and a viz added back comes back — the zone path still works after a clear
  await seedCode(page, `${TRACK}.viz("spiral")`)
  await play(page)
  await expect(page.locator('[data-viz-zone-track]')).toHaveCount(1, { timeout: 8000 })
})
