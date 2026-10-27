/**
 * Full-song view: expanded per-voice sub-rows keep a STABLE row order when clips
 * are reordered (#480) — Playwright observation (AnviDev observe gate, P195).
 *
 * The bug: `groupVoices` orders a lane's voice sub-rows by first-appearance-in-
 * time, so reordering the clips reshuffled the instrument rows even though the
 * marks were correct. For a DAW that's wrong — reordering CLIPS must not move
 * TRACKS. The fix pins each voice's row first-seen (stableVoiceOrder), mirroring
 * the top-level lane stability.
 *
 * Repro (verified in the real browser): `arrange([2, s("bd*4")], [2, s("hh*8")],
 * [4, s("bd sn bd sn")])` is ONE lane (`d1`) with three voices — a header row, and
 * under it indented labels `[bd, hh, sn]` (#2226). Swapping the first two arms (code-edit OR
 * drag) must leave that row order [bd, hh, sn] UNCHANGED while the per-voice mark
 * content moves (bd's hits slide later; hh's slide earlier) — proving the rows
 * held WITHOUT freezing the timeline.
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

const ORIG = 'arrange([2, s("bd*4")], [2, s("hh*8")], [4, s("bd sn bd sn")])'
const SWAPPED = 'arrange([2, s("hh*8")], [2, s("bd*4")], [4, s("bd sn bd sn")])'

async function bootShell(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:bottomPanel.height', '360')
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

async function focusStrudel(page: Page): Promise<void> {
  await page.evaluate(() => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string } | null; focus: () => void }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.focus()
  })
}

async function setSongAndEval(page: Page, code: string): Promise<void> {
  await focusStrudel(page)
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.press('Backspace')
  await page.keyboard.type(code, { delay: 6 })
  await page.waitForTimeout(400)
  await page.keyboard.press(`${MOD}+Enter`)
  await page.waitForTimeout(1800)
}

async function reEval(page: Page): Promise<void> {
  await focusStrudel(page)
  await page.keyboard.press(`${MOD}+Enter`)
  await page.waitForTimeout(1800)
}

async function openSongView(page: Page): Promise<void> {
  // Song canvas is the only timeline view now (#497/U5) -- wait for it.
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-lane]').first().waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400)
}

/** The FULL ordered voice keys of a lane: its indented `data-full-song-voice`
 *  rows, one per voice under the header row (#2226). This is the exact
 *  top-to-bottom row order the user sees. */
async function voiceOrder(page: Page, laneKey: string): Promise<string[]> {
  // every voice has a labelled row of its own under the track's header (#2226)
  const lane = page.locator(`[data-full-song-lane="${laneKey}"]`)
  return lane.locator('[data-full-song-voice]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-full-song-voice') ?? ''),
  )
}

/** A pixel fingerprint of the canvas — changes iff the drawn scene changed.
 *  The playhead is a DOM overlay (not on the canvas), so a diff here means the
 *  note CONTENT moved, not animation. */
async function canvasFingerprint(page: Page): Promise<string> {
  return page.locator('[data-full-song-canvas]').evaluate((el) => (el as HTMLCanvasElement).toDataURL())
}

async function expandLane(page: Page, laneKey: string): Promise<void> {
  const caret = page.locator(`[data-full-song-lane-expand="${laneKey}"]`)
  if ((await caret.getAttribute('aria-pressed')) !== 'true') {
    await caret.click()
    await page.waitForTimeout(200)
  }
}

test('expanded voice rows hold their order across a CODE-EDIT clip swap (#480)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  await setSongAndEval(page, ORIG)
  await openSongView(page)
  await expandLane(page, 'd1')

  const before = await voiceOrder(page, 'd1')
  expect(before, `expected the repro to split lane d1 into [bd, hh, sn]; saw ${JSON.stringify(before)}`).toEqual(['bd', 'hh', 'sn'])
  const canvasBefore = await canvasFingerprint(page)
  await page.screenshot({ path: 'test-results/full-song-voice-order-before.png' })

  // Reorder the first two clips by editing the code, then re-eval.
  await setSongAndEval(page, SWAPPED)
  await page.waitForTimeout(300)

  const after = await voiceOrder(page, 'd1')
  // (1) Rows HELD — the swap did not move the tracks.
  expect(after, `voice rows reshuffled on clip swap — saw ${JSON.stringify(after)}`).toEqual(['bd', 'hh', 'sn'])
  // (2) Content MOVED — the canvas redrew (bd's hits slid later, hh's earlier);
  //     proves the rows held WITHOUT freezing the timeline.
  const canvasAfter = await canvasFingerprint(page)
  expect(canvasAfter, 'canvas did not change — the swap was a no-op (frozen timeline)').not.toBe(canvasBefore)
  await page.screenshot({ path: 'test-results/full-song-voice-order-after.png' })

  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})

test('expanded voice rows hold their order across a DRAG clip reorder (#480)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await bootShell(page)
  await setSongAndEval(page, ORIG)
  await openSongView(page)
  await expandLane(page, 'd1')

  const before = await voiceOrder(page, 'd1')
  expect(before).toEqual(['bd', 'hh', 'sn'])

  // The song spans 8 cycles: arm 0 (bd) over [0,2) = x∈[0,0.25W), arm 1 (hh)
  // over [2,4) = x∈[0.25W,0.5W). Grab arm 0's clip body at cycle 1.125 and drag
  // it into arm 1's span at cycle ~2.8 (0.35W) → reorderArm rewrites the source,
  // swapping the first two arms.
  //
  // ⚠ The grab is the MIDDLE of a bd hit ([1, 1.25)), not a whole cycle. On an
  // expanded lane the few px just inside a sample mark's edge trim what it plays
  // (#1527), so a press at cycle 1 — exactly where a `bd*4` hit begins — is a
  // `.begin` drag, not a move. That is the timeline's intended priority, and it
  // is why the cursor is read before pressing: the canvas says `grab` over a
  // movable body and `col-resize` over an edge, in the same order the press
  // resolves, so this arm fails on the press it is about to make rather than on
  // a document it did not mean to write.
  const grid = page.locator('[data-full-song="grid"]')
  const box = await grid.boundingBox()
  if (!box) throw new Error('no grid box')
  const y = box.y + 8
  await page.mouse.move(box.x + box.width * (1.125 / 8), y)
  await expect.poll(() => grid.evaluate((el) => (el as HTMLElement).style.cursor), { timeout: 2_000 }).toBe('grab')
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.25, y, { steps: 5 })
  await page.mouse.move(box.x + box.width * 0.35, y, { steps: 5 })
  await page.mouse.up()

  // The write-back rewrites the code; re-eval to refresh the analyzed marks.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; getValue: () => string } | null }> } } }).monaco?.editor?.getEditors?.()) ?? []
          const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
          return t?.getModel()?.getValue() ?? ''
        }),
      { timeout: 8_000 },
    )
    .toContain('s("hh*8")], [2, s("bd*4")')
  await reEval(page)
  await page.waitForTimeout(300)

  const after = await voiceOrder(page, 'd1')
  expect(after, `voice rows reshuffled after a drag reorder — saw ${JSON.stringify(after)}`).toEqual(['bd', 'hh', 'sn'])
  await page.screenshot({ path: 'test-results/full-song-voice-order-drag.png' })

  expect(errors, `unexpected console/page errors:\n${errors.join('\n')}`).toEqual([])
})
