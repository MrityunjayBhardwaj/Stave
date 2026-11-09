import { test, expect, type Page } from '@playwright/test'
import { bootApp, editorValue, evalCode, seedCode, stopCode, waitForEditorLoaded } from './_appBoot'
import { vizPixelStats } from './_vizFrames'

// #2394 — a background DECLARED on a track line (`.viz(name, { backdrop: true })`)
// follows the options its code writes, before the first Play and as they are
// edited, the way a master-line background already does (#2385). An IMPLICIT viz
// method on a track (`$: ….spiral()`) is a background only once it plays: the
// user's rule is that a viz written on a track reads as an inline viz, and only
// backgrounds follow the code live. #2387 — an underscore viz method on the
// master line is the background too, and with several master viz lines the LAST
// one is the background, in the code reader as in the engine. #2528 — a declared
// track background shows when its file is reopened, without an edit.
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

const DECLARED = `lead: ${NOTES}.viz("spiral", { backdrop: true, theme: 'transparent' })`
const IMPLICIT = `$: ${NOTES}.spiral({ theme: 'transparent' })`

for (const [form, line] of [['a flagged .viz() on a named track', DECLARED]] as const) {
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

// An implicit viz method on a track changes the background only when it plays:
// not before the first Play, not when its options are edited, not when it is
// deleted — each of those waits for the next Play.
test('an implicit viz method on a $: track changes the background only when it plays', async ({ page }) => {
  await seedCode(page, IMPLICIT)
  await page.waitForTimeout(2000)
  await expect(page.locator(BG)).not.toHaveAttribute('data-background-file-id', /spiral/)

  await evalCode(page)
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
  await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)

  // an options edit, no Play: the background keeps what the last Play said
  await seedCode(page, IMPLICIT.replace("'transparent'", "'white'"))
  await page.waitForTimeout(2000)
  await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)

  // the call deleted, still playing, no new Play: still the last Play's background
  await seedCode(page, `$: ${NOTES}`)
  await page.waitForTimeout(2000)
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/)

  // the next Play agrees with the code: no background from it
  await evalCode(page)
  await expect(page.locator(BG)).not.toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
  await stopCode(page)
})

// #2528 — reopening the file shows the declared track background without an
// edit. On a reload the editor mounts before the project's files load, so the
// first read can't resolve the name; it must be read again once they arrive.
test('a declared track background shows when its file is reopened, without an edit or a Play', async ({ page }) => {
  await seedCode(page, DECLARED)
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+S`)
  await page.waitForTimeout(1500)

  await page.reload()
  await waitForEditorLoaded(page)
  await expect.poll(() => editorValue(page)).toBe(DECLARED)
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 15000 })
})

// Clear in the set bg popover takes a track's background call out of the code
// (whichever form it is); it used to forget only the last evaluation's, and the
// next Play would bring the background straight back.
test("Clear in the set bg popover removes a track's background call from the code", async ({ page }) => {
  await seedCode(page, IMPLICIT)
  await evalCode(page)
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
  await stopCode(page)

  await page.locator('[data-testid="strudel-chrome-bg-toggle"]').click()
  await page.locator('[data-testid="backdrop-chrome-clear"]').click()
  await expect.poll(() => editorValue(page)).toBe(`$: ${NOTES}`)
  // nothing else is pinned, so the pane has no background at all, and it stays so
  await expect(page.locator(BG)).toHaveCount(0, { timeout: 8000 })
  await expect(page.locator('[data-testid="strudel-chrome-bg-toggle"]')).toContainText('set bg')
})

// A muted track's chain still runs, so the engine still takes its background.
test('a muted track declares its background too: code and Play agree', async ({ page }) => {
  await seedCode(page, `_${DECLARED}\n$: ${NOTES}`)
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
  await evalCode(page)
  await page.waitForTimeout(1500)
  await expect(page.locator(BG)).toHaveAttribute('data-background-file-id', /spiral/, { timeout: 8000 })
  await expect.poll(red(page), { timeout: 8000 }).toBeGreaterThan(0.4)
})

// Half-typed code says nothing about the background: "could not read it" must not
// count as "the code declares none", or it would vanish on every open bracket.
for (const [form, line] of [
  ['a track (declared)', DECLARED],
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
