import { test, expect, type Page } from '@playwright/test'
import { chooseDisplay, shownDisplay } from './_laneType'

import { bootApp, seedCode, waitForEditorLoaded } from './_appBoot'

/**
 * #1731 — a synth track draws its own loudness on the Song timeline, rendered
 * offline from its own pattern, and only while the transport is stopped.
 *
 * Three claims, each read off the running app:
 *
 *  1. A stopped document's collapsed synth lane carries an envelope that TRACKS
 *     GAIN: the lane-coloured ink stands taller in a loud cycle than in a quiet
 *     one. Measured as a DIFFERENCE between two cycles of one snapshot, never an
 *     absolute count — the note mark in each cycle is the same height, so only
 *     the envelope can make them differ. A drum lane (files) gets none: its
 *     waveform is the files' own (#1730).
 *  2. An edit made while playing marks exactly the edited track stale, and the
 *     next stop renders it fresh again.
 *  3. Play pressed while a render is in flight starts at once rather than after
 *     the render: the render is aborted, not waited out.
 *  4. An audition fired while a render is in flight reaches the LIVE graph
 *     (#1733). Counted at the one place a synth note makes its sound: which
 *     context `createOscillator` is called on. The rendering track is white
 *     noise, which makes no oscillator, so any oscillator made on an offline
 *     context during the render can only be the audition's.
 *
 * Slots are measured off the ruler's own ticks, never off the ink being judged
 * (the lesson of #1730's instruments), and ink is matched to the LANE'S OWN hue,
 * read off its swatch, so clip borders and other overlays cannot count.
 */

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function envelopes(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector('[data-full-song-envelopes]')?.getAttribute('data-full-song-envelopes') ?? '')
}

async function rendering(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector('[data-full-song-envelope-rendering]')?.getAttribute('data-full-song-envelope-rendering') ?? '',
  )
}

/**
 * Rows of the lane's band holding the envelope's ink across at least a tenth of
 * the middle of `cycle`'s slot, in backing-store pixels.
 *
 * #1740 — the envelope is drawn INSIDE the lane's bars, over a recessed bed, at
 * the full lane colour. The bar under it is still lane-hued, only darker, so
 * hue alone counts the whole bar in every cycle. The envelope is the only ink
 * at (nearly) the swatch's own brightness: a bar is drawn at a gain-scaled
 * opacity and then recessed, so it never reaches 90% of it.
 */
async function inkRows(page: Page, laneKey: string, cycle: number): Promise<number> {
  return page.evaluate(
    ({ key, cycle }) => {
      const canvas = document.querySelector('[data-full-song-canvas]') as HTMLCanvasElement | null
      const row = document.querySelector(`[data-full-song-lane="${key}"]`) as HTMLElement | null
      const dot = document.querySelector(`[data-full-song-lane-dot="${key}"]`) as HTMLElement | null
      if (!canvas || !row || !dot) return -1
      const rgb = (getComputedStyle(dot).backgroundColor.match(/\d+(\.\d+)?/g) ?? []).map(Number)
      const hueOf = (r: number, g: number, b: number) => {
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        if (max === min) return { h: 0, s: 0, v: max }
        const d = max - min
        let h = max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d
        h = (h * 60 + 360) % 360
        return { h, s: d / max, v: max }
      }
      const lane = hueOf(rgb[0], rgb[1], rgb[2])
      const cr = canvas.getBoundingClientRect()
      const rr = row.getBoundingClientRect()
      const dpr = canvas.width / cr.width
      // Slot from the ruler: the tick labelled `cycle` and the next one.
      const ticks = Array.from(document.querySelectorAll('[data-full-song-tick]')).map((t) => ({
        label: (t.textContent ?? '').trim(),
        left: t.getBoundingClientRect().left,
      }))
      const a = ticks.find((t) => t.label === String(cycle))
      const b = ticks.find((t) => t.label === String(cycle + 1))
      if (!a || !b) return -2
      const x0 = Math.round((a.left - cr.left + (b.left - a.left) * 0.2) * dpr)
      const x1 = Math.round((a.left - cr.left + (b.left - a.left) * 0.8) * dpr)
      const y0 = Math.max(0, Math.round((rr.top - cr.top) * dpr))
      const h = Math.round(rr.height * dpr)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx || x1 <= x0) return -3
      const data = ctx.getImageData(x0, y0, x1 - x0, h).data
      let rows = 0
      for (let y = 0; y < h; y++) {
        let hits = 0
        for (let x = 0; x < x1 - x0; x++) {
          const i = (y * (x1 - x0) + x) * 4
          const p = hueOf(data[i], data[i + 1], data[i + 2])
          const dh = Math.min(Math.abs(p.h - lane.h), 360 - Math.abs(p.h - lane.h))
          if (p.s > 0.4 && p.v >= lane.v * 0.9 && dh < 25) hits++
        }
        if (hits >= (x1 - x0) * 0.1) rows++
      }
      return rows
    },
    { key: laneKey, cycle },
  )
}

