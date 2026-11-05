import { test, expect, type Page, type Locator } from '@playwright/test'
import { bootApp, seedCode, editorValue, pinLcmGrid } from './_appBoot'
import { expectRefusalReported, expectNoRefusalReported } from './_console'

// The tests titled `(LCM grid)` pin the shared-grid writer's results (Settings › Grid, #2294).
pinLcmGrid(test)

/**
 * #1824 — the `+` past a grid's last column makes the pattern longer.
 *   click → one more bar, continuing the pattern (a one-bar pattern sounds the
 *           same until the copy is edited)
 *   drag  → one column at a time while held; on release, that many columns' worth
 *           of EMPTY bars, rounded up
 * Driven with the real mouse. What each rewrite PLAYS is checked against Strudel in
 * `lengthen.test.ts`; here the question is what the user sees and what lands in the
 * document.
 */

const ROLL = '[data-bottom-panel-tab="piano-roll"]'
const SEQ = '[data-bottom-panel-tab="sequencer"]'
const MELODY = 'e4 d4 c4 d4 e4 e4 e4@2'

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

/** distinct columns the grid draws */
function columns(panel: Locator, attr: string): Promise<number> {
  return panel
    .locator(`[${attr}]`)
    .evaluateAll((els, a) => new Set(els.map((e) => e.getAttribute(a)!.split(':')[1])).size, attr)
}

