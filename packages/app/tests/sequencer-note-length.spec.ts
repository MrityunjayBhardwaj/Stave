/**
 * Sequencer — a note is DRAWN across the columns it covers (#1056).
 *
 * WHY THIS IS A BROWSER TEST AND NOT A UNIT TEST. The claim this phase closes is about
 * RENDERED GEOMETRY and nothing upstream of it: the length was already read by the parser
 * (#1010 P4b), already preserved by the printer (P4c), and already asserted per cell
 * against the engine (`cell-duration.test.ts`) — and was still invisible, because every
 * visual property of a cell derived from `isCellOn` and a sustained column is `false`.
 * Model, writer and three corpus gates all read TRUE while the user saw nothing
 * ([[PV245]]). So the observation has to be made where the pixels are.
 *
 * THE DECISIVE PAIR is the one recorded as identical when the gap was found:
 * `bd _ sd ~` (bd sounds through two columns) and `bd ~ sd ~` (bd sounds through one)
 * produced the same lit-cell picture, `bd:#... | sd:..#.`. They must now differ, and
 * differ in the RIGHT column. A test that only asserted "the second column is lit" would
 * pass on a grid that lit every column, so the full row is compared both ways.
 */
import { test, expect, type Page } from '@playwright/test'
import { pinLcmGrid } from './_appBoot'
import { slotsControl } from './_resolutionControl'


pinLcmGrid(test)
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

async function setStrudelCode(page: Page, code: string): Promise<void> {
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
    target.setPosition({ lineNumber: 1, column: 1 })
    target.focus()
    return true
  }, code)
  expect(ok).toBe(true)
  await page.waitForTimeout(200)
}

async function openSequencer(page: Page) {
  const drawer = page.locator('[data-bottom-panel="root"]')
  await drawer.locator('[data-bottom-panel="toggle"]').click()
  await drawer.locator('role=tab[name="Pattern"]').click()
  return drawer
}

/**
 * The lane as the USER sees it, read off the rendered fill: `#` a struck column, `=` a
 * column the note is carried through, `-` silence. Read from the DOM the panel actually
 * produced, never from the model.
 */
async function readLane(page: Page, lane: number, steps: number): Promise<string> {
  const out: string[] = []
  for (let s = 0; s < steps; s++) {
    const cell = page.locator(`[data-seq-cell="${lane}:${s}"]`)
    const fill = cell.locator('[data-seq-fill]')
    if ((await fill.count()) === 0) {
      out.push('-')
      continue
    }
    out.push((await fill.getAttribute('data-seq-sustain')) === 'true' ? '=' : '#')
  }
  return out.join('')
}

