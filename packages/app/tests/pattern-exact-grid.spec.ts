/**
 * Exact grid mode (#1855): each `,`-part drawn at its own steps.
 *
 * `<[bd ~ bd ~] [bd ~ ~ bd]>, ~ sd ~ sd, hh*8` writes the kick and snare in 4 steps a bar
 * and the hats in 8. LCM cuts every row to 8 cells a bar, so a snare step is 2 cells and
 * a click on an empty one would paint half of it — those 8 cells are locked (#1853). Exact
 * draws the snare as 4 boxes a bar, each 2 hat-cells wide, and a click fills a whole box.
 * It is a view: the text a click writes is what the part's own reading spells.
 *
 * WHY A BROWSER TEST. The unit tests pin the layout and the write; only the panel shows
 * that a box sits over exactly the columns it stands for, that the click on it writes the
 * whole step, and that the setting redraws a grid that is already open.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'

const KICK = '<[bd ~ bd ~] [bd ~ ~ bd]>'
const BEAT = `$: s("${KICK}, ~ sd ~ sd, hh*8")`

async function open(page: Page, code: string, gridMode?: 'exact' | 'lcm'): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 460 }, gridMode })
  await seedCode(page, code)
  const seq = page.locator('[data-bottom-panel-tab="sequencer"]')
  await expect(seq, `the sequencer must open for ${code}`).toHaveCount(1)
  return seq
}
const cell = (seq: Locator, label: string): Locator => seq.locator(`[data-seq-cell][aria-label="${label}"]`)

/** Settings › Pattern & Timeline › Grid, through the real modal (see grid-visual-identity) */
async function setGridMode(page: Page, mode: 'exact' | 'lcm'): Promise<string> {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByText('Editor Settings...').click()
  await page.getByTestId('settings-shell').waitFor({ timeout: 5000 })
  await page.getByTestId('settings-nav-pattern').click()
  const select = page.getByTestId('setting-gridMode')
  await select.waitFor({ timeout: 5000 })
  const before = await select.inputValue()
  await select.selectOption(mode)
  await page.getByTestId('settings-shell').getByRole('button', { name: 'Close', exact: true }).click()
  return before
}

