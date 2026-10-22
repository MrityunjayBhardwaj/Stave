/**
 * The Pattern grids on a phone: steps wide enough to tap (#2006).
 *
 * A 16-step bar on a 390 px screen gave each step 16 px, less than half of what a
 * finger hits. So on a phone a step is never narrower than 40 px. Upright, a bar that
 * no longer fits scrolls sideways: the row of step numbers above the grid is what a
 * finger drags (a drag on the steps themselves is still the grid's own), a thin bar
 * under the numbers shows which part is in view, and the row names stay put. Sideways
 * the bar fits where the screen is wide enough, and the piano roll follows the same
 * rule.
 *
 * A tap writes what a click writes: the last phone test and the tablet test press the
 * same step and expect the same text.
 *
 * The drags here are made with the mouse's pointer, which runs the same pointer
 * handlers a finger does; how a real finger's drag feels is a real-device check.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, editorValue, seedCode } from './_appBoot'

const DRUMS = '$: s("bd ~ ~ ~ sd ~ ~ ~ bd ~ hh ~ sd ~ ~ hh")'
const NOTES = '$: note("c3 e3 g3 b3 c4 e4 g4 b4 c3 e3 g3 b3 c4 e4 g4 b4").s("sawtooth")'
const CODE = `${DRUMS}\n\n${NOTES}\n`
/** the same file after one press on the Kick row's second step */
const AFTER_KICK_2 = `${DRUMS.replace('"bd ~ ~ ~', '"bd bd ~ ~')}\n\n${NOTES}\n`

const STEP_GRID = '[data-bottom-panel-tab="sequencer"]'
const ROLL = '[data-bottom-panel-tab="piano-roll"]'

/** boot with the fixture, the cursor in a pattern, and the Pattern panel open as this device opens it */
async function openPattern(page: Page, project: string, line: number, code = CODE): Promise<void> {
  await bootApp(page)
  // the dev server's badge sits in the bottom-left corner, over the panel
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await seedCode(page, code)
  await page.evaluate((lineNumber) => {
    const m = (window as unknown as {
      monaco: { editor: { getEditors: () => Array<{ setPosition: (p: { lineNumber: number; column: number }) => void }> } }
    }).monaco
    m.editor.getEditors()[0].setPosition({ lineNumber, column: 12 })
  }, line)
  if (project === 'phone-sideways') await page.locator('[data-phone-view="pattern"]').tap()
  else await page.locator('[data-bottom-panel="header"] [data-tab-id="pattern"]').tap()
  // upright, the grid gets the whole sheet: more rows to see
  if (project === 'phone' || project === 'iphone') {
    const handle = await page.locator('[data-bottom-panel="sheet-handle"]').boundingBox()
    const x = handle!.x + handle!.width / 2
    const y = handle!.y + handle!.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(x, y - i * 30)
    await page.mouse.up()
    await expect(page.locator('[data-bottom-panel="root"]')).toHaveAttribute('data-sheet', 'full')
  }
}

interface GridFacts {
  readonly cells: number
  readonly narrowest: number
  readonly lastCellRight: number
  readonly screen: number
  readonly nameLeft: number
  readonly nameRight: number
  readonly firstCellLeft: number
}

/** widths and edges of one grid's first row, and where its row name is */
function facts(page: Page, grid: string, name: string): Promise<GridFacts> {
  return page.evaluate(
    ([gridSel, nameSel]) => {
      const root = document.querySelector(gridSel)!
      const row = root.querySelector('[role="row"]')!
      const cells = [...row.querySelectorAll('[role="gridcell"]')].map((c) => c.getBoundingClientRect())
      const label = root.querySelector(nameSel)!.getBoundingClientRect()
      return {
        cells: cells.length,
        narrowest: Math.min(...cells.map((c) => c.width)),
        lastCellRight: Math.max(...cells.map((c) => c.right)),
        firstCellLeft: Math.min(...cells.map((c) => c.left)),
        screen: window.innerWidth,
        nameLeft: label.left,
        nameRight: label.right,
      }
    },
    [grid, name],
  )
}

/** press on the ruler and drag `dx` px (negative brings later steps in) */
async function dragRuler(page: Page, ruler: string, dx: number): Promise<void> {
  // Press where the ruler IS: wait until two looks at it agree, and check the press lands
  // on it. A press that misses lands on a step, and a drag on a step is the grid's — it
  // scrolls nothing, which would read here as a ruler that does not work.
  let box = await page.locator(ruler).boundingBox()
  await expect
    .poll(async () => {
      const again = await page.locator(ruler).boundingBox()
      const same = box !== null && again !== null && again.y === box.y && again.height === box.height
      box = again
      return same
    })
    .toBe(true)
  expect(box, 'the ruler has no box').not.toBeNull()
  // the ruler is as long as the pattern, so most of it is off screen: press the part that is on it
  const x = (await page.evaluate(() => window.innerWidth)) * 0.7
  const y = box!.y + box!.height / 2
  const pressed = await page.evaluate(
    ([sel, px, py]) => {
      const hit = document.elementFromPoint(px as number, py as number)
      return hit !== null && hit.closest(sel as string) !== null
    },
    [ruler.split(' ').pop()!, x, y],
  )
  expect(pressed, 'the press is not on the ruler').toBe(true)
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y)
  await page.mouse.up()
}

