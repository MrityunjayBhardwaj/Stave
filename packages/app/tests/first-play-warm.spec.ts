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
