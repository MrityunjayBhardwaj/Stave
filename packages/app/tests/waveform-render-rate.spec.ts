import { test, expect, type Page } from '@playwright/test'

import { bootApp, seedCode } from './_appBoot'
import { chooseDisplay } from './_laneType'

/**
 * #1759 — a synth track that plays nothing but plain oscillators draws from a
 * 24 kHz render, and counts half against the render budget, so a long song's
 * last tracks are not "too long to draw".
 *
 * Every `OfflineAudioContext` render is logged with its length and rate, so the
 * two kinds are told apart by what the browser was asked to do:
 *
 *  1. Four oscillator tracks of 374 s each (1,496 s, past the 1,200 s budget at
 *     full rate) all draw, each from a 24 kHz render, with no notice. Before
 *     #1759: the fourth was "too long to draw", every render at 48 kHz.
 *  2. A track that also plays a sample renders at the live rate: superdough
 *     caches a decoded sample at the rate of the first context to load it.
 */

// #2109 — the songs here are 187-cycle arrangements, rendered whole against the
// budget; at the default limit of 64 the timeline would draw them a 64-cycle window
// at a time and the budget would never be reached.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('stave:songCycleLimit', '256') } catch { /* ignore */ }
  })
})

async function attr(page: Page, name: string): Promise<string> {
  return page.evaluate((a) => document.querySelector(`[${a}]`)?.getAttribute(a) ?? '', name)
}

const osc = (name: string, sound: string) =>
  `${name}: arrange([187, note("<c3 e3 g3 b3>*4").s("${sound}").lpf(1200).gain(0.3)])`

/**
 * #2079 — a synth lane with no saved type draws as Bars, so save Waveform for
 * every lane through its menu, then reload. The reload drops every render and
 * every count the init scripts keep, and scrolls back to the top, so the test
 * starts from the same untouched page as before; the saved types survive it.
 */
async function saveWaveformThenReload(page: Page, lanes: readonly string[]): Promise<void> {
  for (const lane of lanes) {
    await page.locator(`[data-full-song-lane="${lane}"]`).waitFor({ state: 'attached', timeout: 30_000 })
    // The label gutter follows the grid's scroll and cannot be scrolled itself,
    // so scroll the GRID until the lane's name is on screen, as a user would.
    await page.evaluate((key) => {
      const grid = document.querySelector('[data-full-song="grid"]') as HTMLElement
      const row = document.querySelector(`[data-full-song-lane="${key}"]`) as HTMLElement
      grid.scrollTop += row.getBoundingClientRect().top - grid.getBoundingClientRect().top
    }, lane)
    await expect
      .poll(() =>
        page.evaluate((key) => {
          const grid = document.querySelector('[data-full-song="grid"]')!.getBoundingClientRect()
          const r = document.querySelector(`[data-full-song-lane="${key}"]`)!.getBoundingClientRect()
          return r.top >= grid.top - 1 && r.bottom <= grid.bottom + 1
        }, lane),
      )
      .toBe(true)
    await chooseDisplay(page, lane, 'waveform')
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator(`[data-full-song-lane="${lanes[0]}"]`).waitFor({ timeout: 30_000 })
}

test('a long song of oscillator tracks draws every one, from 24 kHz renders (#1759)', async ({ page }) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => {
    // Init scripts also run in every frame, and #1758 renders in a throwaway
    // frame: each copy records into the TOP window, and only the top resets it.
    const w = (window.top ?? window) as unknown as { __renders: string[] }
    if (window === window.top) w.__renders = []
    const start = OfflineAudioContext.prototype.startRendering
    OfflineAudioContext.prototype.startRendering = function (this: OfflineAudioContext) {
      w.__renders.push(`${Math.round(this.length / this.sampleRate)}s@${this.sampleRate}`)
      return start.call(this)
    }
  })
  await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 360 } })
  const live = await page.evaluate(() => new AudioContext().sampleRate)
  test.skip(live <= 24000, `the live rate is ${live} Hz, at or below the display rate: nothing to lower`)

  await seedCode(
    page,
    [
      'setcps(0.5)',
      osc('bass', 'sawtooth'),
      osc('keys', 'triangle'),
      osc('pad', 'supersaw'),
      osc('lead', 'square'),
      'mixed: arrange([187, note("c3 e3").s("<sawtooth bd>")])',
    ].join('\n'),
  )
  await saveWaveformThenReload(page, ['bass', 'keys', 'pad', 'lead', 'mixed'])
  await expect
    .poll(() => attr(page, 'data-full-song-envelopes'), { timeout: 120_000 })
    .toBe('bass:fresh keys:fresh pad:fresh lead:fresh mixed:fresh')
  await expect.poll(() => attr(page, 'data-full-song-envelope-rendering'), { timeout: 10_000 }).toBe('')
  const renders = await page.evaluate(() => (window as unknown as { __renders: string[] }).__renders)
  console.log(`[#1759] live ${live} Hz · renders: ${renders.join(' ')}`)

  // Nothing is left out: 4 × 374 s at half weight + 374 s at full = 1,122 s.
  await expect(page.getByText(/too long to draw/)).toHaveCount(0)
  // Every oscillator track rendered at 24 kHz (supersaw's worklet-free first try,
  // #1755, is dropped before it renders). The mixed track, at the live rate.
  expect(renders.filter((r) => r === '374s@24000').length).toBeGreaterThanOrEqual(4)
  expect(renders.filter((r) => r === `374s@${live}`)).toHaveLength(1)
  expect(renders.every((r) => r === '374s@24000' || r === `374s@${live}`)).toBe(true)
})

