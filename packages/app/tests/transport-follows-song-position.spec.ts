/**
 * The transport display and the grid's playing step follow the SONG position
 * (#1725) — Playwright observation spec.
 *
 * Two clocks exist. The scheduler's counts cycles since Play; the song position
 * is that minus the transport offset a seek sets (and folded into a loop range).
 * The Song timeline's playhead has always read the song position. The display
 * and the Sequencer / Piano Roll step highlight read the scheduler's, so a click
 * on the ruler moved the playhead and the audio and left both of them where
 * they were: scrub to bar 7.2 and the display still read 002.3.
 *
 * Every arm drives the REAL gesture — a click on the ruler — and reads the
 * display against the playhead the timeline DREW, in one evaluate, so the two
 * readings are the same instant. The playhead's cycle is recovered from its
 * pixels against the ruler's own labelled bar ticks (pixels per bar), not from
 * any value the fix itself publishes, and not from the analysis's period
 * either: a bare loop is DRAWN over more bars than its period (#489), and an
 * instrument that assumed otherwise read the wrong scale. The instrument must
 * not share the code it is checking.
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function boot(page: Page, code: string, lane: string): Promise<void> {
  await page.addInitScript(() => {
    try {
      ;(window as unknown as { __STAVE_E2E__?: boolean }).__STAVE_E2E__ = true
      localStorage.setItem('stave:debug.timelineMarks', '1')
      localStorage.setItem('stave:bottomPanel.height', '320')
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.activeTabId', 'musical-timeline')
    } catch {
      /* ignore */
    }
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  // #872 — wait for the project file to land in the editor before replacing
  // it, or the load overwrites our code and the starter song plays instead.
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getValue?: () => string } | null }> } } }).monaco
      return (m?.editor?.getEditors?.() ?? []).some((e) => (e.getModel()?.getValue?.()?.length ?? 0) > 0)
    },
    { timeout: 20_000 },
  )
  // the mount, not just the text: a seed written before it is not heard (#2036)
  await page.waitForFunction(() => {
    const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId: () => string } | null }> } } }).monaco
    const language = m?.editor?.getEditors?.()?.[0]?.getModel()?.getLanguageId()
    return language !== undefined && language !== 'plaintext'
  }, undefined, { timeout: 30_000 })
  await page.evaluate((c) => {
    const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null; focus: () => void }> } } }).monaco
    const eds = m?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.getModel()?.setValue(c)
    t?.focus()
  }, code)
  await page.waitForTimeout(300)
  await page.keyboard.press(`${MOD}+Enter`)
  // Only go on once the timeline holds THIS document's lane: the starter song
  // has lanes of its own and would give plausible, wrong readings.
  await page.waitForFunction(
    (want) =>
      ((window as unknown as { __staveTimelineAnalysis?: { lanes?: Array<{ laneKey: string }> } })
        .__staveTimelineAnalysis?.lanes ?? [])
        .map((l) => l.laneKey)
        .join(',') === want,
    lane,
    { timeout: 30_000 },
  )
  await expect(page.locator('[data-stave-transport-lcd]')).toContainText('PLAY', { timeout: 10_000 })
  await page.waitForTimeout(1000)
}

interface Reading {
  /** The display's position text, e.g. `007.3` or `008.2.1`. */
  readonly lcd: string
  /** The display's pass number text. */
  readonly pass: string
  /** The cycle under the drawn playhead, from its pixels. */
  readonly playhead: number | null
  /** How many bars the timeline draws, from the same ruler scale. */
  readonly drawnBars: number | null
  /** The viewport x of a cycle on the ruler, from the same scale. */
  readonly xOf: { readonly left: number; readonly x0: number; readonly pxPerBar: number; readonly scrollLeft: number } | null
  /** The page's clock at the reading, in ms. */
  readonly at: number
}

