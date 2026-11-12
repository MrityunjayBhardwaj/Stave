/**
 * Deleting a note is gated on whether the document reopens holding what is left (#1340).
 *
 * WHY A BROWSER TEST. The rule is swept at model level over the whole corpus, but no
 * model-level arm can see whether the PANEL passes the option at all — those arms call the
 * writer directly, so a delete that silently stayed on the cheap spelling rule would leave
 * every corpus arm green and the gesture still destructive.
 *
 * Delete has no cadence question: it is one gesture, so the check gates the write itself
 * rather than deferring to gesture commit the way a resize drag must.
 *
 * THE FIXTURE is a corpus mini, and the pair is TWO NOTES IN ONE COLUMN:
 *
 *     <g1, c1> - <c3, g4 - - >        9 columns, 3 bars
 *
 *   c3, column 2   accepted — the document loses only c3, spelling `<g4 c3 c3>`
 *   g4, column 2   refused  — ungated it wrote `<g1, c1> - <c3, ~ - - >`, which spells
 *                             and parses and reopens holding FEWER notes than the model
 *                             meant, because the rest lands inside the `,`-stack
 *
 * ⚠ THE PAIR IS THE POINT, and same-column adjacency is what makes it tight: "g4 wrote
 * nothing" cannot be read as "this column is not clickable" or "the roll never received the
 * gesture" when c3, in the same column in the same render, writes.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue, pinLcmGrid } from './_appBoot'
import { expectRefusalReported, expectNoRefusalReported } from './_console'

// The tests titled `(LCM grid)` pin the shared-grid writer's results (Settings › Grid, #2294).
pinLcmGrid(test)

const CODE = '$: note("<g1, c1> - <c3, g4 - - >")'
/** the accepted delete — c3 goes, and the bar re-spells without it */
const ACCEPTED = '$: note("<g1, c1> - <g4 c3 c3>")'

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
  // The roll opens on its notes (#1850), and this fixture spans c1..g4 — taller than the
  // view — so g4 starts above it. Scroll to the cell first, as a user would; a centre
  // read off-screen is a click on nothing, which the byte-identical arm cannot tell
  // from a refused delete.
  await loc.scrollIntoViewIfNeeded()
  const b = await loc.boundingBox()
  if (!b) throw new Error(`roll cell ${key} has no box`)
  const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  // …and prove the press will land ON it. "The document is byte-identical" is also what
  // a click on nothing leaves, so without this the refused-delete arm stays green with
  // no gesture at all — it did, when #1850 moved g4 above the view.
  const hit = await page.evaluate(
    ({ x, y }) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-roll-cell]')?.getAttribute('data-roll-cell') ?? null,
    at,
  )
  expect(hit, `a press at roll cell ${key}'s centre must land on it`).toBe(key)
  return at
}

test.describe('a note is only deleted where the document keeps the rest (#1340)', () => {
  test('the accepted note is deleted, and the document re-spells without it (LCM grid)', async ({ page }) => {
    await openRoll(page, CODE)
    const at = await cell(page, '48:2')
    await page.mouse.click(at.x, at.y)
    await expect.poll(() => editorValue(page)).toBe(ACCEPTED)
  })

  test('the note in the same column, whose removal the document would not keep, writes nothing (LCM grid)', async ({
    page,
  }) => {
    await openRoll(page, CODE)
    const at = await cell(page, '67:2')
    await page.mouse.click(at.x, at.y)
    // The document must be BYTE-IDENTICAL to what it was — a refusal leaves it alone.
    await expect
      .poll(() => editorValue(page), {
        message: 'a delete the document would not keep must not be written',
      })
      .toBe(CODE)
  })
})

/**
 * ⚠ THE REPORT IS READ OFF THE CONSOLE PANEL, not off a count (#1443).
 *
 * These two arms used to read a running warning total from the status bar's console
 * chip as a DELTA, because that number mixed in every warning the session had raised.
 * `718c9bb3` retired the status bar and the arms went on asking for the chip for
 * months, timing out at 30s apiece while both vitest gates stayed green.
 *
 * The rows carry the level, the runtime and the TEXT, so the assertion can now say the
 * message named this gesture rather than only that a number moved — and filtering to
 * `runtime: 'stave'` makes the count absolute, with the accepted arm as its control.
 * Helper shared in `_console.ts` so the next retirement breaks in one place.
 */
test.describe('a refused delete is reported, not swallowed (#1340)', () => {
  test('the refused delete raises exactly one warning, and it names the gesture (LCM grid)', async ({
    page,
  }) => {
    await openRoll(page, CODE)

    const at = await cell(page, '67:2')
    await page.mouse.click(at.x, at.y)
    // The refusal is what we are reporting on, so pin it first: the document must be
    // byte-identical, or "one warning" could be describing some other failure.
    await expect.poll(() => editorValue(page)).toBe(CODE)

    await expectRefusalReported(page, "Couldn't delete that note")
  })

  test('the accepted delete raises none — the report tracks the refusal, not the click (LCM grid)', async ({
    page,
  }) => {
    await openRoll(page, CODE)

    const at = await cell(page, '48:2')
    await page.mouse.click(at.x, at.y)
    // PRECONDITION, not an independent pin: if the click never landed, "no warning was
    // raised" would be satisfied by a gesture that did nothing at all.
    await expect
      .poll(() => editorValue(page), { message: 'the accepted click must reach the writer' })
      .toBe(ACCEPTED)

    await expectNoRefusalReported(page)
  })
})