test.describe('piano roll', () => {
  test('click + adds one bar that continues the pattern: one undo step, nothing reported', async ({ page }) => {
    const code = `$: note("${MELODY}")`
    const roll = await open(page, code, ROLL, '[data-roll-cell="64:0"]')
    expect(await columns(roll, 'data-roll-cell')).toBe(8)
    await roll.locator('[data-extend-handle]').click()
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(
      `$: note("<[${MELODY}] [${MELODY}]>")`,
    )
    await expect.poll(() => columns(roll, 'data-roll-cell')).toBe(16)
    // bar 2 is the copy: the first note of bar 1 again, at column 8
    await expect(roll.locator('[data-roll-cell="64:8"]')).toHaveAttribute('aria-pressed', 'true')
    // a second click adds ONE more bar — three, not four
    await roll.locator('[data-extend-handle]').click()
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(
      `$: note("<[${MELODY}] [${MELODY}] [${MELODY}]>")`,
    )
    await expect.poll(() => columns(roll, 'data-roll-cell')).toBe(24)
    await expect(roll.locator('[data-roll-cell="64:16"]')).toHaveAttribute('aria-pressed', 'true')
    // one gesture, one undo step each
    await roll.locator('[data-roll-cell="64:0"]').focus()
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(`$: note("<[${MELODY}] [${MELODY}]>")`)
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(code)
    await expectNoRefusalReported(page)
  })

  test('drag + grows a column at a time, writes nothing until release, then adds whole empty bars (LCM grid)', async ({ page }) => {
    const code = `$: note("${MELODY}")`
    const roll = await open(page, code, ROLL, '[data-roll-cell="64:0"]')
    const handle = roll.locator('[data-extend-handle]')
    const a = await centre(roll.locator('[data-roll-cell="62:0"]'))
    const b = await centre(roll.locator('[data-roll-cell="62:1"]'))
    const pitch = b.x - a.x
    const h = await centre(handle)
    await page.mouse.move(h.x, h.y)
    await page.mouse.down()
    for (let i = 1; i <= 3; i++) {
      await page.mouse.move(h.x + i * pitch, h.y, { steps: 4 })
      await expect(roll.locator('[data-extend-ghost]')).toHaveAttribute('data-extend-ghost', String(i))
    }
    await expect(roll.locator('[data-extend-tip]')).toHaveText('+3 steps → adds 1 bar')
    // a preview only: the document is untouched while the button is held
    expect(await editorValue(page)).toBe(code)
    await page.mouse.up()
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(`$: note("<[${MELODY}] ~>")`)
    await expect.poll(() => columns(roll, 'data-roll-cell')).toBe(16)
    await expect(roll.locator('[data-extend-ghost]')).toHaveCount(0)
    // the new bar is editable with the mouse like any other
    await roll.locator('[data-roll-cell="62:10"]').click()
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(
      `$: note("<[${MELODY}] [~ ~ d4 ~ ~ ~ ~ ~]>")`,
    )
    await expectNoRefusalReported(page)
  })

  test('a chord progression continues: its first chord, then its second', async ({ page }) => {
    const roll = await open(page, '$: note("<[c3,e3,g3] [a2,c3,e3]>")', ROLL, '[data-roll-cell="48:0"]')
    await roll.locator('[data-extend-handle]').click()
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(
      '$: note("<[c3,e3,g3] [a2,c3,e3] [c3,e3,g3]>")',
    )
    await roll.locator('[data-extend-handle]').click()
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe(
      '$: note("<[c3,e3,g3] [a2,c3,e3] [c3,e3,g3] [a2,c3,e3]>")',
    )
    await expectNoRefusalReported(page)
  })

  test('click + continues a melody in thirds (equal bars compare equal whatever the split)', async ({ page }) => {
    const roll = await open(page, '$: note("c3 e3 g3")', ROLL, '[data-roll-cell="48:0"]')
    await roll.locator('[data-extend-handle]').click()
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe('$: note("<[c3 e3 g3] [c3 e3 g3]>")')
    await expectNoRefusalReported(page)
  })

  test('REFUSES a pattern that changes from cycle to cycle, says so on the handle and in the Console', async ({ page }) => {
    const code = '$: note("c3 <e3 g3>")'
    const roll = await open(page, code, ROLL, '[data-roll-cell="48:0"]')
    const handle = roll.locator('[data-extend-handle]')
    // the reason is asked when the handle is reached, as a user reaches it
    await handle.hover()
    await expect(handle).toHaveAttribute('title', /plays differently from one cycle to the next/)
    await expect(handle).toHaveAttribute('aria-disabled', 'true')
    // by position: a disabled-looking control is still one a user can press
    const at = await centre(handle)
    await page.mouse.click(at.x, at.y)
    await expectRefusalReported(page, "Couldn't add a bar that continues the pattern")
    expect(await editorValue(page)).toBe(code)
  })

  test('REFUSES a melody with per-column velocities, which would lock its velocity lane', async ({ page }) => {
    const code = '$: note("c3 e3 g3 c4").gain("0.5 1 1 1")'
    const roll = await open(page, code, ROLL, '[data-roll-cell="48:0"]')
    const handle = roll.locator('[data-extend-handle]')
    await handle.hover()
    await expect(handle).toHaveAttribute('title', /velocities are written per column/)
    const at = await centre(handle)
    await page.mouse.click(at.x, at.y)
    await expectRefusalReported(page, "Couldn't add a bar that continues the pattern")
    expect(await editorValue(page)).toBe(code)
  })
})

test.describe('step sequencer', () => {
  test('click + adds a bar to a drum pattern', async ({ page }) => {
    const seq = await open(page, '$: s("bd sd bd sd")', SEQ, '[data-seq-cell="0:0"]')
    expect(await columns(seq, 'data-seq-cell')).toBe(4)
    await seq.locator('[data-extend-handle]').click()
    await expect.poll(() => editorValue(page), { timeout: 5_000 }).toBe('$: s("<[bd sd bd sd] [bd sd bd sd]>")')
    await expect.poll(() => columns(seq, 'data-seq-cell')).toBe(8)
    await expectNoRefusalReported(page)
  })

  test('REFUSES a bar the step grid could not show, rather than sending it to standby', async ({ page }) => {
    const code = '$: s("bd*2 sd")'
    const seq = await open(page, code, SEQ, '[data-seq-cell="0:0"]')
    await seq.locator('[data-extend-handle]').hover()
    await expect(seq.locator('[data-extend-handle]')).toHaveAttribute('title', /grid couldn't show the longer pattern/)
    await seq.locator('[data-extend-handle]').click()
    await expectRefusalReported(page, "Couldn't add a bar that continues the pattern")
    expect(await editorValue(page)).toBe(code)
  })
})