test.describe('a note is drawn across the columns it covers (#1056)', () => {
  test('the pair that used to render identically now differs, in the right column (LCM grid)', async ({ page }) => {
    await boot(page)

    await setStrudelCode(page, '$: s("bd ~ sd ~")')
    await openSequencer(page)
    await expect(page.locator('[data-seq-cell="0:0"]')).toHaveCount(1)
    const short = await readLane(page, 0, 4)

    await setStrudelCode(page, '$: s("bd _ sd ~")')
    await expect(page.locator('[data-seq-cell="0:0"]')).toHaveCount(1)
    const held = await readLane(page, 0, 4)

    console.log(`\n  bd ~ sd ~  →  ${short}`)
    console.log(`  bd _ sd ~  →  ${held}`)

    // struck at column 0 in both; the held one CARRIES through column 1 and the other
    // does not. This exact comparison read `#---` / `#---` before this phase.
    expect(short).toBe('#---')
    expect(held).toBe('#=--')
    expect(held).not.toBe(short)
  })

  test('a carried column is drawn as a continuation, not as a second strike (LCM grid)', async ({ page }) => {
    // The head/sustain distinction is the piano roll's shipped vocabulary (a non-head
    // draws at 0.7). If a carried column were drawn identically to a struck one, the
    // picture would say `bd bd sd ~` — a different pattern — so the two are compared as
    // rendered rather than trusted from the style prop.
    await boot(page)
    await setStrudelCode(page, '$: s("bd _ sd ~")')
    await openSequencer(page)
    await expect(page.locator('[data-seq-cell="0:0"]')).toHaveCount(1)

    const headOpacity = await page
      .locator('[data-seq-cell="0:0"] [data-seq-fill]')
      .evaluate((el) => getComputedStyle(el).opacity)
    const heldOpacity = await page
      .locator('[data-seq-cell="0:1"] [data-seq-fill]')
      .evaluate((el) => getComputedStyle(el).opacity)

    console.log(`  head opacity ${headOpacity} · carried opacity ${heldOpacity}`)
    expect(Number(heldOpacity)).toBeLessThan(Number(headOpacity))

    // and the carried column is NOT a trigger — the ops, and the accessibility tree,
    // still say only column 0 is pressed.
    await expect(page.locator('[data-seq-cell="0:0"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-seq-cell="0:1"]')).toHaveAttribute('aria-pressed', 'false')

    // The fill is the only thing that distinguishes a carried column from an empty one,
    // so the accessible name has to carry it too — otherwise this change is legible to
    // sighted users and invisible to everyone else, which is the same failure the phase
    // exists to fix, one audience over.
    await expect(page.locator('[data-seq-cell="0:1"]')).toHaveAttribute(
      'aria-label',
      'bd step 2, held from step 1',
    )
    await expect(page.locator('[data-seq-cell="0:2"]')).toHaveAttribute('aria-label', 'bd step 3')
  })

  test('the length is still drawn at a REFINED view scale (×2) (LCM grid)', async ({ page }) => {
    /**
     * WHY THIS ARM EXISTS. Everything above observes the pattern at its own resolution,
     * and the panel's render is scale-agnostic — it reads `laneCoverage` and nothing else,
     * so a refined view "obviously" draws the same way. That inference is exactly what
     * went wrong once already: a probe asked `isCellOn` instead of the coverage the panel
     * actually draws from, reported a held and a short note as identical at ×1/×2/×4, and
     * a whole issue was re-scoped on it. `isCellOn` is the trigger; it is not the drawing.
     *
     * So the refined view gets its own observation, in pixels, rather than an argument.
     */
    await boot(page)
    await setStrudelCode(page, '$: s("bd _ ~ ~")')
    const drawer = await openSequencer(page)
    await expect(page.locator('[data-seq-cell="0:0"]')).toHaveCount(1)
    expect(await readLane(page, 0, 4)).toBe('#=--')

    // ×2 is a free view here: it changes only how finely the panel draws, and the note
    // must go on covering the same half of the cycle — now spelled across four columns.
    await slotsControl(drawer).locator('[data-resolution-double]').click()
    await expect(page.locator('[data-seq-cell="0:7"]')).toHaveCount(1)
    const refinedHeld = await readLane(page, 0, 8)
    console.log(`  bd _ ~ ~  @×2  →  ${refinedHeld}`)
    expect(refinedHeld).toBe('#===----')

    // CONTROL, and the pair the earlier mistake claimed was identical: the SHORT note on
    // the same view scale draws a different row. Without this arm, a regression that lit
    // every column of a refined grid would satisfy the assertion above.
    await setStrudelCode(page, '$: s("bd ~ ~ ~")')
    await expect(page.locator('[data-seq-cell="0:0"]')).toHaveCount(1)
    await slotsControl(drawer).locator('[data-resolution-double]').click()
    await expect(page.locator('[data-seq-cell="0:7"]')).toHaveCount(1)
    const refinedShort = await readLane(page, 0, 8)
    console.log(`  bd ~ ~ ~  @×2  →  ${refinedShort}`)
    expect(refinedShort).toBe('#=------')
    expect(refinedShort).not.toBe(refinedHeld)
  })

  test('drawing the length does not disturb an ordinary all-length-1 pattern (LCM grid)', async ({ page }) => {
    // The control arm in the live app: where every note lasts its own column, the grid
    // must be exactly the grid it has always been — one full-width box per trigger, no
    // carried columns anywhere.
    await boot(page)
    await setStrudelCode(page, '$: s("bd hh sd hh")')
    await openSequencer(page)
    await expect(page.locator('[data-seq-cell="0:0"]')).toHaveCount(1)

    const carried = await page.locator('[data-seq-fill][data-seq-sustain="true"]').count()
    const narrowed = await page.locator('[data-seq-fill][data-seq-extent]').count()
    console.log(`  all-length-1 pattern: carried ${carried}, narrowed ${narrowed}`)
    expect(carried).toBe(0)
    expect(narrowed).toBe(0)

    const width = await page
      .locator('[data-seq-cell="0:0"] [data-seq-fill]')
      .evaluate((el) => (el as HTMLElement).style.width)
    expect(width).toBe('100%')
  })
})