async function held(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector('[data-full-song-envelopes-held]')?.getAttribute('data-full-song-envelopes-held') ?? '',
  )
}

/** Stop by the transport's own button, and wait for the playhead to go: a
 *  keyboard stop after a click in the timeline does not reach the editor. */
async function stopTransport(page: Page): Promise<void> {
  await page.getByTestId('strudel-chrome-transport').click()
  await page.locator('[data-full-song="playhead"]').waitFor({ state: 'detached', timeout: 10_000 })
}

async function waitForEnvelopes(page: Page, want: string, timeout = 20_000): Promise<void> {
  await expect.poll(() => envelopes(page), { timeout }).toBe(want)
}

/** Evaluate-and-play while a display render is in flight starts about as fast as with none. */
async function playsAtOnceDuringRender(page: Page, tag: string): Promise<void> {
  // One long, dense track, so a render is seconds of work and certainly in
  // flight when Play is pressed.
  const code = 'setcps(0.5)\n$: arrange([256, note("c3*8 e3*8").s("sawtooth").lpf(1200)])'
  await seedCode(page, code)
  await chooseDisplay(page, 'd1', 'waveform')
  await waitForEnvelopes(page, 'd1:fresh', 60_000)

  // Baseline: evaluate-and-play with no render running.
  const playLatency = async (): Promise<number> => {
    await page.locator('.monaco-editor').first().click()
    const t0 = Date.now()
    await page.keyboard.press(`${MOD}+Enter`)
    await page.locator('[data-full-song="playhead"]').waitFor({ timeout: 30_000 })
    return Date.now() - t0
  }
  const idle = await playLatency()
  await page.keyboard.press(`${MOD}+Period`)
  await page.locator('[data-full-song="playhead"]').waitFor({ state: 'detached', timeout: 10_000 })

  // A new document to render, then Play the moment the render starts.
  await seedCode(page, code.replace('lpf(1200)', 'lpf(900)'))
  await expect.poll(() => rendering(page), { timeout: 30_000, intervals: [20] }).not.toBe('')
  const during = await playLatency()
  console.log(`[${tag}] evaluate-and-play: idle ${idle} ms, during a render ${during} ms`)
  expect(during - idle).toBeLessThan(400)
  await page.keyboard.press(`${MOD}+Period`)
}

