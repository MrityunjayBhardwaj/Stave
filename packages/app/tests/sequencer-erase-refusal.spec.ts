/**
 * Removing a hit the grid draws more than once from ONE written note (#1836, #2292).
 *
 * #1836 made the panel say so when an erase was refused — and these were the erases it
 * refused: a hit whose written note plays in more than one box of the view (`bd` outside
 * every `< >` over two bars, `sd` in `[- sd]*2`), which the leaf writer could not remove
 * from one box without respelling the pattern.
 *
 * THE RULING OF 2026-11-04 (#2292) REVERSES THAT: a click edits the WRITTEN step, every
 * place it plays. So erasing one of those boxes erases the written note, and every box it
 * draws goes with it — one small edit at the note's own text. This file now pins that: the
 * code read back, and that EVERY copy of the hit is gone from the grid, not only the box
 * that was clicked.
 *
 * WHY A BROWSER TEST. The writer and its corpus sweep are pinned in the editor's unit
 * tests; only the panel shows that every lit cell is offered, that the click reaches the
 * writer, and that the grid redraws BOTH copies from what was written.
 *
 * ⚠ EACH ARM HAS A TWIN: a hit written once and drawn once, erased the same way, so
 * "both copies went" cannot be satisfied by a grid that clears whole rows.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'
import { expectNoRefusalReported } from './_console'

/** Two bars (the `< >` entries). The third `bd` sits outside every `< >`: one note, drawn in both bars. */
const TWO_BARS = '$: s("<bd [~ bd]>@2 hh@2 bd <bd ~> [hh bd] [~ hh]")'
/** that `bd`'s box in bar 1 — a box #1836 refused */
const TWICE = '0:8'
/** the written `bd`, erased: its own text and nothing else */
const TWO_BARS_ERASED = '$: s("<bd [~ bd]>@2 hh@2 ~ <bd ~> [hh bd] [~ hh]")'
/** the first `bd` is inside `< >`, one bar's own note — drawn once */
const TWO_BARS_ONCE_AFTER = '$: s("<~ [~ bd]>@2 hh@2 bd <bd ~> [hh bd] [~ hh]")'

/** One bar: the `sd` of `[- sd]*2` is one written note drawn as two hits. */
const ONE_BAR = '$: s("[bd - [- bd] -], <[- sd]*2>")'
const ONE_BAR_NO_SD = '$: s("[bd - [- bd] -], <[- ~]*2>")'

async function openSequencer(page: Page, code: string) {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 520 } })
  await seedCode(page, code)
  const grid = page.locator('[data-bottom-panel-tab="sequencer"]')
  await expect(grid, `the sequencer must open for ${code}`).toHaveCount(1)
  return grid
}

/** The lit cells of the open grid, by key, and which of them are marked inert. */
async function litKeys(page: Page): Promise<{ key: string; row: string; inert: boolean }[]> {
  return page
    .locator('[data-bottom-panel-tab="sequencer"] [data-seq-cell][aria-pressed="true"]')
    .evaluateAll((els) =>
      els.map((e) => ({
        key: e.getAttribute('data-seq-cell')!,
        row: e.getAttribute('aria-label')?.split(' ')[0] ?? '',
        inert: e.getAttribute('aria-disabled') === 'true',
      })),
    )
}

/** the lit cells of the row that draws `sound` */
async function litOf(page: Page, sound: string): Promise<string[]> {
  return (await litKeys(page)).filter((c) => c.row === sound).map((c) => c.key)
}

test.describe('a hit drawn twice from one written note: the click erases the note, every copy (#2292)', () => {
  test('two bars: every lit cell is offered', async ({ page }) => {
    await openSequencer(page, TWO_BARS)
    const lit = await litKeys(page)
    expect(lit.length, 'the fixture draws 13 hits').toBe(13)
    expect(lit.filter((c) => c.inert).map((c) => c.key), 'no lit cell is refused').toEqual([])
  })

  test('two bars: erasing the third `bd` in bar 1 writes `~`, and bar 2’s copy goes too', async ({ page }) => {
    const grid = await openSequencer(page, TWO_BARS)
    const before = (await litKeys(page)).map((c) => c.key)
    await grid.locator(`[data-seq-cell="${TWICE}"]`).click()
    await expect.poll(() => editorValue(page)).toBe(TWO_BARS_ERASED)
    // exactly two boxes went dark — the clicked one, and its copy in the other bar
    await expect.poll(async () => (await litKeys(page)).length).toBe(before.length - 2)
    const after = (await litKeys(page)).map((c) => c.key)
    const gone = before.filter((k) => !after.includes(k))
    expect(gone).toContain(TWICE)
    expect(gone.length).toBe(2)
    const [row, col] = TWICE.split(':').map(Number)
    const other = gone.find((k) => k !== TWICE)!
    expect(Number(other.split(':')[0]), 'the copy is in the same row').toBe(row)
    expect(Number(other.split(':')[1]), 'the copy is in the other bar').not.toBe(col)
    await expectNoRefusalReported(page)
  })

  test('two bars, by key: Delete on that `bd` box erases the written note', async ({ page }) => {
    const grid = await openSequencer(page, TWO_BARS)
    await grid.locator(`[data-seq-cell="${TWICE}"]`).focus()
    await page.keyboard.press('Delete')
    await expect.poll(() => editorValue(page)).toBe(TWO_BARS_ERASED)
    await expectNoRefusalReported(page)
  })

  test('CONTROL, two bars: a note drawn once erases only its own box', async ({ page }) => {
    const grid = await openSequencer(page, TWO_BARS)
    const kicks = await litOf(page, 'bd')
    await grid.locator('[data-seq-cell="0:0"]').click()
    await expect.poll(() => editorValue(page)).toBe(TWO_BARS_ONCE_AFTER)
    expect(await litOf(page, 'bd')).toEqual(kicks.filter((k) => k !== '0:0'))
  })

  test('one bar: erasing one `sd` of `[- sd]*2` erases the written note — both hits', async ({ page }) => {
    const grid = await openSequencer(page, ONE_BAR)
    const sd = await litOf(page, 'sd')
    expect(sd.length, 'the `sd` row draws two hits from one written note').toBe(2)
    await grid.locator(`[data-seq-cell="${sd[0]}"]`).click()
    await expect.poll(() => editorValue(page)).toBe(ONE_BAR_NO_SD)
    for (const k of sd) await expect(grid.locator(`[data-seq-cell="${k}"]`)).toHaveAttribute('aria-pressed', 'false')
    await expectNoRefusalReported(page)
  })

  test('CONTROL, one bar: the first kick erases alone', async ({ page }) => {
    const grid = await openSequencer(page, ONE_BAR)
    const kicks = await litOf(page, 'bd')
    await grid.locator('[data-seq-cell="0:0"]').click()
    await expect.poll(() => editorValue(page)).toBe('$: s("[~ - [- bd] -], <[- sd]*2>")')
    expect(await litOf(page, 'bd')).toEqual(kicks.filter((k) => k !== '0:0'))
  })
})