const read = (page: Page): Promise<Reading> =>
  page.evaluate(() => {
    const at = performance.now()
    const lcd = (document.querySelector('[data-stave-lcd-pos]') as HTMLElement | null)?.innerText ?? ''
    const pass = (document.querySelector('[data-stave-lcd-pass]') as HTMLElement | null)?.innerText ?? ''
    const grid = document.querySelector('[data-full-song="grid"]') as HTMLElement | null
    const ph = document.querySelector('[data-full-song="playhead"]') as HTMLElement | null
    // Two labelled ticks give the scale: their label names the cycle, their
    // left is its x in content space. The ruler counts in the display's units
    // (one shared preference): cycles from 0, or bars from 1.
    const barsMode = /\bBAR\b/.test((document.querySelector('[data-stave-transport-lcd]') as HTMLElement | null)?.innerText ?? '')
    const labelled = Array.from(document.querySelectorAll('[data-full-song-tick]'))
      .filter((t) => (t.textContent ?? '').trim() !== '')
      .map((t) => ({ x: parseFloat((t as HTMLElement).style.left), cyc: Number(t.textContent) - (barsMode ? 1 : 0) }))
      .filter((t) => Number.isFinite(t.cyc) && Number.isFinite(t.x))
    const [a, b] = [labelled[0], labelled[labelled.length - 1]]
    const pxPerBar = a && b && b.cyc > a.cyc ? (b.x - a.x) / (b.cyc - a.cyc) : null
    const x0 = a && pxPerBar ? a.x - a.cyc * pxPerBar : 0
    const playhead =
      grid && ph && pxPerBar ? (parseFloat(ph.style.left) + grid.scrollLeft - x0) / pxPerBar : null
    const drawnBars = grid && pxPerBar ? grid.scrollWidth / pxPerBar : null
    const xOf =
      grid && pxPerBar ? { left: grid.getBoundingClientRect().left, x0, pxPerBar, scrollLeft: grid.scrollLeft } : null
    return { lcd, pass, playhead, drawnBars, xOf, at }
  })

const lcdCycle = (r: Reading): number => {
  const m = /^(\d+)\.(\d)$/.exec(r.lcd.trim())
  if (!m) throw new Error(`display is not a CYC reading: "${r.lcd}"`)
  return Number(`${m[1]}.${m[2]}`)
}

async function clickRuler(page: Page, frac: number): Promise<void> {
  const box = await page.locator('[data-full-song="ruler-area"]').boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.click(box!.x + box!.width * frac, box!.y + box!.height / 2)
}

// The display refreshes every 80 ms and shows one decimal; at 1 cps that is at
// most ~0.13 cycles behind the playhead. Before the fix the gap was whole bars.
const TOL = 0.2

/**
 * How far apart two positions are on a loop of `period` cycles. A reading taken
 * just after the playhead wraps can hold the display's previous refresh from
 * just before it (observed: display 006.0, playhead 4.05, in a loop over 4-6),
 * which is 0.05 apart on the loop and 1.95 apart on a straight line.
 */
const gap = (a: number, b: number, period: number): number => {
  const d = Math.abs(a - b) % period
  return Math.min(d, period - d)
}

// 8 bars at 1 cps: one pass is 8 s, short enough to watch it wrap.
const ARRANGED = 'setcps(1)\ndrums: arrange([4, s("bd*4")], [4, s("hh*8")])'

