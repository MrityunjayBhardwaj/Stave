/**
 * Full-song view: select-to-jump (#610) + render-from-source on file-active (#611)
 * — Playwright observation (AnviDev observe gate).
 *
 * #611: a freshly-opened, never-evaluated Strudel file used to show
 *   "SONG · press play" with zero lanes — the IR snapshot was published only on
 *   eval / song-entry / code-change. The fix publishes a source snapshot the
 *   moment a file becomes active (captureAndPublishSnapshot is pure on the
 *   source), so the timeline maps the song with NO eval at all.
 *
 * #610: clicking anywhere on a lane HEADER reveals that track's code in the
 *   editor (the twin of the Mixer's strip cursor-follow #595/#596). It is a pure
 *   "go to this track" — it does NOT expand the lane (that is the caret) and the
 *   double-click rename still works.
 *
 * INPUT NOTE (as the sibling specs): eval reads the FILE STORE, so the analyzed
 * song is the starter example — assertions are generic (≥1 lane, cursor moved,
 * not expanded), never a fixed line or pixel.
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const STORAGE_KEYS = {
  height: 'stave:bottomPanel.height',
  open: 'stave:bottomPanel.open',
  activeTabId: 'stave:bottomPanel.activeTabId',
} as const

async function preOpenDrawer(page: Page): Promise<void> {
  await page.addInitScript(
    ([heightKey, openKey, activeKey]: readonly string[]) => {
      try {
        window.localStorage.setItem(heightKey, '340')
        window.localStorage.setItem(openKey, 'true')
        window.localStorage.setItem(activeKey, 'musical-timeline')
      } catch {
        /* ignore */
      }
    },
    [STORAGE_KEYS.height, STORAGE_KEYS.open, STORAGE_KEYS.activeTabId],
  )
}

async function bootShell(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () =>
      ((window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco?.editor?.getEditors?.()?.length ?? 0) > 0,
    { timeout: 20_000 },
  )
}

async function evalStrudel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string } | null; focus: () => void }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.focus()
  })
  await page.keyboard.press(`${MOD}+Enter`)
  await page.waitForTimeout(1800)
}

function cursorLine(page: Page): Promise<number> {
  return page.evaluate(() => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string } | null; getPosition: () => { lineNumber: number } | null }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const ed = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    return ed?.getPosition?.()?.lineNumber ?? 0
  })
}

function parkCursorAtEnd(page: Page): Promise<number> {
  return page.evaluate(() => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; getLineCount?: () => number } | null; setPosition: (p: { lineNumber: number; column: number }) => void }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const ed = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    const last = ed?.getModel()?.getLineCount?.() ?? 1
    ed?.setPosition?.({ lineNumber: last, column: 1 })
    return last
  })
}

test('#611 — the Song timeline renders from source with NO eval (cold, file-active)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await preOpenDrawer(page)
  await bootShell(page)
  // Deliberately do NOT eval. The active file's source must be analyzed on its
  // own — wait past the on-active capture + analysis.
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-lane]').first().waitFor({ timeout: 6_000 })
  expect(await page.locator('[data-full-song-lane]').count()).toBeGreaterThanOrEqual(1)

  // Not the misleading "press play" — a real loop/horizon is surfaced.
  const period = await page.locator('[data-full-song-period]').getAttribute('data-full-song-period')
  expect(period).toMatch(/loop \d+|\d+\+? cycles/)

  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})

test('#610 — clicking a lane header jumps the editor to its code (no expand); rename still works', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await preOpenDrawer(page)
  await bootShell(page)
  await evalStrudel(page)
  await page.locator('[data-full-song-lane]').first().waitFor({ timeout: 10_000 })

  // Park the cursor at the end so a jump is observable.
  const sentinel = await parkCursorAtEnd(page)
  const header = page.locator('[data-full-song-lane-select]').first()
  const laneKey = await header.getAttribute('data-full-song-lane-select')
  expect(laneKey).toBeTruthy()

  await header.click()
  await page.waitForTimeout(150)

  // Cursor jumped off the sentinel onto the track's line…
  const afterJump = await cursorLine(page)
  expect(afterJump).toBeGreaterThan(0)
  if (sentinel > 1) expect(afterJump).not.toBe(sentinel)
  // …and the lane did NOT expand (jump is orthogonal to the caret).
  await expect(page.locator(`[data-full-song-lane="${laneKey}"]`)).toHaveAttribute('data-expanded', 'false')

  // The caret still expands (its stopPropagation didn't kill its own job).
  await page.locator(`[data-full-song-lane-expand="${laneKey}"]`).click()
  await page.waitForTimeout(120)
  await expect(page.locator(`[data-full-song-lane="${laneKey}"]`)).toHaveAttribute('data-expanded', 'true')

  // Double-click the name → menu → Rename → inline rename input mounts and keeps focus (the
  // header-jump's editor-focus must not blow the rename away).
  await page.locator(`[data-full-song-lane-name="${laneKey}"]`).dblclick()
  // #1738 — a double-click opens the track menu; Rename is its entry.
  await page.locator('[data-full-song-lane-menu-rename]').click()
  await page.waitForTimeout(150)
  await expect(page.locator('[data-full-song-lane-rename]')).toHaveCount(1)
  expect(
    await page.evaluate(() => document.activeElement?.getAttribute('data-full-song-lane-rename') != null),
  ).toBe(true)
  await page.keyboard.press('Escape')

  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})

test('#610 — clicking a track ROW in the grid also jumps to its code, and the grid keeps focus', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await preOpenDrawer(page)
  await bootShell(page)
  await evalStrudel(page)
  await page.locator('[data-full-song-lane]').first().waitFor({ timeout: 10_000 })

  const sentinel = await parkCursorAtEnd(page)
  // Click the note-area (grid), top band = first lane — NOT the header.
  const grid = page.locator('[data-full-song="grid"]')
  const box = await grid.boundingBox()
  if (!box) throw new Error('no grid box')
  await page.mouse.click(box.x + box.width * 0.5, box.y + 10)
  await page.waitForTimeout(150)

  // The whole lane row jumps to code: the cursor moved off the sentinel.
  const afterJump = await cursorLine(page)
  expect(afterJump).toBeGreaterThan(0)
  if (sentinel > 1) expect(afterJump).not.toBe(sentinel)

  // …but the GRID keeps keyboard focus (so the clip-op shortcuts still work,
  // #488) — the reveal positions the editor cursor without stealing focus.
  const activeInGrid = await page.evaluate(
    () => !!document.activeElement?.closest('[data-full-song="grid"]'),
  )
  expect(activeInGrid).toBe(true)

  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})
