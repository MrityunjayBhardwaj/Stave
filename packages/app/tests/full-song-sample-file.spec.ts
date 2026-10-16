import { test, expect, type Page } from '@playwright/test'
import { chooseDisplay } from './_laneType'

import { bootApp, seedCode, evalCode, stopCode } from './_appBoot'

/**
 * #1764 — a drum lane draws the file the engine plays.
 *
 * A sample lane draws each hit as the shape of its sample file. It used to look
 * that file up by the event's `s` alone, so `.bank("RolandTR909")` and a sample
 * number (`bd:3`) changed the sound and not the drawing: the lane kept the
 * default kit's first `bd`. Measured before the fix: both drew pixel-for-pixel
 * the same lane as plain `bd`, while the engine fetched a different file for
 * each.
 *
 * Each pattern is played (that is what loads its file), stopped, and the drum
 * lane's canvas is read back: per pixel column, how many pixels stand off the
 * band's median. Two drawings are compared by the summed column difference over
 * the first one's ink.
 *
 * Guards, so a pass cannot come from something else:
 *  - the same pattern drawn twice must read exactly the same (the noise floor);
 *  - the engine must have fetched the banked and the numbered file, so the
 *    shape the lane should draw really exists;
 *  - every lane must hold a drawn shape, not a plain bar, so "different" is
 *    never a failed load drawing nothing.
 */

const PATTERNS = {
  bd: 'setcps(0.5)\n$: s("bd")',
  banked: 'setcps(0.5)\n$: s("bd").bank("RolandTR909")',
  numbered: 'setcps(0.5)\n$: s("bd:3")',
} as const

/** Per column of the first lane's band: pixels standing off the band's median. */
async function inkColumns(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const row = document.querySelector('[data-full-song-lane]') as HTMLElement | null
    const canvas = document.querySelector('[data-full-song-canvas]') as HTMLCanvasElement | null
    if (!row || !canvas) return []
    const rr = row.getBoundingClientRect()
    const cr = canvas.getBoundingClientRect()
    const dpr = canvas.width / cr.width
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return []
    const y0 = Math.max(0, Math.round((rr.top - cr.top) * dpr))
    const h = Math.max(1, Math.round(rr.height * dpr))
    const d = ctx.getImageData(0, y0, canvas.width, h).data
    const luma = (i: number) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
    const all: number[] = []
    for (let i = 0; i < d.length; i += 4) all.push(luma(i))
    const med = [...all].sort((a, b) => a - b)[Math.floor(all.length / 2)]
    const cols: number[] = []
    for (let x = 0; x < canvas.width; x++) {
      let n = 0
      for (let y = 0; y < h; y++) if (Math.abs(luma((y * canvas.width + x) * 4) - med) > 20) n++
      cols.push(n)
    }
    return cols
  })
}

function difference(a: number[], b: number[]): number {
  let diff = 0
  let ink = 0
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff += Math.abs((a[i] ?? 0) - (b[i] ?? 0))
    ink += a[i] ?? 0
  }
  return ink === 0 ? NaN : diff / ink
}

/** A drawn shape varies in height across its columns; a plain bar does not. */
function distinctHeights(cols: number[]): number {
  return new Set(cols.filter((c) => c > 0)).size
}

