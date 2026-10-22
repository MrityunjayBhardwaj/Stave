/**
 * full-song-arranged-span — #1721.
 *
 * An arrangement declares its length (`Σ weight`, folded with any parameter
 * that outlasts it), and the bounce renders it. The Song timeline did not: its
 * span was a period DETECTED from what played, which cannot see past half the
 * 256-cycle cap and takes the first period that fits. So a 150-bar arrangement
 * that opens on one repeated bar drew ONE bar, and a 187-bar one drew 256.
 *
 * Measured in the running app, because the unit tests cannot prove the one thing
 * that decides whether the fix reaches the user: that the IR the timeline is
 * handed still carries the `Arrange` node (`songExtent` reads it off that IR, and
 * an earlier pipeline once left `arrange(...)` as opaque code there).
 *
 * The control arm keeps the measured path honest: a document with no arrangement
 * still reads as a detected loop.
 */
import { test, expect, type Page } from '@playwright/test'

type AnalysisProbe = {
  periodCycles: number | null
  horizonCycles: number
  displaySpan: { kind: string; cycles: number } | null
  lanes: Array<{ laneKey: string; onsets: number }>
}

/** 100 bars of one repeated bar, then 50 of another: detection confirms period 1. */
const ARRANGED_150 = 'setcps(0.5)\ndrums: arrange([100, s("bd*4")], [50, s("hh*8")])'
/** #1723 / #1936 — four bars of structure under a gain stepping `<.2 .9>` by the
 *  absolute bar: the song first comes back round at 8, where play-once stops. */
const FOLDED_8 = 'setcps(0.5)\nconst a = s("bd*2").gain("<.2 .9>")\nsong: arrange([2, a], [1, s("hh*2")], [1, a])'
/** No arrangement — a loop, measured as before. */
const LOOP = 'setcps(0.5)\nbeat: s("bd*4")'

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:bottomPanel.height', '360')
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.activeTabId', 'musical-timeline')
      localStorage.setItem('stave:debug.timelineMarks', '1')
      // #2109 — these songs run to 150 cycles; this spec is about spanning a declared
      // end, so the limit must hold it (the default of 64 pages a longer song instead,
      // which `full-song-cycle-limit.spec.ts` covers).
      localStorage.setItem('stave:songCycleLimit', '256')
    } catch { /* ignore */ }
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getValue?: () => string } | null }> } } }).monaco
      const eds = m?.editor?.getEditors?.() ?? []
      return eds.some((e) => (e.getModel()?.getValue?.()?.length ?? 0) > 0)
    },
    { timeout: 20_000 },
  )
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 15_000 })
}

/** setValue in one shot, then evaluate — and clear the previous analysis first, so
 *  nothing below can read the starter song's verdict as this document's. */
async function evaluateCode(page: Page, code: string): Promise<void> {
  await page.evaluate(() => {
    delete (window as unknown as { __staveTimelineAnalysis?: unknown }).__staveTimelineAnalysis
  })
  await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null; focus: () => void }> } } }).monaco
    const editors = monaco?.editor?.getEditors?.() ?? []
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    target?.getModel()?.setValue(c)
    target?.focus()
  }, code)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
}

function analysisOf(page: Page): Promise<AnalysisProbe | null> {
  return page.evaluate(
    () => (window as unknown as { __staveTimelineAnalysis?: AnalysisProbe }).__staveTimelineAnalysis ?? null,
  )
}

/** The analysis once it is THIS document's (its own lane key) and has stopped moving. */
async function settledAnalysisFor(page: Page, laneKey: string): Promise<AnalysisProbe> {
  await expect
    .poll(async () => (await analysisOf(page))?.lanes.map((l) => l.laneKey).join(',') ?? '', { timeout: 60_000 })
    .toBe(laneKey)
  let prev = ''
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500)
    const cur = JSON.stringify(await analysisOf(page))
    if (cur === prev) break
    prev = cur
  }
  return (await analysisOf(page))!
}

test('an arranged song spans the end it declares, not a detected period', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await boot(page)
  await evaluateCode(page, ARRANGED_150)

  const a = await settledAnalysisFor(page, 'drums')
  expect(a.displaySpan).toEqual({ kind: 'arranged', cycles: 150 })
  expect(a.horizonCycles).toBe(150)
  // Both sections are in the view: 100 bars × 4 kicks + 50 bars × 8 hats.
  expect(a.lanes[0]!.onsets).toBe(100 * 4 + 50 * 8)
  await expect(page.locator('[data-full-song-period]')).toHaveAttribute('data-full-song-period', 'arranged 150 cycles')
  expect(errors).toEqual([])
})

test('an arrangement under a parameter that outlasts it spans where play-once stops, not its bare length', async ({ page }) => {
  // #1936 — the timeline, play-once and the bounce ask one `songEnd`. The structure
  // is 4 bars; the song is 8, and play-once stops at 8 (playback-that-ends.spec.ts).
  test.setTimeout(180_000)
  await boot(page)
  await evaluateCode(page, FOLDED_8)
  const a = await settledAnalysisFor(page, 'song')
  expect(a.displaySpan).toEqual({ kind: 'arranged', cycles: 8 })
  await expect(page.locator('[data-full-song-period]')).toHaveAttribute('data-full-song-period', 'arranged 8 cycles')
})

test('control: a document with no arrangement is still a measured loop', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)
  await evaluateCode(page, LOOP)
  const a = await settledAnalysisFor(page, 'beat')
  expect(a.displaySpan).toEqual({ kind: 'loop', cycles: 1 })
  await expect(page.locator('[data-full-song-period]')).toHaveAttribute('data-full-song-period', 'loop 1')
})
