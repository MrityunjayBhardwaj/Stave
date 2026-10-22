/**
 * Look-only views — #1975.
 *
 * A pattern whose hits cannot be edited one by one used to get no view at all: the
 * Pattern tab said "isn't grid-editable" over a perfectly ordinary rhythm. It is now
 * drawn from what Strudel plays, with no gestures and one line saying why.
 *
 * Observes the REAL app and the REAL document:
 *   - the two patterns that lost their view since July open again, and draw the hits;
 *   - no gesture writes — clicks, drags, keys, velocity, Slots, the + handle — with
 *     the document compared byte for byte before and after;
 *   - CONTROL: the same gestures on an editable pattern DO write, so the arms above
 *     are not passing because the gestures missed.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { slotsControl, preset } from './_resolutionControl'

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 15_000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 15_000 },
  )
}

/** set the document and put the cursor inside the pattern's string */
async function setCode(page: Page, code: string): Promise<void> {
  const ok = await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null
      focus: () => void
      setPosition: (p: { lineNumber: number; column: number }) => void
    }>
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    if (!target) return false
    target.getModel()?.setValue(c)
    target.setPosition({ lineNumber: 1, column: c.indexOf('"') + 3 })
    target.focus()
    return true
  }, code)
  expect(ok).toBe(true)
  await page.waitForTimeout(150)
}

async function docValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; getValue: () => string } | null
    }>
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    return target?.getModel()?.getValue() ?? ''
  })
}

async function openPattern(page: Page): Promise<Locator> {
  const drawer = page.locator('[data-bottom-panel="root"]')
  await drawer.locator('[data-bottom-panel="toggle"]').click()
  await drawer.locator('role=tab[name="Pattern"]').click()
  return drawer
}

/** press at a point, drag by (dx, dy) and release — paint, move and velocity all start so */
async function dragFrom(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 })
  await page.mouse.move(x + dx, y + dy, { steps: 4 })
  await page.mouse.up()
}

/** the centre of a cell, read ONCE — a gesture that gets through must not strand the next one */
async function centre(cell: Locator): Promise<{ x: number; y: number; w: number }> {
  const box = await cell.boundingBox()
  if (!box) throw new Error('no such cell')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width }
}

/**
 * Every gesture the step grid has, aimed by POSITION at a hit and at an empty step.
 * By position, not by `aria-pressed`: if a write got through, the hit would be gone
 * and a locator for it would time out — the test must reach its byte comparison and
 * fail THERE, saying what the document became.
 */
async function everyGridGesture(page: Page, grid: Locator): Promise<void> {
  expect(await grid.locator('[data-seq-cell]').count()).toBeGreaterThan(3)
  const hit = await centre(grid.locator('[data-seq-cell][aria-pressed="true"]').first())
  const empty = grid.locator('[data-seq-cell][aria-pressed="false"]').first()
  const gap = (await empty.count()) > 0 ? await centre(empty) : null
  await page.mouse.click(hit.x, hit.y) // remove a hit
  if (gap) await page.mouse.click(gap.x, gap.y) // add one
  await dragFrom(page, hit.x, hit.y, 120, 0) // paint across
  await dragFrom(page, hit.x, hit.y, 0, -40) // velocity
  await dragFrom(page, hit.x + hit.w / 2 - 2, hit.y, 60, 0) // the right edge is the length handle
  // the keyboard, from the cell the clicks above focused
  for (const key of ['Enter', ' ', 'Backspace', 'Delete', 'Shift+ArrowRight', 'Shift+ArrowLeft', 'ArrowRight', 'Enter']) {
    await page.keyboard.press(key)
  }
}

