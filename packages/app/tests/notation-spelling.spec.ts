/**
 * The write path must not re-spell your pattern — observed through the REAL app.
 *
 * Three fixes landed at one seam in three sessions (#1117, #1121, #1123): a velocity
 * drag and a look-closer/come-back both rewrote how a pattern was spelled, without
 * moving a note. All three were measured headlessly — the notation modules under
 * vitest, and Strudel itself as the oracle for what the document plays.
 *
 * NONE of them was ever observed in a browser, and this file is why that mattered:
 *
 *   THE FIXTURES AT THIS SEAM WERE ALL PATTERNS THAT CANNOT EXPRESS THE DEFECT.
 *   `resolution.spec.ts` drives refine→collapse on `s("bd ~ sn ~")` and
 *   `velocity.spec.ts` drags a cell on `s("bd hh sn hh")`. Both are FLAT. A flat
 *   pattern spells its own content uniquely, so the rebuild those bugs fell back to
 *   reproduces it byte-for-byte. Every assertion here was green throughout, and could
 *   not have gone red even in principle.
 *
 * So the fixtures below all carry internal structure — a group, a repeat operator, an
 * alternation — which is the one property that makes a re-spelling visible. The
 * question to ask of any fixture at this seam: *what would this test do if the bug
 * were present?*
 *
 * WHAT IS ASSERTED HERE, AND WHAT IS NOT. This file asserts SPELLING through the real
 * gesture — a real mouse drag, a real click on the Slots control, the document read back
 * out of the editor. The clause about what the document PLAYS is asked of Strudel in
 * `tests/parity-corpus/1123-gain-preserves-spelling.test.ts`; it belongs where the engine
 * can be queried directly, and is not duplicated here.
 */
import { test, expect, type Page, type Locator } from '@playwright/test'
import { slotsControl, preset } from './_resolutionControl'

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 15_000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } })
        .monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 15_000 },
  )
}

async function setStrudelCode(page: Page, code: string): Promise<void> {
  const ok = await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } })
      .monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null
      focus: () => void
      setPosition: (p: { lineNumber: number; column: number }) => void
    }>
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    if (!target) return false
    target.getModel()?.setValue(c)
    // inside the head mini, so the panel binds to this statement
    target.setPosition({ lineNumber: 1, column: 8 })
    target.focus()
    return true
  }, code)
  expect(ok).toBe(true)
  await page.waitForTimeout(250)
}

async function strudelValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } })
      .monaco
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
  await page.waitForTimeout(300)
  return drawer
}

/** Press on a cell/bar, drag vertically by `dy` px (down = softer), release. */
async function dragVertical(page: Page, target: Locator, dy: number): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('drag target has no box')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx, cy + dy, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(150)
}

/** the head mini as written in the document — the thing a re-spelling would move */
function headMini(code: string): string {
  return code.match(/"([^"]*)"/)?.[1] ?? ''
}

