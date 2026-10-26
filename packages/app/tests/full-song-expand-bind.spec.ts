/**
 * Full-song view: expand + bind (#422 / #416) — Playwright observation.
 *
 * AnviDev observe gate. The pure layer (laneLayout, drawTimeline per-lane boxes,
 * scene sourceOffset) is unit-tested; FullSongTimeline.test covers the caret →
 * expand-state + onBindLane callback in jsdom. This drives the REAL app to
 * confirm the end-to-end behaviour against a real evaluated song:
 *   1. Clicking a lane's disclosure caret accordions it (data-expanded=true) AND
 *      grows the canvas backing height (the taller content is really laid out).
 *   2. The SAME click binds the lane into the editing seam: the Monaco cursor
 *      jumps to that lane's source line (this is what `revealLineInFile` drives;
 *      the Pattern panel then re-detects the active chunk — `useActiveChunk`).
 *   3. Multi-expand: two lanes expand at once (cross-track alignment) and the
 *      canvas grows further.
 *   4. Double-click in the grid body also expands the lane under the pointer.
 *   5. No console/page errors; screenshots of collapsed vs expanded.
 *
 * INPUT NOTE: the song is the Starter Stave opened with until #2240, seeded
 * (a drum stack of three voices) — assertions are generic (≥1 lane, height grew,
 * cursor moved), never a fixed line or pixel.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, evalCode, STARTER_UNTIL_2240 } from './_appBoot'

async function canvasHeight(page: Page): Promise<number> {
  return page.locator('[data-full-song-canvas]').evaluate((el) => (el as HTMLCanvasElement).height)
}

/** The strudel editor's cursor line, plus the model line count (for a sentinel
 *  that's guaranteed distinct from any real pattern line). */
async function cursor(page: Page): Promise<{ line: number; lineCount: number }> {
  return page.evaluate(() => {
    const monaco = (window as unknown as {
      monaco?: { editor?: { getEditors?: () => unknown[] } }
    }).monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; getLineCount?: () => number } | null
      getPosition: () => { lineNumber: number } | null
      setPosition: (p: { lineNumber: number; column: number }) => void
    }>
    const ed = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    const model = ed?.getModel()
    return { line: ed?.getPosition?.()?.lineNumber ?? 0, lineCount: model?.getLineCount?.() ?? 0 }
  })
}

/** Park the cursor on the last line so any bind-driven jump is observable. */
async function parkCursorAtEnd(page: Page): Promise<number> {
  return page.evaluate(() => {
    const monaco = (window as unknown as {
      monaco?: { editor?: { getEditors?: () => unknown[] } }
    }).monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; getLineCount?: () => number } | null
      setPosition: (p: { lineNumber: number; column: number }) => void
    }>
    const ed = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    const last = ed?.getModel()?.getLineCount?.() ?? 1
    ed?.setPosition?.({ lineNumber: last, column: 1 })
    return last
  })
}

test('full-song view: expand a lane (taller canvas) + bind it to the editor cursor', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 360 } })
  await seedCode(page, STARTER_UNTIL_2240)
  await evalCode(page)
  await page.waitForTimeout(1800)

  // Enter the full-song view.
  // Song canvas is the only timeline view now (#497/U5) -- wait for it.
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-lane]').first().waitFor({ timeout: 10_000 })

  const laneCount = await page.locator('[data-full-song-lane]').count()
  expect(laneCount).toBeGreaterThanOrEqual(1)

  // Collapsed baseline.
  const heightCollapsed = await canvasHeight(page)
  expect(heightCollapsed).toBeGreaterThan(0)
  await page.screenshot({ path: 'test-results/full-song-expand-collapsed.png' })

  // (1)+(2) Click the first lane's caret → it expands AND binds. Park the cursor
  // at the end first so the bind-driven jump to the lane's source line is visible.
  const sentinel = await parkCursorAtEnd(page)
  const firstCaret = page.locator('[data-full-song-lane-expand]').first()
  const firstLaneKey = await firstCaret.getAttribute('data-full-song-lane-expand')
  await firstCaret.click()
  await page.waitForTimeout(150)

  // Expanded: the row reports it and the canvas grew taller.
  await expect(
    page.locator(`[data-full-song-lane="${firstLaneKey}"]`),
  ).toHaveAttribute('data-expanded', 'true')
  const heightExpanded = await canvasHeight(page)
  expect(heightExpanded).toBeGreaterThan(heightCollapsed)

  // Bind: the cursor jumped off the sentinel onto the lane's pattern line.
  const afterBind = await cursor(page)
  expect(afterBind.line).toBeGreaterThan(0)
  if (sentinel > 1) expect(afterBind.line).not.toBe(sentinel)

  await page.screenshot({ path: 'test-results/full-song-expand-expanded.png' })

  // (3) Multi-expand a second lane (if present) → canvas grows further.
  if (laneCount >= 2) {
    await page.locator('[data-full-song-lane-expand]').nth(1).click()
    await page.waitForTimeout(120)
    const expandedLanes = await page.locator('[data-full-song-lane][data-expanded="true"]').count()
    expect(expandedLanes).toBe(2)
    expect(await canvasHeight(page)).toBeGreaterThan(heightExpanded)
    await page.screenshot({ path: 'test-results/full-song-expand-multi.png' })
  }

  // (4) Collapse the first lane again via its caret (toggle).
  await page.locator(`[data-full-song-lane-expand="${firstLaneKey}"]`).click()
  await page.waitForTimeout(120)
  await expect(
    page.locator(`[data-full-song-lane="${firstLaneKey}"]`),
  ).toHaveAttribute('data-expanded', 'false')

  // (5) Double-click the grid body → expands the lane under the pointer.
  const grid = page.locator('[data-full-song="grid"]')
  const box = await grid.boundingBox()
  if (box) {
    await page.mouse.dblclick(box.x + 40, box.y + 10) // top band = first lane
    await page.waitForTimeout(120)
    expect(await page.locator('[data-full-song-lane][data-expanded="true"]').count()).toBeGreaterThanOrEqual(1)
  }

  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})
