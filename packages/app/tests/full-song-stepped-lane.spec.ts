/**
 * Full-song view: the STEPPED automation staircase (#1463 Stage 2) — Playwright
 * observation (AnviDev observe gate).
 *
 * The unit tests cover the IR read (`steppedAutomation.test.ts`, with the real
 * engine in `steppedAutomation.engine.test.ts`), the geometry
 * (`steppedLane.test.ts`) and the canvas draw against a mock context
 * (`drawTimeline.stepped.test.ts`). All of that can pass while nothing reaches the
 * screen — the `props.ir` memo, the knob-range resolution, the scene field and the
 * two barrel imports sit between them. This drives the real app.
 *
 * ⚠ IT CARRIES ITS OWN CONTROL ARM, the discipline `full-song-automation-lane.spec`
 * established: "the automation colour is on the canvas" means nothing unless the
 * same probe finds it absent for the same song with the parameter held CONSTANT.
 *
 * ⚠ AND A SECOND READING THE CURVE SPEC DOES NOT NEED. A staircase and a flat
 * rule both span the lane; what separates them is that a staircase holds MORE
 * THAN ONE LEVEL. So the probe counts the rows the stroke runs flat along, not
 * just its vertical extent — a single slanted line would have extent and no
 * levels.
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/** Stepped: velocity holds three levels, one per cycle. `s("bd*2")` keeps the
 *  lane's own marks sparse so the stroke is not competing with note rects. */
const STEPPED_SONG = 's("bd*2").velocity("<.2 .9 .5>")'
/** The control: the same song, the same lane, the parameter held constant. */
const CONSTANT_SONG = 's("bd*2").velocity(.5)'

async function bootShell(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:bottomPanel.height', '340')
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.activeTabId', 'musical-timeline')
    } catch {
      /* ignore */
    }
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () => ((window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco?.editor?.getEditors?.()?.length ?? 0) > 0,
    { timeout: 20_000 },
  )
}

async function typeSongAndEval(page: Page, code: string): Promise<void> {
  await page.evaluate(() => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string } | null; focus: () => void }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.focus()
  })
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.press('Backspace')
  await page.keyboard.type(code, { delay: 8 })
  await page.waitForTimeout(400)
  await page.keyboard.press(`${MOD}+Enter`)
  await page.waitForTimeout(1800)
}

/** The canvas's blue channel, one value per pixel, row-major. */
async function readBlue(page: Page): Promise<{ W: number; H: number; blue: number[] }> {
  return page.locator('[data-full-song-canvas]').evaluate((el) => {
    const c = el as HTMLCanvasElement
    const { width: W, height: H } = c
    const img = c.getContext('2d')!.getImageData(0, 0, W, H).data
    const blue = new Array<number>(W * H)
    for (let p = 0; p < W * H; p++) blue[p] = img[p * 4 + 2]
    return { W, H, blue }
  })
}

/**
 * The automation stroke, isolated AGAINST THE CONTROL RENDER, and the flat LEVELS
 * it holds.
 *
 * ⚠ WHY A DIFFERENCE AND NOT A COLOUR TEST. The first version of this spec used
 * the curve spec's absolute test (blue leads red by 45 and green by 20). It counted
 * 2 levels for a 3-step song, and the product was right: a collapsed percussive
 * lane paints its note marks across the MIDDLE rows, and the staircase's middle
 * step (`.5`) runs straight across that orange bar, where a 75%-alpha blue stroke
 * blends to a colour the absolute test rejects. Measured, then seen in a
 * screenshot, before anything was changed. The staircase was drawn; the instrument
 * was blind exactly where one of its levels sits.
 *
 * So a pixel is stroke when its blue is well ABOVE the same pixel in the control
 * render — the same song, same lane, same marks, the parameter held constant, and
 * so no automation at all. Whatever sits underneath, the stroke adds blue and
 * nothing else on the lane does.
 *
 * A LEVEL is a pixel row the stroke runs along for a long horizontal stretch: a
 * staircase has one per distinct step, a riser contributes a column, not a row.
 */
function strokeAgainst(
  subject: { W: number; H: number; blue: number[] },
  control: { W: number; H: number; blue: number[] },
) {
  const { W, H } = subject
  const perRow = new Array<number>(H).fill(0)
  const xs = new Set<number>()
  let hits = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x
      if (subject.blue[p] - control.blue[p] > 60) {
        hits++
        xs.add(x)
        perRow[y]++
      }
    }
  }
  // A row is a level when the stroke covers at least a tenth of the width along
  // it; contiguous qualifying rows are one level (a 1.5px stroke antialiases over
  // two or three rows).
  const minRun = Math.floor(W * 0.1)
  let levels = 0
  let inLevel = false
  for (let y = 0; y < H; y++) {
    if (perRow[y] >= minRun) {
      if (!inLevel) levels++
      inLevel = true
    } else {
      inLevel = false
    }
  }
  return { hits, xSpread: xs.size, levels, W, H }
}

