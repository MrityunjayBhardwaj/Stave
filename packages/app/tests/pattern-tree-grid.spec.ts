/**
 * The step grid drawn from the pattern's own divisions (#1834, epic #1832).
 *
 * A pattern the columns cannot hold — its bar needs more than 64 steps, or a hit falls
 * between the columns — used to open as "isn't grid-editable". It now draws look-only from
 * the tree Strudel gives: every step at its exact share of the bar, the steps inside a
 * closed one as small boxes, the ruler naming each step by its place, zoom opening levels.
 *
 * Observed in the REAL app, with the real mouse and wheel:
 *   - the 96-column pattern draws 8 steps, 9 small boxes and its 14 hits, every step an
 *     eighth of the bar, and a click on it writes nothing;
 *   - zooming in opens its groups, and the ruler names their steps;
 *   - a pattern nested five deep (an onset off every column) draws every row, and zoom
 *     opens each level down to the deepest;
 *   - the piano roll opens a pulse of three whose second beat is five;
 *   - CONTROL: a pattern the columns hold still opens the column grid, not this one.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue, pinLcmGrid } from './_appBoot'


pinLcmGrid(test)
const NINETY_SIX = '$: s("hh hh [hh hh] hh [hh hh hh] hh hh [hh hh hh hh]")'
const DEEP = '$: s("bd [hh [hh [hh*4 [cp]]]] sd [~ cp]")'

async function open(page: Page, code: string): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 460 } })
  // the dev server's badge sits over the panel's corner
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await seedCode(page, code)
  const grid = page.locator('[data-tree-grid]')
  await expect(grid, `the tree grid must open for ${code}`).toHaveCount(1)
  return grid
}

const labels = (grid: Locator): Promise<string[]> =>
  grid.locator('[data-seq-ruler-label]').evaluateAll((els) => els.map((e) => e.textContent ?? ''))

/** each box's left and width on screen */
const boxes = (l: Locator): Promise<Array<{ x: number; w: number }>> =>
  l.evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect()
    return { x: r.left, w: r.width }
  }))

