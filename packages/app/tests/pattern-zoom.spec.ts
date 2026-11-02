/**
 * The step grid's zoom (#2277, #2276): the pattern divides the bar, and zooming in opens
 * each level.
 *
 * At 1× a grid that fits the panel draws as it always has, and one that did not now fits:
 * its columns are squeezed, and a step too narrow to open draws what it holds as small
 * boxes. Zooming in widens every column; a step whose inner steps are wide enough opens
 * into them, with its own outline, and the ruler gains their names (`1.2.2`).
 *
 * WHY A BROWSER TEST. The unit tests pin which steps exist and which open at a width; only
 * the panel measures its own width, takes the wheel, and shows that a click on a step is
 * the same click whether the step is open or not.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'

async function open(page: Page, code: string): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 460 } })
  // the dev server's badge sits over the panel's corner
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await seedCode(page, code)
  const seq = page.locator('[data-bottom-panel-tab="sequencer"]')
  await expect(seq, `the sequencer must open for ${code}`).toHaveCount(1)
  await expect(seq.locator('[data-seq-cell]').first()).toBeVisible()
  return seq
}

const labels = (seq: Locator): Promise<string[]> =>
  seq.locator('[data-seq-ruler-label]').evaluateAll((els) => els.map((e) => e.textContent ?? ''))

const NESTED = '$: s("bd [hh [hh hh]] sd [~ cp]")'

test.describe('zoom opens a level (#2277)', () => {
  test('1× keeps every step closed; zooming in opens the levels the text writes, and the ruler names them', async ({ page }) => {
    const seq = await open(page, NESTED)
    await expect(seq.locator('[data-grid-zoom-level]')).toHaveText('1×')
    expect(await labels(seq)).toEqual(['1', '1.2', '1.3', '1.4'])
    await expect(seq.locator('[data-seq-step="open"]')).toHaveCount(0)

    await seq.locator('[data-grid-zoom-in]').click()
    await expect(seq.locator('[data-grid-zoom-level]')).toHaveText('1.5×')
    await expect.poll(() => labels(seq)).toEqual(['1', '1.2', '1.2.2', '1.2.2.2', '1.3', '1.4', '1.4.2'])
    // 1.2 and 1.2.2 and 1.4 open, in each of the four rows
    await expect(seq.locator('[data-seq-step="open"]')).toHaveCount(12)
    await expect(seq.locator('[data-seq-step="open"][data-seq-depth="2"]')).toHaveCount(4)

    await seq.locator('[data-grid-zoom-out]').click()
    await expect.poll(() => labels(seq)).toEqual(['1', '1.2', '1.3', '1.4'])
    await expect(seq.locator('[data-seq-step="open"]')).toHaveCount(0)
  })

  test('⌘/Ctrl + scroll over the grid zooms', async ({ page }) => {
    const seq = await open(page, NESTED)
    const box = (await seq.locator('[data-seq-cell="0:0"]').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -100)
    await page.keyboard.up('Control')
    await expect(seq.locator('[data-grid-zoom-level]')).toHaveText('1.5×')
    const wider = (await seq.locator('[data-seq-cell="0:0"]').boundingBox())!
    expect(wider.width).toBeGreaterThan(box.width * 1.2)
  })

  test('a crowded bar fits the panel at 1×, and scrolls once zoomed in', async ({ page }) => {
    // 60 columns: at 16 px a column this ran off the panel's edge
    const seq = await open(page, '$: s("hh [hh hh hh] hh [hh hh hh hh hh], bd*4")')
    const overflow = (): Promise<number> => seq.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(await overflow()).toBeLessThanOrEqual(1)
    await seq.locator('[data-grid-zoom-in]').click()
    await seq.locator('[data-grid-zoom-in]').click()
    await expect.poll(overflow).toBeGreaterThan(100)
  })

  test('a click on a step is the same edit whether the step it sits in is open or not', async ({ page }) => {
    const code = '$: s("bd [hh [hh hh]] sd [~ cp]")'
    // the snare row's cell inside `[hh hh]`, at 1× a small box in a closed step
    const target = '2:6'
    let seq = await open(page, code)
    await expect(seq.locator(`[data-seq-step="holds"]:has([data-seq-cell="${target}"])`)).toHaveCount(1)
    await seq.locator(`[data-seq-cell="${target}"]`).click()
    await expect.poll(() => editorValue(page)).not.toBe(code)
    const closed = await editorValue(page)

    seq = await open(page, code)
    await seq.locator('[data-grid-zoom-in]').click()
    await expect(seq.locator(`[data-seq-step="open"]:has([data-seq-cell="${target}"])`).first()).toBeVisible()
    await seq.locator(`[data-seq-cell="${target}"]`).click()
    await expect.poll(() => editorValue(page)).not.toBe(code)
    expect(await editorValue(page)).toBe(closed)
  })
})
