/**
 * The piano roll's move and delete writers, observed in the real app (#1325/#1326).
 *
 * WHY A BROWSER TEST. Both gestures were consolidated into `place.ts` and verified
 * entirely at model level — a corpus sweep plus a vitest arm. What no model-level
 * check can see is whether the PANEL routes a decline correctly, because a decline
 * and a dropped write produce the same document: none. The distinction lives in the
 * gesture, so it is checked where the gesture is.
 *
 * Three of these had no equivalent anywhere in the suite, and one of them is a bug
 * that was caught by hand rather than by a gate:
 *
 *   - a note dragged AWAY AND BACK must come home. Mid-drag the document sits at the
 *     last accepted position, not at the base, so "declined" has to mean LEAVE IT
 *     ALONE while a drop on the note's own cell has to mean GO HOME. `moveNote`
 *     keeps them apart by IDENTITY (a refusal is the input; a restore is an
 *     equal-but-new model). Get it wrong and the note stays away — silently.
 *   - a refused MOVE must leave the document byte-identical.
 *   - a refused DELETE must leave the document byte-identical.
 *
 * ⚠ EVERY REFUSAL IS PAIRED WITH AN ACCEPTED GESTURE ON THE SAME GRABBED NOTE,
 * differing only in the target step. Without the pair, "the document did not change"
 * cannot be told from "the gesture never reached the writer at all" — which is the
 * reading that would let a broken drag pass as a working decline.
 *
 * The refusal fixtures are corpus minis, not constructed cases: a sweep of 387
 * hand-typeable corpus units found 1,650 refusing move drags and 33 refusing
 * deletes, and these are the smallest that address cleanly.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue, pinLcmGrid } from './_appBoot'

// The tests titled `(LCM grid)` pin the shared-grid writer's results (Settings › Grid, #2294).
pinLcmGrid(test)

/** Open the app with the roll already on screen and tall enough to address. */
async function openRoll(page: Page, code: string) {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 520 } })
  await seedCode(page, code)
  const grid = page.locator('[data-bottom-panel-tab="piano-roll"]')
  await expect(grid, `the roll must open for ${code}`).toHaveCount(1)
  return grid
}

/** Centre of a roll cell. Fails loudly rather than returning null — an
 *  un-addressable cell means the fixture changed, not that the test may skip. */
async function cell(page: Page, key: string): Promise<{ x: number; y: number }> {
  const loc = page.locator(`[data-bottom-panel-tab="piano-roll"] [data-roll-cell="${key}"]`)
  await expect(loc, `roll cell ${key} must be drawn`).toHaveCount(1)
  const b = await loc.boundingBox()
  if (!b) throw new Error(`roll cell ${key} has no box`)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** Press at `from`, release at `to`. `steps` is deliberate: with 1, exactly ONE
 *  mousemove is dispatched, so only the destination cell is entered. A refusal
 *  test needs that — an accepted intermediate frame would write first, and the
 *  "unchanged" reading would then be about that write rather than the refusal. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 1) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up()
}

