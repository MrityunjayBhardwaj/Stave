import { test, expect, type Page } from '@playwright/test'

import { bootApp, evalCode, seedCode, stopCode } from './_appBoot'

/**
 * #2256 — the first time a song plays, no note is dropped for a sound that was
 * still loading.
 *
 * Each test runs in a fresh browser context, so its HTTP cache and superdough's
 * buffer caches start empty: every sample and instrument zone is fetched for the
 * first time, which is the case a visitor meets.
 *
 * What is counted: superdough logs `[webaudio] skip hap: still loading` when it
 * drops a note whose sound finished loading after the note's start time
 * (superdough.mjs, after `await onTrigger`). Strudel's logger swallows a repeat
 * of the same message within a second, so the count is AT LEAST the number of
 * drops; zero means none.
 *
 * And what proves the notes really sounded, so "no drops" can't pass by playing
 * nothing: every sample and instrument note reaches the speakers through
 * `AudioBufferSourceNode.start`, so each call is counted with the page time it
 * was made.
 */

const SKIP = 'skip hap: still loading'

async function collectStrudelLogs(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __strudelLogs: Array<{ t: number; message: string }> }
    w.__strudelLogs = []
    document.addEventListener('strudel.log', (e) => {
      const message = String((e as CustomEvent<{ message: string }>).detail?.message ?? '')
      w.__strudelLogs.push({ t: performance.now(), message })
    })
    const started: number[] = []
    ;(window as unknown as { __bufferStarts: number[] }).__bufferStarts = started
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      started.push(performance.now())
      return start.apply(this, args)
    }
  })
}

/** Buffer notes started at least `afterMs` after `fromMs` (page clock). */
const notesStarted = (page: Page, fromMs: number, afterMs = 0): Promise<number> =>
  page.evaluate(({ from, after }) =>
    (window as unknown as { __bufferStarts: number[] }).__bufferStarts.filter((t) => t - from >= after).length,
  { from: fromMs, after: afterMs })

/** Page ms from `fromMs` to the first buffer note started after it, or null. */
const firstNoteAfter = (page: Page, fromMs: number): Promise<number | null> =>
  page.evaluate((from) => {
    const t = (window as unknown as { __bufferStarts: number[] }).__bufferStarts.find((x) => x >= from)
    return t == null ? null : Math.round(t - from)
  }, fromMs)

/** Dropped-note logs, optionally only those at least `afterMs` after `fromMs` (page clock). */
const skips = (page: Page, fromMs = 0, afterMs = 0): Promise<number> =>
  page.evaluate(({ needle, from, after }) =>
    (window as unknown as { __strudelLogs: Array<{ t: number; message: string }> }).__strudelLogs
      .filter((m) => m.message.includes(needle) && m.t - from >= after).length,
  { needle: SKIP, from: fromMs, after: afterMs })

const pageNow = (page: Page): Promise<number> => page.evaluate(() => performance.now())

async function boot(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 })
  await collectStrudelLogs(page)
  await bootApp(page)
}

test.describe('first play loads its sounds first (#2256)', () => {
  test('drums and a gm instrument play their first notes on a cold cache', async ({ page }) => {
    test.setTimeout(60_000)
    await boot(page)
    await seedCode(page, [
      '$: s("bd hh sd hh, ~ cp").bank("RolandTR909")',
      '$: note("c3 e3 g3 b3").s("gm_piano")',
    ].join('\n'))
    const pressed = await pageNow(page)
    await evalCode(page)
    // Play waits for the first cycles' sounds, at most WARM_CAP_MS (2.5 s), so the
    // first note may come a while after the press on a slow network. Listen from it.
    await expect.poll(() => firstNoteAfter(page, pressed), { timeout: 10_000 }).not.toBeNull()
    const first = (await firstNoteAfter(page, pressed))!
    await page.waitForTimeout(4000)
    const dropped = await skips(page)
    const played = await notesStarted(page, pressed)
    console.log(`[#2256] cold first play: at least ${dropped} dropped, ${played} played, first note ${first} ms after Play`)
    expect(dropped, 'notes dropped because their sound was still loading').toBe(0)
    // 4 s from the first note is 2 cycles: 5 drum hits and 4 piano notes a cycle
    expect(played, 'notes that reached the audio graph').toBeGreaterThanOrEqual(15)
    await stopCode(page)
  })

  test('a sound that first appears later in the song is loaded before it arrives', async ({ page }) => {
    test.setTimeout(60_000)
    await boot(page)
    // The electric piano first plays in the fourth cycle (6 s in at the default
    // 0.5 cycles a second), well past the start, so only warming ahead can have it
    // ready. An instrument, not a drum: its font file is big enough that loading
    // it on demand misses the note (a late `rim` loaded in time, measured on main).
    await seedCode(page, [
      '$: s("bd hh sd hh")',
      '$: note("<~ ~ ~ [c3,e3,g3]>").s("gm_epiano1")',
    ].join('\n'))
    const pressed = await pageNow(page)
    await evalCode(page)
    await page.waitForTimeout(9000)
    // Only drops after the first two cycles (4 s) count here: the start is the
    // test above, and the instrument enters at 6 s.
    const dropped = await skips(page, pressed, 4000)
    const late = await notesStarted(page, pressed, 5500)
    console.log(`[#2256] late sound: at least ${dropped} dropped after 4 s (all: ${await skips(page)}), ${late} notes from 5.5 s`)
    expect(dropped, 'notes dropped because their sound was still loading').toBe(0)
    // from 5.5 s: the chord's 3 notes, plus the drums' 4 a cycle
    expect(late, 'notes that reached the audio graph').toBeGreaterThanOrEqual(5)
    await stopCode(page)
  })
})

