/**
 * A roll resize is settled against what the document will REOPEN as (#1331).
 *
 * WHY A BROWSER TEST, when the rule itself is swept at model level over the whole corpus:
 * the rule lives in the writer, but the CADENCE lives in the panel. The check parses, so
 * it cannot run per pointermove — gating the writer on it there took p99 to 549ms and was
 * reverted (#1324). It therefore runs exactly once, when the gesture commits on pointerup,
 * and nothing at model level can see whether the panel actually calls it, calls it with
 * the gesture's own final ask, or puts the document back when it declines. Those are
 * properties of the gesture, so they are checked where the gesture is.
 *
 * THE FIXTURE is a corpus mini, not a constructed case — the smallest that carries BOTH
 * arms on one pattern:
 *
 *     [c3@3 e3] [~ g2@2 b2]        c3@0 d=3 · e3@3 d=1 · g2@5 d=2 · b2@7 d=1
 *
 *   accepted   c3's tail dragged one column right (d 3 → 4) writes, keeping all four notes
 *   refused    g2's tail dragged one column right (d 2 → 3) would write `[c3@3 e3] [~ g2@3]`
 *              — which parses perfectly and has LOST b2
 *
 * ⚠ THE REFUSAL ARM REACHES THE REFUSAL THROUGH AN OBSERVABLE LOSSY STATE, and that is the
 * point of its shape rather than a flourish. Every frame of the drag writes under the cheap
 * rule, so mid-gesture the document really does hold the note-losing spelling; the arm
 * asserts that FIRST. Without it, "the document is unchanged at the end" cannot be told
 * from "the drag never reached the writer at all", which is the reading that lets a broken
 * gesture pass as a working decline. Asserting the restore from a state that never moved
 * is an assertion that cannot fail.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue, pinLcmGrid } from './_appBoot'
import { expectRefusalReported, expectNoRefusalReported } from './_console'

// The tests titled `(LCM grid)` pin the shared-grid writer's results (Settings › Grid, #2294).
pinLcmGrid(test)

const CODE = '$: note("[c3@3 e3] [~ g2@2 b2]")'
/** what the per-frame rule writes for the refused ask — note that b2 is gone */
const LOSSY_MID_DRAG = '$: note("[c3@3 e3] [~ g2@3]")'
/** the accepted resize, all four notes intact */
const ACCEPTED = '$: note("[c3@4, ~ ~ ~ e3] [~ g2@2 b2]")'

async function openRoll(page: Page, code: string) {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 520 } })
  await seedCode(page, code)
  const grid = page.locator('[data-bottom-panel-tab="piano-roll"]')
  await expect(grid, `the roll must open for ${code}`).toHaveCount(1)
  return grid
}

const cellLoc = (page: Page, key: string) =>
  page.locator(`[data-bottom-panel-tab="piano-roll"] [data-roll-cell="${key}"]`)

/** Centre of a roll cell. Fails loudly — an un-addressable cell means the fixture moved. */
async function cell(page: Page, key: string): Promise<{ x: number; y: number }> {
  const loc = cellLoc(page, key)
  await expect(loc, `roll cell ${key} must be drawn`).toHaveCount(1)
  const b = await loc.boundingBox()
  if (!b) throw new Error(`roll cell ${key} has no box`)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/**
 * A point inside a cell's resize GRAB ZONE — measured inward from the bar's trailing edge,
 * so a full-width note's centre is NOT in it. 88% across clears the zone's floor at every
 * column width the roll draws (the figure `roll-resize-affordance.spec.ts` established).
 */
async function tailEdge(page: Page, key: string): Promise<{ x: number; y: number }> {
  const loc = cellLoc(page, key)
  await expect(loc, `roll cell ${key} must be drawn`).toHaveCount(1)
  const b = await loc.boundingBox()
  if (!b) throw new Error(`roll cell ${key} has no box`)
  return { x: b.x + b.width * 0.88, y: b.y + b.height / 2 }
}

test.describe('a roll resize is settled against the reopened document (#1331)', () => {
  test('an accepted resize writes, and keeps every voice (LCM grid)', async ({ page }) => {
    // The positive half of the pair. Without it, the refusal arm below cannot tell a
    // working decline from a resize gesture that never functioned at all.
    await openRoll(page, CODE)
    const from = await tailEdge(page, '48:2')
    const to = await cell(page, '48:3')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => editorValue(page)).toBe(ACCEPTED)
  })

  test('a resize that would lose a voice is taken back when the gesture commits (LCM grid)', async ({
    page,
  }) => {
    await openRoll(page, CODE)
    const from = await tailEdge(page, '43:6')
    const to = await cell(page, '43:7')

    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 6 })

    // MID-DRAG: the cheap per-frame rule has really written the note-losing spelling.
    // This is the defect, live, and asserting it is what makes the restore below mean
    // something — the document has demonstrably moved before the gesture ends.
    await expect
      .poll(() => editorValue(page), {
        message: 'the per-frame rule must write the lossy spelling mid-drag',
      })
      .toBe(LOSSY_MID_DRAG)

    await page.mouse.up()

    // ON COMMIT: the readback check refuses, and the document goes home byte-for-byte.
    await expect
      .poll(() => editorValue(page), {
        message: 'committing a resize that cannot reopen intact must restore the original',
      })
      .toBe(CODE)
  })
})

/**
 * AND THE SNAP-BACK IS EXPLAINED (#1336).
 *
 * Resize is the case that most needs saying and the ONE THAT CANNOT BE GATED AT OFFER
 * TIME AT ALL: the refusal depends on the length the drag ends at, which does not exist
 * when the handle is drawn. #1322 could gate the handle on whether a resize was possible;
 * nothing can gate it on whether THIS resize will reopen intact.
 *
 * It is also the most confusing refusal to receive, because something visibly happens —
 * the drag tracks the pointer the whole way, the bar grows, and then the note returns to
 * its original length on release. Without a message that reads as the editor breaking.
 *
 * ⚠ THE REPORT IS READ OFF THE CONSOLE PANEL, not off a count (#1443). These arms used to
 * read a running warning total from the status bar's console chip as a DELTA, because that
 * number mixed in every warning the session had raised. `718c9bb3` retired the status bar
 * and the arms went on asking for the chip for months, timing out at 30s apiece while both
 * vitest gates stayed green. The Console rows carry level, runtime and TEXT, so the
 * assertion can now say the message named THIS gesture; `runtime: 'stave'` makes the count
 * absolute, and the accepted arm below is the control that proves it.
 */
test.describe('a refused resize says why the note went back (#1336)', () => {
  test('the refused resize raises exactly one warning, and it names the gesture', async ({
    page,
  }) => {
    await openRoll(page, CODE)

    const from = await tailEdge(page, '43:6')
    const to = await cell(page, '43:7')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 6 })
    await page.mouse.up()

    // The snap-back is what is being explained, so pin it first — a resize that never
    // reached the writer would leave the document here too, and say nothing.
    await expect.poll(() => editorValue(page)).toBe(CODE)

    await expectRefusalReported(page, "Couldn't set that length")
  })

  test('the accepted resize raises none (LCM grid)', async ({ page }) => {
    await openRoll(page, CODE)

    const from = await tailEdge(page, '48:2')
    const to = await cell(page, '48:3')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 6 })
    await page.mouse.up()

    // PRECONDITION, not an independent pin: a drag that never reached the writer would
    // satisfy "no warning" for the wrong reason.
    await expect
      .poll(() => editorValue(page), { message: 'the accepted resize must reach the writer' })
      .toBe(ACCEPTED)

    await expectNoRefusalReported(page)
  })
})
