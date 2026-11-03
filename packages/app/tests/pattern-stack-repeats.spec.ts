/**
 * A `,`-pattern whose parts are written over different numbers of bars (#1849).
 *
 * `<[bd ~ bd ~] [bd ~ ~ bd]>, ~ sd ~ sd, hh*8` plays two bars: the kick is written over
 * two, the snare and hats over one and played again in bar 2. The step grid used to read
 * it leaf by leaf and lock 44 of its 48 cells; every bar is now drawn as its own.
 *
 * WHAT A CLICK WRITES (#2292, the ruling of 2026-11-04): the clicked step's own text. The
 * snare is written once and plays in both bars, so a click on it in bar 2 changes it in
 * bar 1 too — the text says one thing for both. The kick is written per bar, so a click
 * in bar 2 changes bar 2 only. The hats are made by `*8`, and a click on one is refused.
 *
 * WHY A BROWSER TEST. The unit tests pin the writer; only the panel can show that the
 * grid on screen agrees with the text after the click — so every click here is followed
 * by a look at the OTHER bar, not only the cell that was clicked.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'

const KICK = '<[bd ~ bd ~] [bd ~ ~ bd]>'
const BEAT = `$: s("${KICK}, ~ sd ~ sd, hh*8")`

async function open(page: Page, code: string): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 460 }, gridMode: 'lcm' })
  await seedCode(page, code)
  const seq = page.locator('[data-bottom-panel-tab="sequencer"]')
  await expect(seq, `the sequencer must open for ${code}`).toHaveCount(1)
  return seq
}
const cell = (seq: Locator, label: string): Locator => seq.locator(`[data-seq-cell][aria-label="${label}"]`)

test.describe('a comma pattern with a `<…>` part (#1849)', () => {
  test('opens editable, every bar drawn alike', async ({ page }) => {
    const seq = await open(page, BEAT)
    // 48 cells; refused: the 16 hats (made by `*8`) and the second column of every kick
    // and snare step (16), which is part of a longer step, not a step
    await expect(seq.locator('[data-seq-cell]')).toHaveCount(48)
    await expect(seq.locator('[data-seq-cell-inert="true"]')).toHaveCount(32)
    await expect(cell(seq, 'sd step 15')).toHaveAttribute('aria-pressed', 'true')
    await expect(cell(seq, 'sd step 15')).not.toHaveAttribute('title', /.*/)
  })

  test('a click on the snare in bar 2 changes the written snare, in both bars', async ({ page }) => {
    const seq = await open(page, BEAT)
    await cell(seq, 'sd step 15').click()
    await expect.poll(() => editorValue(page)).toBe(`$: s("${KICK}, ~ sd ~ ~, hh*8")`)
    await expect(cell(seq, 'sd step 15')).toHaveAttribute('aria-pressed', 'false')
    // bar 1 is the same text: on screen as in the text
    await expect(cell(seq, 'sd step 7')).toHaveAttribute('aria-pressed', 'false')
    await expect(cell(seq, 'sd step 11')).toHaveAttribute('aria-pressed', 'true')
    // and a second click puts it back
    await cell(seq, 'sd step 15').click()
    await expect.poll(() => editorValue(page)).toBe(BEAT)
  })

  test('a hat made by `*8` is refused, in either bar', async ({ page }) => {
    const seq = await open(page, BEAT)
    await expect(cell(seq, 'hh step 12')).toHaveAttribute('aria-disabled', 'true')
    await expect(cell(seq, 'hh step 12')).toHaveAttribute('title', /operator on its step/)
    await cell(seq, 'hh step 12').click({ force: true })
    await page.waitForTimeout(150)
    expect(await editorValue(page)).toBe(BEAT)
  })

  test('an edit to the part written over two bars changes that bar only', async ({ page }) => {
    const seq = await open(page, BEAT)
    await cell(seq, 'bd step 11').click()
    await expect.poll(() => editorValue(page)).toBe('$: s("<[bd ~ bd ~] [bd bd ~ bd]>, ~ sd ~ sd, hh*8")')
    await expect(cell(seq, 'bd step 11')).toHaveAttribute('aria-pressed', 'true')
    await expect(cell(seq, 'bd step 3')).toHaveAttribute('aria-pressed', 'true')
    await expect(cell(seq, 'bd step 7')).toHaveAttribute('aria-pressed', 'false')
  })

  test('CONTROL: a comma pattern that plays one bar is edited as before', async ({ page }) => {
    const seq = await open(page, '$: s("bd sd, hh*4")')
    await expect(seq.locator('[data-seq-cell]')).toHaveCount(12)
    await cell(seq, 'sd step 1').click()
    await expect.poll(() => editorValue(page)).toBe('$: s("[bd,sd] sd, hh*4")')
  })
})