test.describe('Exact grid mode (#1855)', () => {
  test('is the default: each part at its own steps, every written step editable', async ({ page }) => {
    const seq = await open(page, BEAT)
    // kick 2 bars × 4, snare 2 × 4, hats 2 × 8
    await expect(seq.locator('[data-seq-cell]')).toHaveCount(32)
    await expect(seq.locator('[data-seq-cell][data-seq-box-width="2"]')).toHaveCount(16)
    // every kick and snare box is a written step a click edits; the 16 hats are made by
    // `*8`, and a click on one of them is refused — it keeps its generator (#2292)
    await expect(seq.locator('[data-seq-cell-inert="true"]')).toHaveCount(16)
    await expect(seq.locator('[data-seq-cell-inert="true"][aria-label^="hh "]')).toHaveCount(16)
    await expect(cell(seq, 'sd step 2')).toHaveAttribute('aria-pressed', 'true')
    await expect(cell(seq, 'sd step 3')).toHaveAttribute('aria-pressed', 'false')

    // a snare box stands over exactly the two hat cells of its step
    const box = await cell(seq, 'sd step 2').boundingBox()
    const h3 = await cell(seq, 'hh step 3').boundingBox()
    const h4 = await cell(seq, 'hh step 4').boundingBox()
    expect(Math.abs(box!.x - h3!.x)).toBeLessThan(1)
    expect(Math.abs(box!.x + box!.width - (h4!.x + h4!.width))).toBeLessThan(1)
  })

  test('a click on an empty own step writes the step’s own text, in every bar it plays', async ({ page }) => {
    // `~ sd ~ sd` is written once and plays in both bars: its first `~` is one step of text,
    // and a click changes it everywhere it plays (the ruling of 2026-11-04, #2292)
    const seq = await open(page, BEAT)
    await cell(seq, 'sd step 1').click()
    await expect.poll(() => editorValue(page)).toBe(`$: s("${KICK}, sd sd ~ sd, hh*8")`)
    await expect(cell(seq, 'sd step 1')).toHaveAttribute('aria-pressed', 'true')
    await expect(cell(seq, 'sd step 5')).toHaveAttribute('aria-pressed', 'true')
    // and off again: the pattern as it was
    await cell(seq, 'sd step 1').click()
    await expect.poll(() => editorValue(page)).toBe(BEAT)
  })

  test('a kick box: the step LCM locked', async ({ page }) => {
    const seq = await open(page, BEAT)
    await cell(seq, 'bd step 2').click()
    await expect.poll(() => editorValue(page)).toBe('$: s("<[bd bd bd ~] [bd ~ ~ bd]>, ~ sd ~ sd, hh*8")')
  })

  test('rows that do not nest: bd*3 against hh*4 draws 3 and 4', async ({ page }) => {
    const seq = await open(page, '$: s("bd*3, hh*4")')
    await expect(seq.locator('[data-seq-cell][aria-label^="bd "]')).toHaveCount(3)
    await expect(seq.locator('[data-seq-cell][aria-label^="hh "]')).toHaveCount(4)
    // the kicks are made by `*3`: a click on one is refused and says why (#2292)
    await expect(cell(seq, 'bd step 2')).toHaveAttribute('aria-disabled', 'true')
    await expect(cell(seq, 'bd step 2')).toHaveAttribute('title', /operator on its step/)
    await cell(seq, 'bd step 2').click({ force: true })
    await page.waitForTimeout(150)
    expect(await editorValue(page)).toBe('$: s("bd*3, hh*4")')
  })

  test('keys step over a whole box and act on it', async ({ page }) => {
    const seq = await open(page, BEAT)
    await cell(seq, 'sd step 1').focus()
    await page.keyboard.press('ArrowRight')
    await expect(seq.locator('[role="gridcell"][aria-selected="true"] > [data-seq-cell]')).toHaveAttribute(
      'aria-label',
      'sd step 2',
    )
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect.poll(() => editorValue(page)).toBe(`$: s("${KICK}, ~ sd sd sd, hh*8")`)
  })

  test('the setting redraws an open grid, both ways', async ({ page }) => {
    const seq = await open(page, BEAT)
    await expect(seq.locator('[data-seq-cell]')).toHaveCount(32)
    expect(await setGridMode(page, 'lcm')).toBe('exact')
    await expect(seq.locator('[data-seq-cell]')).toHaveCount(48)
    // LCM: the 16 hats. The second column of each kick and snare step (16) was refused
    // too; since #2293 a click there splits the step
    await expect(seq.locator('[data-seq-cell-inert="true"]')).toHaveCount(16)
    expect(await setGridMode(page, 'exact')).toBe('lcm')
    await expect(seq.locator('[data-seq-cell]')).toHaveCount(32)
    await expect(seq.locator('[data-seq-cell-inert="true"]')).toHaveCount(16)
  })

  // ── PART 2: the other gestures move by the box the row draws ──────────────────────

  test('the length handle is offered on an own step and drags by whole steps', async ({ page }) => {
    // the snare is 2 hat-cells long; one column longer or shorter is half a step, which the
    // writer declines both ways — asked by columns, the handle was never drawn
    const seq = await open(page, '$: s("~ sd ~ ~, hh*8")')
    const handle = seq.locator('[data-seq-resize="0:2"]')
    await expect(handle).toHaveCount(1)
    const h = await handle.boundingBox()
    const t = await cell(seq, 'sd step 3').boundingBox()
    await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2)
    await page.mouse.down()
    await page.mouse.move(t!.x + t!.width / 2, t!.y + t!.height / 2, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => editorValue(page)).toBe('$: s("~ sd _ ~, hh*8")')
  })

  test('⌥⇧→ / ⌥⇧← lengthen and shorten by one own step', async ({ page }) => {
    const seq = await open(page, '$: s("~ sd ~ ~, hh*8")')
    await cell(seq, 'sd step 2').focus()
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await expect.poll(() => editorValue(page)).toBe('$: s("~ sd _ ~, hh*8")')
    await page.keyboard.press('Alt+Shift+ArrowLeft')
    await expect.poll(() => editorValue(page)).toBe('$: s("~ sd ~ ~, hh*8")')
  })

  test('↓ lands on the step playing when the box starts, also after ←', async ({ page }) => {
    const seq = await open(page, '$: s("~ sd ~ sd, hh*8")')
    const selected = seq.locator('[role="gridcell"][aria-selected="true"] > [data-seq-cell]')
    await cell(seq, 'sd step 2').focus()
    await page.keyboard.press('ArrowLeft')
    await expect(selected).toHaveAttribute('aria-label', 'sd step 1')
    await page.keyboard.press('ArrowDown')
    await expect(selected).toHaveAttribute('aria-label', 'hh step 1')
    // ↑/↓ keep the moment: from the second snare step, down is the hat box playing then,
    // and up from it is that snare step again
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowRight')
    await expect(selected).toHaveAttribute('aria-label', 'sd step 2')
    await page.keyboard.press('ArrowDown')
    await expect(selected).toHaveAttribute('aria-label', 'hh step 3')
    await page.keyboard.press('ArrowUp')
    await expect(selected).toHaveAttribute('aria-label', 'sd step 2')
    // the hats are ONE written step, `hh*8`: → walks steps (#2293), so there is no step after it
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowRight')
    await expect(selected).toHaveAttribute('aria-label', 'hh step 3')
  })

  test('a paint drag fills every own step it crosses, one step each', async ({ page }) => {
    const seq = await open(page, '$: s("~ sd ~ ~, hh*8")')
    const a = await cell(seq, 'sd step 1').boundingBox()
    const b = await cell(seq, 'sd step 3').boundingBox()
    await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2)
    await page.mouse.down()
    await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => editorValue(page)).toBe('$: s("sd sd sd ~, hh*8")')
  })

  test('in LCM too the length moves by the note’s own step (#2293)', async ({ page }) => {
    // the length is the step writer's now: a unit of the note's own group, whatever the
    // grid draws. In LCM a column is half the snare's step, and the handle and the key
    // still move it a whole step — they used to be declined there
    const seq = await open(page, '$: s("~ sd ~ ~, hh*8")', 'lcm')
    await expect(seq.locator('[data-seq-resize="0:2"]')).toHaveCount(1)
    await cell(seq, 'sd step 3').focus()
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await expect.poll(() => editorValue(page)).toBe('$: s("~ sd _ ~, hh*8")')
  })

  test('CONTROL: LCM draws the same and writes the same step text', async ({ page }) => {
    const seq = await open(page, BEAT, 'lcm')
    await expect(seq.locator('[data-seq-cell]')).toHaveCount(48)
    // the 16 hats; a step's second column splits it since #2293
    await expect(seq.locator('[data-seq-cell-inert="true"]')).toHaveCount(16)
    // the last snare of bar 2 is the same written `sd` as bar 1's: both go (#2292)
    await cell(seq, 'sd step 15').click()
    await expect.poll(() => editorValue(page)).toBe(`$: s("${KICK}, ~ sd ~ ~, hh*8")`)
  })

  test('CONTROL: a pattern whose parts share one grid looks the same in both modes', async ({ page }) => {
    const seq = await open(page, '$: s("bd [~ bd] sd ~, hh*8")')
    await expect(seq.locator('[data-seq-cell]')).toHaveCount(24)
    await expect(seq.locator('[data-seq-box-width]')).toHaveCount(0)
  })
})