const inViewPart = (page: Page, grid: string): Promise<{ left: number; width: number; whole: number }> =>
  page.evaluate((gridSel) => {
    const bar = document.querySelector(`${gridSel} [data-grid-in-view]`)!.getBoundingClientRect()
    const part = document.querySelector(`${gridSel} [data-grid-in-view-part]`)!.getBoundingClientRect()
    return { left: part.left - bar.left, width: part.width, whole: bar.width }
  }, grid)

test.describe('the step grid on a phone held upright (#2006)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!['phone', 'iphone'].includes(testInfo.project.name), 'upright phones only')
  })

  test('every step is at least 40 px wide, and the bar no longer fits the screen', async ({ page }, testInfo) => {
    await openPattern(page, testInfo.project.name, 1)
    await expect(page.locator(STEP_GRID)).toBeVisible()
    const f = await facts(page, STEP_GRID, '[data-seq-voice]')
    expect(f.cells).toBe(16)
    expect(f.narrowest).toBeGreaterThanOrEqual(40)
    expect(f.lastCellRight).toBeGreaterThan(f.screen)
    // it says so: the in-view bar is lit over part of its length, and the hint is shown
    await expect(page.locator(`${STEP_GRID} [data-grid-in-view]`)).toHaveAttribute('data-more', 'true')
    const part = await inViewPart(page, STEP_GRID)
    expect(part.left).toBeLessThan(1)
    expect(part.width).toBeGreaterThan(20)
    expect(part.width).toBeLessThan(part.whole - 20)
    await expect(page.locator(`${STEP_GRID} [data-grid-turn-hint]`)).toBeVisible()
  })

  test('dragging the numbers reaches step 16, and the row names do not scroll away', async ({ page }, testInfo) => {
    await openPattern(page, testInfo.project.name, 1)
    const ruler = `${STEP_GRID} [data-seq-ruler]`
    const rulerBox = await page.locator(ruler).boundingBox()
    expect(rulerBox!.height, 'the ruler is tall enough to hold').toBeGreaterThanOrEqual(44)
    const before = await facts(page, STEP_GRID, '[data-seq-voice]')

    await dragRuler(page, ruler, -1200)
    const after = await facts(page, STEP_GRID, '[data-seq-voice]')
    // the last step is on screen now, and the first has gone off to the left
    expect(after.lastCellRight).toBeLessThanOrEqual(after.screen)
    expect(after.firstCellLeft).toBeLessThan(before.firstCellLeft - 100)
    // the name is still on screen, whole, and the steps pass under it rather than over it
    expect(after.nameLeft).toBeGreaterThanOrEqual(0)
    expect(after.nameRight).toBeLessThanOrEqual(after.screen)
    expect(after.nameRight - after.nameLeft).toBeGreaterThan(30)
    const nameOnTop = await page.evaluate((sel) => {
      const el = document.querySelector(sel)!
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return hit !== null && (hit === el || el.contains(hit))
    }, `${STEP_GRID} [data-seq-voice]`)
    expect(nameOnTop).toBe(true)
    // and the in-view bar has moved to its far end (it follows the scroll a frame later)
    await expect.poll(async () => (await inViewPart(page, STEP_GRID)).left).toBeGreaterThan(20)
    const part = await inViewPart(page, STEP_GRID)
    expect(Math.abs(part.left + part.width - part.whole)).toBeLessThan(2)

    // dragging back returns to step 1
    await dragRuler(page, ruler, 1200)
    const back = await facts(page, STEP_GRID, '[data-seq-voice]')
    expect(Math.round(back.firstCellLeft)).toBe(Math.round(before.firstCellLeft))
  })

  test('a drag across the steps still belongs to the grid: it does not scroll it', async ({ page }, testInfo) => {
    await openPattern(page, testInfo.project.name, 1)
    const before = await facts(page, STEP_GRID, '[data-seq-voice]')
    const row = await page.locator(`${STEP_GRID} [role="row"]`).nth(2).boundingBox()
    const y = row!.y + row!.height / 2
    await page.mouse.move(before.screen - 30, y)
    await page.mouse.down()
    for (let i = 1; i <= 6; i++) await page.mouse.move(before.screen - 30 - i * 25, y)
    await page.mouse.up()
    const after = await facts(page, STEP_GRID, '[data-seq-voice]')
    expect(Math.round(after.firstCellLeft)).toBe(Math.round(before.firstCellLeft))
  })

  test('the piano roll follows the same rule', async ({ page }, testInfo) => {
    await openPattern(page, testInfo.project.name, 3)
    await expect(page.locator(ROLL)).toBeVisible()
    const f = await facts(page, ROLL, '[data-roll-key]')
    expect(f.cells).toBe(16)
    expect(f.narrowest).toBeGreaterThanOrEqual(40)
    expect(f.lastCellRight).toBeGreaterThan(f.screen)
    await expect(page.locator(`${ROLL} [data-grid-in-view]`)).toHaveAttribute('data-more', 'true')

    const ruler = `${ROLL} [data-roll-ruler]`
    expect((await page.locator(ruler).boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await dragRuler(page, ruler, -1200)
    const after = await facts(page, ROLL, '[data-roll-key]')
    expect(after.lastCellRight).toBeLessThanOrEqual(after.screen)
    // the keys stay at the left edge
    expect(after.nameLeft).toBeGreaterThanOrEqual(0)
    expect(after.nameLeft).toBeLessThan(40)
  })

  test('a tap on a step writes what a click writes on a desktop', async ({ page }, testInfo) => {
    await openPattern(page, testInfo.project.name, 1)
    await page.locator(`${STEP_GRID} [role="row"]`).first().locator('[data-seq-cell]').nth(1).tap()
    await expect.poll(() => editorValue(page)).toBe(AFTER_KICK_2)
  })
})