test('the display reads the playhead through scrubs and past the end', async ({ page }) => {
  test.setTimeout(90_000)
  await boot(page, ARRANGED, 'drums')

  const r0 = await read(page)
  expect(Math.round(r0.drawnBars!), 'the timeline draws the 8-bar song').toBe(8)
  // Control: before any scrub the two clocks agree, fix or no fix. If this arm
  // fails, the instrument is wrong, not the display.
  expect(gap(lcdCycle(r0), r0.playhead!, 8)).toBeLessThan(TOL)

  await clickRuler(page, 0.8)
  await page.waitForTimeout(700)
  const r1 = await read(page)
  console.log(`[#1725] scrub 0.8: ${JSON.stringify(r1)}`)
  expect(r1.playhead!).toBeGreaterThan(6)
  expect(gap(lcdCycle(r1), r1.playhead!, 8), 'the display follows a scrub').toBeLessThan(TOL)
  expect(r1.pass.trim(), 'still the first time through').toBe('1')

  // Past bar 8 the playhead wraps to the start; the display wraps with it, and
  // the pass number says this is the second time through.
  await page.waitForTimeout(2500)
  const r2 = await read(page)
  console.log(`[#1725] past the end: ${JSON.stringify(r2)}`)
  expect(r2.playhead!).toBeLessThan(4)
  expect(gap(lcdCycle(r2), r2.playhead!, 8), 'the display wraps with the playhead').toBeLessThan(TOL)
  expect(r2.pass.trim()).toBe('2')

  // A scrub BACK, from the second pass into the song's opening bars.
  await clickRuler(page, 0.2)
  await page.waitForTimeout(700)
  const r3 = await read(page)
  console.log(`[#1725] scrub 0.2: ${JSON.stringify(r3)}`)
  expect(gap(lcdCycle(r3), r3.playhead!, 8), 'the display follows a scrub back').toBeLessThan(TOL)

  // BAR mode counts the same position in bars: bar = floor(cycle) + 1.
  await page.locator('[data-stave-transport-lcd]').click()
  await expect(page.locator('[data-stave-transport-lcd]')).toContainText('BAR')
  await clickRuler(page, 0.55)
  await page.waitForTimeout(700)
  const r4 = await read(page)
  console.log(`[#1725] BAR mode after scrub 0.55: ${JSON.stringify(r4)}`)
  const bar = Number(/^(\d+)\./.exec(r4.lcd.trim())?.[1])
  // Allow the one-bar slack of a reading that lands on a barline.
  expect(Math.abs(bar - (Math.floor(r4.playhead!) + 1))).toBeLessThanOrEqual(
    r4.playhead! % 1 > 0.9 || r4.playhead! % 1 < 0.1 ? 1 : 0,
  )
})

