/**
 * Sequencer — a note's LENGTH is settable from the grid (#1053).
 *
 * WHY THIS IS A BROWSER TEST. #1056 made length visible; the unit gates
 * (`cellResize.test.ts`) pin what `resizeCell` means, and the corpus gate
 * (`op-admissibility.test.ts`) pins that the offer is never dead. None of them can say
 * that a user dragging the thing they can see changes the document — the handle's
 * geometry, the pointer contract it shares with toggle/paint/velocity, and the write-back
 * all live above every one of those. That whole span is what this file observes.
 *
 * ⚠ THE CONTROL MOVED, and the move is the point of #1146. It used to be the FLAT
 * spelling `bd ~ sd ~`: every column its own source element, so a sustain had nowhere to
 * go and no handle was drawn — while the same four columns as `[bd ~ sd ~]` accepted the
 * drag. Two spellings that sound identical behaved differently for a reason no user could
 * see, and it was most of this feature's ceiling. The writer now absorbs the rest a note
 * reaches into, so the flat grid has its own POSITIVE arm here, and the control is a grid
 * with no rest to absorb at all (`bd*4`). A handle drawn on every note still fails there
 * and nowhere else.
 */
import { test, expect, type Page } from '@playwright/test'

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

type Ed = {
  getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void; getValue: () => string } | null
  focus: () => void
  setPosition: (p: { lineNumber: number; column: number }) => void
}

const editors = (): Ed[] => {
  const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
  return (monaco?.editor?.getEditors?.() ?? []) as Ed[]
}

async function setStrudelCode(page: Page, code: string): Promise<void> {
  const ok = await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
    const es = (monaco?.editor?.getEditors?.() ?? []) as Ed[]
    const target = es.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? es[0]
    if (!target) return false
    target.getModel()?.setValue(c)
    target.setPosition({ lineNumber: 1, column: 1 })
    target.focus()
    return true
  }, code)
  expect(ok).toBe(true)
  await page.waitForTimeout(200)
}

async function readCode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
    const es = (monaco?.editor?.getEditors?.() ?? []) as Ed[]
    const target = es.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? es[0]
    return target?.getModel()?.getValue() ?? ''
  })
}

async function openSequencer(page: Page) {
  const drawer = page.locator('[data-bottom-panel="root"]')
  await drawer.locator('[data-bottom-panel="toggle"]').click()
  await drawer.locator('role=tab[name="Pattern"]').click()
  return drawer
}

/** the lane as the user sees it — `#` struck, `=` carried, `-` silent (same reader as #1056's gate) */
async function readLane(page: Page, lane: number, steps: number): Promise<string> {
  const out: string[] = []
  for (let s = 0; s < steps; s++) {
    const fill = page.locator(`[data-seq-cell="${lane}:${s}"] [data-seq-fill]`)
    if ((await fill.count()) === 0) {
      out.push('-')
      continue
    }
    out.push((await fill.getAttribute('data-seq-sustain')) === 'true' ? '=' : '#')
  }
  return out.join('')
}

/** press the handle, drag horizontally onto `toCell`, release — the real gesture */
async function dragHandleTo(page: Page, handle: string, toCell: string): Promise<void> {
  const h = await page.locator(handle).boundingBox()
  const t = await page.locator(toCell).boundingBox()
  expect(h, `no handle ${handle}`).not.toBeNull()
  expect(t, `no cell ${toCell}`).not.toBeNull()
  await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2)
  await page.mouse.down()
  await page.mouse.move(t!.x + t!.width / 2, t!.y + t!.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(250)
}