test.describe('synth lane envelope (#1731)', () => {
  test.beforeEach(async ({ page }) => {
    // #2109 — several songs here are 256-cycle arrangements, rendered whole; at the
    // default limit of 64 the timeline would draw them a 64-cycle window at a time.
    await page.addInitScript(() => {
      try { localStorage.setItem('stave:songCycleLimit', '256') } catch { /* ignore */ }
    })
    await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 360 } })
  })

  test('a stopped synth lane draws an envelope that follows its gain; a drum lane draws none', async ({ page }) => {
    // One sustained note per cycle, getting louder each cycle.
    await seedCode(page, 'setcps(0.5)\n$: note("c3").s("sine").gain("<0.1 0.4 0.7 1>")\n$: s("bd*4")')
    await chooseDisplay(page, 'd1', 'waveform')
    await waitForEnvelopes(page, 'd1:fresh')
    const quiet = await inkRows(page, 'd1', 0)
    // Cycle 2 (gain 0.7), not 3: a four-cycle song has no tick for cycle 4 to
    // close cycle 3's slot.
    const loud = await inkRows(page, 'd1', 2)
    console.log(`[#1731] ink rows: quiet cycle ${quiet}, loud cycle ${loud}`)
    await page.locator('[data-full-song-canvas]').screenshot({ path: 'test-results/synth-lane-envelope-gain.png' })
    // The instrument found the lane and both slots (its failures are negative
    // sentinels). Under #1740 the quiet cycle's shape is a ~1 px line inside its
    // bar, which anti-aliases below the brightness the instrument counts.
    expect(quiet).toBeGreaterThanOrEqual(0)
    expect(loud - quiet).toBeGreaterThanOrEqual(4)
  })

  test('with no type saved, a synth lane and a drum lane draw as Bars, and their menus say so (#2079)', async ({ page }) => {
    await seedCode(page, 'setcps(0.5)\n$: note("c3").s("sine").gain("<0.1 0.4 0.7 1>")\n$: s("bd*4")')
    await page.locator('[data-full-song-lane="d2"]').waitFor({ timeout: 20_000 })
    // The synth track is still rendered, last, so choosing Waveform draws at
    // once (#1748), but nothing is drawn while it is Bars.
    await expect.poll(() => held(page), { timeout: 30_000 }).toBe('d1')
    // #2138 — and it STAYS 'd1'. The drum lane plays only files, so its track is
    // never rendered, Bars or not. Reaching 'd1' once proved nothing: before the
    // fix the drum track was rendered ~300 ms after the synth's, and this poll
    // passed only when it happened to land in that gap. So watch for the drum
    // lane joining, over longer than the engine's 700 ms debounce between renders.
    for (const until = Date.now() + 3_000; Date.now() < until; ) {
      expect(await held(page), 'the drum lane got a render it can never draw').toBe('d1')
      await page.waitForTimeout(50)
    }
    expect(await envelopes(page)).toBe('')
    expect(await shownDisplay(page, 'd1')).toBe('bars')
    expect(await shownDisplay(page, 'd2')).toBe('bars')
    // CONTROL — saving Waveform draws it, and the menu follows.
    await chooseDisplay(page, 'd1', 'waveform')
    await waitForEnvelopes(page, 'd1:fresh')
    expect(await shownDisplay(page, 'd1')).toBe('waveform')
  })

  test('an edit while playing marks only that track stale, and stopping renders it again', async ({ page }) => {
    const before = 'setcps(0.5)\n$: note("c3*2").s("sawtooth")\n$: note("e2").s("square")'
    await seedCode(page, before)
    await chooseDisplay(page, 'd1', 'waveform')
    await chooseDisplay(page, 'd2', 'waveform')
    await waitForEnvelopes(page, 'd1:fresh d2:fresh')

    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press(`${MOD}+Enter`)
    await page.locator('[data-full-song="playhead"]').waitFor({ timeout: 10_000 })
    await seedCode(page, before.replace('note("c3*2")', 'note("c3*4")'))
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press(`${MOD}+Enter`)
    await waitForEnvelopes(page, 'd1:stale d2:fresh')
    // Still playing: nothing renders until the transport stops.
    await page.waitForTimeout(1500)
    expect(await envelopes(page)).toBe('d1:stale d2:fresh')
    await page.screenshot({ path: 'test-results/synth-lane-envelope-stale.png' })

    await page.keyboard.press(`${MOD}+Period`)
    await waitForEnvelopes(page, 'd1:fresh d2:fresh')
  })

  test('Play pressed during a render starts at once instead of waiting for it', async ({ page }) => {
    await playsAtOnceDuringRender(page, '#1731')
  })

  test('an audition during a render plays through the live graph, not into the render (#1733)', async ({ page }) => {
    await page.addInitScript(() => {
      // Init scripts also run in every frame, and #1758 renders in a throwaway
      // frame: each copy records into the TOP window, and only the top resets it.
      const w = (window.top ?? window) as unknown as { __osc: { live: number; offline: number }; __offlineActive: number }
      if (window === window.top) {
        w.__osc = { live: 0, offline: 0 }
        w.__offlineActive = 0
      }
      const create = BaseAudioContext.prototype.createOscillator
      BaseAudioContext.prototype.createOscillator = function (this: BaseAudioContext) {
        if (this instanceof OfflineAudioContext) w.__osc.offline++
        else w.__osc.live++
        return create.call(this)
      }
      const start = OfflineAudioContext.prototype.startRendering
      OfflineAudioContext.prototype.startRendering = function (this: OfflineAudioContext) {
        w.__offlineActive++
        const done = start.call(this)
        void done.finally(() => w.__offlineActive--)
        return done
      }
    })
    await page.reload()
    // #1753 — the reloaded page loads its saved document; seed only after it
    // has landed, or the load puts the starter back over the fixture.
    await waitForEditorLoaded(page)
    // Tracks 1 and 2 render first and are long white noise; track 3 is the
    // sawtooth the Pattern tab's ▶ auditions, an oscillator.
    await seedCode(
      page,
      'setcps(0.5)\n$: arrange([256, s("white*16").gain(0.3)])\n$: arrange([256, s("pink*16").gain(0.3)])\n$: note("c3").s("sawtooth")',
    )
    // Caret into the sawtooth's pattern, so the Pattern tab offers its sound.
    await page.evaluate(() => {
      const m = (window as unknown as {
        monaco: { editor: { getEditors: () => Array<{ setPosition: (p: { lineNumber: number; column: number }) => void; focus: () => void }> } }
      }).monaco
      const ed = m.editor.getEditors()[0]
      ed.setPosition({ lineNumber: 4, column: 12 })
      ed.focus()
    })
    // #1753 — wait for THIS document's render. Track ids are positional, so the
    // page's saved document (the starter song, a `loop 4`) also has a `$0`,
    // and on a slow page it is evaluated at load and starts rendering before
    // the seed's evaluate replaces it. Its synth voices are offline
    // oscillators; counting from page load read them as the audition's. So key
    // on the seeded document's own span as well, and count from there.
    const ownRender = () =>
      page.evaluate(
        () =>
          `${document.querySelector('[data-full-song-period]')?.getAttribute('data-full-song-period') ?? ''} / ` +
          `${document.querySelector('[data-full-song-envelope-rendering]')?.getAttribute('data-full-song-envelope-rendering') ?? ''}`,
      )
    await expect.poll(ownRender, { timeout: 30_000, intervals: [20] }).toBe('arranged 256 cycles / $0')
    const osc = () => page.evaluate(() => ({ ...(window as unknown as { __osc: { live: number; offline: number } }).__osc }))
    const armed = await osc()

    await page.locator('[data-bottom-panel="root"]').locator('role=tab[name="Pattern"]').click()
    const play = page.locator('[data-mixer-sound-audition]:not([disabled])').first()
    await play.waitFor({ timeout: 10_000 })
    const before = await osc()
    // Noise has no oscillator: this document's render makes none, so any offline
    // oscillator after the click can only be the audition's.
    expect(before.offline - armed.offline).toBe(0)
    const midRender = await page.evaluate(() => (window as unknown as { __offlineActive: number }).__offlineActive)
    await play.click()
    await page.waitForTimeout(400)
    const after = await page.evaluate(() => (window as unknown as { __osc: { live: number; offline: number } }).__osc)
    console.log(`[#1733] offline renders active at the click: ${midRender}; oscillators live ${after.live - before.live}, offline ${after.offline - before.offline}`)
    expect(midRender).toBeGreaterThan(0) // the click really landed during a render
    expect(after.offline - before.offline).toBe(0)
    expect(after.live - before.live).toBeGreaterThan(0)
  })

  test('a song too long to render every track says how many it left out', async ({ page }) => {
    // Five 256-cycle tracks at 0.5 cps are 512 s of audio each. A sawtooth track
    // renders at half rate and counts half (#1759), 256 s; the budget is 1200 s a
    // pass, so the first four are drawn and the fifth is named.
    const part = (n: string) => `$: arrange([256, note("${n}*2").s("sawtooth")])`
    await seedCode(page, ['setcps(0.5)', part('c3'), part('e3'), part('g3'), part('b3'), part('d4')].join('\n'))
    await chooseDisplay(page, 'd1', 'waveform')
    await chooseDisplay(page, 'd2', 'waveform')
    await chooseDisplay(page, 'd3', 'waveform')
    await chooseDisplay(page, 'd4', 'waveform')
    await chooseDisplay(page, 'd5', 'waveform')
    await waitForEnvelopes(page, 'd1:fresh d2:fresh d3:fresh d4:fresh', 90_000)
    const notice = page.locator('[data-full-song-envelope-over-cap]')
    await expect(notice).toHaveAttribute('data-full-song-envelope-over-cap', '1')
    await expect(notice).toHaveText('1 track too long to draw')
  })
  test('a track set to Bars from its header menu draws notes only, and stays so after a reload (#1738)', async ({ page }) => {
    const code = 'setcps(0.5)\n$: note("c3").s("sine").gain("<0.1 0.4 0.7 1>")\n$: note("e2").s("square")'
    await seedCode(page, code)
    await chooseDisplay(page, 'd1', 'waveform')
    await chooseDisplay(page, 'd2', 'waveform')
    await waitForEnvelopes(page, 'd1:fresh d2:fresh')
    const shaped = (await inkRows(page, 'd1', 2)) - (await inkRows(page, 'd1', 0))
    expect(shaped).toBeGreaterThanOrEqual(4) // PRECONDITION: the render is drawn

    // Right-click the name area → Type ▸ shows Waveform checked → pick Bars.
    const header = page.locator('[data-full-song-lane="d1"]').getByText('d1', { exact: true })
    await header.click({ button: 'right' })
    const menu = page.locator('[data-full-song-lane-menu="d1"]')
    await expect(menu).toBeVisible()
    await expect(menu.locator('[data-full-song-lane-menu-rename]')).toBeVisible()
    await menu.locator('[data-full-song-lane-menu-type]').hover()
    await expect(menu.locator('[data-full-song-lane-menu-display="waveform"]')).toHaveAttribute('aria-checked', 'true')
    await menu.locator('[data-full-song-lane-menu-display="bars"]').click()
    await expect(menu).toHaveCount(0)

    // d1 draws no render; d2 keeps drawing its own.
    await waitForEnvelopes(page, 'd2:fresh')
    const flat = (await inkRows(page, 'd1', 2)) - (await inkRows(page, 'd1', 0))
    console.log(`[#1738] loud-minus-quiet ink rows: waveform ${shaped}, bars ${flat}`)
    expect(flat).toBeLessThanOrEqual(1) // the note marks alone are the same height

    // Saved in the file's Yjs doc: a reload keeps d1 on Bars.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-full-song-lane="d1"]').waitFor({ timeout: 30_000 })
    await waitForEnvelopes(page, 'd2:fresh', 30_000)
    // A DOUBLE-click this time: its first click jumps to the code and the editor
    // scrolls, which must not close the menu it opens.
    await page.locator('[data-full-song-lane="d1"]').getByText('d1', { exact: true }).dblclick()
    const again = page.locator('[data-full-song-lane-menu="d1"]')
    await again.locator('[data-full-song-lane-menu-type]').hover()
    await expect(again.locator('[data-full-song-lane-menu-display="bars"]')).toHaveAttribute('aria-checked', 'true')

    // And back: Waveform renders it again.
    await again.locator('[data-full-song-lane-menu-display="waveform"]').click()
    await waitForEnvelopes(page, 'd1:fresh d2:fresh')
  })
  test('an EXPANDED synth lane draws its shape inside its pitched bars; Bars takes it away (#1745)', async ({ page }) => {
    // A pitch range, so the expanded lane places bars by pitch at the sub-row
    // bar height (#1744), and a gain swell, so the shape differs cycle to cycle.
    const code = 'setcps(0.5)\n$: note("<c3 e3 g3 c4>").s("sine").gain("<0.1 0.4 0.7 1>")\n$: note("e2").s("square")'
    await seedCode(page, code)
    await chooseDisplay(page, 'd1', 'waveform')
    await chooseDisplay(page, 'd2', 'waveform')
    await waitForEnvelopes(page, 'd1:fresh d2:fresh')
    await page.locator('[data-full-song-lane-expand="d1"]').click()
    await expect(page.locator('[data-full-song-lane="d1"]')).toHaveAttribute('data-expanded', 'true')
    await expect.poll(async () => (await inkRows(page, 'd1', 2)) - (await inkRows(page, 'd1', 0)), { timeout: 10_000 }).toBeGreaterThanOrEqual(3)
    const quiet = await inkRows(page, 'd1', 0)
    const loud = await inkRows(page, 'd1', 2)
    console.log(`[#1745] expanded ink rows: quiet cycle ${quiet}, loud cycle ${loud}`)
    await page.locator('[data-full-song-canvas]').screenshot({ path: 'test-results/synth-lane-expanded-shape.png' })

    await page.locator('[data-full-song-lane="d1"]').getByText('d1', { exact: true }).click({ button: 'right' })
    const menu = page.locator('[data-full-song-lane-menu="d1"]')
    await menu.locator('[data-full-song-lane-menu-type]').hover()
    await menu.locator('[data-full-song-lane-menu-display="bars"]').click()
    await waitForEnvelopes(page, 'd2:fresh')
    expect(await inkRows(page, 'd1', 2)).toBe(0)
  })

  test('a Bars track has a render ready, so Waveform chosen while playing draws at once (#1748)', async ({ page }) => {
    const code = 'setcps(0.5)\n$: note("c3").s("sine").gain("<0.1 0.4 0.7 1>")\n$: note("e2").s("square")'
    await seedCode(page, code)
    await chooseDisplay(page, 'd1', 'waveform')
    await chooseDisplay(page, 'd2', 'waveform')
    await waitForEnvelopes(page, 'd1:fresh d2:fresh')
    await chooseDisplay(page, 'd1', 'bars')
    await waitForEnvelopes(page, 'd2:fresh')

    // A reload drops every render: the page starts with none. While stopped,
    // the Bars track is rendered too, after d2, and draws nothing.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-full-song-lane="d1"]').waitFor({ timeout: 30_000 })
    await waitForEnvelopes(page, 'd2:fresh', 30_000)
    await expect.poll(() => held(page), { timeout: 20_000 }).toBe('d1 d2')
    expect(await envelopes(page)).toBe('d2:fresh')

    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press(`${MOD}+Enter`)
    await page.locator('[data-full-song="playhead"]').waitFor({ timeout: 10_000 })
    const t0 = Date.now()
    await chooseDisplay(page, 'd1', 'waveform')
    await waitForEnvelopes(page, 'd1:fresh d2:fresh', 3_000)
    console.log(`[#1748] Waveform while playing drew d1 in ${Date.now() - t0} ms`)
    // Still playing, and nothing is waiting.
    await expect(page.locator('[data-full-song="playhead"]')).toHaveCount(1)
    await expect(page.locator('[data-full-song-envelope-waiting]')).toHaveCount(0)
    await expect.poll(async () => (await inkRows(page, 'd1', 2)) - (await inkRows(page, 'd1', 0)), { timeout: 5_000 }).toBeGreaterThanOrEqual(4)
    await stopTransport(page)
  })

  test('a Waveform track with no render yet says it draws when stopped, while playing (#1748)', async ({ page }) => {
    const one = 'setcps(0.5)\n$: note("c3").s("sine")'
    await seedCode(page, one)
    await chooseDisplay(page, 'd1', 'waveform')
    await waitForEnvelopes(page, 'd1:fresh')
    await expect(page.locator('[data-full-song-envelope-waiting]')).toHaveCount(0)

    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press(`${MOD}+Enter`)
    await page.locator('[data-full-song="playhead"]').waitFor({ timeout: 10_000 })
    // A track added while playing has no render, and none can start until Stop.
    await seedCode(page, `${one}\n$: note("e2").s("square")`)
    await page.locator('.monaco-editor').first().click()
    await page.keyboard.press(`${MOD}+Enter`)
    await chooseDisplay(page, 'd2', 'waveform')
    const notice = page.locator('[data-full-song-envelope-waiting]')
    await expect(notice).toHaveAttribute('data-full-song-envelope-waiting', 'd2', { timeout: 10_000 })
    await expect(notice).toHaveText('1 track draws when stopped')
    await expect(page.locator('[data-full-song-lane="d2"]')).toHaveAttribute('data-full-song-lane-waiting', 'true')
    await expect(page.locator('[data-full-song-lane="d1"]')).not.toHaveAttribute('data-full-song-lane-waiting', 'true')
    await page.screenshot({ path: 'test-results/synth-lane-waiting.png' })

    await stopTransport(page)
    await expect(notice).toHaveCount(0)
    await expect(page.locator('[data-full-song-lane="d2"]')).not.toHaveAttribute('data-full-song-lane-waiting', 'true')
    await waitForEnvelopes(page, 'd1:fresh d2:fresh')
  })
})