test.describe('roll writers decline instead of quietly doing nothing (#1325/#1326)', () => {
  test('a drag moves the note, and the document says so', async ({ page }) => {
    const code = '$: note("c3 ~ ~ ~")'
    await openRoll(page, code)
    await drag(page, await cell(page, '48:0'), await cell(page, '52:2'), 10)
    await expect.poll(() => editorValue(page)).toBe('$: note("~ ~ e3 ~")')
  })

  test('dragging away and back inside ONE drag brings the note home', async ({ page }) => {
    const code = '$: note("c3 ~ ~ ~")'
    await openRoll(page, code)
    const home = await cell(page, '48:0')
    const away = await cell(page, '52:2')

    await page.mouse.move(home.x, home.y)
    await page.mouse.down()
    await page.mouse.move(away.x, away.y, { steps: 10 })
    // the note must genuinely have travelled — otherwise the restore below is
    // satisfied by a drag that never moved anything.
    await expect.poll(() => editorValue(page)).toBe('$: note("~ ~ e3 ~")')
    await page.mouse.move(home.x, home.y, { steps: 10 })
    await page.mouse.up()

    await expect.poll(() => editorValue(page)).toBe(code)
  })

  test('dragging away, then back as a SECOND drag, brings the note home', async ({ page }) => {
    const code = '$: note("c3 ~ ~ ~")'
    await openRoll(page, code)
    await drag(page, await cell(page, '48:0'), await cell(page, '52:2'), 10)
    await expect.poll(() => editorValue(page)).toBe('$: note("~ ~ e3 ~")')
    await drag(page, await cell(page, '52:2'), await cell(page, '48:0'), 10)
    await expect.poll(() => editorValue(page)).toBe(code)
  })

  test('a refused DROP leaves the document where the drag left it — it does not snap home (LCM grid)', async ({ page }) => {
    // Grabbing b3@6: every pitch is declined at step 7 and taken at every other
    // step, so the two drops below differ only in the target step.
    //
    // ⚠ THE REFUSAL IS REACHED MID-DRAG, ON PURPOSE. A refusal taken straight from
    // the gesture's start cannot discriminate: leaving the document alone and
    // writing the base back produce the SAME bytes, so the test would pass with the
    // decline branch deleted. Only once an intermediate frame has been ACCEPTED do
    // the two answers differ — "leave it alone" holds the accepted position, while
    // writing the base back snaps the note home. Verified by deleting
    // `if (next === d.base) return` from the panel: this test, and only this test,
    // reddens.
    const code = '$: note("- - - <b3 [b3 b3]>")'
    const MOVED = '$: note("<[~ ~ c4@2 ~ ~ ~ ~] [~ ~ ~ ~ ~ ~ b3 b3]>")'
    await openRoll(page, code)

    const grab = await cell(page, '59:6')
    const accepted = await cell(page, '60:2') // c4 @ step 2 — the writer takes this
    const declined = await cell(page, '60:7') // c4 @ step 7 — the writer declines this

    await page.mouse.move(grab.x, grab.y)
    await page.mouse.down()
    // one mousemove per hop, so exactly one cell is entered each time
    await page.mouse.move(accepted.x, accepted.y)
    await expect.poll(() => editorValue(page), { message: 'the accepted hop must write' }).toBe(MOVED)
    await page.mouse.move(declined.x, declined.y)
    await page.mouse.up()

    expect(await editorValue(page), 'a declined drop must hold the last accepted position').toBe(MOVED)
  })

  test('a refused DROP taken from rest leaves the document byte-identical', async ({ page }) => {
    // The other half: nothing accepted first, so the document must come back
    // untouched. This one is a PIN rather than a discriminator — before the writer
    // existed the write simply serialized to null and was dropped, which produced
    // the same bytes. It reddens if a later change ever forces a write here.
    const code = '$: note("- - - <b3 [b3 b3]>")'
    await openRoll(page, code)
    await drag(page, await cell(page, '59:6'), await cell(page, '60:7'))
    expect(await editorValue(page)).toBe(code)
  })

  test('removing a note changes the document', async ({ page }) => {
    await openRoll(page, '$: note("c3 e3 g3 ~")')
    await page.locator('[data-bottom-panel-tab="piano-roll"] [data-roll-cell="48:0"]').click()
    await expect.poll(() => editorValue(page)).toBe('$: note("~ e3 g3 ~")')
  })

  test('a refused DELETE leaves the document alone — and the same row deletes fine elsewhere (LCM grid)', async ({ page }) => {
    // Numeric rows, so the row token IS the number. Deleting 4@3 is declined and
    // 4@0 is taken — one row, so the pair differs only in the step.
    //
    // A PIN, not a discriminator: delete fires once, so there is no accepted
    // intermediate for a refusal to be told apart from, and before the writer the
    // null write was dropped to the same effect. What it holds is that a declined
    // delete never starts writing, while the paired accepted one still does.
    //
    // ⚠ THE FIXTURE MOVED, AND THE OLD ONE WAS PINNING A DEFECT (#1340). It was
    // `<0 - - - - <- 0>>*6`, whose delete at 0@11 this test asserted "must write" —
    // and that write is one of the five the readback gate now refuses, because the
    // rest lands inside the nested alternation and the document reopens holding
    // fewer notes than the model meant. Re-fixtured rather than re-expected: the
    // property under test is the accepted/declined PAIR, and that property is real,
    // so it needs a fixture whose accepted half is genuinely admissible. On the old
    // fixture no delete is — all three are refused — so the pair cannot be shown
    // there at all any more.
    const code = '$: note("<0 2 0 4>*4, <4 6 4 8>*2, -4*4")'
    await openRoll(page, code)

    await cell(page, '4:3') // assert it is addressable before clicking it
    await page.locator('[data-bottom-panel-tab="piano-roll"] [data-roll-cell="4:3"]').click()
    await expect(await editorValue(page), 'a declined delete must not touch the document').toBe(code)

    await page.locator('[data-bottom-panel-tab="piano-roll"] [data-roll-cell="4:0"]').click()
    await expect
      .poll(() => editorValue(page), { message: 'the paired accepted delete must write' })
      .toBe('$: note("<0 2 0 4>*4, <~ 6 4 8>*2, -4*4")')
  })
})
