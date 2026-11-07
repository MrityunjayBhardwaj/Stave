import { test, expect, type Page } from '@playwright/test'
import { bootApp, editorValue, evalCode, seedCode, stopCode } from './_appBoot'
import { vizPixelStats } from './_vizFrames'

// #2394 — a background declared on a TRACK line follows the options its code
// writes, before the first Play and as they are edited, the way a master-line
// background already does (#2385). #2387 — an underscore viz method on the master
// line is the background too, and with several master viz lines the LAST one is
// the background, in the code reader as in the engine.
//
// Observed in PIXELS: the bundled `spiral.p5` is swapped for a probe that paints
// solid red when `stave.options.theme` is 'transparent', blue for any other
// options and green for none (the same probe as master-viz-backdrop.spec.ts).

const PROBE = `function setup() { createCanvas(stave.width, stave.height) }
function draw() {
  const o = stave.options || {}
  if (o.theme === 'transparent') background(255, 0, 0)
  else if (Object.keys(o).length) background(0, 0, 255)
  else background(0, 255, 0)
}
`
const BG = '[data-workspace-background]'
const NOTES = 'note("c e g").s("sawtooth")'

async function swapSpiralForProbe(page: Page): Promise<void> {
  const id = await page.evaluate(
    (code) => (window as unknown as { __staveOverrideVizFile?: (n: string, c: string) => string | null })
      .__staveOverrideVizFile?.('spiral', code) ?? null,
    PROBE,
  )
  expect(id).not.toBeNull()
}

const red = (page: Page) => async () =>
  (await vizPixelStats(page, `${BG} canvas`, { rMin: 121, gMax: 79, bMax: 89 })).frac
const blue = (page: Page) => async () =>
  (await vizPixelStats(page, `${BG} canvas`, { bMin: 121, rMax: 79, gMax: 89 })).frac

test.beforeEach(async ({ page }) => {
  await bootApp(page, { e2eHooks: true })
  await swapSpiralForProbe(page)
})

for (const [form, line] of [
  ['a flagged .viz() on a named track', `lead: ${NOTES}.viz("spiral", { backdrop: true, theme: 'transparent' })`],
  ['a viz method on a $: track', `$: ${NOTES}.spiral({ theme: 'transparent' })`],
] as const) {
  test(`${form}: the background follows its options before any Play, and as they are edited`, async ({ page }) => {
    await seedCode(page, line)
    await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
    await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)

    // edited, no Play: the sketch sees the new value
    await seedCode(page, line.replace("'transparent'", "'white'"))
    await expect.poll(blue(page), { timeout: 8000 }).toBeGreaterThan(0.4)
  })

  test(`${form}: an edit after Play and Stop reaches the background without another Play`, async ({ page }) => {
    await seedCode(page, line)
    await evalCode(page)
    await page.waitForTimeout(1500)
    await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
    await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)

    await stopCode(page)
    await page.waitForTimeout(1000)
    await seedCode(page, line.replace("'transparent'", "'white'"))
    await expect.poll(blue(page), { timeout: 8000 }).toBeGreaterThan(0.4)
  })
}

// The code declares a track's background now, so the set bg popover's Clear takes
// it out of the code; it used to forget only the last evaluation's, and the next
// edit would bring the background straight back.
test("Clear in the set bg popover removes a track's background call from the code", async ({ page }) => {
  await seedCode(page, `$: ${NOTES}.spiral({ theme: 'transparent' })`)
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })

  await page.locator('[data-testid="strudel-chrome-bg-toggle"]').click()
  await page.locator('[data-testid="backdrop-chrome-clear"]').click()
  await expect.poll(() => editorValue(page)).toBe(`$: ${NOTES}`)
  // nothing else is pinned, so the pane has no background at all, and it stays so
  await expect(page.locator(BG)).toHaveCount(0, { timeout: 8000 })
  await expect(page.locator('[data-testid="strudel-chrome-bg-toggle"]')).toContainText('set bg')
})

// A muted track's chain still runs, so the engine still takes its background.
test('a muted track declares its background too: code and Play agree', async ({ page }) => {
  await seedCode(page, `_lead: ${NOTES}.spiral({ theme: 'transparent' })\n$: ${NOTES}`)
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
  await evalCode(page)
  await page.waitForTimeout(1500)
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
  await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)
})

// Half-typed code says nothing about the background: "could not read it" must not
// count as "the code declares none", or it would vanish on every open bracket.
for (const [form, line] of [
  ['a track', `$: ${NOTES}.spiral({ theme: 'transparent' })`],
  ['the master line', `$: ${NOTES}\nall(x => x.viz("spiral", { theme: 'transparent' }))`],
] as const) {
  test(`a background on ${form} stays, with its options, while the code does not parse`, async ({ page }) => {
    await seedCode(page, line)
    await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)

    await seedCode(page, `${line}\n$: note(`)
    await page.waitForTimeout(1000)
    await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/)
    await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)

    // and it reads the code again as soon as it parses
    await seedCode(page, line.replace("'transparent'", "'white'"))
    await expect.poll(blue(page), { timeout: 8000 }).toBeGreaterThan(0.4)
  })
}

test('an underscore viz method on the master line is the background, with its options', async ({ page }) => {
  const code = `$: ${NOTES}\nall(x => x._spiral({ theme: 'transparent' }))`
  await seedCode(page, code)
  // before any Play, from the code
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
  await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)

  // and Play agrees: the engine sends it to the background, not to a lost zone
  await evalCode(page)
  await page.waitForTimeout(1500)
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
  await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)
  await expect(page.locator('[data-viz-zone-track]')).toHaveCount(0)
})

test('with two master viz lines the last one is the background, before and after Play', async ({ page }) => {
  const code = `$: ${NOTES}\nall(x => x.viz("scope"))\nall(x => x.viz("spiral", { theme: 'transparent' }))`
  await seedCode(page, code)
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
  await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)

  await evalCode(page)
  await page.waitForTimeout(1500)
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
  await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)
})