test('a stepped parameter draws a staircase on its lane', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)

  // ── The control render: the same song with the parameter held constant.
  await typeSongAndEval(page, CONSTANT_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)
  const controlPixels = await readBlue(page)

  await typeSongAndEval(page, STEPPED_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)
  const steppedPixels = await readBlue(page)

  // (0) THE TWO RENDERS ARE COMPARABLE — a difference between canvases of
  //     different sizes would measure the layout, not the stroke.
  expect([steppedPixels.W, steppedPixels.H]).toEqual([controlPixels.W, controlPixels.H])

  const stepped = strokeAgainst(steppedPixels, controlPixels)
  // The instrument's own control: the control render against ITSELF must find
  // nothing, or the threshold is matching noise.
  const control = strokeAgainst(controlPixels, controlPixels)

  // (1) THE INSTRUMENT IS CLEAN.
  expect(control.hits, `the detector fires on an identical render: ${JSON.stringify(control)}`).toBe(0)

  // (2) THERE IS A SIGNAL, before any claim about its shape.
  expect(
    stepped.hits,
    `no automation stroke found on the canvas: ${JSON.stringify(stepped)}`,
  ).toBeGreaterThan(control.hits + 100)

  // (3) IT SPANS THE LANE.
  expect(stepped.xSpread, `stroke does not span the lane: ${JSON.stringify(stepped)}`)
    .toBeGreaterThan(stepped.W * 0.5)

  // (4) IT IS A STAIRCASE — the three distinct steps are three flat levels. A
  //     flat rule has one; a slanted line has none.
  expect(stepped.levels, `expected three flat levels, one per step: ${JSON.stringify(stepped)}`)
    .toBe(3)

  // (5) The new scene field and the two new barrel imports flow cleanly.
  expect(errors, `page/console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── Stage 3: edit a step from the lane ───────────────────────────────────────

/**
 * Two tracks, so the song is FOUR cycles long while the gain alternates every
 * cycle: step 1 (`.9`) plays in cycles 1 and 3, and both are on screen. That is
 * what makes "an edit moves every bar that plays the step, and only those"
 * observable rather than inferred.
 */
const EDIT_SONG = '$: s("bd*2").gain("<.2 .9>")\n$: s("<hh cp hh cp>")'

type MarksProbe = {
  byLane: Record<string, { count: number; onsets: number[]; gains: number[] }>
}

/** Replace the document and evaluate it. `setValue` rather than typing, so the
 *  editor's bracket and indent helpers cannot reshape a two-line song. */
async function setSongAndEval(page: Page, code: string): Promise<void> {
  await page.locator('.monaco-editor').first().click()
  await page.evaluate((c) => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { setValue: (s: string) => void; getLanguageId?: () => string } | null }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.getModel()?.setValue(c)
  }, code)
  await page.waitForTimeout(400)
  await page.keyboard.press(`${MOD}+Enter`)
  await page.waitForTimeout(1800)
}

async function readDoc(page: Page): Promise<string> {
  return page.evaluate(() => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getValue: () => string; getLanguageId?: () => string } | null }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    return t?.getModel()?.getValue() ?? ''
  })
}

/**
 * What the ENGINE plays on the `bd` lane, per bar: the gain of every evaluated
 * hap, grouped by whole cycle. Read from the timeline's marks probe, which is fed
 * by the scheduler's own query — not from the document text.
 */
async function gainsByBar(page: Page): Promise<Record<number, number[]>> {
  const probe = await page.evaluate(
    () => (window as unknown as { __staveTimelineMarks?: MarksProbe }).__staveTimelineMarks ?? null,
  )
  if (!probe) return {}
  // The kick lane is the one with eight onsets over four cycles.
  const lane = Object.values(probe.byLane).find((l) => l.count === 8)
  if (!lane) return {}
  const out: Record<number, number[]> = {}
  lane.onsets.forEach((onset, i) => {
    const bar = Math.floor(onset)
    ;(out[bar] ??= []).push(Math.round(lane.gains[i] * 100) / 100)
  })
  return out
}

/** Click down one column of the lane until a step editor opens showing `value`. */
async function openStepShowing(page: Page, x: number, value: string): Promise<boolean> {
  const editor = page.locator('[data-full-song="automation-step"]')
  const box = await page.locator('[data-full-song-canvas]').boundingBox()
  if (!box) throw new Error('no canvas')
  // the lane's whole height: an expanded two-voice lane is a header row and two
  // voice rows (#2226), and its levels spread over all of it
  for (let y = 1; y <= 80; y++) {
    await page.mouse.click(box.x + x, box.y + y)
    await page.waitForTimeout(60)
    if (await editor.count()) {
      if ((await editor.inputValue()) === value) return true
      await page.keyboard.press('Escape')
      await page.waitForTimeout(40)
    }
  }
  return false
}

test('a step retyped on the lane changes what the engine plays, in every bar that plays it (#1463 Stage 3)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:debug.timelineMarks', '1')
    } catch {
      /* ignore */
    }
  })

  await bootShell(page)
  await setSongAndEval(page, EDIT_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)

  // (0) THE INSTRUMENT READS THE STEPS AT ALL — before any edit, the engine plays
  //     .2 in the even bars and .9 in the odd ones. Without this, an unchanged
  //     reading after the edit could mean a probe that never saw a gain.
  await expect.poll(() => gainsByBar(page), { timeout: 10_000 })
    .toEqual({ 0: [0.2, 0.2], 1: [0.9, 0.9], 2: [0.2, 0.2], 3: [0.9, 0.9] })

  const editor = page.locator('[data-full-song="automation-step"]')
  const box = await page.locator('[data-full-song-canvas]').boundingBox()
  if (!box) throw new Error('no canvas')
  const barX = (bar: number) => Math.round(box.width * ((bar + 0.5) / 4))

  // (1) COLLAPSED: the staircase is drawn, and nothing along it opens an editor.
  for (let y = 1; y <= 24; y += 2) {
    await page.mouse.click(box.x + barX(1), box.y + y)
    await page.waitForTimeout(40)
    expect(await editor.count(), `a collapsed lane opened a step editor at y=${y}`).toBe(0)
  }

  // EXPAND the kick lane.
  await page.mouse.dblclick(box.x + barX(2), box.y + 8)
  await page.waitForTimeout(800)

  // (2) THE PRESSED BAR PICKS THE STEP — bar 1 plays .9.
  expect(await openStepShowing(page, barX(1), '0.9'), 'no step editor showing 0.9 opened over bar 1').toBe(true)

  // (3) THE EDIT REACHES THE DOCUMENT, and only that step's number moved.
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.type('0.4')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  const after = await readDoc(page)
  expect(after, `the step did not reach the document: ${after}`).toContain('$: s("bd*2").gain("<.2 0.4>")')
  expect(after).toContain('$: s("<hh cp hh cp>")')
  expect(await editor.count(), 'the editor lingered after its commit').toBe(0)

  // (4) WHAT THE ENGINE PLAYS: both bars that play step 1 moved to .4, and the
  //     bars that play step 0 did not move at all.
  await expect.poll(() => gainsByBar(page), { timeout: 10_000 })
    .toEqual({ 0: [0.2, 0.2], 1: [0.4, 0.4], 2: [0.2, 0.2], 3: [0.4, 0.4] })

  // (5) ESCAPE WRITES NOTHING — bar 3 plays the same step, now at .4.
  expect(await openStepShowing(page, barX(3), '0.4'), 'no step editor showing 0.4 opened over bar 3').toBe(true)
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.type('0.7')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  expect(await readDoc(page), 'Escape wrote to the document').toBe(after)

  expect(errors, `page/console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── #1579: a slowed alternation ──────────────────────────────────────────────

/**
 * `/2` stretches every step over two cycles: over the four-cycle song the kick
 * plays .2 in bars 0 and 1 and .9 in bars 2 and 3. The plain reading (`/2`
 * ignored) would put .9 in bar 1, so bar 1 separates the two — which is why the
 * arm opens it after the edit.
 */
const SLOW_SONG = '$: s("bd*2").gain("<.2 .9>/2")\n$: s("<hh cp hh cp>")'

test('a step of a slowed alternation retyped on the lane moves both bars that play it, and keeps the /2 (#1579)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:debug.timelineMarks', '1')
    } catch {
      /* ignore */
    }
  })

  await bootShell(page)
  await setSongAndEval(page, SLOW_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)

  // (0) The engine plays each step for two bars.
  await expect.poll(() => gainsByBar(page), { timeout: 10_000 })
    .toEqual({ 0: [0.2, 0.2], 1: [0.2, 0.2], 2: [0.9, 0.9], 3: [0.9, 0.9] })

  const editor = page.locator('[data-full-song="automation-step"]')
  const box = await page.locator('[data-full-song-canvas]').boundingBox()
  if (!box) throw new Error('no canvas')
  const barX = (bar: number) => Math.round(box.width * ((bar + 0.5) / 4))

  await page.mouse.dblclick(box.x + barX(2), box.y + 8)
  await page.waitForTimeout(800)

  // (1) The last bar plays the second step.
  expect(await openStepShowing(page, barX(3), '0.9'), 'no step editor showing 0.9 opened over bar 3').toBe(true)

  // (2) Only that step's number is rewritten; the `/2` survives.
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.type('0.4')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  const after = await readDoc(page)
  expect(after, `the step did not reach the document: ${after}`).toContain('$: s("bd*2").gain("<.2 0.4>/2")')
  expect(await editor.count(), 'the editor lingered after its commit').toBe(0)

  // (3) Both bars of the edited step moved; both bars of the other held.
  await expect.poll(() => gainsByBar(page), { timeout: 10_000 })
    .toEqual({ 0: [0.2, 0.2], 1: [0.2, 0.2], 2: [0.4, 0.4], 3: [0.4, 0.4] })

  // (4) Bar 1 is still the FIRST step — the lane draws the stretch, not `c mod 2`.
  expect(await openStepShowing(page, barX(1), '0.2'), 'no step editor showing 0.2 opened over bar 1').toBe(true)
  await page.keyboard.press('Escape')

  expect(errors, `page/console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── #1595: a stepped parameter under a whole-track slow ──────────────────────

/**
 * `.slow(2)` on the whole track holds each step for two bars. The song-cycle
 * reading — a lane that ignored the slow — alternates every bar, so bar 1 would
 * open .9 and bar 2 .2. The second track keeps the song four bars long.
 *
 * ⚠ `bd*4`, NOT `bd*2`: under the slow that is two onsets a bar, eight over the four
 * bars, and `gainsByBar` finds the kick lane by exactly that count (a `bd*2` draft
 * read `{}` before measuring anything).
 */
const WHOLE_TRACK_SLOW_SONG = '$: s("bd*4").gain("<.2 .9>").slow(2)\n$: s("<hh cp hh cp>")'

test('a stepped parameter under a whole-track slow opens and edits the step each bar plays, two bars to a step (#1595)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:debug.timelineMarks', '1')
    } catch {
      /* ignore */
    }
  })

  await bootShell(page)
  await setSongAndEval(page, WHOLE_TRACK_SLOW_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)

  // (0) The engine holds each step for two bars — two bd a bar under the slow.
  await expect.poll(() => gainsByBar(page), { timeout: 10_000 })
    .toEqual({ 0: [0.2, 0.2], 1: [0.2, 0.2], 2: [0.9, 0.9], 3: [0.9, 0.9] })

  const editor = page.locator('[data-full-song="automation-step"]')
  const box = await page.locator('[data-full-song-canvas]').boundingBox()
  if (!box) throw new Error('no canvas')
  const barX = (bar: number) => Math.round(box.width * ((bar + 0.5) / 4))

  await page.mouse.dblclick(box.x + barX(2), box.y + 8)
  await page.waitForTimeout(800)

  // (1) Bar 1 is still the FIRST step and bar 2 the second — the song cycle would
  //     say the reverse of both.
  expect(await openStepShowing(page, barX(1), '0.2'), 'no step editor showing 0.2 opened over bar 1').toBe(true)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  expect(await openStepShowing(page, barX(2), '0.9'), 'no step editor showing 0.9 opened over bar 2').toBe(true)

  // (2) Only that step's number is rewritten; the whole-track slow survives.
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.type('0.4')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  const after = await readDoc(page)
  expect(after, `the step did not reach the document: ${after}`).toContain('$: s("bd*4").gain("<.2 0.4>").slow(2)')
  expect(await editor.count(), 'the editor lingered after its commit').toBe(0)

  // (3) Both bars of the edited step moved; both bars of the other held.
  await expect.poll(() => gainsByBar(page), { timeout: 10_000 })
    .toEqual({ 0: [0.2, 0.2], 1: [0.2, 0.2], 2: [0.4, 0.4], 3: [0.4, 0.4] })

  expect(errors, `page/console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── #1585: a stepped parameter inside an arrangement section ────────────────

/**
 * One binding arranged twice around a one-bar break, so `a` plays bars 0, 1 and 3.
 * Each appearance counts ITS OWN cycles: bar 3 is the second appearance's first
 * cycle, so it plays step 0 (.2), where the song's cycle would say step 1 (.9). Bar
 * 2 is where nothing of `a` plays, between two levels, so a staircase joined across
 * the break would cross it.
 *
 * ⚠ TWO STEPS, NOT THREE. The view spans the arrangement's 4 bars times the pattern's
 * period, so a three-step `a` made a 12-bar song: no lane had the 8 onsets the marks
 * reader looks for, and the arm read `{}` before measuring anything (observed with a
 * probe of the marks). Two steps divide 4.
 */
const SECTION_SONG = 'const a = s("bd*2").gain("<.2 .9>")\n$: arrange([2, a], [1, s("hh*2").gain(1)], [1, a])'
/**
 * The control: the same arrangement with `a`'s level held all but still.
 *
 * ⚠ ITS TWO STEPS DIFFER BY .01 ON PURPOSE. The subject song is 8 bars long, not 4:
 * bar 3 plays .2 on one pass and .9 on the next (the second appearance keeps its
 * own count), so the view spans the song's real period of 8 (observed with a probe
 * of the marks). A constant gain made a 4-bar control, which puts every mark at a
 * different x, and the pixel difference would have measured the layout. Two steps
 * that differ keep the control at 8 bars; the arm checks that before comparing.
 * Its own near-flat staircase sits at .5, where the subject draws nothing, so it
 * cannot add to the subject's stroke.
 */
const SECTION_CONSTANT = 'const a = s("bd*2").gain("<.5 .51>")\n$: arrange([2, a], [1, s("hh*2").gain(1)], [1, a])'

/** The one lane's gains by bar, and how many bars the view spans — READ off the
 *  marks, never assumed (the first draft assumed 4 and read `{}`). */
async function laneGainsByBar(page: Page): Promise<{ bars: number; byBar: Record<number, number[]> }> {
  const probe = await page.evaluate(
    () => (window as unknown as { __staveTimelineMarks?: MarksProbe }).__staveTimelineMarks ?? null,
  )
  const lanes = probe ? Object.values(probe.byLane) : []
  if (lanes.length !== 1) return { bars: 0, byBar: {} }
  const byBar: Record<number, number[]> = {}
  lanes[0].onsets.forEach((onset, i) => {
    ;(byBar[Math.floor(onset)] ??= []).push(Math.round(lanes[0].gains[i] * 100) / 100)
  })
  return { bars: Object.keys(byBar).length, byBar }
}

/** Stroke pixels, against the control, in the columns of one of `bars` bars — a few
 *  columns in from each edge, so a level ending on a bar line cannot antialias into
 *  its neighbour. */
function strokeInBar(
  subject: { W: number; H: number; blue: number[] },
  control: { W: number; H: number; blue: number[] },
  bar: number,
  bars: number,
): number {
  const { W, H } = subject
  const x0 = Math.floor((W * bar) / bars) + 4
  const x1 = Math.floor((W * (bar + 1)) / bars) - 4
  let hits = 0
  for (let y = 0; y < H; y++) {
    for (let x = x0; x < x1; x++) if (subject.blue[y * W + x] - control.blue[y * W + x] > 60) hits++
  }
  return hits
}

test('a stepped parameter inside an arrangement section is drawn and edited by the section\'s own count (#1585)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:debug.timelineMarks', '1')
    } catch {
      /* ignore */
    }
  })

  await bootShell(page)
  const canvas = page.locator('[data-full-song-canvas]')

  await setSongAndEval(page, SECTION_CONSTANT)
  await canvas.waitFor({ timeout: 10_000 })
  // The control must span the SAME 8 bars as the subject, or the difference below
  // measures where the marks moved to rather than the staircase.
  await expect.poll(async () => (await laneGainsByBar(page)).bars, { timeout: 15_000 }).toBe(8)
  await page.waitForTimeout(500)
  const controlPixels = await readBlue(page)

  await setSongAndEval(page, SECTION_SONG)

  // (0) WHAT THE ENGINE PLAYS — by each appearance's own count. Bar 3 is the second
  //     appearance's first cycle (.2), where the song's cycle would say .9; bar 7 is
  //     its second (.9). Bars 2 and 6 are the break.
  const BEFORE = { 0: [0.2, 0.2], 1: [0.9, 0.9], 2: [1, 1], 3: [0.2, 0.2], 4: [0.2, 0.2], 5: [0.9, 0.9], 6: [1, 1], 7: [0.9, 0.9] }
  await expect.poll(() => laneGainsByBar(page), { timeout: 15_000 }).toEqual({ bars: 8, byBar: BEFORE })
  await page.waitForTimeout(500)

  const subjectPixels = await readBlue(page)
  expect([subjectPixels.W, subjectPixels.H]).toEqual([controlPixels.W, controlPixels.H])

  // (1) THE INSTRUMENT IS CLEAN, and the staircase holds its two levels.
  expect(strokeAgainst(controlPixels, controlPixels).hits, 'the detector fires on an identical render').toBe(0)
  const stroke = strokeAgainst(subjectPixels, controlPixels)
  expect(stroke.levels, `expected two flat levels (.2 and .9): ${JSON.stringify(stroke)}`).toBe(2)

  // (2) ONLY IN THE BARS THE SECTION PLAYS — nothing over the break, which sits
  //     between a .9 and a .2, so a line joined across it would cross it.
  const silent = [2, 6]
  const perBar = Array.from({ length: 8 }, (_, bar) => strokeInBar(subjectPixels, controlPixels, bar, 8))
  expect(silent.map((bar) => perBar[bar]), `a staircase was drawn over a bar where \`a\` is silent: ${perBar}`).toEqual([0, 0])
  expect(perBar.filter((_, bar) => !silent.includes(bar)).every((n) => n > 0), `a bar that plays \`a\` has no staircase: ${perBar}`).toBe(true)

  const editor = page.locator('[data-full-song="automation-step"]')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('no canvas')
  const barX = (bar: number) => Math.round(box.width * ((bar + 0.5) / 8))

  await page.mouse.dblclick(box.x + barX(2), box.y + 8)
  await page.waitForTimeout(800)

  // (3) BAR 3 IS STEP 0 — the second appearance restarted its count.
  expect(await openStepShowing(page, barX(3), '0.2'), 'no step editor showing 0.2 opened over bar 3').toBe(true)

  // (4) ONE WRITTEN NUMBER, SO THE EDIT REACHES BOTH APPEARANCES: bars 0, 3 and 4.
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.type('0.4')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  const after = await readDoc(page)
  expect(after, `the step did not reach the document: ${after}`).toBe(
    'const a = s("bd*2").gain("<0.4 .9>")\n$: arrange([2, a], [1, s("hh*2").gain(1)], [1, a])',
  )
  await expect.poll(() => laneGainsByBar(page), { timeout: 15_000 }).toEqual({
    bars: 8,
    byBar: { ...BEFORE, 0: [0.4, 0.4], 3: [0.4, 0.4], 4: [0.4, 0.4] },
  })

  // (5) BAR 7 IS STEP 1 — the second appearance, one pass on.
  expect(await openStepShowing(page, barX(7), '0.9'), 'no step editor showing 0.9 opened over bar 7').toBe(true)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // (6) THE BREAK HAS NO STEP TO PRESS — either time it comes round.
  for (const bar of silent) for (let y = 1; y <= 40; y += 2) {
    await page.mouse.click(box.x + barX(bar), box.y + y)
    await page.waitForTimeout(40)
    expect(await editor.count(), `a press over the break opened a step editor at y=${y}`).toBe(0)
  }
  expect(await readDoc(page), 'a press over the break wrote to the document').toBe(after)

  expect(errors, `page/console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── #1592: a visualiser call above the parameter ─────────────────────────────

const VIZ_SONG = '$: s("bd*2").gain("<.2 .9>")._pianoroll()\n$: s("<hh cp hh cp>")'

test('a stepped parameter under a visualiser call plays and is drawn exactly as without it (#1592)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:debug.timelineMarks', '1')
    } catch {
      /* ignore */
    }
  })

  await bootShell(page)
  const PLAYS = { 0: [0.2, 0.2], 1: [0.9, 0.9], 2: [0.2, 0.2], 3: [0.9, 0.9] }

  // (0) THE CONTROL — the same song with no visualiser, read by the same instrument.
  await setSongAndEval(page, EDIT_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await expect.poll(() => gainsByBar(page), { timeout: 15_000 }).toEqual(PLAYS)

  // (1) THE ENGINE PLAYS THE SAME GAINS WITH `._pianoroll()` — what makes it safe to draw.
  await setSongAndEval(page, VIZ_SONG)
  await expect.poll(() => gainsByBar(page), { timeout: 15_000 }).toEqual(PLAYS)
  await page.waitForTimeout(500)

  const box = await page.locator('[data-full-song-canvas]').boundingBox()
  if (!box) throw new Error('no canvas')
  const barX = (bar: number) => Math.round(box.width * ((bar + 0.5) / 4))
  await page.mouse.dblclick(box.x + barX(2), box.y + 8)
  await page.waitForTimeout(800)

  // (2) THE LANE HAS THE STEPS — each bar opens the step it plays.
  expect(await openStepShowing(page, barX(1), '0.9'), 'no step editor showing 0.9 opened over bar 1').toBe(true)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  expect(await openStepShowing(page, barX(0), '0.2'), 'no step editor showing 0.2 opened over bar 0').toBe(true)
  await page.keyboard.press('Escape')

  expect(errors, `page/console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── #1578: drag a step's level ───────────────────────────────────────────────

/** Rows (in CSS px of the canvas) where column `x` differs by more than the
 *  stroke threshold between two frames. */
function changedRowsAt(
  a: { W: number; H: number; blue: number[] },
  b: { W: number; H: number; blue: number[] },
  cssX: number,
  cssW: number,
): number {
  const x = Math.round(cssX * (a.W / cssW))
  let rows = 0
  for (let y = 0; y < a.H; y++) if (Math.abs(a.blue[y * a.W + x] - b.blue[y * a.W + x]) > 60) rows++
  return rows
}

test('a step dragged on the lane previews without writing, then changes what the engine plays in every bar that plays it (#1578)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:debug.timelineMarks', '1')
    } catch {
      /* ignore */
    }
  })

  await bootShell(page)
  await setSongAndEval(page, EDIT_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)

  // (0) THE INSTRUMENT READS THE STEPS AT ALL.
  await expect.poll(() => gainsByBar(page), { timeout: 10_000 })
    .toEqual({ 0: [0.2, 0.2], 1: [0.9, 0.9], 2: [0.2, 0.2], 3: [0.9, 0.9] })

  const canvas = page.locator('[data-full-song-canvas]')
  const grid = page.locator('[data-full-song="grid"]')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('no canvas')
  const barX = (bar: number) => Math.round(box.width * ((bar + 0.5) / 4))

  await page.mouse.dblclick(box.x + barX(2), box.y + 8)
  await page.waitForTimeout(800)

  // (1) FIND THE .9 LEVEL OVER BAR 1 BY WHAT THE CURSOR PROMISES — the hover
  //     test is the press test, so the rows reading `ns-resize` are the level.
  const drag: number[] = []
  for (let y = 1; y <= 90; y++) {
    await page.mouse.move(box.x + barX(1), box.y + y)
    if ((await grid.evaluate((el) => (el as HTMLElement).style.cursor)) === 'ns-resize') drag.push(y)
  }
  expect(drag.length, 'no row over bar 1 promised a step drag').toBeGreaterThan(0)
  const levelY = drag[Math.floor(drag.length / 2)]

  const before = await readBlue(page)
  const doc = await readDoc(page)

  // (2) DRAG IT DOWN about a third of the band, and hold it there.
  //
  //     ⚠ THE TRAVEL IS READ OFF THE LANE, NEVER ASSUMED. The first version moved a
  //     fixed 20px and the label read `gain 0`: in this layout an EXPANDED lane is
  //     still 25px tall (the panel has no room to grow it), so the band is 19px and
  //     18px of travel reaches the floor. Measured one pixel at a time before
  //     anything changed — the level followed the pointer 1:1, 0.69 at the 4px
  //     threshold. The product was right; the instrument's geometry was a guess.
  const laneH = await page
    .locator('[data-full-song-lane][data-expanded="true"]')
    .first()
    .evaluate((el) => parseFloat((el as HTMLElement).style.height))
  const bandH = laneH - 6
  const travel = Math.max(6, Math.round(bandH * 0.35))
  await page.mouse.move(box.x + barX(1), box.y + levelY)
  await page.mouse.down()
  for (let dy = 1; dy <= travel; dy++) await page.mouse.move(box.x + barX(1), box.y + levelY + dy)
  await page.waitForTimeout(300)

  const label = page.locator('[data-full-song="automation-step-drag"]')
  expect(await label.count(), 'no value shown while dragging').toBe(1)
  const shown = (await label.textContent()) ?? ''
  const value = Number(shown.split(' ')[1])
  expect(shown.startsWith('gain '), `label: ${shown}`).toBe(true)
  expect(value, `label: ${shown}`).toBeLessThan(0.9)
  expect(value, `label: ${shown}`).toBeGreaterThan(0.2)

  // (3) THE PREVIEW IS ON THE CANVAS, AND ONLY WHERE THE STEP PLAYS. Bars 1 and 3
  //     play step 1 and their level moved; bars 0 and 2 play step 0 and did not.
  const during = await readBlue(page)
  const moved = [0, 1, 2, 3].map((bar) => changedRowsAt(before, during, barX(bar), box.width))
  expect(moved[1], `bar 1 did not redraw: ${moved}`).toBeGreaterThan(0)
  expect(moved[3], `bar 3 did not redraw: ${moved}`).toBeGreaterThan(0)
  expect([moved[0], moved[2]], `a bar that plays the OTHER step redrew: ${moved}`).toEqual([0, 0])

  // (4) …AND NOT IN THE DOCUMENT, while the pointer is still down.
  expect(await readDoc(page), 'the drag wrote before release').toBe(doc)

  // (5) RELEASE: one write, of the number the label showed.
  await page.mouse.up()
  await page.waitForTimeout(600)
  const after = await readDoc(page)
  expect(after, `the drag did not reach the document: ${after}`).toContain(`$: s("bd*2").gain("<.2 ${value}>")`)
  expect(await label.count(), 'the value label lingered after release').toBe(0)
  expect(await page.locator('[data-full-song="automation-step"]').count(), 'a drag opened the typed editor').toBe(0)

  // (6) WHAT THE ENGINE PLAYS: bars 1 and 3 at the dragged value, 0 and 2 held.
  await expect.poll(() => gainsByBar(page), { timeout: 10_000 })
    .toEqual({ 0: [0.2, 0.2], 1: [value, value], 2: [0.2, 0.2], 3: [value, value] })

  // (7) A CLICK IS STILL A CLICK — a press released in place opens the number.
  expect(await openStepShowing(page, barX(3), String(value)), `no step editor showing ${value} opened over bar 3`).toBe(true)
  await page.keyboard.press('Escape')

  expect(errors, `page/console errors: ${errors.join(' | ')}`).toEqual([])
})

