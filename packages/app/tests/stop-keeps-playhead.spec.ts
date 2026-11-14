/**
 * Stop keeps the playhead; Play carries on from it (#2593), and Go to start
 * takes it back to the top with the mouse (#2599) — Playwright spec.
 *
 * Logic Pro for Mac 13.0, "Control playback with the transport buttons":
 *   Stop: "Stops playback or recording. Click a second time to move the
 *   playhead to the start of the project, or to the left locator position
 *   when in Cycle mode."
 *   Play: "Starts playback at the playhead position ..."
 *
 * The bug: Stop reset the scheduler's clock but kept the offset from the last
 * ruler click, so Play after Stop landed on that click, not where Stop was
 * pressed. Every arm drives the real gestures (ruler click, Ctrl/Cmd+. to
 * stop, Ctrl/Cmd+Enter to play) and reads the playhead the timeline DREW, from
 * its pixels against the ruler's labelled ticks (helpers shared in shape with
 * transport-follows-song-position.spec.ts).
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

const SONG = 'setcps(1)\ndrums: arrange([8, s("bd*4")], [8, s("hh*8")])'

/** Put keyboard focus back in the editor: a ruler click takes it, and the keys are editor actions. */
async function focusEditor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ focus: () => void }> } } }).monaco
    m?.editor?.getEditors?.()?.[0]?.focus()
  })
}

const lcdState = (page: Page) => page.locator('[data-stave-lcd-state]')

async function stop(page: Page): Promise<void> {
  await focusEditor(page)
  await page.keyboard.press(`${MOD}+Period`)
  await expect(lcdState(page)).not.toHaveAttribute('data-stave-lcd-state', 'play', { timeout: 5_000 })
}

async function play(page: Page): Promise<void> {
  await focusEditor(page)
  await page.keyboard.press(`${MOD}+Enter`)
  await expect(lcdState(page)).toHaveAttribute('data-stave-lcd-state', 'play', { timeout: 10_000 })

}

/** The drawn playhead, read twice 250 ms apart so a first frame still at 0 is not taken for the answer. */
async function settledPlayhead(page: Page): Promise<number> {
  await page.waitForTimeout(400)
  const r = await read(page)
  expect(r.playhead, 'the timeline draws a playhead').not.toBeNull()
  return r.playhead!
}

test('Play after Stop carries on from where Stop was pressed, not from the last ruler click', async ({ page }) => {
  test.setTimeout(90_000)
  await boot(page, SONG, 'drums')

  // Jump to about bar 4 with a ruler click, then let it play on ~3 bars.
  await clickRuler(page, 0.25)
  await page.waitForTimeout(500)
  const clicked = (await read(page)).playhead!
  expect(clicked, 'the click moved the playhead near bar 4').toBeGreaterThan(3)
  await page.waitForTimeout(3000)
  const beforeStop = (await read(page)).playhead!
  expect(beforeStop - clicked, 'it played on past the click').toBeGreaterThan(2)

  await stop(page)
  await page.waitForTimeout(800)
  await play(page)
  const resumed = await settledPlayhead(page)
  console.log(`[#2593] clicked=${clicked.toFixed(2)} beforeStop=${beforeStop.toFixed(2)} resumed=${resumed.toFixed(2)}`)
  // ~0.4 cycle of play since resuming, plus the read-to-stop gap: allow -0.3 … +1.2.
  expect(resumed, 'Play resumes where Stop was pressed').toBeGreaterThan(beforeStop - 0.3)
  expect(resumed, 'Play resumes where Stop was pressed').toBeLessThan(beforeStop + 1.2)
})

test('Stop twice goes back to the start of the song', async ({ page }) => {
  test.setTimeout(90_000)
  await boot(page, SONG, 'drums')
  await clickRuler(page, 0.4)
  await page.waitForTimeout(1500)
  const beforeStop = (await read(page)).playhead!
  expect(beforeStop).toBeGreaterThan(5)

  await stop(page)
  await page.waitForTimeout(300)
  await focusEditor(page)
  await page.keyboard.press(`${MOD}+Period`) // a second Stop while stopped
  await page.waitForTimeout(300)
  await play(page)
  const resumed = await settledPlayhead(page)
  console.log(`[#2593] double stop: beforeStop=${beforeStop.toFixed(2)} resumed=${resumed.toFixed(2)}`)
  expect(resumed, 'a second Stop rewinds to bar 1').toBeLessThan(1.2)
})

// #2599 — the transport is one Play/Stop toggle, so once stopped it reads Play
// and Stop's second press is keyboard-only. Go to start is the mouse's way back
// (Logic Pro's "Go to Beginning" button). These arms use the mouse only.
const transportButton = (page: Page) => page.getByTestId('strudel-chrome-transport').first()
const goToStartButton = (page: Page) => page.getByTestId('strudel-chrome-go-to-start').first()

test('#2599 with the mouse only: Stop, Go to start, Play starts from the top', async ({ page }) => {
  test.setTimeout(90_000)
  await boot(page, SONG, 'drums')
  await clickRuler(page, 0.4)
  await page.waitForTimeout(1500)
  const beforeStop = (await read(page)).playhead!
  expect(beforeStop).toBeGreaterThan(5)

  await transportButton(page).click() // Stop
  await expect(lcdState(page)).not.toHaveAttribute('data-stave-lcd-state', 'play', { timeout: 5_000 })
  await goToStartButton(page).click()
  // Going to the start while stopped must not start playback.
  await page.waitForTimeout(600)
  await expect(lcdState(page)).not.toHaveAttribute('data-stave-lcd-state', 'play')
  await transportButton(page).click() // Play
  await expect(lcdState(page)).toHaveAttribute('data-stave-lcd-state', 'play', { timeout: 10_000 })
  const resumed = await settledPlayhead(page)
  console.log(`[#2599] stopped: beforeStop=${beforeStop.toFixed(2)} resumed=${resumed.toFixed(2)}`)
  expect(resumed, 'Play after Go to start begins at bar 1').toBeLessThan(1.2)
})

test('#2599 Go to start while playing jumps back to the top and keeps playing', async ({ page }) => {
  test.setTimeout(90_000)
  await boot(page, SONG, 'drums')
  await clickRuler(page, 0.4)
  await page.waitForTimeout(1500)
  const before = (await read(page)).playhead!
  expect(before).toBeGreaterThan(5)

  await goToStartButton(page).click()
  const after = await settledPlayhead(page)
  console.log(`[#2599] playing: before=${before.toFixed(2)} after=${after.toFixed(2)}`)
  expect(after, 'the playhead jumped back to bar 1').toBeLessThan(1.2)
  await expect(lcdState(page)).toHaveAttribute('data-stave-lcd-state', 'play')
  await page.waitForTimeout(1000)
  const later = (await read(page)).playhead!
  expect(later - after, 'and playback carries on from there').toBeGreaterThan(0.5)
})
