/**
 * The sequencer offers a velocity drag only where the writer will write it (#1839).
 *
 * WHY A BROWSER TEST. The writer, `serializeStepGain`, was always right: it hands off
 * every leaf-read grid, because there is no column sequence of ours for a `.gain("…")` to
 * line up with. The panel predicted that answer with its own copy of the rule, and the
 * copy missed the leaf line. So on a leaf-read grid a vertical drag redrew the bar at the
 * new height and the code never changed. Only the panel was wrong, and only a rendered
 * panel shows it.
 *
 * The pair is two one-bar, one-part grids, so the old copy of the rule said yes to both:
 *
 *   `bd sd hh sd`                  element path — the writer writes `.gain(…)`
 *   `[bd - [- bd] -], [- sd]*2`    leaf-read    — the writer skips, so no drag is offered
 *
 * `data-gain` is the panel's own statement that velocity is offered on a cell: it is set
 * exactly where the drag is armed.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue, pinLcmGrid, velocityDragOn } from './_appBoot'

// velocity drags are off by default (#2525); this spec is about the gesture, so it turns them on
velocityDragOn(test)


pinLcmGrid(test)
const WRITES = '$: s("bd sd hh sd")'
/** a 60px downward drag on the first hit, observed once and pinned */
const WRITES_AFTER = '$: s("bd sd hh sd").gain("0.25 1 1 1")'
const LEAF = '$: s("[bd - [- bd] -], [- sd]*2")'

async function openSequencer(page: Page, code: string) {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 520 } })
  await seedCode(page, code)
  const grid = page.locator('[data-bottom-panel-tab="sequencer"]')
  await expect(grid, `the sequencer must open for ${code}`).toHaveCount(1)
  return grid
}

/** Press on the cell, drag straight down 60px, release. */
async function dragDown(page: Page, key: string) {
  const loc = page.locator(`[data-bottom-panel-tab="sequencer"] [data-seq-cell="${key}"]`)
  await expect(loc).toHaveAttribute('aria-pressed', 'true')
  const b = (await loc.boundingBox())!
  const x = b.x + b.width / 3
  const y = b.y + b.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(x, y + i * 6)
  await page.mouse.up()
}

test.describe('velocity is offered where the writer writes it (#1839)', () => {
  test('on a grid the writer serves, the drag is offered and writes a .gain (LCM grid)', async ({ page }) => {
    const grid = await openSequencer(page, WRITES)
    await expect(grid.locator('[data-seq-cell="0:0"]')).toHaveAttribute('data-gain', '1')
    await dragDown(page, '0:0')
    await expect.poll(() => editorValue(page), { message: 'the velocity drag must write' }).toBe(WRITES_AFTER)
  })

  test('on a leaf-read grid the drag is not offered: no lit cell claims a velocity', async ({ page }) => {
    const grid = await openSequencer(page, LEAF)
    const lit = grid.locator('[data-seq-cell][aria-pressed="true"]')
    await expect(lit.first()).toBeVisible()
    const gains = await lit.evaluateAll((els) => els.map((e) => e.getAttribute('data-gain')))
    expect(gains.length, 'the fixture draws its hits').toBeGreaterThan(0)
    expect(gains, 'a velocity the writer will never write must not be offered').toEqual(gains.map(() => null))
  })
})