test.describe('a velocity drag leaves the notation alone (#1123)', () => {
  // `bd [hh hh] sn cp` opens at 8 columns: the group subdivides column 1. The rebuild
  // this defect fell back to spelled it `bd _ hh hh sn _ cp _` — every hit in the right
  // place, the grouping gone. 220 grid units corpus-wide.
  const GRID = '$: s("bd [hh hh] sn cp")'

  test('grid: dragging a cell writes a .gain and does NOT respell the head mini', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await boot(page)
    await setStrudelCode(page, GRID)
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    await expect(grid).toHaveCount(1)

    // the group's own two cells — this is the structure the rebuild would flatten
    await expect(grid.locator('[data-seq-cell="1:2"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-seq-cell="1:3"]')).toHaveAttribute('aria-pressed', 'true')

    await dragVertical(page, grid.locator('[data-seq-cell="1:2"]'), 40)

    const after = await strudelValue(page)
    // the gain landed…
    expect(after).toMatch(/\.gain\("/)
    // …and the notation is untouched. Before the fix this read `bd _ hh hh sn _ cp _`.
    expect(headMini(after)).toBe('bd [hh hh] sn cp')
    expect(errors).toEqual([])
  })

  test('grid: an operator survives the same drag (`bd*2 sn cp`)', async ({ page }) => {
    // A second shape, because `*2` is a different way of having structure than a group
    // and the rebuild loses it the same way (`bd bd sn ~ cp ~`).
    await boot(page)
    await setStrudelCode(page, '$: s("bd*2 sn cp")')
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    await expect(grid).toHaveCount(1)
    await dragVertical(page, grid.locator('[data-seq-cell="0:0"]'), 40)
    const after = await strudelValue(page)
    expect(after).toMatch(/\.gain\("/)
    expect(headMini(after)).toBe('bd*2 sn cp')
  })

  test('roll: dragging a velocity bar does NOT respell the head mini', async ({ page }) => {
    // The roll was measured separately rather than assumed: its gain mini emits one
    // token per note GROUP with `@duration`, a coupling the grid's flat run does not
    // have. Same answer — 156 roll units.
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await boot(page)
    await setStrudelCode(page, '$: note("c3 [e3 g3] c4")')
    const drawer = await openPattern(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(roll).toHaveCount(1)
    await expect(roll.locator('[data-roll-velocity-lane]')).toHaveCount(1)

    await dragVertical(page, roll.locator('[data-vel-col="0"]'), 40)

    const after = await strudelValue(page)
    expect(after).toMatch(/\.gain\("/)
    expect(headMini(after)).toBe('c3 [e3 g3] c4')
    expect(errors).toEqual([])
  })
})

test.describe('looking closer and coming back returns the pattern as written (#1121)', () => {
  // The refine→collapse round trip. `resolution.spec.ts` already asserts this, on
  // `s("bd ~ sn ~")` — flat, so the collapse's fallback rebuild IS the identity there
  // and the assertion cannot fail. On a structured pattern it could, and did: the
  // collapse handed the writer a model whose description still claimed the refined
  // width, the writer correctly refused it and rebuilt flat. 362 grid / 263 roll units.
  const GRID = '$: s("bd [hh hh] sn cp")'

  // ⚠ AN UNEDITED ROUND TRIP IS THE WEAK FORM, AND IT IS LABELLED AS SUCH. The writer
  // copies unedited regions verbatim at every scale, so a collapse that did nothing
  // satisfies it. MEASURED here rather than argued: with #1121's fix reverted and the
  // dist rebuilt, the two `refine and come back` clauses below stay GREEN and only the
  // EDITED clauses go red. They are kept because they assert a real and separate
  // property — that looking closer never writes — but they do not cover #1121, and the
  // clauses that do are the two `a velocity drag made through a REFINED view` cases.
  test('grid: refine to 16 and back to 8 never writes (the no-write property, not #1121)', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await boot(page)
    await setStrudelCode(page, GRID)
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    const slots = slotsControl(drawer)

    // the document's own resolution is 8 (the group subdivides), and 16 is offered
    // as a VIEW — it announces that before it is pressed
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(8)
    await expect((await preset(slots, 8))).toHaveAttribute(
      'data-resolution-active',
      'true',
    )
    await expect((await preset(slots, 16))).toHaveAttribute(
      'data-resolution-view',
      'true',
    )

    await (await preset(slots, 16)).click()
    await page.waitForTimeout(150)
    // the view really did refine…
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(16)
    // …without writing
    expect(await strudelValue(page)).toBe(GRID)

    // and coming back returns the pattern AS WRITTEN — not a flattened equivalent
    await (await preset(slots, 8)).click()
    await page.waitForTimeout(150)
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(8)
    expect(await strudelValue(page)).toBe(GRID)
    expect(errors).toEqual([])
  })

  test('grid: a velocity drag made through a REFINED view still writes the original spelling', async ({
    page,
  }) => {
    // The composition of the two fixes, which is the shape a user actually hits: look
    // closer, then adjust a velocity. The write must spell the document, not the view.
    await boot(page)
    await setStrudelCode(page, GRID)
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    const slots = slotsControl(drawer)

    await (await preset(slots, 16)).click()
    await page.waitForTimeout(150)
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(16)
    expect(await strudelValue(page)).toBe(GRID)

    // at 16 columns the group's first hit sits at column 4 — asserted, not assumed,
    // because a drag on an empty cell would write nothing and the clause would pass
    // for the wrong reason
    await expect(grid.locator('[data-seq-cell="1:4"]')).toHaveAttribute('aria-pressed', 'true')
    await dragVertical(page, grid.locator('[data-seq-cell="1:4"]'), 40)
    const after = await strudelValue(page)
    expect(after).toMatch(/\.gain\("/)
    expect(headMini(after)).toBe('bd [hh hh] sn cp')
  })

  test('roll: refine to 16 and back to 8 never writes (the no-write property, not #1121)', async ({ page }) => {
    // The roll gets its own clause rather than inheriting the grid's. This surface was
    // measured separately at every step of the arc — its gain mini emits one token per
    // note GROUP with `@duration`, a coupling the grid's flat run does not have — and
    // #1121 hit 263 roll units of its own. `c3 [e3 g3] c4 e4` opens at 8 columns
    // because the group subdivides, so 16 is offered as a view.
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await boot(page)
    const SRC = '$: note("c3 [e3 g3] c4 e4")'
    await setStrudelCode(page, SRC)
    const drawer = await openPattern(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    const slots = slotsControl(drawer)
    await expect(roll).toHaveCount(1)
    await expect(roll.locator('[data-vel-col]')).toHaveCount(8)

    await (await preset(slots, 16)).click()
    await page.waitForTimeout(150)
    await expect(roll.locator('[data-vel-col]')).toHaveCount(16)
    expect(await strudelValue(page)).toBe(SRC)

    await (await preset(slots, 8)).click()
    await page.waitForTimeout(150)
    await expect(roll.locator('[data-vel-col]')).toHaveCount(8)
    expect(await strudelValue(page)).toBe(SRC)
    expect(errors).toEqual([])
  })

  test('roll: a velocity drag made through a REFINED view still writes the original spelling', async ({
    page,
  }) => {
    // The roll's half of the clause that actually covers #1121 — an EDIT made from a
    // refined view, which is the only form that forces the collapse to hand the writer
    // a model and so the only one that can catch a stale description. Given its own
    // clause rather than inherited from the grid, because every step of this arc that
    // asked the roll separately got a different answer from the grid.
    await boot(page)
    const SRC = '$: note("c3 [e3 g3] c4 e4")'
    await setStrudelCode(page, SRC)
    const drawer = await openPattern(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    const slots = slotsControl(drawer)

    await (await preset(slots, 16)).click()
    await page.waitForTimeout(150)
    await expect(roll.locator('[data-vel-col]')).toHaveCount(16)
    expect(await strudelValue(page)).toBe(SRC)

    await dragVertical(page, roll.locator('[data-vel-col="0"]'), 40)
    const after = await strudelValue(page)
    expect(after).toMatch(/\.gain\("/)
    expect(headMini(after)).toBe('c3 [e3 g3] c4 e4')
  })

  /**
   * #1964 — a NOTE edit made through a refined view keeps the view. The velocity drag above
   * changes only `.gain`, so it never saw that the zoom reset whenever the notes' text
   * changed: the panel took its own edit for a move to another pattern. Main's bundle drew
   * 4 columns after this click.
   */
  test('roll: a note added through a refined view keeps the view (#1964)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 e3 g3 c4")')
    const drawer = await openPattern(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    const slots = slotsControl(drawer)
    await expect(roll.locator('[data-vel-col]')).toHaveCount(4)

    await (await preset(slots, 8)).click()
    await expect(roll.locator('[data-vel-col]')).toHaveCount(8)

    // drawn column 2 is the document's column 1, so the note fits the document as written
    await roll.locator('[data-roll-cell="60:2"]').click()
    await expect
      .poll(() => strudelValue(page), { timeout: 8_000 })
      .toBe('$: note("c3 [e3,c4] g3 c4")')
    await page.waitForTimeout(400)

    await expect(roll.locator('[data-vel-col]'), 'the zoom the user set').toHaveCount(8)
    await expect(slots.locator('[data-resolution-current]')).toHaveAttribute(
      'data-resolution-current',
      '8',
    )
  })
})

test.describe('looking closer at an alternation draws it (#1117)', () => {
  test('grid: `<bd sn> hh` refines to a view without touching the document', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await boot(page)
    const SRC = '$: s("<bd sn> hh")'
    await setStrudelCode(page, SRC)
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    const slots = slotsControl(drawer)

    // it DRAWS — the alternation used to be refused rather than rendered
    await expect(grid).toHaveCount(1)
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(4)

    await (await preset(slots, 8)).click()
    await page.waitForTimeout(150)
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(8)
    expect(await strudelValue(page)).toBe(SRC)

    await (await preset(slots, 4)).click()
    await page.waitForTimeout(150)
    expect(await strudelValue(page)).toBe(SRC)
    expect(errors).toEqual([])
  })

  test('grid: `bd@2 sn cp` offers a finer view, and taking it writes nothing (#1120)', async ({
    page,
  }) => {
    // A HELD NOTE, which is the property the fixtures at this seam were missing next.
    // The three clauses above all use unit-length notes; this one does not.
    //
    // ⚠ WHAT GOING RED HERE ACTUALLY LOOKS LIKE, observed rather than assumed. Revert
    // the writer fix and the "8" button is NOT disabled — it comes back as
    // `title="8 slots — keeps timing"`, i.e. offered as a lossless WRITE with no
    // `data-resolution-view`. So on this fixture the pre-fix harm is not "you cannot
    // look closer", it is "looking closer rewrites your file": the free zone declined,
    // and the click fell through to the branch below it, which writes. Patterns whose
    // doubled width is not reachable losslessly get the disabled button the issue
    // describes instead. One cause, two faces, and the attribute is what tells them
    // apart — which is why this asserts the attribute and not merely enabledness.
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await boot(page)
    const SRC = '$: s("bd@2 sn cp")'
    await setStrudelCode(page, SRC)
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    const slots = slotsControl(drawer)

    await expect(grid).toHaveCount(1)
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(4)

    // THE CLAUSE THAT GOES RED WITHOUT THE FIX: the target was not offered at all
    await expect((await preset(slots, 8))).toHaveAttribute(
      'data-resolution-view',
      'true',
    )

    await (await preset(slots, 8)).click()
    await page.waitForTimeout(150)
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(8)
    expect(await strudelValue(page)).toBe(SRC)

    await (await preset(slots, 4)).click()
    await page.waitForTimeout(150)
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(4)
    expect(await strudelValue(page)).toBe(SRC)
    expect(errors).toEqual([])
  })
})