/**
 * #2259 — while Play is still loading (the engine, the code, those sounds), the
 * transport says LOAD and the Play button says Loading, so the wait doesn't read
 * as a Play that did nothing. Every change of the transport's state word, and of
 * the button's label, is recorded with its page time.
 */
async function recordTransportStates(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: Array<{ t: number; state: string }> = []
    ;(window as unknown as { __lcdStates: typeof seen }).__lcdStates = seen
    const tick = (): void => {
      const lcd = document.querySelector<HTMLElement>('[data-stave-lcd-state]')?.dataset.staveLcdState ?? ''
      const button = document.querySelector('[data-testid="strudel-chrome-transport"]')?.textContent?.trim() ?? ''
      const state = lcd && `${lcd}|${button}`
      if (state && seen[seen.length - 1]?.state !== state) seen.push({ t: performance.now(), state })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

const lcdStates = (page: Page): Promise<Array<{ t: number; state: string }>> =>
  page.evaluate(() => (window as unknown as { __lcdStates: Array<{ t: number; state: string }> }).__lcdStates)

const COLD_SONG = [
  '$: s("bd hh sd hh, ~ cp").bank("RolandTR909")',
  '$: note("c3 e3 g3 b3").s("gm_piano")',
].join('\n')

test.describe('the wait for sounds is shown (#2259)', () => {
  test('a cold Play reads LOAD, then PLAY once the clock starts', async ({ page }) => {
    test.setTimeout(60_000)
    await recordTransportStates(page)
    await boot(page)
    await seedCode(page, COLD_SONG)
    const button = page.getByTestId('strudel-chrome-transport')
    const pressed = await pageNow(page)
    await evalCode(page)

    await expect(page.locator('[data-stave-lcd-state]')).toHaveAttribute('data-stave-lcd-state', 'play', { timeout: 10_000 })
    await expect(button).toHaveText(/Stop/)
    await expect.poll(() => firstNoteAfter(page, pressed), { timeout: 10_000 }).not.toBeNull()

    // read from the frame-by-frame record, so a short LOAD can't slip between polls
    const states = (await lcdStates(page)).filter((s) => s.t >= pressed)
    const load = states.find((s) => s.state.startsWith('load|'))
    const play = states.find((s) => s.state.startsWith('play|'))!
    const first = (await firstNoteAfter(page, pressed))!
    console.log(`[#2259] ${states.map((s) => `${s.state} @${Math.round(s.t - pressed)}`).join(', ')}; first note ${first} ms after Play`)
    // each surface on its own: the transport is drawn a render after the button
    // (it goes through the app shell), so for a frame the two may differ
    const sequence = (part: 0 | 1): string[] =>
      states.map((s) => s.state.split('|')[part]).filter((v, i, all) => v !== all[i - 1])
    expect(sequence(0)).toEqual(['load', 'play'])
    expect(sequence(1)).toEqual(['\u25CC Loading', '\u25A0 Stop'])
    expect(load).toBeDefined()
    // LOAD covers the wait: it ends no later than the first note sounds
    expect(play.t - pressed).toBeLessThanOrEqual(first + 50)
    await stopCode(page)
  })

  test('pressing the button while it loads cancels that Play', async ({ page }) => {
    test.setTimeout(60_000)
    await boot(page)
    await seedCode(page, COLD_SONG)
    const button = page.getByTestId('strudel-chrome-transport')
    await evalCode(page)
    await expect(button).toHaveAttribute('data-play-pending', 'true', { timeout: 5_000 })

    await button.click()
    const cancelled = await pageNow(page)
    await expect(page.locator('[data-stave-lcd-state]')).toHaveAttribute('data-stave-lcd-state', 'stop')
    await expect(button).toHaveText(/Play/)
    // past the warm-up's 2.5 s cap: the cancelled Play never starts the clock
    await page.waitForTimeout(3500)
    await expect(page.locator('[data-stave-lcd-state]')).toHaveAttribute('data-stave-lcd-state', 'stop')
    expect(await notesStarted(page, cancelled), 'notes after the cancel').toBe(0)
  })
})