test('a drum lane draws the kit and the sample number it plays (#1764)', async ({ page }) => {
  test.setTimeout(180_000)
  const fetched: string[] = []
  page.on('request', (r) => {
    if (/\.(wav|mp3|ogg|flac)(\?|$)/i.test(r.url())) fetched.push(decodeURIComponent(r.url()).toLowerCase())
  })
  await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 360 } })

  const drawn = async (code: string): Promise<number[]> => {
    await seedCode(page, code)
    // #2079 — a drum lane is Bars by default; its drawn file is what is read.
    await chooseDisplay(page, 'd1', 'waveform')
    await evalCode(page)
    await page.waitForTimeout(4500)
    await stopCode(page)
    await expect(page.locator('[data-full-song="playhead"]')).toHaveCount(0, { timeout: 10_000 })
    await page.waitForTimeout(2500)
    return inkColumns(page)
  }

  const bd = await drawn(PATTERNS.bd)
  const again = await drawn(PATTERNS.bd)
  const banked = await drawn(PATTERNS.banked)
  const numbered = await drawn(PATTERNS.numbered)

  const vsBd = { again: difference(again, bd), banked: difference(banked, bd), numbered: difference(numbered, bd) }
  console.log(
    `[#1764] vs plain bd: again ${vsBd.again} · banked ${vsBd.banked.toFixed(3)} · numbered ${vsBd.numbered.toFixed(3)} · ` +
      `shape heights bd ${distinctHeights(bd)} banked ${distinctHeights(banked)} numbered ${distinctHeights(numbered)} · ` +
      `fetched ${fetched.map((u) => u.split('/').slice(-2).join('/')).join(', ')}`,
  )

  // The noise floor: one pattern, drawn twice, is the same drawing.
  expect(vsBd.again).toBe(0)
  // The shapes the lane should draw exist: the engine fetched both files.
  expect(fetched.some((u) => u.includes('rolandtr909'))).toBe(true)
  expect(fetched.filter((u) => /\/bd\//.test(u)).length).toBeGreaterThanOrEqual(2)
  // Each lane holds a drawn shape, not a plain bar.
  for (const cols of [bd, banked, numbered]) expect(distinctHeights(cols)).toBeGreaterThan(3)
  // And the drawing follows the file: a different kit, a different number.
  expect(vsBd.banked).toBeGreaterThan(0.01)
  expect(vsBd.numbered).toBeGreaterThan(0.01)
})

/**
 * #1767 — a drum name the engine ALIASES (`kick` → `bd`, `aliasSoundValue`)
 * draws and lights as the sound it plays.
 *
 * Before the fix `s("kick")` drew 0.222 away from `s("bd")` (a thin synth-style
 * row, the registry has no `kick`) and lit 0 of 50 frames while playing, though
 * the engine played `bd`'s very file. The alias runs on the bare name BEFORE
 * superdough adds the bank, so `kick` + bank must draw as `bd` + bank.
 */
const ALIASED = {
  kick: 'setcps(0.5)\n$: s("kick")',
  kickBanked: 'setcps(0.5)\n$: s("kick").bank("RolandTR909")',
  bdBanked: 'setcps(0.5)\n$: s("bd").bank("RolandTR909")',
  // A sound the user registers under the alias name wins over the alias table.
  registered:
    // Single quotes: a double-quoted string in a document becomes a mini-notation
    // pattern, and `samples()` then rejects it ("Invalid argument").
    "samples({ kick: ['sd/rytm-00-hard.wav'] }, 'https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master/')\n" +
    'setcps(0.5)\n$: s("kick")',
} as const

test('an aliased drum name draws the file it plays, and a registered one wins (#1767)', async ({ page }) => {
  test.setTimeout(240_000)
  const fetched: string[] = []
  page.on('request', (r) => {
    if (/\.(wav|mp3|ogg|flac)(\?|$)/i.test(r.url())) fetched.push(decodeURIComponent(r.url()).toLowerCase())
  })
  await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 360 } })

  const drawn = async (code: string): Promise<number[]> => {
    await seedCode(page, code)
    // #2079 — a drum lane is Bars by default; its drawn file is what is read.
    await chooseDisplay(page, 'd1', 'waveform')
    await evalCode(page)
    await page.waitForTimeout(4500)
    await stopCode(page)
    await expect(page.locator('[data-full-song="playhead"]')).toHaveCount(0, { timeout: 10_000 })
    await page.waitForTimeout(2500)
    return inkColumns(page)
  }

  // ORDER MATTERS. A document that fails to evaluate leaves the previous lane on
  // screen, so each arm follows one that draws DIFFERENTLY from what the arm must
  // equal: a stale `kick` would read as bd+bank (0.047 from bd), not 0.
  const bd = await drawn(PATTERNS.bd)
  const again = await drawn(PATTERNS.bd)
  const bdBanked = await drawn(ALIASED.bdBanked)
  const kick = await drawn(ALIASED.kick)
  const kickBanked = await drawn(ALIASED.kickBanked)
  // Last: a registration outlives the document for the rest of the page.
  const registered = await drawn(ALIASED.registered)

  const d = {
    again: difference(again, bd),
    kick: difference(kick, bd),
    kickBanked: difference(kickBanked, bdBanked),
    bankedVsBd: difference(bdBanked, bd),
    registered: difference(registered, bd),
    registeredVsBanked: difference(registered, bdBanked),
  }
  console.log(
    `[#1767] kick vs bd ${d.kick} · kick+bank vs bd+bank ${d.kickBanked} · bd+bank vs bd ${d.bankedVsBd.toFixed(3)} · ` +
      `registered kick vs bd ${d.registered.toFixed(3)} vs bd+bank ${d.registeredVsBanked.toFixed(3)} · floor ${d.again} · ` +
      `shape heights kick ${distinctHeights(kick)} kick+bank ${distinctHeights(kickBanked)} registered ${distinctHeights(registered)}`,
  )

  expect(d.again).toBe(0)
  for (const cols of [kick, kickBanked, registered]) expect(distinctHeights(cols)).toBeGreaterThan(3)
  // The aliased name draws exactly what the written canonical name draws.
  expect(d.kick).toBe(0)
  expect(d.kickBanked).toBe(0)
  // CONTROL — the two kits really draw differently, so the 0 above is not blindness.
  expect(d.bankedVsBd).toBeGreaterThan(0.01)
  // A registered `kick` plays its own file, and the lane draws that file, not bd's.
  expect(fetched.some((u) => u.endsWith('sd/rytm-00-hard.wav'))).toBe(true)
  expect(d.registered).toBeGreaterThan(0.01)
  expect(d.registeredVsBanked).toBeGreaterThan(0.01)
})