test.describe('a pattern nobody can edit note by note is still shown (#1975)', () => {
  test('`[hh ~]!16` opens look-only, draws sixteen hits, and no gesture writes', async ({ page }) => {
    await boot(page)
    const code = '$: s("[hh ~]!16")'
    await setCode(page, code)
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    await expect(grid).toHaveCount(1)
    await expect(grid).toHaveAttribute('data-look-only', 'view-unusable')
    await expect(grid.locator('[data-seq-look-only]')).toContainText('Look only')
    await expect(grid.locator('[data-seq-look-only]')).toContainText('Edit it in the code')
    // what Strudel plays: one voice, sixteen steps, a hit on every one, each half a step long
    await expect(grid.locator('[data-seq-voice]')).toHaveCount(1)
    await expect(grid.locator('[data-seq-cell]')).toHaveCount(16)
    await expect(grid.locator('[data-seq-cell][aria-pressed="true"]')).toHaveCount(16)
    await expect(grid.locator('[data-seq-fill][data-seq-extent="0.5000"]')).toHaveCount(16)
    // the controls that are not cells are gone, and every cell says it is inert
    await expect(grid.locator('[data-seq-remove-voice]')).toHaveCount(0)
    await expect(grid.locator('[data-seq-add-voice]')).toHaveCount(0)
    await expect(grid.locator('[data-seq-resize]')).toHaveCount(0)
    await expect(grid.locator('[data-seq-cell][aria-disabled="true"]')).toHaveCount(16)

    await everyGridGesture(page, grid)
    expect(await docValue(page), 'not one byte moved').toBe(code)
    await expect(grid.locator('[data-seq-cell][aria-pressed="true"]')).toHaveCount(16)
  })

  test('`~ ~ ~ bd(<2 4!2>, 8)` opens look-only over its three bars, ten hits', async ({ page }) => {
    await boot(page)
    const code = '$: s("~ ~ ~ bd(<2 4!2>, 8)")'
    await setCode(page, code)
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    // `no-leaf-anchor` until #1974: with its hits anchored on the note, every hit is the one `bd`
    await expect(grid).toHaveAttribute('data-look-only', 'view-unusable')
    await expect(grid.locator('[data-seq-cell]')).toHaveCount(48)
    // bar 1 plays 2 hits, bars 2 and 3 play 4 each — at the columns Strudel puts them
    const on = await grid.locator('[data-seq-cell][aria-pressed="true"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-seq-cell')),
    )
    expect(on).toEqual(['0:12', '0:14', '0:28', '0:29', '0:30', '0:31', '0:44', '0:45', '0:46', '0:47'])

    await everyGridGesture(page, grid)
    expect(await docValue(page)).toBe(code)
  })

  test('`<bd>*4` — whole-step hits, which a rebuild from the cells COULD spell — still writes nothing', async ({ page }) => {
    // The two patterns above play half-step hits, and the grid's rebuild has no
    // spelling for those: they would stay unwritten even with the look-only guards
    // gone. This one plays four whole steps, so only the guards keep it unwritten —
    // it is the arm that goes red when a write is let through.
    await boot(page)
    const code = '$: s("<bd>*4")'
    await setCode(page, code)
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    await expect(grid).toHaveAttribute('data-look-only', 'view-unusable')
    await expect(grid.locator('[data-seq-cell][aria-pressed="true"]')).toHaveCount(4)
    await everyGridGesture(page, grid)
    expect(await docValue(page), 'not one byte moved').toBe(code)
    await expect(grid.locator('[data-seq-cell][aria-pressed="true"]')).toHaveCount(4)
  })

  test('the Slots control and the + handle offer nothing on a look-only view', async ({ page }) => {
    await boot(page)
    const code = '$: s("<clap clap>*8")'
    await setCode(page, code)
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    await expect(grid).toHaveAttribute('data-look-only', /.+/)
    await expect(drawer.locator('[data-extend-handle]')).toHaveCount(0)
    // Slots: the readout shows what is drawn; ÷2, ×2 and every preset are pressed anyway
    const slots = slotsControl(drawer)
    await expect(slots.locator('[data-resolution-current]')).toHaveAttribute('data-resolution-current', '8')
    await slots.locator('[data-resolution-halve]').click({ force: true, timeout: 3000 })
    await slots.locator('[data-resolution-double]').click({ force: true, timeout: 3000 })
    for (const n of [4, 16, 32, 64]) {
      const button = await preset(slots, n)
      await expect(button).toHaveCount(1)
      // nothing is offered: not a write, and not a finer view either
      expect(await button.getAttribute('data-resolution-writes')).toBeNull()
      expect(await button.getAttribute('data-resolution-view')).toBeNull()
      await button.click({ force: true, timeout: 3000 })
    }
    expect(await docValue(page)).toBe(code)
    await expect(grid).toHaveAttribute('data-look-only', /.+/)
  })

  test('a look-only piano roll: notes drawn, nothing moves', async ({ page }) => {
    await boot(page)
    const code = '$: note("<c3>*4")'
    await setCode(page, code)
    const drawer = await openPattern(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(roll).toHaveAttribute('data-look-only', 'view-unusable')
    await expect(roll.locator('[data-roll-look-only]')).toContainText('Look only')
    // no velocity lane: a look-only view never reads the levels, so it does not draw any
    await expect(roll.locator('[data-roll-velocity-lane]')).toHaveCount(0)
    const c3 = 48
    for (const step of [0, 1, 2, 3]) {
      await expect(roll.locator(`[data-roll-cell="${c3}:${step}"]`)).toHaveAttribute('aria-pressed', 'true')
    }
    const note = await centre(roll.locator(`[data-roll-cell="${c3}:1"]`))
    const free = await centre(roll.locator(`[data-roll-cell="${c3 + 2}:2"]`))
    await page.mouse.click(note.x, note.y) // delete
    await dragFrom(page, note.x, note.y, 60, -34) // move
    await dragFrom(page, note.x + note.w / 2 - 2, note.y, 40, 0) // length
    await page.mouse.click(free.x, free.y) // place
    // ⌘-click selects without editing, so the keys below have a note to act on
    await page.keyboard.down('Meta')
    await page.mouse.click(note.x, note.y)
    await page.keyboard.up('Meta')
    for (const key of ['Backspace', 'Delete', 'Enter', 'Alt+ArrowUp', 'Alt+ArrowRight', 'Shift+ArrowRight']) {
      await page.keyboard.press(key)
    }
    expect(await docValue(page)).toBe(code)
  })

  test('CONTROL: the same gestures on an editable pattern write', async ({ page }) => {
    await boot(page)
    const code = '$: s("hh ~ hh ~")'
    await setCode(page, code)
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    await expect(grid).toHaveCount(1)
    expect(await grid.getAttribute('data-look-only')).toBeNull()
    await expect(grid.locator('[data-seq-look-only]')).toHaveCount(0)
    await grid.locator('[data-seq-cell="0:1"]').click()
    await expect.poll(() => docValue(page)).toBe('$: s("hh hh hh ~")')
  })

  test('typing an editable pattern over a look-only one brings the editing grid back', async ({ page }) => {
    await boot(page)
    await setCode(page, '$: s("[hh ~]!16")')
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    await expect(grid).toHaveAttribute('data-look-only', 'view-unusable')
    await setCode(page, '$: s("hh ~ hh ~")')
    await expect(grid.locator('[data-seq-cell]')).toHaveCount(4)
    expect(await grid.getAttribute('data-look-only')).toBeNull()
    await grid.locator('[data-seq-cell="0:3"]').click()
    await expect.poll(() => docValue(page)).toBe('$: s("hh ~ hh hh")')
  })
})