test.describe('the step grid on a phone held sideways (#2006)', () => {
  test('every step is at least 40 px wide, and the bar scrolls only if 16 of them do not fit', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone-sideways', 'a phone held sideways only')
    await openPattern(page, testInfo.project.name, 1)
    await expect(page.locator(STEP_GRID)).toBeVisible()
    const f = await facts(page, STEP_GRID, '[data-seq-voice]')
    expect(f.cells).toBe(16)
    expect(f.narrowest).toBeGreaterThanOrEqual(40)
    // this screen is 863 px wide, which 16 steps at 40 px fit: nothing to scroll, no hint
    expect(f.lastCellRight).toBeLessThanOrEqual(f.screen)
    await expect(page.locator(`${STEP_GRID} [data-grid-in-view]`)).toHaveAttribute('data-more', 'false')
    await expect(page.locator(`${STEP_GRID} [data-grid-turn-hint]`)).toHaveCount(0)
  })
})

test.describe('the grids on a tablet (#2006)', () => {
  test("a tablet's grid is the desktop's, and a tap there writes the same text", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet', 'phones are covered above')
    await openPattern(page, testInfo.project.name, 1)
    await expect(page.locator(STEP_GRID)).toBeVisible()
    // the desktop's ruler: 12 px, with no in-view bar and no hint
    expect(Math.round((await page.locator(`${STEP_GRID} [data-seq-ruler]`).boundingBox())!.height)).toBe(12)
    await expect(page.locator(`${STEP_GRID} [data-grid-in-view]`)).toHaveCount(0)
    await expect(page.locator(`${STEP_GRID} [data-grid-turn-hint]`)).toHaveCount(0)
    // its steps are not held to the phone's floor: 16 of them share what the column has
    const f = await facts(page, STEP_GRID, '[data-seq-voice]')
    expect(f.cells).toBe(16)
    expect(f.narrowest).toBeLessThan(40)

    await page.locator(`${STEP_GRID} [role="row"]`).first().locator('[data-seq-cell]').nth(1).tap()
    await expect.poll(() => editorValue(page)).toBe(AFTER_KICK_2)
  })
})

test.describe('a step that holds several hits, on a phone held upright (#1861)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!['phone', 'iphone'].includes(testInfo.project.name), 'upright phones only')
  })

  // the kick and snare rows are four steps with `[~ bd]` holding two; the hat row is ONE
  // step holding eight, so its columns line up with the other rows only if every step,
  // grouped or not, is exactly as wide as its columns drawn one by one
  test('its columns are as wide as every other column, and every row stays in line', async ({ page }, testInfo) => {
    await openPattern(page, testInfo.project.name, 1, '$: s("bd [~ bd] sd ~, hh*8")\n')
    await expect(page.locator(STEP_GRID)).toBeVisible()
    const rows = await page.evaluate((gridSel) => {
      const root = document.querySelector(gridSel)!
      return [...root.querySelectorAll('[role="row"]')]
        .map((row) => ({
          grouped: row.querySelectorAll('[data-seq-step]').length,
          cells: [...row.querySelectorAll('[role="gridcell"]')]
            .map((c) => c.getBoundingClientRect())
            .map((r) => ({ left: r.left, right: r.right, width: r.width }))
            .sort((x, y) => x.left - y.left),
        }))
        .filter((r) => r.cells.length > 0)
    }, STEP_GRID)
    expect(rows.length).toBeGreaterThanOrEqual(3)
    // the case under test is on screen: rows drawn with grouped steps
    expect(rows.every((r) => r.grouped > 0)).toBe(true)
    for (const r of rows) {
      expect(r.cells.length).toBe(rows[0].cells.length)
      expect(Math.min(...r.cells.map((c) => c.width))).toBeGreaterThanOrEqual(40)
      // no column runs into the next one
      for (let i = 1; i < r.cells.length; i++) expect(r.cells[i].left).toBeGreaterThanOrEqual(r.cells[i - 1].right - 0.5)
    }
    // every row's columns fall on the first row's
    for (const r of rows.slice(1)) {
      r.cells.forEach((c, i) => expect(Math.abs(c.left - rows[0].cells[i].left)).toBeLessThan(1.5))
    }
  })
})
