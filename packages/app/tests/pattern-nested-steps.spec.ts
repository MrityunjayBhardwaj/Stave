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
import { bootApp, seedCode, editorValue } from './_appBoot'

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
  test('each row as the text writes it: plain steps, a step holding two, hh*8 as one step', async ({ page }) => {
    const seq = await open(page, BEAT)
    // kick: bd | [~ bd] | sd | ~  — the same four steps in the snare row (one part)
    await expect(stepOf(seq, '0:0')).toHaveAttribute('data-seq-step', 'plain')
    await expect(stepOf(seq, '0:2')).toHaveAttribute('data-seq-step', 'holds')
    await expect(stepOf(seq, '0:4')).toHaveAttribute('data-seq-step', 'plain')
    await expect(stepOf(seq, '1:2')).toHaveAttribute('data-seq-step', 'holds')
    // the 8 hats are one written step
    await expect(stepOf(seq, '2:0').locator('[data-seq-cell]')).toHaveCount(8)
    await expect(stepOf(seq, '2:0')).toHaveAttribute('data-seq-step', 'holds')
    await expect(seq.locator('[data-seq-step="holds"]')).toHaveCount(3)
    await expect(seq.locator('[data-seq-step="plain"]')).toHaveCount(6)
    // every cell is still drawn: 8 columns × 3 rows
    await expect(seq.locator('[data-seq-cell]')).toHaveCount(24)

    // the small boxes inside a step that holds several are smaller than a plain step's box
    const inner = await cell(seq, '0:2').boundingBox()
    const plain = await cell(seq, '0:0').boundingBox()
    expect(inner!.height).toBeLessThan(plain!.height - 4)
  })

  test('a grouped step keeps the columns: its edges fall on the hat cells', async ({ page }) => {
    const seq = await open(page, BEAT)
    for (const [kick, from, to] of [
      ['0:0', '2:0', '2:1'],
      ['0:2', '2:2', '2:3'],
      ['0:4', '2:4', '2:5'],
    ] as const) {
      const step = await stepOf(seq, kick).boundingBox()
      const a = await cell(seq, from).boundingBox()
      const b = await cell(seq, to).boundingBox()
      expect(Math.abs(step!.x - a!.x), `${kick} left edge`).toBeLessThan(1.5)
      expect(Math.abs(step!.x + step!.width - (b!.x + b!.width)), `${kick} right edge`).toBeLessThan(1.5)
    }
  })

  test('a click inside a step writes what it always wrote', async ({ page }) => {
    const seq = await open(page, BEAT)
    // the rest inside [~ bd]
    await cell(seq, '0:2').click()
    await expect.poll(() => editorValue(page)).toBe('$: s("bd [bd bd] sd ~, hh*8")')
    await cell(seq, '0:2').click()
    await expect.poll(() => editorValue(page)).toBe(BEAT)
    // a hat inside the one hh*8 step
    await cell(seq, '2:3').click()
    await expect.poll(() => editorValue(page)).toBe('$: s("bd [~ bd] sd ~, [hh hh hh ~ hh hh hh hh]")')
  })

  test('a click on a faint half of a plain step splits it, as the column did', async ({ page }) => {
    const seq = await open(page, BEAT)
    await expect(cell(seq, '0:1')).toHaveAttribute('aria-label', 'bd step 2, held from step 1')
    await cell(seq, '0:1').click()
    await expect.poll(() => editorValue(page)).toBe('$: s("[bd bd] [~ bd] sd ~, hh*8")')
  })

  test('the playing column of a plain step is still marked', async ({ page }) => {
    // a plain step's columns draw no border, which is how every other cell shows it is playing
    const seq = await open(page, '$: s("bd hh*2 sd cp")')
    await page.evaluate(() => {
      const eds = (window as unknown as { monaco: { editor: { getEditors: () => { getModel: () => { getValue: () => string } | null; focus: () => void }[] } } }).monaco.editor.getEditors()
      ;(eds.find((e) => e.getModel()?.getValue().includes('hh*2')) ?? eds[0]).focus()
    })
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Enter`)
    await expect(
      seq.locator('[data-seq-step="plain"] [data-seq-cell][data-playing="true"] [data-seq-playing-frame]').first(),
    ).toBeVisible({ timeout: 8000 })
  })

  test('the keyboard cursor inside a step is not clipped by the step', async ({ page }) => {
    // the focus ring is drawn just outside a cell; a clipping step hid it on a filled column
    const seq = await open(page, BEAT)
    await cell(seq, '0:0').focus()
    await page.keyboard.press('ArrowRight')
    await expect(cell(seq, '0:1')).toBeFocused()
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
