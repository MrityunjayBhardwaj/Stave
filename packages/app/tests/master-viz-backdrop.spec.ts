import { test, expect, type Page } from '@playwright/test'
import { bootApp, editorValue, evalCode, seedCode, stopCode } from './_appBoot'
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
const green = (page: Page) => async () =>
  (await vizPixelStats(page, `${BG} canvas`, { gMin: 121, rMax: 79, bMax: 89 })).frac

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

// #2385 — the background's options follow the CODE at every moment: before the
// first Play, while playing, after Stop, and as they are edited. They used to come
// only from the last evaluation's capture, which Stop withdraws.
for (const [form, line] of [
  ['the master line', `all(x => x.viz("spiral", { theme: 'transparent', emit: true }))`],
  ['the flagged master line', `all(x => x.viz("spiral", { backdrop: true, theme: 'transparent' }))`],
] as const) {
  test(`Stop keeps the background's options on ${form}`, async ({ page }) => {
    await seedCode(page, `${TRACK}\n${line}`)
    await play(page)
    await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
    await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)

    await stopCode(page)
    await page.waitForTimeout(1500)
    await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)
    expect(await green(page)()).toBeLessThan(0.05)
  })

  test(`the background follows ${form}'s options before any Play, and as they are edited`, async ({ page }) => {
    await seedCode(page, `${TRACK}\n${line}`)
    await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
    await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)

    // edited, no Play: the sketch sees the new value
    await seedCode(page, `${TRACK}\n${line.replace("'transparent'", "'white'")}`)
    await expect.poll(blue(page), { timeout: 8000 }).toBeGreaterThan(0.4)
  })
}

// #2396 — Play and Stop only start and stop the music. The background sketch is
// ONE running instance throughout: it is not restarted by either. The probe draws
// a red bar that grows with the time since its own setup() (full at 40 s), so a
// restart shows as the red fraction dropping back toward zero.
const TIMER = `let t0 = 0
function setup() { createCanvas(stave.width, stave.height); t0 = millis() }
function draw() {
  background(0, 0, 255)
  fill(255, 0, 0); noStroke()
  rect(0, 0, width * Math.min(1, (millis() - t0) / 40000), height)
}
`
test('the background keeps running across Play and Stop — never restarted', async ({ page }) => {
  test.setTimeout(60_000) // ~8 s build-up + four steps
  await page.evaluate(
    (code) => (window as unknown as { __staveOverrideVizFile: (n: string, c: string) => string | null })
      .__staveOverrideVizFile('spiral', code),
    TIMER,
  )
  await seedCode(page, `${TRACK}\nall(x => x.viz("spiral", { theme: 'transparent' }))`)
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
  const grown = red(page)
  // let it build a lead first: a restart then reads ~0.04 after the 1.5 s step
  // wait, far below the bar it threw away, so it can't hide inside the tolerance
  await expect.poll(grown, { timeout: 20000, intervals: [1000] }).toBeGreaterThan(0.2)

  // each step must leave the bar at least where it was (a restart drops it to ~0)
  let last = await grown()
  for (const step of ['play', 'stop', 'play', 'stop'] as const) {
    if (step === 'play') await evalCode(page)
    else await stopCode(page)
    await page.waitForTimeout(1500)
    const now = await grown()
    expect(now, `after ${step}: ${last} → ${now}`).toBeGreaterThanOrEqual(last - 0.01)
    last = now
  }
})
