/**
 * Placing a note is gated on whether the document keeps it (#1333).
 *
 * WHY A BROWSER TEST. The rule is swept at model level over the whole corpus, but what no
 * model-level check can see is whether the PANEL passes the option at all. A placement that
 * silently stayed on the cheap rule would leave every corpus arm green and the click still
 * broken, because the arms call the writer directly.
 *
 * Unlike resize, placement has no cadence question to get wrong — it is one click, so the
 * check gates the write itself rather than deferring to gesture commit.
 *
 * THE FIXTURE is a corpus mini, and the pair is ADJACENT CELLS ON ONE ROW:
 *
 *     <c2*2 g2*3 [a g] c2*6>   24 columns, 4 bars
 *
 *   c2 column 6    accepted — the document gains the note, spelled `[g2,c2]@2`
 *   c2 column 7    refused  — ungated it writes `<c2*2 [g2@2 g2@2 g2@2] [a g] c2*6>`,
 *                             which parses, re-spells `g2*3` for nothing, and does NOT
 *                             contain the note the click just made
 *
 * ⚠ THE BARS' STEP COUNTS MUST NEST (2, 3, 2, 6 all divide 6) so the roll draws one
 * shared column grid, where a half-cell like column 7 exists to be clicked. The original
 * fixture `<c2*2 g2*5 [a g]>` (2, 5, 2) is now drawn one bar at a time (#1827), as 9 cells
 * with no half-cells, so it can no longer pose this question.
 *
 * ⚠ THE PAIR IS THE POINT, and same-row adjacency is what makes it tight: "column 7 wrote
 * nothing" cannot be read as "this row is not clickable" or "the roll never received the
 * gesture" when column 6, one cell away on the same row in the same render, writes.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue, pinLcmGrid } from './_appBoot'
import { expectRefusalReported, expectNoRefusalReported } from './_console'

// The tests titled `(LCM grid)` pin the shared-grid writer's results (Settings › Grid, #2294).
pinLcmGrid(test)

const CODE = '$: note("<c2*2 g2*3 [a g] c2*6>")'
/** the accepted click — c2 joins the first g2 as a chord */
const ACCEPTED = '$: note("<c2*2 [[g2,c2]@2 g2@2 g2@2] [a g] c2*6>")'

async function openRoll(page: Page, code: string) {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 520 } })
  await seedCode(page, code)
  const grid = page.locator('[data-bottom-panel-tab="piano-roll"]')
  await expect(grid, `the roll must open for ${code}`).toHaveCount(1)
  return grid
}

/** Centre of a roll cell. Fails loudly — an un-addressable cell means the fixture moved. */
async function cell(page: Page, key: string): Promise<{ x: number; y: number }> {
  const loc = page.locator(`[data-bottom-panel-tab="piano-roll"] [data-roll-cell="${key}"]`)
  await expect(loc, `roll cell ${key} must be drawn`).toHaveCount(1)
  const b = await loc.boundingBox()
  if (!b) throw new Error(`roll cell ${key} has no box`)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

test.describe('a placed note is only written where the document keeps it (#1333)', () => {
  test('the accepted cell places the note, and the document holds it (LCM grid)', async ({ page }) => {
    await openRoll(page, CODE)
    const at = await cell(page, '36:6')
    await page.mouse.click(at.x, at.y)
    await expect.poll(() => editorValue(page)).toBe(ACCEPTED)
  })

  test('the adjacent cell, whose note the document would not keep, writes nothing at all (LCM grid)', async ({
    page,
  }) => {
    await openRoll(page, CODE)

    // The positive half FIRST, in this same render: the row takes a click one cell away.
    // Without it the assertion below is satisfied by any broken gesture.
    const ok = await cell(page, '36:6')
    await page.mouse.click(ok.x, ok.y)
    await expect
      .poll(() => editorValue(page), { message: 'the row must accept a click at column 6' })
      .toBe(ACCEPTED)

    // Back to the original, so the refusal is measured against a known document.
    await seedCode(page, CODE)
    await expect.poll(() => editorValue(page)).toBe(CODE)

    const refused = await cell(page, '36:7')
    await page.mouse.click(refused.x, refused.y)

    // Ungated this wrote a re-spelled pattern that does not contain the placed note.
    // Gated, the click leaves the document byte-identical rather than damaging it.
    await expect
      .poll(() => editorValue(page), {
        message: 'a placement the document would not keep must not be written',
      })
      .toBe(CODE)
  })
})

/**
 * AND THE REFUSAL SAYS SO (#1336).
 *
 * #1322 removed the invisible decline from this surface by gating the length handle, so
 * the gesture was never offered where it could not write. The readback gate reinstated the
 * same experience through a different door: the affordance is legitimately offered, the
 * writer accepts the gesture, and then the document declines to keep it — silently.
 *
 * ⚠ WHY REPORTING RATHER THAN GATING THE AFFORDANCE, measured rather than preferred. There
 * is no per-cell admissibility seam on this panel at all (`viewPlacesNotes` once per view,
 * `overlapAt` per cell), and building one costs p99 8,482ms with readback in it — against
 * the p99 21.7ms at which #1072 already declined a per-cell map here. The per-column lever
 * #1072 suggested is sound (2 of 7,984 columns are mixed) and still lands at p99 546ms,
 * the figure that made #1324 unshippable, recomputed every drag frame. Both gates are off
 * the table for different reasons, and resize could not be gated at offer time regardless
 * — its refusal depends on the length the drag ends at.
 *
 * ⚠ THE REPORT IS READ OFF THE CONSOLE PANEL, not off a count (#1443). These arms used
 * to read a running warning total from the status bar's console chip as a DELTA, because
 * that number mixed in every warning the session had raised — boot's included. `718c9bb3`
 * retired the status bar; the arms went on asking for the chip for months, timing out at
 * 30s apiece while both vitest gates stayed green.
 *
 * The Console rows carry the level, the runtime and the TEXT, so the assertion can now
 * say the message named THIS gesture rather than only that a number moved. Filtering to
 * `runtime: 'stave'` also makes the count absolute — boot's chatter belongs to the engine
 * runtimes — and the accepted arm below is the control that proves it.
 */
test.describe('a refused roll gesture is reported, not swallowed (#1336)', () => {
  test('the refused placement raises exactly one warning, and it names the gesture (LCM grid)', async ({
    page,
  }) => {
    await openRoll(page, CODE)

    const refused = await cell(page, '36:7')
    await page.mouse.click(refused.x, refused.y)
    // The refusal is the thing being reported, so pin it first: an unchanged document,
    // or "one warning" could be describing some other failure entirely.
    await expect.poll(() => editorValue(page)).toBe(CODE)

    await expectRefusalReported(page, "Couldn't add that note")
  })

  test('the accepted placement raises none — the report tracks the refusal, not the click (LCM grid)', async ({
    page,
  }) => {
    await openRoll(page, CODE)

    const ok = await cell(page, '36:6')
    await page.mouse.click(ok.x, ok.y)
    // PRECONDITION, not an independent pin: if the click never landed, "no warning was
    // raised" would be satisfied by a gesture that did nothing at all.
    await expect
      .poll(() => editorValue(page), { message: 'the accepted click must reach the writer' })
      .toBe(ACCEPTED)

    await expectNoRefusalReported(page)
  })
})
