/**
 * The piano roll offers a length handle only where a drag can change the length (#1322).
 *
 * WHY A BROWSER TEST. The rule itself is model-level and gated in `roll-isolation` — 1,861
 * of 5,480 corpus notes have no reachable length the pattern can hold, checked in both
 * directions against an exhaustive sweep. What no model-level check can see is whether the
 * PANEL withholds the affordance for that reason, and whether it still offers it to
 * everyone else. Those are render decisions, so they are checked where the render is.
 *
 * ⚠ EVERY ABSENCE IS PAIRED WITH A PRESENCE ON THE SAME ROW OF THE SAME DOCUMENT. In
 * `g c g c g c g c` the c at step 7 is inert and the c at step 1 is offerable — same pitch,
 * same lane, one render. Without that pairing "no handle here" cannot be told from "this
 * row was never drawn", which is the reading that would let a broken roll pass as a
 * working gate.
 *
 * ⚠ AND THE "NOTHING HAPPENED" ARM IS TAKEN AFTER AN ACCEPTED EDIT, not from rest. A press
 * on an inert note writes nothing whether or not the guard is there — with the guard the
 * press returns, without it a resize drag starts and the writer declines every frame, and
 * both leave the document byte-identical. Measured from rest that arm cannot fail. Measured
 * after an accepted resize elsewhere in the same document it asserts the accepted value
 * survives, which is a state the two behaviours could differ on.
 *
 * The fixtures are corpus minis: a sweep of short round-tripping units found 12 holding
 * both an inert and an offerable note, and these are the two smallest that address cleanly
 * — one on each of `resizeNote`'s branches (single-bar, and the multi-bar `<...>` form).
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue, pinLcmGrid } from './_appBoot'

// The tests titled `(LCM grid)` pin the shared-grid writer's results (Settings › Grid, #2294).
pinLcmGrid(test)

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
 * A point inside the resize GRAB ZONE of a cell — the panel measures that zone inward from
 * the bar's trailing edge, so the cell's centre is NOT in it for a full-width note. 88% of
 * the way across clears the zone's floor at every column width the roll draws.
 */
async function tailEdge(page: Page, key: string): Promise<{ x: number; y: number }> {
  const loc = cellLoc(page, key)
  await expect(loc, `roll cell ${key} must be drawn`).toHaveCount(1)
  const b = await loc.boundingBox()
  if (!b) throw new Error(`roll cell ${key} has no box`)
  return { x: b.x + b.width * 0.88, y: b.y + b.height / 2 }
}

const handle = (page: Page, key: string) =>
  page.locator(`[data-bottom-panel-tab="piano-roll"] [data-roll-resize="${key}"]`)

