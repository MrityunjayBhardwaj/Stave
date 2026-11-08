import { test, expect, type Page, type Locator } from '@playwright/test'
import { bootApp, seedCode, editorValue, pinLcmGrid } from './_appBoot'
import { expectNoRefusalReported } from './_console'


pinLcmGrid(test)
/**
 * #1827 — each bar of a pattern is drawn at its own step count.
 *   `<[c3 e3 g3] [c3 e3 g3 b3]>` used to open as 24 columns (both bars at 12), and
 *   bars of 8 and 7 did not open at all. Now a bar of 3 shows 3 cells, a bar of 4 shows
 *   4, and the two bars are the same width, because each is one cycle.
 * Driven with the real mouse. What each write PLAYS is checked against Strudel in
 * `perBar.test.ts`; here the question is what the user sees and what lands in the
 * document.
 */

const ROLL = '[data-bottom-panel-tab="piano-roll"]'
const SEQ = '[data-bottom-panel-tab="sequencer"]'
const EIGHT = 'c3 d3 e3 f3 g3 a3 b3 c4'
const SEVEN = 'c3 d3 e3 f3 g3 a3 b3'

async function open(page: Page, code: string, tab: string, first: string): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 520 } })
  await seedCode(page, code)
  const panel = page.locator(tab)
  await expect(panel.locator(first)).toBeVisible({ timeout: 10_000 })
  return panel
}

/** the x-extent of each cell in one row, in drawn order */
async function row(panel: Locator, selector: string): Promise<{ x: number; w: number }[]> {
  return panel.locator(selector).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect()
      return { x: r.x, w: r.width }
    }),
  )
}

/** how wide a run of cells is on screen, first cell's left edge to last cell's right */
const span = (cells: { x: number; w: number }[]): number =>
  cells[cells.length - 1].x + cells[cells.length - 1].w - cells[0].x

test.describe('piano roll', () => {
  test('a bar of 3 and a bar of 4 draw 3 and 4 cells, the same width, and edit where clicked', async ({ page }) => {
    const code = '$: note("<[c3 e3 g3] [c3 e3 g3 b3]>")'
    const roll = await open(page, code, ROLL, '[data-roll-cell="48:0"]')
    const cells = await row(roll, '[data-roll-cell^="48:"]')
    expect(cells).toHaveLength(7)
    // each bar is one cycle, so each is drawn the same width (within a few px of gaps)
    expect(Math.abs(span(cells.slice(0, 3)) - span(cells.slice(3)))).toBeLessThan(4)
    // a cell in the bar of 3 is wider than one in the bar of 4
    expect(cells[0].w).toBeGreaterThan(cells[3].w + 5)
    // bar 2's last note, then a new one on bar 2's third cell: spelled at four steps
    await roll.locator('[data-roll-cell="59:6"]').click() // b3 off
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe('$: note("<[c3 e3 g3] [c3 e3 g3 ~]>")')
    await roll.locator('[data-roll-cell="57:6"]').click() // a3 on
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe('$: note("<[c3 e3 g3] [c3 e3 g3 a3]>")')
    // each gesture is one undo step
    await roll.locator('[data-roll-cell="48:0"]').focus()
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(code)
    await expectNoRefusalReported(page)
  })

  test('a bar of 8 and a bar of 7 opens (it used to be refused) and edits its second bar', async ({ page }) => {
    const roll = await open(page, `$: note("<[${EIGHT}] [${SEVEN}]>")`, ROLL, '[data-roll-cell="48:0"]')
    expect(await row(roll, '[data-roll-cell^="48:"]')).toHaveLength(15)
    await roll.locator('[data-roll-cell="48:8"]').click() // bar 2's c3 off
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(
      `$: note("<[${EIGHT}] [~ d3 e3 f3 g3 a3 b3]>")`,
    )
    await expectNoRefusalReported(page)
  })

  test('the + adds a bar that continues the pattern at its own count', async ({ page }) => {
    const roll = await open(page, '$: note("<[c3 e3 g3] [c3 e3 g3 b3]>")', ROLL, '[data-roll-cell="48:0"]')
    await roll.locator('[data-extend-handle]').click()
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(
      '$: note("<[c3 e3 g3] [c3 e3 g3 b3] [c3 e3 g3]>")',
    )
    // 3 + 4 + 3 cells
    await expect.poll(async () => (await row(roll, '[data-roll-cell^="48:"]')).length).toBe(10)
    await expectNoRefusalReported(page)
  })
})

test.describe('step sequencer', () => {
  test('a bar of 3 and a bar of 4, and a hit added to the first is spelled at 3 steps (LCM grid)', async ({ page }) => {
    const seq = await open(page, '$: s("<[bd sd hh] [bd sd hh oh]>")', SEQ, '[data-seq-cell="0:0"]')
    const cells = await row(seq, '[data-seq-cell^="0:"]')
    expect(cells).toHaveLength(7)
    expect(Math.abs(span(cells.slice(0, 3)) - span(cells.slice(3)))).toBeLessThan(4)
    // hi-hat lane (row 2), bar 1's first cell
    await seq.locator('[data-seq-cell="2:0"]').click()
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe('$: s("<[[bd,hh] sd hh] [bd sd hh oh]>")')
    await expectNoRefusalReported(page)
  })
})
