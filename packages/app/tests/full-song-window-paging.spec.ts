/**
 * The Song view PAGES, and the paged window draws itself completely
 * (#1201 item 4 / #1209) — Playwright observation.
 *
 * ── WHY THIS SPEC HAD TO EXIST BEFORE THE FEATURE COULD BE CALLED DONE ──────
 * Everything about a window is correct-by-coincidence at origin 0: the window
 * frame and the song-absolute frame coincide there, so an origin-blind
 * implementation and a correct one produce identical pixels. Every unit arm for
 * paging therefore has to construct a non-zero origin by hand — and #1209 was
 * a defect that survived exactly because nothing had ever DRIVEN one through
 * the real app. A view that pages was, until this file, unobserved.
 *
 * The route to a non-zero origin is the only one the app offers: play, then
 * seek past three quarters of the first window, which is the condition the
 * rAF trigger watches. No test hook, no forced state — the same gesture a user
 * makes by clicking the ruler.
 *
 * ⚠ THE FIXTURE MUST BE APERIODIC, and the spec asserts it. Paging exists only
 * on the branch where period detection FAILED: when a period was found, cycle
 * 257 genuinely is cycle 1 and there is nothing to the right to reach. If this
 * document ever resolves to a period, the trigger never fires and every
 * assertion below would be vacuous rather than failing — so the precondition
 * is checked, not assumed.
 *
 * ⚠ AND IT MUST DECLARE NO END THE VIEW CAN SPAN (#1721). An arrangement that
 * fits under the cap is shown as long as it says it is — its `Σ weight`, folded
 * with any parameter that outlasts it — so there is nothing to page to. These
 * fixtures used to be 4- and 128-cycle arrangements made aperiodic by an LFO;
 * they page only because the timeline measured them instead of reading them.
 * Each is now an arrangement LONGER than the cap, which is the arranged song
 * that genuinely pages.
 */
import { test, expect, type Page } from '@playwright/test'

/**
 * Aperiodic by construction (an irrational-ratio slow LFO on a continuous
 * control makes every cycle differ), and ARRANGED so the window has clips as
 * well as marks. The two halves are both needed: the density heatmap followed
 * the window before #1209, the marks and clips did not. 320 cycles long, past
 * the cap, so its end is not one the first window can show (#1721).
 */
const APERIODIC_ARRANGE =
  '$: arrange([160, s("bd*4")], [160, s("hh*8")]).cutoff(sine.range(200,2000).slow(97.3))'

/** The analysis cap, and therefore the first window's width. */
const SPAN = 256

type MarksProbe = {
  laneCount: number
  byLane: Record<string, { count: number; onsets: number[] }>
}
type AnalysisProbe = { periodCycles: number | null; horizonCycles: number; lanes: unknown[] }

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:bottomPanel.height', '360')
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.activeTabId', 'musical-timeline')
      // Marks are canvas-drawn, so the DOM cannot report them. This publishes
      // the per-lane onset cycles the view actually collected — which is the
      // one readout that can tell "no marks" from "marks in the wrong place".
      localStorage.setItem('stave:debug.timelineMarks', '1')
      // #2109 — this spec's songs are built around a 256-cycle first window (`SPAN`).
      // Paging at the default limit of 64 is `full-song-cycle-limit.spec.ts`.
      localStorage.setItem('stave:songCycleLimit', '256')
    } catch {
      /* ignore */
    }
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () => {
      const m = (
        window as unknown as {
          monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getValue?: () => string } | null }> } }
        }
      ).monaco
      const eds = m?.editor?.getEditors?.() ?? []
      return eds.some((e) => (e.getModel()?.getValue?.()?.length ?? 0) > 0)
    },
    { timeout: 20_000 },
  )
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 15_000 })
}

/** setValue in one shot — typing character-by-character races the evaluator and
 *  is the catalogued flake class in this suite. */
async function evalCode(page: Page, code: string): Promise<void> {
  await page.evaluate(() => {
    delete (window as unknown as { __staveTimelineAnalysis?: unknown }).__staveTimelineAnalysis
  })
  await page.evaluate((c) => {
    const monaco = (
      window as unknown as {
        monaco?: {
          editor?: {
            getEditors?: () => Array<{
              getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null
              focus: () => void
            }>
          }
        }
      }
    ).monaco
    const editors = monaco?.editor?.getEditors?.() ?? []
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    target?.getModel()?.setValue(c)
    target?.focus()
  }, code)
  await page.waitForTimeout(150)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
}