/** Frames (of 50, 100 ms apart) in which the first lane has a lit run wider than 6 px. */
async function litFrames(page: Page): Promise<number> {
  let frames = 0
  for (let i = 0; i < 50; i++) {
    const run = await page.evaluate(() => {
      const o = document.querySelector('[data-full-song-overlay]') as HTMLCanvasElement | null
      const row = document.querySelector('[data-full-song-lane]') as HTMLElement | null
      if (!o || !row || o.width === 0) return 0
      const orr = o.getBoundingClientRect()
      const rr = row.getBoundingClientRect()
      const dpr = o.width / orr.width
      const y0 = Math.max(0, Math.round((rr.top - orr.top) * dpr))
      const rows = Math.min(Math.max(1, Math.round(rr.height * dpr)), o.height - y0)
      if (rows <= 0) return 0
      const px = o.getContext('2d')!.getImageData(0, y0, o.width, rows).data
      let cur = 0
      let best = 0
      for (let x = 0; x < o.width; x++) {
        let any = false
        for (let y = 0; y < rows && !any; y++) if (px[(y * o.width + x) * 4 + 3] > 10) any = true
        cur = any ? cur + 1 : 0
        best = Math.max(best, cur)
      }
      return best
    })
    if (run > 6) frames++
    await page.waitForTimeout(100)
  }
  return frames
}

test('an aliased drum name lights while it plays (#1767)', async ({ page }) => {
  test.setTimeout(180_000)
  await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 360 } })
  const lit: Record<string, number> = {}
  // The played hit reaches the timeline named `bd` (the alias runs before the
  // live stream, and the visualisers depend on that), so lighting a `kick` mark
  // also shows that order is intact: a hit named `kick` would miss it.
  for (const [label, code] of [
    ['bd', 'setcps(0.5)\n$: s("bd*2")'],
    ['kick', 'setcps(0.5)\n$: s("kick*2")'],
    ['kick+bank', 'setcps(0.5)\n$: s("kick*2").bank("RolandTR909")'],
  ] as const) {
    await seedCode(page, code)
    await evalCode(page)
    await page.locator('[data-full-song-overlay]').waitFor({ timeout: 10_000 })
    lit[label] = await litFrames(page)
    await stopCode(page)
    await expect(page.locator('[data-full-song="playhead"]')).toHaveCount(0, { timeout: 10_000 })
  }
  console.log(`[#1767] lit frames of 50: ${JSON.stringify(lit)}`)
  // CONTROL — the plain name lights, so the instrument sees a lit mark.
  expect(lit.bd).toBeGreaterThanOrEqual(40)
  expect(lit.kick).toBeGreaterThanOrEqual(40)
  expect(lit['kick+bank']).toBeGreaterThanOrEqual(40)
})