test.describe('the roll offers a length handle only where one would work (#1322)', () => {
  // `g c g c g c g c` — single-bar branch. Every note is one step long. The first seven can
  // grow (a single-bar roll spells overlap as parallel comma lanes, so a note may sustain
  // under a later onset); the last cannot, because there is nothing past the grid end, and
  // it cannot shrink either since the writer floors at 1.
  const SINGLE = '$: note("g c g c g c g c")'
  const INERT_CELL = '48:7' // c at step 7 — no writable length
  const LIVE_CELL = '48:1' // c at step 1 — same row, same document, offerable

  test('withholds the handle where no length is writable, and keeps it on the same row where one is (LCM grid)', async ({
    page,
  }) => {
    await openRoll(page, SINGLE)

    // THE PAIR. Same pitch, same lane, one render — so an absent handle cannot be
    // explained by an absent row.
    await expect(
      handle(page, '48:1'),
      'the offerable c at step 1 must keep its handle',
    ).toHaveCount(1)
    await expect(
      handle(page, '48:7'),
      'the inert c at step 7 must NOT be offered a handle',
    ).toHaveCount(0)
  })

  test('says why the handle is missing, rather than leaving the absence unexplained (LCM grid)', async ({
    page,
  }) => {
    await openRoll(page, SINGLE)

    // The whole reason #1322 exists: a refused resize left the document alone — correctly
    // — and said nothing, so a note whose length is fixed looked exactly like one whose
    // drag was broken.
    await expect(cellLoc(page, INERT_CELL)).toHaveAttribute('data-roll-resize-inert', 'true')
    await expect(cellLoc(page, INERT_CELL)).toHaveAttribute(
      'title',
      /no other length the pattern can hold/i,
    )

    // and the control says nothing, because it has nothing to explain
    await expect(cellLoc(page, LIVE_CELL)).not.toHaveAttribute('data-roll-resize-inert', 'true')
  })

  test('a note that KEEPS its handle still resizes — the gate did not take the affordance from everyone (LCM grid)', async ({
    page,
  }) => {
    await openRoll(page, SINGLE)
    // Grab the offerable c at step 1 by its trailing edge and pull it one column right.
    const from = await tailEdge(page, LIVE_CELL)
    const to = await cell(page, '48:2')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 6 })
    await page.mouse.up()

    await expect
      .poll(() => editorValue(page), { message: 'an offered handle must actually write' })
      .not.toBe(SINGLE)
  })

  test('pressing where the handle used to be writes nothing — checked against an ACCEPTED edit, not from rest (LCM grid)', async ({
    page,
  }) => {
    await openRoll(page, SINGLE)

    // 1. an accepted resize elsewhere in the same document, so the comparison below is
    //    against a CHANGED state. From rest this arm cannot fail: with the guard the press
    //    returns, without it a resize drag starts and is declined every frame, and both
    //    leave the bytes identical.
    const from = await tailEdge(page, LIVE_CELL)
    const to = await cell(page, '48:2')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => editorValue(page)).not.toBe(SINGLE)
    const accepted = await editorValue(page)

    // 2. now press the inert note's trailing edge and drag. The press is deliberately
    //    INERT rather than falling through to the move branch: on this surface a press
    //    with no drag deletes the note, so removing a handle that did nothing must not
    //    install a destructive gesture where the user had learned nothing happens.
    const inertFrom = await tailEdge(page, INERT_CELL)
    const inertTo = await cell(page, '48:5')
    await page.mouse.move(inertFrom.x, inertFrom.y)
    await page.mouse.down()
    await page.mouse.move(inertTo.x, inertTo.y, { steps: 6 })
    await page.mouse.up()

    expect(await editorValue(page), 'the accepted edit must survive, and nothing else').toBe(
      accepted,
    )
  })

  // `- - - <b3 [b3 b3]>` — the multi-bar `<...>` branch, where the cap is the next onset
  // rather than the grid end. Same shape of pairing: b3@6 keeps its handle, the two b3s in
  // the second slot do not, and all three are the same row.
  const MULTI = '$: note("- - - <b3 [b3 b3]>")'

  test('the same rule holds on the multi-bar branch (LCM grid)', async ({ page }) => {
    await openRoll(page, MULTI)

    await expect(handle(page, '59:6'), 'the offerable b3 must keep its handle').toHaveCount(1)
    // ⚠ THE HANDLE, NOT ONLY THE MARKER. An earlier version of this arm asserted the
    // `data-roll-resize-inert` attribute alone, and stayed GREEN when the render gate was
    // deleted and every note got its handle back — the marker and the handle are computed
    // from the same set but written in different places, so one can be right while the
    // other is wrong. Both ends are asserted here.
    await expect(handle(page, '59:14'), 'the inert b3 must not be offered one').toHaveCount(0)
    await expect(handle(page, '59:15'), 'nor the second b3 in that slot').toHaveCount(0)
    await expect(cellLoc(page, '59:14')).toHaveAttribute('data-roll-resize-inert', 'true')
    await expect(cellLoc(page, '59:15')).toHaveAttribute('data-roll-resize-inert', 'true')
  })
})