const marksOf = (page: Page): Promise<MarksProbe | null> =>
  page.evaluate(
    () => (window as unknown as { __staveTimelineMarks?: MarksProbe }).__staveTimelineMarks ?? null,
  )

const analysisOf = (page: Page): Promise<AnalysisProbe | null> =>
  page.evaluate(
    () =>
      (window as unknown as { __staveTimelineAnalysis?: AnalysisProbe }).__staveTimelineAnalysis ??
      null,
  )

/** Every onset cycle the view collected, across all lanes. */
function allOnsets(m: MarksProbe | null): number[] {
  if (!m) return []
  return Object.values(m.byLane).flatMap((l) => l.onsets)
}

/** Wait for an analysis whose period verdict has stopped moving. */
async function settledAnalysis(page: Page): Promise<AnalysisProbe> {
  await expect
    .poll(async () => (await analysisOf(page))?.lanes.length ?? 0, { timeout: 90_000 })
    .toBeGreaterThan(0)
  let prev = ''
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000)
    const a = await analysisOf(page)
    const cur = JSON.stringify([a?.periodCycles ?? null, a?.horizonCycles ?? null])
    if (cur === prev && i > 1) break
    prev = cur
  }
  const a = await analysisOf(page)
  expect(a, 'analysis probe never published').not.toBeNull()
  return a!
}

test('the Song view pages past the first window, and the paged window keeps its note marks', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  await boot(page)
  await evalCode(page, APERIODIC_ARRANGE)

  // ── PRECONDITION: this really is the branch that can page ────────────────
  const a = await settledAnalysis(page)
  expect(a.periodCycles, 'fixture must be aperiodic or the trigger never fires').toBeNull()
  expect(a.horizonCycles).toBe(SPAN)

  // ── The FIRST window, for comparison. Marks exist and all lie inside it. ──
  await expect.poll(async () => allOnsets(await marksOf(page)).length, { timeout: 60_000 }).toBeGreaterThan(0)
  const first = allOnsets(await marksOf(page))
  expect(Math.min(...first)).toBeGreaterThanOrEqual(0)
  expect(Math.max(...first)).toBeLessThan(SPAN)

  const notice = page.locator('[data-full-song-fallback-notice]')
  await expect(notice).toBeVisible({ timeout: 15_000 })
  expect(await notice.textContent()).toContain(`showing first ${SPAN} cycles`)

  // ── THE GESTURE: play, then seek past three quarters of the window ───────
  // The trigger watches the transport's position, so the view must actually be
  // playing — a seek while stopped reports no position and pages nothing.
  await page.locator('[data-full-song="grid"]').click({ position: { x: 4, y: 4 } })
  await page.keyboard.press('Space')
  const ruler = page.locator('[data-full-song="ruler-area"]')
  const box = await ruler.boundingBox()
  expect(box, 'no ruler box').not.toBeNull()
  // 0.78 of a 256-cycle window is ~200 — past the 192 the trigger waits for,
  // and comfortably short of the end so this is a page-AHEAD, not a rescue.
  await page.mouse.click(box!.x + box!.width * 0.78, box!.y + box!.height / 2)

  // ── OBSERVATION 1: the view pages, and SAYS which cycles it is showing ────
  // The notice's paged wording is its own site — a template string, which is
  // why the frame-mismatch grep written for comparisons could not find it.
  await expect(notice).toHaveText(new RegExp(`showing cycles ${SPAN}[^0-9]+${SPAN * 2}`), {
    timeout: 90_000,
  })

  // ── OBSERVATION 2: the paged window still HAS marks, and they are ITS ─────
  // This is #1209 exactly. Before it, the marks were re-collected over
  // `[0, span)` at every origin; being song-absolute they then mapped to
  // negative x and were culled, so this window drew no note marks at all.
  // The two assertions are different claims and both are needed: a non-empty
  // count alone would pass on marks belonging to the first window.
  await expect
    .poll(async () => Math.min(...allOnsets(await marksOf(page)), Infinity), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(SPAN)
  const paged = allOnsets(await marksOf(page))
  expect(paged.length, 'a paged window must still draw note marks').toBeGreaterThan(0)
  expect(Math.max(...paged)).toBeLessThan(SPAN * 2)

  await page.screenshot({ path: 'test-results/window-paging-origin-256.png' })
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([])
})

