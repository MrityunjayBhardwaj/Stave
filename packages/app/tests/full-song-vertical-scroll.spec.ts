/**
 * Full-song view: when the lanes overflow a short drawer, the grid must expose a
 * vertical scrollbar and the label gutter must scroll in lockstep (#655).
 *
 * Bug: `#645` made both columns CLIP consistently (gutter `overflow: clip`, grid
 * `overflowY: hidden`) — which fixed the collapse mismatch but left the lower rows
 * unreachable: there was no way to scroll down to them.
 *
 * Fix: the grid is the vertical scrollport too (`overflowY: auto`) — its content is
 * the full-`totalHeight` canvas, so `scrollHeight` already exceeds the viewport. The
 * gutter rows are translated by `-scrollTop` in lockstep (kept `overflow: clip`, so
 * no `#645` focus-drift), and the Y hit-tests add `scrollTop` (mirror of the X math).
 *
 * Guard (screenshot-free): at a short drawer the grid scrolls vertically; scrolling
 * it translates the gutter inner row-stack by the SAME offset (lockstep); and a lane
 * label that was below the fold becomes visible after scrolling to the bottom.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, evalCode } from './_appBoot'
// Four lanes — even collapsed they exceed the short drawer's body height, so the
// vertical overflow (and thus the scrollbar) is exercised without expanding.
const CODE = `setcps(130/240)

$: note("c4 e4 g4 b4").s("sawtooth").gain(0.3).viz("pianoroll")

$: note("<c2 g2 f2 eb2>").s("square").gain(0.4).viz("pitchwheel")

$: stack(
  s("hh*8").gain(0.3),
  s("bd [~ bd] ~ bd").gain(0.5)
).viz("wordfall")

$: s("cp*4").gain(0.35).viz("spectrum")
`

async function boot(page: Page, height: number) {
  // the shared boot waits for the project file to land before seeding (#872)
  await bootApp(page, { drawer: { tabId: 'musical-timeline', height } })
  await seedCode(page, CODE)
  await evalCode(page)
  await page.waitForTimeout(1500)
}

test('#655 — a short drawer scrolls vertically; the gutter tracks the grid in lockstep', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })

  await boot(page, 120) // short — the lanes overflow the body height
  await page.locator('[data-full-song-lane]').first().waitFor({ timeout: 10_000 })

  const grid = page.locator('[data-full-song="grid"]')
  const inner = page.locator('[data-full-song="lane-labels-inner"]')

  // 1) The grid now has a real vertical overflow (the precondition for a scrollbar).
  const pre = await grid.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, st: el.scrollTop }))
  expect(pre.sh, 'lanes should overflow the short drawer').toBeGreaterThan(pre.ch)
  expect(pre.st).toBe(0)

  // The last lane's gutter label starts below the fold (clipped by the short body).
  const last = page.locator('[data-full-song-lane]').last()
  const gridBox0 = (await grid.boundingBox())!
  const lastBox0 = (await last.boundingBox())!
  expect(lastBox0.y, 'last lane should start below the visible grid bottom').toBeGreaterThan(gridBox0.y + gridBox0.height - 4)

  // 2) Scroll the grid to the bottom → the gutter inner stack translates by the
  //    SAME offset (lockstep), driven by handleGridScroll.
  const target = pre.sh - pre.ch
  await grid.evaluate((el, top) => { el.scrollTop = top }, target)
  await page.waitForTimeout(120)

  const after = await grid.evaluate((el) => el.scrollTop)
  expect(after).toBeCloseTo(target, 0)

  // translateY(-after) — read back as a matrix (m41 == -after) or a translateY().
  const dy = await inner.evaluate((el) => {
    const t = getComputedStyle(el).transform
    if (!t || t === 'none') return 0
    const m = new DOMMatrixReadOnly(t)
    return m.m42 // vertical translate
  })
  expect(dy, 'gutter inner tracks the grid scrollTop in lockstep').toBeCloseTo(-after, 0)

  // 3) After scrolling to the bottom, the previously-clipped last lane label is now
  //    within the visible grid band (the reveal the user asked for).
  const gridBox1 = (await grid.boundingBox())!
  const lastBox1 = (await last.boundingBox())!
  expect(lastBox1.y).toBeGreaterThanOrEqual(gridBox1.y - 1)
  expect(lastBox1.y + lastBox1.height).toBeLessThanOrEqual(gridBox1.y + gridBox1.height + 1)

  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})
