import { test, expect, type Page, type Locator } from '@playwright/test'
import { bootApp, seedCode, editorValue, pinLcmGrid } from './_appBoot'
import { expectRefusalReported, expectNoRefusalReported } from './_console'


pinLcmGrid(test)
/**
 * #1803 — move, transpose and resize the note under the cursor from the keyboard.
 * Every expected document is what THE MOUSE wrote for the same edit on the same
 * pattern, recorded first in the same test, never a predicted string.
 */

const ROLL = '[data-bottom-panel-tab="piano-roll"]'
const SEQ = '[data-bottom-panel-tab="sequencer"]'

async function open(page: Page, code: string, tab: string, first: string): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 520 } })
  await seedCode(page, code)
  const panel = page.locator(tab)
  await expect(panel.locator(first)).toBeVisible({ timeout: 10_000 })
  return panel
}

async function centre(loc: Locator): Promise<{ x: number; y: number }> {
  const b = await loc.boundingBox()
  if (!b) throw new Error('no box')
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  const f = await centre(from)
  const t = await centre(to)
  await page.mouse.move(f.x, f.y)
  await page.mouse.down()
  await page.mouse.move(t.x, t.y, { steps: 10 })
  await page.mouse.up()
}

/** What a mouse drag writes, then the pattern put back. */
async function byMouse(page: Page, code: string, act: () => Promise<void>): Promise<string> {
  await act()
  await expect.poll(() => editorValue(page), { timeout: 5_000 }).not.toBe(code)
  const want = await editorValue(page)
  await seedCode(page, code)
  return want
}

function focusedCell(page: Page, attr: string): Promise<string | null> {
  return page.evaluate((a) => document.activeElement?.getAttribute(a) ?? null, attr)
}