/**
 * Wide arms (64 cycles each) so a clip in the SECOND window is a quarter of the
 * grid rather than a few pixels, and still aperiodic for the same reason — the
 * LFO, not the arrangement, is what defeats period detection. Six arms, 384
 * cycles, so the song runs past the cap (#1721). At origin 256 the window shows
 * arm 4 over [256, 320) and arm 5 over [320, 384) — a `bd` then an `hh`, where the
 * old two-arm fixture's third pass put the same sounds. An origin-blind edit
 * would land in arm 0 or 1 and write a different array, so every write-back
 * below names the arm the user grabbed.
 */
const WIDE_ARMS = (tail: string): string =>
  `arrange([64, s("bd*4")], [64, s("hh*8")], [64, s("bd*4")], [64, s("hh*8")], ${tail})`
const WIDE_APERIODIC_ARRANGE =
  `$: ${WIDE_ARMS('[64, s("bd*4")], [64, s("hh*8")]')}.cutoff(sine.range(200,2000).slow(97.3))`

/**
 * Drive the view to the SECOND window by the only route the app offers: play,
 * then seek past three quarters of the first window, which is the condition the
 * rAF trigger watches. No test hook and no forced state — the same two gestures
 * a user makes. Returns once the notice has confirmed the paged frame.
 *
 * This performs GESTURES and waits only. It computes no expected value, so it
 * cannot become a second oracle for anything the arms below assert.
 */
async function pageToSecondWindow(page: Page): Promise<void> {
  await page.locator('[data-full-song="grid"]').click({ position: { x: 4, y: 4 } })
  await page.keyboard.press('Space')
  const ruler = page.locator('[data-full-song="ruler-area"]')
  const rbox = await ruler.boundingBox()
  expect(rbox, 'no ruler box').not.toBeNull()
  await page.mouse.click(rbox!.x + rbox!.width * 0.78, rbox!.y + rbox!.height / 2)
  await expect(page.locator('[data-full-song-fallback-notice]')).toHaveText(
    new RegExp(`showing cycles ${SPAN}[^0-9]+${SPAN * 2}`),
    { timeout: 90_000 },
  )
}

const strudelSource = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const monaco = (
      window as unknown as {
        monaco?: {
          editor?: {
            getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; getValue: () => string } | null }>
          }
        }
      }
    ).monaco
    const eds = monaco?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    return t?.getModel()?.getValue() ?? ''
  })

test('a clip edited from the SECOND window writes back to the bar the user is looking at', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  await boot(page)
  await evalCode(page, WIDE_APERIODIC_ARRANGE)

  const a = await settledAnalysis(page)
  expect(a.periodCycles, 'fixture must be aperiodic or the trigger never fires').toBeNull()

  // Page to [256, 512) by the same real gesture: play, then seek past 192.
  await page.locator('[data-full-song="grid"]').click({ position: { x: 4, y: 4 } })
  await page.keyboard.press('Space')
  const ruler = page.locator('[data-full-song="ruler-area"]')
  const rbox = await ruler.boundingBox()
  expect(rbox).not.toBeNull()
  await page.mouse.click(rbox!.x + rbox!.width * 0.78, rbox!.y + rbox!.height / 2)
  await expect(page.locator('[data-full-song-fallback-notice]')).toHaveText(
    new RegExp(`showing cycles ${SPAN}[^0-9]+${SPAN * 2}`),
    { timeout: 90_000 },
  )

  // ── THE GESTURE, entirely inside the second window ───────────────────────
  // An eighth of the way across is song cycle 256 + 32 = 288, which lies in
  // arm 4's clip [256, 320). Select it and split it there.
  const grid = page.locator('[data-full-song="grid"]')
  const gbox = await grid.boundingBox()
  expect(gbox).not.toBeNull()
  await page.mouse.click(gbox!.x + gbox!.width * 0.125, gbox!.y + 8)
  await expect(page.locator('[data-full-song="clip-selection"]')).toBeVisible({ timeout: 8_000 })
  await grid.press('s')

  // ── OBSERVATION: the split lands where the user clicked ──────────────────
  // 288 is 32 cycles into a 64-cycle arm, so the arm halves into 32 + 32. This
  // is the assertion the whole window origin exists to make true: the scene's
  // clip cycles are song-ABSOLUTE, so `288 − 256` is what reaches the edit path.
  // Were they window-relative, the clip would start at 0 while the cursor still
  // read 288, and the split would be written 288 cycles into a 64-cycle arm.
  await expect
    .poll(() => strudelSource(page), { timeout: 15_000 })
    .toContain(WIDE_ARMS('[32, s("bd*4")], [32, s("bd*4")], [64, s("hh*8")]'))

  await page.screenshot({ path: 'test-results/window-paging-split-origin-256.png' })
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([])
})