test('the same travel with the modifier held moves a step a TENTH as far, and pressing it mid-drag does not move the level (#1582)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  // ⚠ WITHOUT THIS FLAG `gainsByBar` READS NOTHING, and an empty reading looks
  // exactly like "the engine plays no steps" — a product failure. The first run
  // of this arm failed that way, on its own control.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:debug.timelineMarks', '1')
    } catch {
      /* ignore */
    }
  })

  await bootShell(page)
  await setSongAndEval(page, EDIT_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)
  await expect.poll(() => gainsByBar(page), { timeout: 10_000 })
    .toEqual({ 0: [0.2, 0.2], 1: [0.9, 0.9], 2: [0.2, 0.2], 3: [0.9, 0.9] })

  const canvas = page.locator('[data-full-song-canvas]')
  const grid = page.locator('[data-full-song="grid"]')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('no canvas')
  const barX = (bar: number) => Math.round(box.width * ((bar + 0.5) / 4))
  await page.mouse.dblclick(box.x + barX(2), box.y + 8)
  await page.waitForTimeout(800)

  // The level, found the way the #1578 arm finds it: the rows whose cursor
  // promises a drag ARE the level.
  const rows: number[] = []
  for (let y = 1; y <= 120; y++) {
    await page.mouse.move(box.x + barX(1), box.y + y)
    if ((await grid.evaluate((el) => (el as HTMLElement).style.cursor)) === 'ns-resize') rows.push(y)
  }
  expect(rows.length, 'no row over bar 1 promised a step drag').toBeGreaterThan(0)
  const levelY = rows[Math.floor(rows.length / 2)]

  const doc = await readDoc(page)
  const label = page.locator('[data-full-song="automation-step-drag"]')

  /**
   * Drag down `travel`, read the level the label shows, then come back to where
   * the press began and release.
   *
   * ⚠ IT RETURNS TO THE START ON PURPOSE. A drag that ends where it began writes
   * nothing, so the two measurements below are taken on the SAME document from
   * the SAME step value — the only difference between them is the modifier,
   * which is the whole claim. The document is checked afterwards to prove it.
   */
  const dragBy = async (travel: number, fine: boolean): Promise<number> => {
    await page.mouse.move(box.x + barX(1), box.y + levelY)
    await page.mouse.down()
    if (fine) await page.keyboard.down('Shift')
    for (let dy = 1; dy <= travel; dy++) await page.mouse.move(box.x + barX(1), box.y + levelY + dy)
    await page.waitForTimeout(200)
    const shown = (await label.textContent()) ?? ''
    expect(shown.startsWith('gain '), `label: ${shown}`).toBe(true)
    const value = Number(shown.split(' ')[1])
    for (let dy = travel - 1; dy >= 0; dy--) await page.mouse.move(box.x + barX(1), box.y + levelY + dy)
    if (fine) await page.keyboard.up('Shift')
    await page.mouse.up()
    await page.waitForTimeout(300)
    return value
  }

  // The band is read off the lane, never assumed — #1578's own caution, and the
  // lane is taller now that it draws an automation (#1582's floor).
  const laneH = await page
    .locator('[data-full-song-lane][data-expanded="true"]')
    .first()
    .evaluate((el) => parseFloat((el as HTMLElement).style.height))
  const bandH = laneH - 6
  const travel = Math.max(8, Math.round(bandH * 0.35))

  const plain = await dragBy(travel, false)
  const held = await dragBy(travel, true)

  // The claim: the same pixels move the value a tenth as far. Compared as a
  // DROP from the step's own value, and allowed one quantum of snap either way.
  const dropPlain = 0.9 - plain
  const dropHeld = 0.9 - held
  expect(dropPlain, `a plain drag of ${travel}px did not move the level: ${plain}`).toBeGreaterThan(0.05)
  expect(dropHeld, `a fine drag of ${travel}px moved nothing at all: ${held}`).toBeGreaterThan(0)
  expect(Math.abs(dropHeld - dropPlain / 10), `plain ${dropPlain}, held ${dropHeld}`).toBeLessThanOrEqual(0.011)

  // Neither drag wrote: both came back to where they started.
  expect(await readDoc(page), 'a drag that returned to its start wrote to the document').toBe(doc)

  // …and the modifier pressed MID-DRAG, with the pointer standing still, does
  // not move the level — it only re-prices what comes next.
  await page.mouse.move(box.x + barX(1), box.y + levelY)
  await page.mouse.down()
  for (let dy = 1; dy <= travel; dy++) await page.mouse.move(box.x + barX(1), box.y + levelY + dy)
  await page.waitForTimeout(200)
  const beforeKey = (await label.textContent()) ?? ''
  await page.keyboard.down('Shift')
  await page.waitForTimeout(200)
  expect((await label.textContent()) ?? '', 'the level leapt when the modifier went down').toBe(beforeKey)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(200)
  expect((await label.textContent()) ?? '', 'the level leapt when the modifier came up').toBe(beforeKey)
  for (let dy = travel - 1; dy >= 0; dy--) await page.mouse.move(box.x + barX(1), box.y + levelY + dy)
  await page.mouse.up()
  await page.waitForTimeout(300)
  expect(await readDoc(page), 'the mid-drag modifier arm wrote to the document').toBe(doc)

  expect(errors, `page/console errors: ${errors.join(' | ')}`).toEqual([])
})