/**
 * #1760 — the budget is spent on the lanes on screen first. Twelve 374 s
 * oscillator tracks each render at 24 kHz and cost 374 × 24,000 / live seconds
 * against the 1,200 s budget (#1759): 187 s at 48 kHz, so six fit; about 204 s
 * at 44.1 kHz, so five. In a short drawer the top lanes draw; scrolled to the
 * bottom, the lanes then on screen draw too, as many as fit, and none already
 * drawn is rendered again.
 */
const BUDGET_SECONDS = 1200
const DISPLAY_RATE = 24000
const TRACK_SECONDS = 374
// #1769 — run at both common device rates, whatever this machine's output is set
// to: the live rate decides how much each lane costs, so a count that holds at
// one rate is wrong at the other.
for (const liveRate of [44100, 48000]) test(`scrolling a long song brings the lanes on screen into the budget, re-rendering none, live at ${liveRate} Hz (#1760)`, async ({ page }) => {
  test.setTimeout(240_000)
  await page.addInitScript((rate) => {
    // The engine's live context is a bare `new AudioContext()`; give it this rate.
    const Native = window.AudioContext
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super({ sampleRate: rate, ...options })
      }
    }
  }, liveRate)
  await page.addInitScript(() => {
    // Init scripts also run in every frame, and #1758 renders in a throwaway
    // frame: each copy records into the TOP window, and only the top resets it.
    const w = (window.top ?? window) as unknown as { __renders: string[] }
    if (window === window.top) w.__renders = []
    const start = OfflineAudioContext.prototype.startRendering
    OfflineAudioContext.prototype.startRendering = function (this: OfflineAudioContext) {
      w.__renders.push(`${Math.round(this.length / this.sampleRate)}s@${this.sampleRate}`)
      return start.call(this)
    }
  })
  await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 220 } })
  expect(await page.evaluate(() => new AudioContext().sampleRate)).toBe(liveRate)
  const names = Array.from({ length: 12 }, (_, i) => `t${String(i + 1).padStart(2, '0')}`)
  await seedCode(page, ['setcps(0.5)', ...names.map((n) => osc(n, 'sawtooth'))].join('\n'))
  await saveWaveformThenReload(page, names)

  const fresh = async () => (await attr(page, 'data-full-song-envelopes')).split(' ').filter((x) => x.endsWith(':fresh')).map((x) => x.split(':')[0])
  const inView = () =>
    page.evaluate(() => {
      const grid = document.querySelector('[data-full-song="grid"]')!.getBoundingClientRect()
      return [...document.querySelectorAll<HTMLElement>('[data-full-song-lane]')]
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.height > 0 && r.top < grid.bottom - 1 && r.bottom > grid.top + 1
        })
        .map((el) => el.getAttribute('data-full-song-lane')!)
    })
  const settled = () => expect.poll(() => attr(page, 'data-full-song-envelope-rendering'), { timeout: 60_000 }).toBe('')

  // #1769 — how many lanes the budget holds at this live rate.
  const fit = Math.floor(BUDGET_SECONDS / ((TRACK_SECONDS * Math.min(liveRate, DISPLAY_RATE)) / liveRate))
  await expect.poll(async () => (await fresh()).length, { timeout: 120_000 }).toBe(fit)
  await settled()
  const before = await fresh()
  const renders = async () => (await page.evaluate(() => (window as unknown as { __renders: string[] }).__renders)).length
  const rendersBefore = await renders()
  expect(before).toEqual(names.slice(0, fit))

  await page.evaluate(() => {
    const grid = document.querySelector('[data-full-song="grid"]') as HTMLElement
    grid.scrollTop = grid.scrollHeight
  })
  // The label gutter follows the grid's scroll in its scroll handler.
  await expect.poll(inView, { timeout: 5_000 }).toContain('t12')
  const shown = await inView()
  expect(shown).not.toContain('t01')
  // As many of the lanes on screen as the budget holds draw.
  const drawnInView = Math.min(shown.length, fit)
  await expect.poll(async () => (await fresh()).filter((n) => shown.includes(n)).length, { timeout: 120_000 }).toBe(drawnInView)
  await settled()
  const after = await fresh()
  const newRenders = (await renders()) - rendersBefore
  console.log(
    `[#1760] live ${liveRate} Hz, ${fit} fit · in view after scroll: ${shown.join(',')} · drawn before: ${before.join(',')} · ` +
      `after: ${after.join(',')} · new renders: ${newRenders}`,
  )
  // Every lane drawn before still draws: nothing kept was thrown away …
  for (const n of before) expect(after, n).toContain(n)
  // … and only the lanes that had no render were rendered.
  expect(newRenders).toBe(after.filter((n) => shown.includes(n) && !before.includes(n)).length)
})