/**
 * ── THE OTHER TWO HIT-TESTS (#1212, following #1210) ────────────────────────
 * #1210 fixed THREE callbacks that hit-test clips: `clipBodyAt` (selection,
 * split, duplicate, delete), `clipEdgeAt` (the trim edge) and the pointer-move
 * handler (the move-target highlight). All three closed over the window while
 * keying their dependency list on its SPAN — and paging moves the ORIGIN and
 * leaves the span alone, so none of them was ever re-created and all went on
 * mapping the pointer through a window anchored at cycle 0.
 *
 * Only the first was pinned by an arm. The other two were fixed by the same
 * reasoning and reddened NOTHING when re-broken, which is the honest reading
 * that they were unverified — not that they were fine. These two arms drive the
 * gestures those callbacks own, at a non-zero origin, for the first time.
 *
 * ⚠ Each arm's mid-gesture geometry assertion doubles as proof the window did
 * not page again underneath it: the trim edge and the move ghost are both
 * placed through the live window, so a third window would move them.
 *
 * Both gestures are already proven at origin 0 (`full-song-arrange-trim.spec.ts`
 * and `full-song-arrange-move.spec.ts`); what is new here is only the origin.
 */

/**
 * The window's geometry at origin 256, which every coordinate below rests on.
 * The grid fits the window to the viewport at rest, so scrollLeft is 0 and a
 * client x of `gridLeft + f·gridWidth` is song cycle `256 + f·256`. In this
 * fixture that puts arm 4's clip at [256, 320) — the first quarter — and arm 5's
 * at [320, 384), the second.
 */
const cycleToFrac = (cycle: number): number => (cycle - SPAN) / SPAN

test('a clip TRIMMED from the SECOND window resizes the arm the user grabbed', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  await boot(page)
  await evalCode(page, WIDE_APERIODIC_ARRANGE)
  const a = await settledAnalysis(page)
  expect(a.periodCycles, 'fixture must be aperiodic or the trigger never fires').toBeNull()
  await pageToSecondWindow(page)

  const grid = page.locator('[data-full-song="grid"]')
  const gbox = await grid.boundingBox()
  expect(gbox, 'no grid box').not.toBeNull()
  const y = gbox!.y + 8 // the lane row, which holds arm 4

  // Grab arm 4's RIGHT EDGE — cycle 320, a quarter across the window. 4px inside
  // it: the grip is 6px wide and the boundary pixel itself belongs to arm 5
  // (the same offset the origin-0 trim spec uses).
  const grabX = gbox!.x + gbox!.width * cycleToFrac(320) - 4
  await page.mouse.move(grabX, y)
  await page.mouse.down()
  await page.mouse.move(gbox!.x + gbox!.width * 0.3, y, { steps: 4 })

  // ── OBSERVATION 1: the edge was FOUND AT ALL ─────────────────────────────
  // This is `clipEdgeAt`'s dependency exactly. With the span-keyed list the
  // closure maps x through a window anchored at 0, where cycle 320's edge sits
  // at 1.25·W — off the right of the grid. Nothing would be within the grip, no
  // trim drag would begin, and this element would never be rendered: the whole
  // gesture would silently do nothing while the view looked perfect.
  const edge = page.locator('[data-full-song="trim-edge"]')
  await expect(
    edge,
    'no trim edge — clipEdgeAt found no clip edge at a paged origin',
  ).toBeVisible({ timeout: 8_000 })

  // ── OBSERVATION 2: the dragged edge is placed through the WINDOW ─────────
  // Drop at cycle 352. The trim maps the cursor at the constant rest px/cycle
  // and adds the origin back (`trimExtent`), so the ghost belongs at
  // (352−256)/256 of the grid. An origin-blind placement would put it at
  // 352/256 — past the right edge entirely.
  const dropFrac = cycleToFrac(352)
  await page.mouse.move(gbox!.x + gbox!.width * dropFrac, y, { steps: 4 })
  await page.waitForTimeout(250)
  const ebox = await edge.boundingBox()
  expect(ebox, 'trim edge vanished mid-drag').not.toBeNull()
  const expectedEdgeX = gbox!.x + gbox!.width * dropFrac
  expect(
    Math.abs(ebox!.x - expectedEdgeX),
    `trim edge at x=${ebox!.x}, the window puts cycle 352 at x=${expectedEdgeX}`,
  ).toBeLessThanOrEqual(6)

  await page.mouse.up()

  // ── OBSERVATION 3: the write-back resizes the arm the user grabbed ────────
  // 352 − 256 = 96, so arm 4's weight goes 64 → 96 and arm 5 is untouched. The
  // drop sits dead centre of its rounding bucket, so this digit needs ~2px of
  // pointer drift to move.
  await expect
    .poll(() => strudelSource(page), { timeout: 15_000 })
    .toContain(WIDE_ARMS('[96, s("bd*4")], [64, s("hh*8")]'))

  await page.screenshot({ path: 'test-results/window-paging-trim-origin-256.png' })
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([])
})

