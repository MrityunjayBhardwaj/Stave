/**
 * Exact grid (#1861): a written step that holds several hits is drawn as ONE step with its
 * hits inside; a plain step that a sibling cuts into columns is one box with faint halves.
 *
 * `bd [~ bd] sd ~, hh*8`: the kick/snare part writes 4 steps over 8 columns, and the second
 * one (`[~ bd]`) holds a rest and a kick; `hh*8` is ONE written step holding 8 hits. It is a
 * drawing: the columns, what a click writes, and LCM are unchanged.
 *
 * WHY A BROWSER TEST. The unit tests pin which steps group and how; only the panel shows the
 * outline and the small boxes, that a grouped step still lines up with the other rows'
 * columns, and that a click inside one lands where it always did.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue, pinLcmGrid } from './_appBoot'


pinLcmGrid(test)
const BEAT = '$: s("bd [~ bd] sd ~, hh*8")'

async function open(page: Page, code: string, gridMode?: 'exact' | 'lcm'): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 460 }, gridMode })
  await seedCode(page, code)
  const seq = page.locator('[data-bottom-panel-tab="sequencer"]')
  await expect(seq, `the sequencer must open for ${code}`).toHaveCount(1)
  await expect(seq.locator('[data-seq-cell]').first()).toBeVisible()
  return seq
}
const cell = (seq: Locator, key: string): Locator => seq.locator(`[data-seq-cell="${key}"]`)
/** the step a cell is drawn inside, or nothing when it is drawn on its own */
const stepOf = (seq: Locator, key: string): Locator => seq.locator(`[data-seq-step]:has([data-seq-cell="${key}"])`)

test.describe('nested steps in Exact (#1861)', () => {


  test('a click inside a step writes that step’s own text (LCM grid)', async ({ page }) => {
    const seq = await open(page, BEAT)
    // the rest inside [~ bd]
    await cell(seq, '0:2').click()
    await expect.poll(() => editorValue(page)).toBe('$: s("bd [bd bd] sd ~, hh*8")')
    await cell(seq, '0:2').click()
    await expect.poll(() => editorValue(page)).toBe(BEAT)
    // a hat inside the one hh*8 step is edited on its own: the step written out (#2326)
    await cell(seq, '2:3').click()
    await expect.poll(() => editorValue(page)).toBe('$: s("bd [~ bd] sd ~, [hh hh hh ~ hh hh hh hh]")')
  })

  test('a faint half of a plain step is not a step: a click there splits the step (#2293) (LCM grid)', async ({ page }) => {
    const seq = await open(page, BEAT)
    await expect(cell(seq, '0:1')).toHaveAttribute('aria-label', 'bd step 2, held from step 1')
    await expect(cell(seq, '0:1')).toHaveAttribute('title', /Splits this step/)
    await cell(seq, '0:1').click()
    // two equal hits of one sound are written `bd*2` (#2326)
    await expect.poll(() => editorValue(page)).toBe('$: s("bd*2 [~ bd] sd ~, hh*8")')
  })


  test('the keyboard cursor inside a step is not clipped by the step (LCM grid)', async ({ page }) => {
    // the focus ring is drawn just outside a cell; a clipping step hid it on a filled column
    const seq = await open(page, BEAT)
    await cell(seq, '0:0').focus()
    // the next step (#2293 → walks steps) is the rest inside `[~ bd]`, a cell inside a step
    await page.keyboard.press('ArrowRight')
    await expect(cell(seq, '0:2')).toBeFocused()
    const clipped = await seq.locator('[data-seq-step]').evaluateAll((els) =>
      els.filter((e) => getComputedStyle(e).overflow !== 'visible').length,
    )
    expect(clipped).toBe(0)
  })

  test('CONTROL: LCM draws every column on its own, as before', async ({ page }) => {
    const seq = await open(page, BEAT, 'lcm')
    await expect(seq.locator('[data-seq-step="holds"], [data-seq-step="plain"]')).toHaveCount(0)
    await expect(seq.locator('[data-seq-cell]')).toHaveCount(24)
  })

  test('CONTROL: one column per written step is drawn exactly as before', async ({ page }) => {
    const seq = await open(page, '$: s("bd sd hh cp")')
    await expect(seq.locator('[data-seq-step="holds"], [data-seq-step="plain"]')).toHaveCount(0)
  })
})