test.describe('a grid drawn from the tree, look-only (#1834)', () => {
  test('a bar of 96 columns draws its eight steps, each an eighth, with its groups as small boxes (LCM grid)', async ({ page }) => {
    const grid = await open(page, NINETY_SIX)
    await expect(grid.locator('[data-seq-look-only]')).toContainText('Look only')
    await expect(grid.locator('[data-seq-look-only]')).toContainText('more than 64 steps')
    await expect(grid.locator('[data-tree-row]')).toHaveCount(1)
    await expect(grid.locator('[data-tree-step]')).toHaveCount(8)
    await expect(grid.locator('[data-tree-inner]')).toHaveCount(9)
    await expect(grid.locator('[data-tree-hit]')).toHaveCount(14)
    expect(await labels(grid)).toEqual(['1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8'])
    await expect(grid.locator('[data-grid-zoom-level]')).toHaveText('1×')
    // every step the same width: an eighth of the bar, exactly (to the pixel)
    const steps = await boxes(grid.locator('[data-tree-step]'))
    const pitch = steps[1].x - steps[0].x
    for (let i = 1; i < steps.length; i++) expect(Math.abs(steps[i].x - steps[i - 1].x - pitch)).toBeLessThan(1)
    // the fourth group's small boxes are quarters of its step
    const quarters = await boxes(grid.locator('[data-tree-inner]'))
    const last4 = quarters.slice(-4)
    for (let i = 1; i < 4; i++) expect(Math.abs(last4[i].x - last4[i - 1].x - pitch / 4)).toBeLessThan(1)
    // the bar fits the panel at 1×
    expect(await grid.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)

    // look only: a click on a step changes nothing
    const before = await editorValue(page)
    const s = (await grid.locator('[data-tree-step]').nth(2).boundingBox())!
    await page.mouse.click(s.x + s.width / 2, s.y + s.height / 2)
    await page.mouse.click(s.x + 3, s.y + s.height / 2)
    expect(await editorValue(page)).toBe(before)
  })

  test('zooming in opens its groups, and the ruler names their steps; the hits stay where they play (LCM grid)', async ({ page }) => {
    const grid = await open(page, NINETY_SIX)
    const hitsAt = async (): Promise<number[]> => {
      const bar = (await grid.locator('[data-tree-step]').first().boundingBox())!
      const hits = await boxes(grid.locator('[data-tree-hit]'))
      const width = (await grid.locator('[data-tree-row] [role="cell"]').boundingBox())!.width
      return hits.map((h) => Number(((h.x - 2 - (bar.x - 1)) / width).toFixed(3)))
    }
    const at1 = await hitsAt()
    const first = (await grid.locator('[data-tree-step]').first().boundingBox())!
    await page.mouse.move(first.x + 4, first.y + first.height / 2)
    await page.keyboard.down('Control')
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, -100)
      await page.waitForTimeout(80)
    }
    await page.keyboard.up('Control')
    await expect(grid.locator('[data-grid-zoom-level]')).toHaveText('3×')
    await expect.poll(() => labels(grid)).toContain('1.3.2')
    const zoomed = await labels(grid)
    expect(zoomed).toContain('1.5.3')
    expect(zoomed).toContain('1.8.4')
    await expect(grid.locator('[data-tree-step]')).toHaveCount(14)
    await expect(grid.locator('[data-tree-inner]')).toHaveCount(0)
    // the lines inside the groups are lighter: depth 2
    await expect(grid.locator('[data-tree-line="2"]')).toHaveCount(6)
    // every hit at the same share of the bar it had at 1×
    await grid.evaluate((el) => { el.scrollLeft = 0 })
    const at3 = await hitsAt()
    expect(at3).toEqual(at1)
  })

  test('nested five deep, an onset off every column: every row draws, and zoom opens each level (LCM grid)', async ({ page }) => {
    const grid = await open(page, DEEP)
    await expect(grid.locator('[data-seq-look-only]')).toContainText('does not land on any step column')
    expect(await grid.locator('[data-tree-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tree-row')))).toEqual(['bd', 'hh', 'cp', 'sd'])
    expect(await labels(grid)).toEqual(['1', '1.2', '1.3', '1.4'])
    // per row: 4 steps, the 2nd and 4th holding small boxes
    await expect(grid.locator('[data-tree-row="hh"] [data-tree-step]')).toHaveCount(4)
    await expect(grid.locator('[data-tree-row="hh"] [data-tree-hit]')).toHaveCount(6)
    for (let i = 0; i < 6; i++) await grid.locator('[data-grid-zoom-in]').click()
    await expect(grid.locator('[data-grid-zoom-level]')).toHaveText('8×')
    await expect.poll(() => labels(grid)).toEqual(['1', '1.2', '1.2.2', '1.2.2.2', '1.2.2.2.2', '1.3', '1.4', '1.4.2'])
    await expect(grid.locator('[data-tree-row="hh"] [data-tree-line="4"]')).toHaveCount(1)
  })

  test('the playhead moves with the exact position playing, in the tree grid and in the column grid (LCM grid)', async ({ page }) => {
    const play = async (): Promise<void> => {
      await page.evaluate(() => {
        const eds = (window as unknown as { monaco: { editor: { getEditors: () => { getModel: () => { getValue: () => string } | null; focus: () => void }[] } } }).monaco.editor.getEditors()
        ;(eds.find((e) => e.getModel()?.getValue().includes('$:')) ?? eds[0]).focus()
      })
      await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Enter`)
    }
    /** a few readings of a position the line carries, a frame or two apart */
    const readings = async (line: Locator, attr: string): Promise<number[]> => {
      const out: number[] = []
      for (let i = 0; i < 8; i++) {
        const v = await line.getAttribute(attr)
        if (v !== null) out.push(Number(v))
        await page.waitForTimeout(37)
      }
      return out
    }
    // the tree grid: a position in cycles, never a step's start
    const grid = await open(page, NINETY_SIX)
    await play()
    const head = grid.locator('[data-tree-playhead-line]')
    await expect(head).toBeVisible({ timeout: 10_000 })
    const t = await readings(head, 'data-tree-playhead')
    expect(new Set(t).size).toBeGreaterThan(4)
    // not stepping by eighths: some reading falls inside a step
    expect(t.some((v) => Math.abs(v * 8 - Math.round(v * 8)) > 0.05)).toBe(true)

    // the column grid: the line is at a fraction of a column, beside the playing cell
    await seedCode(page, '$: s("bd hh*2 sd cp")')
    await play()
    const line = page.locator('[data-seq-playhead-line]')
    await expect(line).toBeVisible({ timeout: 10_000 })
    const cols = await readings(line, 'data-playhead-col')
    expect(new Set(cols).size).toBeGreaterThan(4)
    expect(cols.some((v) => Math.abs(v - Math.round(v)) > 0.05)).toBe(true)

    // the piano roll the same
    await seedCode(page, '$: note("c4 [e4 g4 b4 d5 f5] a4").s("piano")')
    await play()
    const rollLine = page.locator('[data-roll-playhead-line]')
    await expect(rollLine).toBeVisible({ timeout: 10_000 })
    const rollCols = await readings(rollLine, 'data-playhead-col')
    expect(new Set(rollCols).size).toBeGreaterThan(4)
    expect(rollCols.some((v) => Math.abs(v - Math.round(v)) > 0.05)).toBe(true)
  })

  test('CONTROL: a pattern the columns hold opens the column grid, as before', async ({ page }) => {
    await bootApp(page, { drawer: { tabId: 'pattern', height: 460 } })
    await seedCode(page, '$: s("bd [hh [hh hh]] sd [~ cp]")')
    const seq = page.locator('[data-bottom-panel-tab="sequencer"]')
    await expect(seq.locator('[data-seq-cell]').first()).toBeVisible()
    await expect(page.locator('[data-tree-grid]')).toHaveCount(0)
  })

  test('the piano roll opens a pulse of three whose second beat is five', async ({ page }) => {
    await bootApp(page, { drawer: { tabId: 'pattern', height: 460 } })
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    await seedCode(page, '$: note("c4 [e4 g4 b4 d5 f5] a4").s("piano")')
    const roll = page.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(roll).toHaveCount(1)
    const rollLabels = (): Promise<string[]> => roll.locator('[data-roll-ruler-label]').evaluateAll((els) => els.map((e) => e.textContent ?? ''))
    expect(await rollLabels()).toEqual(['1', '1.2', '1.3'])
    const zoomIn = page.locator('[data-bottom-panel-tab="piano-roll"] [data-grid-zoom-in], [data-roll-header] [data-grid-zoom-in]').first()
    for (let i = 0; i < 4 && !(await rollLabels()).includes('1.2.5'); i++) await zoomIn.click()
    await expect.poll(rollLabels).toEqual(['1', '1.2', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.3'])
  })
})