test.describe('the grid sets a note’s length (#1053)', () => {
  test('dragging the handle right LENGTHENS the note, in the document and in the picture', async ({
    page,
  }) => {
    await boot(page)
    // #2293: the length is the step writer's, which keeps the author's brackets —
    // `[bd ~ sd ~]` becomes `[bd _ sd ~]`, and the column reader draws THAT at two columns
    // (#2323), so the picture is pinned on the flat spelling, which keeps its four
    await setStrudelCode(page, '$: s("bd ~ sd ~")')
    await openSequencer(page)
    await expect(page.locator('[data-seq-cell="0:0"]')).toHaveCount(1)
    expect(await readLane(page, 0, 4)).toBe('#---')

    // the handle is offered on bd's only column, which is also its tail
    await expect(page.locator('[data-seq-resize="0:0"]')).toHaveCount(1)

    await dragHandleTo(page, '[data-seq-resize="0:0"]', '[data-seq-cell="0:1"]')

    const code = await readCode(page)
    console.log(`\n  after drag →  ${code}`)
    // the sustain is spelled `_`, the one-token-per-column shape the grid writes
    expect(code).toContain('bd _ sd ~')
    // …and the panel now DRAWS the note carrying through column 1
    expect(await readLane(page, 0, 4)).toBe('#=--')
  })

  test('dragging the handle left SHORTENS it again — the direction the grid never had', async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd _ sd ~")')
    await openSequencer(page)
    await expect(page.locator('[data-seq-cell="0:0"]')).toHaveCount(1)
    expect(await readLane(page, 0, 4)).toBe('#=--')

    // The handle sits on the note's TAIL, which for a two-column note is column 1 — a
    // column the placement gate has made inert, so this also proves the handle is
    // reachable on a cell whose own pointer-down is refused.
    //
    // Located by CELL, because the attribute names the note (`lane:startColumn`) and not
    // the cell it is drawn in: `[data-seq-resize="0:0"]` is this note's handle wherever it
    // hangs, so asserting its absence globally asserts nothing about where it sits.
    await expect(page.locator('[data-seq-cell="0:0"] [data-seq-resize]')).toHaveCount(0)
    await expect(page.locator('[data-seq-cell="0:1"] [data-seq-resize="0:0"]')).toHaveCount(1)

    await dragHandleTo(page, '[data-seq-cell="0:1"] [data-seq-resize="0:0"]', '[data-seq-cell="0:0"]')

    const code = await readCode(page)
    console.log(`  after drag →  ${code}`)
    expect(code).toContain('bd ~ sd ~')
    expect(await readLane(page, 0, 4)).toBe('#---')
  })

  test('a FLAT grid lengthens too, and its neighbours keep their own bytes', async ({ page }) => {
    // ⚠ THIS PATTERN USED TO BE THE CONTROL — the spelling where every column is its own
    // source element, so a sustain had nowhere to go and the panel drew no handle at all.
    // #1146 taught the writer to absorb the rest the note reaches into, which is what
    // takes the gesture from 46 to 105 of the 732 flat corpus units. It is asserted here
    // because it is the case a user meets first: a plain drum row.
    await boot(page)
    await setStrudelCode(page, '$: s("bd ~ ~ ~ sd ~ ~ ~")')
    await openSequencer(page)
    await expect(page.locator('[data-seq-cell="0:0"]')).toHaveCount(1)
    expect(await readLane(page, 0, 8)).toBe('#-------')

    await dragHandleTo(page, '[data-seq-resize="0:0"]', '[data-seq-cell="0:2"]')

    const code = await readCode(page)
    console.log(`  flat grid after drag →  ${code}`)
    // three columns of bd, and `sd` plus the rests past the note's reach untouched
    expect(code).toContain('bd _ _ ~ sd ~ ~ ~')
    expect(await readLane(page, 0, 8)).toBe('#==-----')
  })

  test('CONTROL: no handle where the writer would decline the drag', async ({ page }) => {
    // A grid with no rest in reach of anything: every column carries a note, so there is
    // nothing for the writer to absorb and no length any note can take. The panel must
    // draw nothing to grab. A handle rendered on every note — the obvious wrong
    // implementation — fails exactly here and nowhere else.
    await boot(page)
    await setStrudelCode(page, '$: s("bd*4")')
    await openSequencer(page)
    await expect(page.locator('[data-seq-cell="0:0"]')).toHaveCount(1)
    expect(await readLane(page, 0, 4)).toBe('####')

    expect(await page.locator('[data-seq-resize]').count()).toBe(0)

    // CONTROL FOR THE CONTROL: the selector is real and does match when a handle exists,
    // so "0 handles" is a fact about this pattern and not about a typo ([[PV275]] — an
    // assertion satisfied by nothing running is not an assertion).
    await setStrudelCode(page, '$: s("[bd ~ sd ~]")')
    await expect(page.locator('[data-seq-cell="0:0"]')).toHaveCount(1)
    expect(await page.locator('[data-seq-resize]').count()).toBeGreaterThan(0)
  })

  test('the handle does not steal the cell’s own gestures', async ({ page }) => {
    // The handle takes the trailing edge of a cell that already means three things.
    // Pressing the cell's LEFT side must still toggle the step off, or this feature was
    // bought by breaking the gesture the panel exists for.
    await boot(page)
    await setStrudelCode(page, '$: s("[bd ~ sd ~]")')
    await openSequencer(page)
    await expect(page.locator('[data-seq-cell="0:0"]')).toHaveCount(1)
    await expect(page.locator('[data-seq-cell="0:0"]')).toHaveAttribute('aria-pressed', 'true')

    const box = (await page.locator('[data-seq-cell="0:0"]').boundingBox())!
    // 2px in from the left edge — as far from the trailing grab zone as the cell allows
    await page.mouse.move(box.x + 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(250)

    await expect(page.locator('[data-seq-cell="0:0"]')).toHaveAttribute('aria-pressed', 'false')
    const code = await readCode(page)
    console.log(`  after left-edge click →  ${code}`)
    expect(code).not.toContain('bd')
  })
})
