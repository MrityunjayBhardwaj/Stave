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
import { bootApp, seedCode, editorValue, pinLcmGrid } from './_appBoot'


pinLcmGrid(test)
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
    // the kicks are made by `*3`: a click on one edits that kick alone, written out (#2326)
    await cell(seq, 'bd step 2').click()
    await expect.poll(() => editorValue(page)).toBe('$: s("[bd ~ bd], hh*4")')
  })


  test('the setting redraws an open grid, both ways', async ({ page }) => {
    const seq = await open(page, BEAT)
    await expect(seq.locator('[data-seq-cell]')).toHaveCount(32)
    expect(await setGridMode(page, 'lcm')).toBe('exact')
    await expect(seq.locator('[data-seq-cell]')).toHaveCount(48)
    // LCM: no inert box. The second column of each kick and snare step splits it (#2293);
    // the 16 hats are each edited on their own (#2326)
    await expect(seq.locator('[data-seq-cell-inert="true"]')).toHaveCount(0)
    expect(await setGridMode(page, 'exact')).toBe('lcm')
    await expect(seq.locator('[data-seq-cell]')).toHaveCount(32)
    await expect(seq.locator('[data-seq-cell-inert="true"]')).toHaveCount(0)
  })

  // ── PART 2: the other gestures move by the box the row draws ──────────────────────


  test('⌥⇧→ / ⌥⇧← lengthen and shorten by one own step', async ({ page }) => {
    const seq = await open(page, '$: s("~ sd ~ ~, hh*8")')
    await cell(seq, 'sd step 2').focus()
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await expect.poll(() => editorValue(page)).toBe('$: s("~ sd@2 ~, hh*8")') // a length is `@n` (#2326)
    await page.keyboard.press('Alt+Shift+ArrowLeft')
    await expect.poll(() => editorValue(page)).toBe('$: s("~ sd ~ ~, hh*8")')
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
    await expect.poll(() => editorValue(page)).toBe('$: s("~ sd@2 ~, hh*8")') // a length is `@n` (#2326)
  })

  test('CONTROL: LCM draws the same and writes the same step text', async ({ page }) => {
    const seq = await open(page, BEAT, 'lcm')
    await expect(seq.locator('[data-seq-cell]')).toHaveCount(48)
    // none: a step's second column splits it (#2293), and each hat is edited on its own (#2326)
    await expect(seq.locator('[data-seq-cell-inert="true"]')).toHaveCount(0)
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