// ── #1601: automate a fixed value from its lane ─────────────────────────────

/** A kick with a FIXED gain beside a four-cycle hat line, so the song is four bars
 *  and each bar plays the same gain until a step is moved. */
const FIXED_SONG = '$: s("bd*2").gain(.8)\n$: s("<hh cp hh cp>")'

test('a fixed value chosen from the lane menu becomes a flat staircase, plays the same, and a drag moves only its bar (#1601)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:debug.timelineMarks', '1')
    } catch {
      /* ignore */
    }
  })

  await bootShell(page)
  await setSongAndEval(page, FIXED_SONG)
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)

  // (0) THE INSTRUMENT READS THE GAIN AT ALL — .8 in every bar before anything changes.
  const FLAT = { 0: [0.8, 0.8], 1: [0.8, 0.8], 2: [0.8, 0.8], 3: [0.8, 0.8] }
  await expect.poll(() => gainsByBar(page), { timeout: 10_000 }).toEqual(FLAT)

  const canvas = page.locator('[data-full-song-canvas]')
  const grid = page.locator('[data-full-song="grid"]')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('no canvas')
  const barX = (bar: number) => Math.round(box.width * ((bar + 0.5) / 4))
  const automate = page.locator('[data-full-song-lane-automate]')
  const menu = page.locator('[data-full-song="automate-parameter"]')

  // (1) COLLAPSED, NOTHING IS OFFERED.
  expect(await automate.count(), 'a collapsed lane offered the menu').toBe(0)

  // (2) EXPANDED, THE KICK LANE OFFERS ITS FIXED GAIN, AND OPENING THE MENU WRITES NOTHING.
  await page.mouse.dblclick(box.x + barX(2), box.y + 8)
  await page.waitForTimeout(800)
  expect(await automate.count(), 'the expanded kick lane offered no menu').toBe(1)
  await automate.click()
  expect(await menu.count(), 'the menu did not open').toBe(1)
  expect(await readDoc(page), 'opening the menu wrote').toBe(FIXED_SONG)

  // (3) CHOOSING WRITES ONE STEP PER BAR, SPELLED AS WRITTEN — and the menu closes.
  await menu.selectOption('0')
  await expect.poll(() => readDoc(page), { timeout: 5_000 }).toBe('$: s("bd*2").gain("<.8 .8 .8 .8>")\n$: s("<hh cp hh cp>")')
  expect(await menu.count(), 'the menu lingered after its commit').toBe(0)

  // (4) THE ENGINE PLAYS WHAT IT PLAYED BEFORE.
  await expect.poll(() => gainsByBar(page), { timeout: 10_000 }).toEqual(FLAT)

  // (5) THE LANE NOW HOLDS A STEP OVER EVERY BAR, AT ONE LEVEL — read by the rows the
  //     cursor promises a step drag on, so the check is the gesture's own hit test.
  const dragRows = async (bar: number): Promise<number[]> => {
    const rows: number[] = []
    for (let y = 1; y <= 90; y++) {
      await page.mouse.move(box.x + barX(bar), box.y + y)
      if ((await grid.evaluate((el) => (el as HTMLElement).style.cursor)) === 'ns-resize') rows.push(y)
    }
    return rows
  }
  await expect.poll(async () => (await dragRows(1)).length, { timeout: 10_000 }).toBeGreaterThan(0)
  const rows = await Promise.resolve([await dragRows(0), await dragRows(1), await dragRows(2), await dragRows(3)])
  expect(rows[0].length, 'bar 0 has no step').toBeGreaterThan(0)
  expect(rows.slice(1), `the staircase is not flat: ${JSON.stringify(rows)}`).toEqual([rows[0], rows[0], rows[0]])

  // (6) DRAG BAR 1 DOWN about a third of the band. Travel read off the lane (see #1578).
  const levelY = rows[1][Math.floor(rows[1].length / 2)]
  const laneH = await page
    .locator('[data-full-song-lane][data-expanded="true"]')
    .first()
    .evaluate((el) => parseFloat((el as HTMLElement).style.height))
  const travel = Math.max(6, Math.round((laneH - 6) * 0.35))
  await page.mouse.move(box.x + barX(1), box.y + levelY)
  await page.mouse.down()
  for (let dy = 1; dy <= travel; dy++) await page.mouse.move(box.x + barX(1), box.y + levelY + dy)
  await page.waitForTimeout(300)
  const shown = (await page.locator('[data-full-song="automation-step-drag"]').textContent()) ?? ''
  const value = Number(shown.split(' ')[1])
  expect(value, `label: ${shown}`).toBeLessThan(0.8)
  await page.mouse.up()

  // (7) ONE WRITE, TO BAR 1'S STEP ALONE — and the engine plays it in bar 1 only.
  await expect.poll(() => readDoc(page), { timeout: 5_000 }).toBe(`$: s("bd*2").gain("<.8 ${value} .8 .8>")\n$: s("<hh cp hh cp>")`)
  await expect.poll(() => gainsByBar(page), { timeout: 10_000 })
    .toEqual({ 0: [0.8, 0.8], 1: [value, value], 2: [0.8, 0.8], 3: [0.8, 0.8] })

  expect(errors, `page/console errors: ${errors.join(' | ')}`).toEqual([])
})