test('the Sequencer lights the step the playhead is on after a scrub', async ({ page }) => {
  test.setTimeout(90_000)
  // One bar of four steps at 0.25 cps: each step lasts a full second, so the
  // half-second a tab switch takes cannot move the answer by more than one.
  await boot(page, 'setcps(0.25)\nseq: s("bd sd hh cp")', 'seq')
  const drawer = page.locator('[data-bottom-panel="root"]')

  // Each seek lands a FRACTION of a cycle away from where the song is, so the
  // scheduler's clock (which a seek does not move) sits 2, 1 and 3 steps away
  // from the song's. Seeking by a fixed ruler fraction instead can land a whole
  // number of cycles away by chance, where both clocks light the same step and
  // the arm proves nothing: observed, with this very song.
  for (const jump of [0.5, 1.25, 2.75]) {
    const before = await read(page)
    const target = (before.playhead! + jump) % before.drawnBars!
    const { left, x0, pxPerBar, scrollLeft } = before.xOf!
    const box = await page.locator('[data-full-song="ruler-area"]').boundingBox()
    await page.mouse.click(left + x0 + target * pxPerBar - scrollLeft, box!.y + box!.height / 2)
    await page.waitForTimeout(300)
    const r = await read(page)
    const frac = `+${jump}`
    // The Pattern tab shows the grid for the pattern under the cursor.
    await page.evaluate(() => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getValue: () => string; getLineCount: () => number; getLineContent: (n: number) => string } | null; focus: () => void; setPosition: (p: { lineNumber: number; column: number }) => void }> } } }).monaco
      const t = (m?.editor?.getEditors?.() ?? []).find((e) => e.getModel()?.getValue().includes('bd sd'))
      const model = t?.getModel()
      if (!t || !model) return
      for (let ln = 1; ln <= model.getLineCount(); ln++) {
        const i = model.getLineContent(ln).indexOf('bd sd')
        if (i >= 0) {
          t.focus()
          t.setPosition({ lineNumber: ln, column: i + 2 })
          return
        }
      }
    })
    await drawer.getByRole('tab', { name: 'Pattern' }).click()
    const lit = drawer.locator('[data-bottom-panel-tab="sequencer"] [data-seq-cell^="0:"][data-playing="true"]')
    await expect(lit).toHaveCount(1, { timeout: 5000 })
    const { cell, at } = await page.evaluate(() => ({
      cell: document.querySelector('[data-bottom-panel-tab="sequencer"] [data-seq-cell^="0:"][data-playing="true"]')?.getAttribute('data-seq-cell') ?? null,
      at: performance.now(),
    }))
    const step = Number(cell!.split(':')[1])
    // Where the song is now: the drawn playhead, run forward at 0.25 cps on
    // the page's own clock. Either side of a step boundary is allowed within
    // a frame or two of the highlight's refresh.
    const now = r.playhead! + ((at - r.at) / 1000) * 0.25
    const stepAt = (c: number) => Math.floor((((c % 1) + 1) % 1) * 4)
    const allowed = new Set([stepAt(now - 0.03), stepAt(now), stepAt(now + 0.03)])
    console.log(`[#1725] scrub ${frac}: playhead ${r.playhead!.toFixed(2)}, song now ${now.toFixed(2)}, lit step ${step}, allowed ${[...allowed]}`)
    expect(allowed.has(step), `lit step ${step} is not where the song is (${now.toFixed(2)})`).toBe(true)
    await drawer.getByRole('tab', { name: 'Timeline' }).click()
    await page.waitForTimeout(500)
  }
})

// #1570 — under a loop range the song position folds into the range, and so
// does the playhead. The display reads the same fold, so it must stay with the
// playhead as it jumps back to the loop's start, again and again.
test('the display stays with the playhead inside a loop range', async ({ page }) => {
  test.setTimeout(90_000)
  await boot(page, ARRANGED, 'drums')

  // Draw a loop over the second half of the 8-bar song with the real pointer.
  const strip = page.locator('[data-full-song="loop-strip"]')
  await expect(strip).toBeVisible({ timeout: 10_000 })
  const box = (await strip.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.5 + 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('[data-full-song="loop-band"]')).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(1000)

  // Two bars at 1 cps: sampled for 5 s, the loop wraps at least twice.
  const seen: number[] = []
  for (let i = 0; i < 12; i++) {
    const r = await read(page)
    seen.push(r.playhead!)
    expect(r.playhead!, 'the playhead stays inside the loop').toBeGreaterThan(3.9)
    expect(r.playhead!).toBeLessThan(6.1)
    expect(gap(lcdCycle(r), r.playhead!, 2), `display ${r.lcd} vs playhead ${r.playhead}`).toBeLessThan(TOL)
    // And the display itself stays in the loop (6.0 is 5.95+ rounded). The
    // closeness check above alone could pass by chance: a display that does
    // not fold drifts from the playhead by exactly one loop per wrap, which
    // the circular gap cannot see. Across 5 cycles it cannot stay in 4-6.
    expect(lcdCycle(r), `display ${r.lcd} stays inside the loop`).toBeGreaterThanOrEqual(3.9)
    expect(lcdCycle(r)).toBeLessThanOrEqual(6.0)
    await page.waitForTimeout(420)
  }
  console.log(`[#1725] inside the loop, playhead read ${seen.map((c) => c.toFixed(2)).join(' ')}`)
  // Evidence the samples crossed a wrap, or the arm never saw the hard case.
  expect(seen.some((c, i) => i > 0 && c < seen[i - 1]), 'the samples include a jump back to the loop start').toBe(true)
})