test('a clip MOVED from the SECOND window reorders the arm the user grabbed', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  await boot(page)
  await evalCode(page, WIDE_APERIODIC_ARRANGE)
  const a = await settledAnalysis(page)
  expect(a.periodCycles, 'fixture must be aperiodic or the trigger never fires').toBeNull()
  await pageToSecondWindow(page)

  const grid = page.locator('[data-full-song="grid"]')
  const gbox = await grid.boundingBox()
  expect(gbox, 'no grid box').not.toBeNull()
  const y = gbox!.y + 8 // the lane row, which holds arm 4

  // Press arm 4's BODY at cycle 288 — well clear of both its edges, so this is a
  // move and not a trim — and drag right into arm 5's span at cycle 352.
  await page.mouse.move(gbox!.x + gbox!.width * cycleToFrac(288), y)
  await page.mouse.down()
  await page.mouse.move(gbox!.x + gbox!.width * cycleToFrac(320), y, { steps: 4 })
  await page.mouse.move(gbox!.x + gbox!.width * cycleToFrac(352), y, { steps: 4 })

  // ── OBSERVATION 1: the move-target highlight appears, over arm 5's clip ───
  // This is the pointer-move handler's dependency. With the span-keyed list the
  // press at cycle 288 reads as cycle 32, no clip contains it, no move drag ever
  // starts and no ghost is rendered. That it appears proves the press hit; WHERE
  // it appears proves the highlight itself is mapped through the live window —
  // arm 5's clip is [320, 384), the window's second quarter.
  const ghost = page.locator('[data-full-song="clip-move-ghost"]')
  await expect(
    ghost,
    'no move ghost — the press at cycle 288 never hit a clip at a paged origin',
  ).toBeVisible({ timeout: 8_000 })
  const gh = await ghost.boundingBox()
  expect(gh, 'move ghost vanished mid-drag').not.toBeNull()
  const expectedGhostX = gbox!.x + gbox!.width * cycleToFrac(320)
  const expectedGhostW = (gbox!.width * (384 - 320)) / SPAN
  expect(
    Math.abs(gh!.x - expectedGhostX),
    `move ghost at x=${gh!.x}, the window puts arm 5's clip at x=${expectedGhostX}`,
  ).toBeLessThanOrEqual(6)
  expect(
    Math.abs(gh!.width - expectedGhostW),
    `move ghost is ${gh!.width}px wide, arm 5's 64 cycles are ${expectedGhostW}px`,
  ).toBeLessThanOrEqual(6)

  await page.mouse.up()

  // ── OBSERVATION 2: the release reorders the arms in the source ────────────
  await expect
    .poll(() => strudelSource(page), { timeout: 15_000 })
    .toContain(WIDE_ARMS('[64, s("hh*8")], [64, s("bd*4")]'))

  await page.screenshot({ path: 'test-results/window-paging-move-origin-256.png' })
  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([])
})