/**
 * #1771 — a browser whose offline context cannot pause (Firefox has no
 * `OfflineAudioContext.suspend`) renders a synth lane in short pieces, joined,
 * instead of one render that schedules the whole song up front (whose cost grows
 * with the length squared: a 512 s track took 83 s in Firefox). Chromium stands
 * in here with `suspend` deleted from every frame's prototype.
 *
 * The count is of `startRendering` calls, recorded in every frame (the render
 * may run in an audio frame, #1758) into the top window. The shape is checked
 * the same way as the first arm above, on cycles that lie in the SECOND piece,
 * so a piece placed at the wrong song time would draw its loud cycle elsewhere.
 */
test.describe('synth lane envelope where a render cannot pause (#1771)', () => {
  const countRenders = (removeSuspend: boolean) => {
    const top = window.top as unknown as { __renders?: number }
    const proto = (window as unknown as { OfflineAudioContext?: { prototype: Record<string, unknown> } }).OfflineAudioContext?.prototype
    if (!proto) return
    if (removeSuspend) delete proto.suspend
    const start = proto.startRendering as (this: unknown) => Promise<unknown>
    proto.startRendering = function (this: unknown) {
      top.__renders = (top.__renders ?? 0) + 1
      return start.call(this)
    }
  }
  const renders = (page: Page) => page.evaluate(() => (window as unknown as { __renders?: number }).__renders ?? 0)
  // 8 cycles at 0.5 cps = 16 s: two 8 s pieces. Cycles 4–7 are the second one.
  const SONG = 'setcps(0.5)\n$: arrange([8, note("c3").s("sine").gain("<0.1 0.4 0.7 1>")])'

  test('without suspend: the lane renders in pieces, and its loud cycle is drawn where it plays', async ({ page }) => {
    await page.addInitScript(countRenders, true)
    await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 360 } })
    expect(await page.evaluate(() => typeof OfflineAudioContext.prototype.suspend)).toBe('undefined')
    await seedCode(page, SONG)
    await chooseDisplay(page, 'd1', 'waveform')
    await waitForEnvelopes(page, 'd1:fresh')
    const count = await renders(page)
    const quiet = await inkRows(page, 'd1', 4)
    const loud = await inkRows(page, 'd1', 6)
    console.log(`[#1771] renders ${count}; ink rows: quiet cycle 4 ${quiet}, loud cycle 6 ${loud}`)
    expect(count).toBeGreaterThanOrEqual(2)
    expect(quiet).toBeGreaterThanOrEqual(0)
    expect(loud - quiet).toBeGreaterThanOrEqual(4)
  })

  test('without suspend: Play pressed during a render starts at once instead of waiting for it', async ({ page }) => {
    await page.addInitScript(countRenders, true)
    await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 360 } })
    await playsAtOnceDuringRender(page, '#1771')
  })

  test('CONTROL — with suspend, the same lane is one render', async ({ page }) => {
    await page.addInitScript(countRenders, false)
    await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 360 } })
    await seedCode(page, SONG)
    await chooseDisplay(page, 'd1', 'waveform')
    await waitForEnvelopes(page, 'd1:fresh')
    expect(await renders(page)).toBe(1)
  })
})