test.describe('piano roll', () => {
  test('⌥→ / ⌥← move the note a column, as a drag does; the cursor follows', async ({ page }) => {
    const code = '$: note("c3 ~ ~ ~")'
    const roll = await open(page, code, ROLL, '[data-roll-cell="48:0"]')
    const want = await byMouse(page, code, () =>
      drag(page, roll.locator('[data-roll-cell="48:0"]'), roll.locator('[data-roll-cell="48:1"]')),
    )
    await roll.locator('[data-roll-cell="48:0"]').focus()
    await page.keyboard.press('Alt+ArrowRight')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(want)
    await expect.poll(() => focusedCell(page, 'data-roll-cell')).toBe('48:1')
    await page.keyboard.press('Alt+ArrowLeft')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(code)
    await expectNoRefusalReported(page)
  })

  test('⌥↑ moves the note up a row, as a drag does', async ({ page }) => {
    const code = '$: note("c3 ~ ~ ~")'
    const roll = await open(page, code, ROLL, '[data-roll-cell="48:0"]')
    const want = await byMouse(page, code, () =>
      drag(page, roll.locator('[data-roll-cell="48:0"]'), roll.locator('[data-roll-cell="49:0"]')),
    )
    await roll.locator('[data-roll-cell="48:0"]').focus()
    await page.keyboard.press('Alt+ArrowUp')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(want)
    await expect.poll(() => focusedCell(page, 'data-roll-cell')).toBe('49:0')
    await page.keyboard.press('Alt+ArrowDown')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(code)
  })

  test('⌥⇧↑ moves the note an octave, as a drag twelve rows up does', async ({ page }) => {
    const code = '$: note("c3 ~ ~ ~ c4 ~ ~ ~")'
    const roll = await open(page, code, ROLL, '[data-roll-cell="48:0"]')
    const want = await byMouse(page, code, () =>
      drag(page, roll.locator('[data-roll-cell="48:0"]'), roll.locator('[data-roll-cell="60:0"]')),
    )
    await roll.locator('[data-roll-cell="48:0"]').focus()
    await page.keyboard.press('Alt+Shift+ArrowUp')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(want)
    await expect.poll(() => focusedCell(page, 'data-roll-cell')).toBe('60:0')
  })

  test('an octave past the drawn rows: the rows grow and the cursor lands on the note', async ({ page }) => {
    const code = '$: note("c3 ~ ~ ~")'
    const roll = await open(page, code, ROLL, '[data-roll-cell="48:0"]')
    await roll.locator('[data-roll-cell="48:0"]').focus()
    await page.keyboard.press('Alt+Shift+ArrowUp')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).not.toBe(code)
    await expect(roll.locator('[data-roll-cell="60:0"]')).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => focusedCell(page, 'data-roll-cell')).toBe('60:0')
    await page.keyboard.press('Alt+Shift+ArrowDown')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(code)
  })

  test('⌥⇧→ / ⌥⇧← lengthen and shorten the note, as its handle does', async ({ page }) => {
    const code = '$: note("c3 ~ ~ ~")'
    const roll = await open(page, code, ROLL, '[data-roll-cell="48:0"]')
    const want = await byMouse(page, code, () =>
      drag(page, roll.locator('[data-roll-resize="48:0"]'), roll.locator('[data-roll-cell="48:1"]')),
    )
    await roll.locator('[data-roll-cell="48:0"]').focus()
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(want)
    await page.keyboard.press('Alt+Shift+ArrowLeft')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(code)
    await expectNoRefusalReported(page)
  })

  test('with the snap at 1/4, ⌥→ and ⌥⇧→ step by a quarter, as a snapped drag does', async ({ page }) => {
    // 16 steps a bar: 1/4 is four columns.
    const code = '$: note("c3 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~")'
    const roll = await open(page, code, ROLL, '[data-roll-cell="48:0"]')
    await page.locator('[data-mixer-division-select]').selectOption('1/4')
    const moved = await byMouse(page, code, () =>
      drag(page, roll.locator('[data-roll-cell="48:0"]'), roll.locator('[data-roll-cell="48:4"]')),
    )
    const longer = await byMouse(page, code, () =>
      drag(page, roll.locator('[data-roll-resize="48:0"]'), roll.locator('[data-roll-cell="48:3"]')),
    )
    await roll.locator('[data-roll-cell="48:0"]').focus()
    await page.keyboard.press('Alt+ArrowRight')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(moved)
    await expect.poll(() => focusedCell(page, 'data-roll-cell')).toBe('48:4')
    await seedCode(page, code)
    await roll.locator('[data-roll-cell="48:0"]').focus()
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(longer)
  })

  test('a move the writer declines is refused and said, as the drag is', async ({ page }) => {
    // The #1452 fixture: every drop into column 7 is declined for this note.
    const code = '$: note("- - - <b3 [b3 b3]>")'
    const roll = await open(page, code, ROLL, '[data-roll-cell="59:6"]')
    await roll.locator('[data-roll-cell="59:6"]').focus()
    await page.keyboard.press('Alt+ArrowRight')
    await page.waitForTimeout(600)
    expect(await editorValue(page)).toBe(code)
    await expectRefusalReported(page, "Couldn't move that note there")
  })

  test('on a scale pattern a row is a degree: ⌥↑ moves one, ⌥⇧↑ is refused and said', async ({ page }) => {
    const code = '$: n("0 ~ ~ 7").scale("C:major")'
    // A numeric roll's rows are degrees: the note `0` sits on row 0.
    const at = '0:0'
    const roll = await open(page, code, ROLL, `[data-roll-cell="${at}"]`)
    const want = await byMouse(page, code, () =>
      drag(page, roll.locator(`[data-roll-cell="${at}"]`), roll.locator('[data-roll-cell="1:0"]')),
    )
    await roll.locator(`[data-roll-cell="${at}"]`).focus()
    await page.keyboard.press('Alt+Shift+ArrowUp')
    await page.waitForTimeout(600)
    expect(await editorValue(page)).toBe(code)
    await expectRefusalReported(page, "Couldn't move that note an octave")
    await roll.locator(`[data-roll-cell="${at}"]`).focus()
    await page.keyboard.press('Alt+ArrowUp')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(want)
  })

  test('each key is one undo step', async ({ page }) => {
    const code = '$: note("c3 ~ ~ ~")'
    const roll = await open(page, code, ROLL, '[data-roll-cell="48:0"]')
    await roll.locator('[data-roll-cell="48:0"]').focus()
    await page.keyboard.press('Alt+ArrowRight')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).not.toBe(code)
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(code)
  })
})

test.describe('sequencer', () => {
  test('⌥⇧→ / ⌥⇧← set the length, as the handle does; ⌥→ does nothing (LCM grid)', async ({ page }) => {
    const code = '$: s("[bd ~ sd ~]")'
    const seq = await open(page, code, SEQ, '[data-seq-cell="0:0"]')
    const want = await byMouse(page, code, () =>
      drag(page, seq.locator('[data-seq-resize="0:0"]'), seq.locator('[data-seq-cell="0:1"]')),
    )
    await seq.locator('[data-seq-cell="0:0"]').focus()
    await page.keyboard.press('Alt+ArrowRight')
    await page.waitForTimeout(600)
    expect(await editorValue(page)).toBe(code)
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(want)
    await page.keyboard.press('Alt+Shift+ArrowLeft')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(code)
  })
})
