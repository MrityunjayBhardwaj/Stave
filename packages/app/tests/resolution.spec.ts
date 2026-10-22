/**
 * Grid resolution — #479, relocated to the Pattern inspector by #601.
 *
 * The "Slots" 4 / 8 / 16 / 32 / 64 control SETS the grid to an absolute column
 * count: a lossless ×2/÷2 when the ratio allows (hits keep their position), else
 * a quantize (notes snap to the nearest new slot, collisions merge) so ANY
 * pattern can be coarsened. It used to sit in each grid header; #601 moved it
 * into the Pattern inspector (`[data-mixer-body]`), lifted from the active grid
 * which still owns the model + write-back. Verified by BOTH the rendered grid
 * and the written-back source, and that the buttons live in the inspector, not
 * the grid.
 */
import { test, expect, type Page, type Locator } from '@playwright/test'
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

async function setStrudelCode(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null
      focus: () => void
      setPosition: (p: { lineNumber: number; column: number }) => void
    }>
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    target?.getModel()?.setValue(c)
    target?.setPosition({ lineNumber: 1, column: 6 })
    target?.focus()
  }, code)
  await page.waitForTimeout(200)
}

async function getStrudelCode(page: Page): Promise<string> {
  return page.evaluate(() => {
    const monaco = (window as unknown as {
      monaco?: { editor?: { getEditors?: () => unknown[] } }
    }).monaco
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

test.describe('Grid resolution 4/8/16/32/64 (#479, in the inspector #601)', () => {
  test('the Slots control is in the inspector, not the grid header', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd ~ sn ~")')
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    const slots = slotsControl(drawer)
    // moved out of the grid…
    await expect(grid.locator('[data-resolution-step]')).toHaveCount(0)
    await expect(grid.locator('[data-resolution-current]')).toHaveCount(0)
    // …and into the inspector, whose resting shape is `÷2 [n] ×2` (#1059)
    await expect(slots.locator('[data-resolution-current]')).toHaveCount(1)
    await expect(slots.locator('[data-resolution-halve]')).toHaveCount(1)
    await expect(slots.locator('[data-resolution-double]')).toHaveCount(1)
    // the presets are BEHIND the readout now — none in the DOM until it is opened,
    // which is the gesture itself and so worth asserting rather than assuming
    await expect(slots.locator('[data-resolution-step]')).toHaveCount(0)
    await slots.locator('[data-resolution-current]').dblclick()
    await expect(slots.locator('[data-resolution-step]')).toHaveCount(5)
  })

  test('step grid: choosing 8 draws 8 columns and leaves the document alone (#1057)', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await boot(page)
    await setStrudelCode(page, '$: s("bd ~ sn ~")')
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    const slots = slotsControl(drawer)

    // 4 columns before; "4" is the active preset
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(4)
    await expect((await preset(slots, 4))).toHaveAttribute(
      'data-resolution-active',
      'true',
    )
    // …and 8 announces itself as a VIEW before it is pressed, so a user can tell
    // that it is safe without having to press it and read their file afterwards.
    await expect((await preset(slots, 8))).toHaveAttribute(
      'data-resolution-view',
      'true',
    )

    await (await preset(slots, 8)).click()
    await page.waitForTimeout(120)

    // THE GRID REFINES…
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(8)
    await expect((await preset(slots, 8))).toHaveAttribute(
      'data-resolution-active',
      'true',
    )
    // …AND THE DOCUMENT IS BYTE-IDENTICAL. This assertion used to read
    // `'$: s("bd ~ ~ ~ sn ~ ~ ~")'` — the spec encoded the very defect #1057 was
    // filed against, which is why it had to be changed rather than kept green.
    expect(await getStrudelCode(page)).toBe('$: s("bd ~ sn ~")')

    // and it is reversible the same way it was entered — still without a write
    await (await preset(slots, 4)).click()
    await page.waitForTimeout(120)
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(4)
    expect(await getStrudelCode(page)).toBe('$: s("bd ~ sn ~")')
    expect(errors).toEqual([])
  })

  test('step grid: a refined view writes only once you actually place a note (#1057)', async ({
    page,
  }) => {
    // The other half of the rule. Refining must not write — but the finer grid has
    // to be REAL, and the only proof of that is placing a note the document could
    // not previously express and seeing it land where it was clicked.
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await boot(page)
    await setStrudelCode(page, '$: s("bd ~ sn ~")')
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    const slots = slotsControl(drawer)

    await (await preset(slots, 8)).click()
    await page.waitForTimeout(120)
    expect(await getStrudelCode(page)).toBe('$: s("bd ~ sn ~")') // still untouched

    // column 1 exists only at the refined resolution — it is between the source's
    // own columns 0 and 1, so this is a note the document could not previously hold
    await grid.locator('[data-seq-cell="0:1"]').click()
    await page.waitForTimeout(150)

    const after = await getStrudelCode(page)
    expect(after).not.toBe('$: s("bd ~ sn ~")') // NOW it writes
    // ⚠ OBSERVED, and not what a flattening prediction would say. The writer does NOT
    // respell the pattern as eight columns — it edits the ONE region the user touched
    // and leaves `~ sn ~` byte-identical, spelling the new subdivision as a group.
    // That is the element writer's locality promise doing its job, and the two are the
    // same music: `[bd bd]` occupies the first quarter, so the onsets are 0 and 1/8,
    // exactly where `bd bd ~ ~ …` at eight columns would put them. The minimal edit is
    // the better answer, and the phase did not have to ask for it.
    expect(after).toBe('$: s("[bd bd] ~ sn ~")')
    // The refinement is absorbed, and the view stays at eight columns WITHOUT a view
    // scale — the document now genuinely expresses eighth-note resolution, so the
    // reader derives eight columns from the onsets themselves.
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(8)
    await expect((await preset(slots, 8))).toHaveAttribute(
      'data-resolution-active',
      'true',
    )
    expect(errors).toEqual([])
  })

  /**
   * #1061 — COARSENING BELOW THE DOCUMENT'S OWN COUNT, AND WHAT THE CONTROL PROMISES.
   *
   * This arm has been through the whole argument, and the reason is worth stating once.
   * P4c (#1047) made the printer preserve a note's LENGTH, which retired grid coarsening:
   * a note lasting one column of an 8-column grid lasts half a column of a 4-column one,
   * and the grid has no notation for half a column, so the writer declined and the button
   * went dead. #1061 makes that a FLOOR rather than a refusal — such a note keeps ONE
   * column of the new grid, sounds longer, and nothing is lost. It is honest only because
   * #1056 made the panel DRAW note length, so the growth is something the user watches.
   *
   * The consequence for THIS test is that its old title was wrong twice over: 8→4 here is
   * not "a lossless reduce" any more, because lengths change. It is a write that keeps
   * every onset and lengthens two notes, and the control has to say exactly that — the
   * distinction from a genuine lossless reduce is kept by `canScaleStepGridTo`, which
   * still refuses this one.
   */
  test('step grid: a reduce below the document keeps timing, lengthens, and says both', async ({
    page,
  }) => {
    await boot(page)
    // hits only on every 4th column → 8→4 moves NO onset. The only cost is length, and
    // announcing a timing change here is the copy a control reading `state` alone produces.
    await setStrudelCode(page, '$: s("bd ~ ~ ~ sn ~ ~ ~")')
    const drawer = await openPattern(page)
    const slots = slotsControl(drawer)
    await expect(await preset(slots, 4)).toBeEnabled()
    await expect(await preset(slots, 4)).toHaveAttribute('data-resolution-lengthens', 'true')
    await expect(await preset(slots, 4)).toHaveAttribute(
      'title',
      '4 slots — rewrites your file, keeps timing, and makes 2 notes longer',
    )
    // and it cuts nothing short, so it carries no shorter marker (#1948's control)
    await expect(await preset(slots, 4)).not.toHaveAttribute('data-resolution-shortens', 'true')

    // CONTROL: refining the same pattern is still FREE, and free declares no cost. Without
    // this arm a regression that marked every target as lengthening would satisfy the above.
    await expect(await preset(slots, 16)).toBeEnabled()
    await expect(await preset(slots, 16)).toHaveAttribute('data-resolution-view', 'true')
    await expect(await preset(slots, 16)).not.toHaveAttribute('data-resolution-lengthens', 'true')

    // and the promise is kept — the write is what the tooltip said it would be
    await (await preset(slots, 4)).click()
    await page.waitForTimeout(120)
    expect(await getStrudelCode(page)).toBe('$: s("bd ~ sn ~")')
  })

  test('step grid: a reduce that loses NO length is still shown as lossless', async ({ page }) => {
    // THE OTHER HALF, and the reason the arm above is not simply "coarsening warns now".
    // Every note here already spans two columns, so halving scales each to exactly one and
    // the floor never fires. That target stays a genuine lossless reduce, is NOT marked as
    // a quantize, and declares no lengthening — so `lossless` still means what it says and
    // the floor has not swallowed the distinction.
    await boot(page)
    await setStrudelCode(page, '$: s("bd _ ~ ~ sn _ ~ ~")')
    const drawer = await openPattern(page)
    const slots = slotsControl(drawer)
    await expect(await preset(slots, 4)).toBeEnabled()
    await expect(await preset(slots, 4)).not.toHaveAttribute('data-resolution-quantize', 'true')
    await expect(await preset(slots, 4)).not.toHaveAttribute('data-resolution-lengthens', 'true')
    await expect(await preset(slots, 4)).toHaveAttribute(
      'title',
      '4 slots — rewrites your file, keeps timing',
    )
  })

  test('step grid: a hit that merges into its neighbour is not counted as made longer (#1968)', async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd bd bd ~ ~ ~ ~ ~")')
    const drawer = await openPattern(page)
    const slots = slotsControl(drawer)
    // 8 → 4 puts the second and third hit in the same slot, so the press writes TWO notes.
    // Both are held at one slot (longer than the half slot they scale to); the third hit is
    // gone into the second. The sentence counts the notes the user will see, not the three
    // they started with.
    await expect(await preset(slots, 4)).toHaveAttribute(
      'title',
      '4 slots — rewrites your file and snaps notes to the grid (changes timing), and makes 2 notes longer',
    )
    await (await preset(slots, 4)).click()
    await page.waitForTimeout(120)
    expect(await getStrudelCode(page)).toBe('$: s("bd bd ~ ~")')
  })

  test('step grid: a non-power-of-2 (5-step) pattern can still be reduced (quantize)', async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd ~ sn ~ bd")')
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    const slots = slotsControl(drawer)
    // every preset is OFFERED (quantize), not disabled — and marked as quantize
    await expect((await preset(slots, 4))).toBeEnabled()
    await expect((await preset(slots, 4))).toHaveAttribute(
      'data-resolution-quantize',
      'true',
    )
    // #1061 — 5 → 4 is not a whole ratio, so onsets move AND every length is floored.
    // BOTH costs are declared, and the sentence differs from the 8-column arm above,
    // which is the point of asking the op rather than inferring from the state.
    await expect((await preset(slots, 4))).toHaveAttribute('data-resolution-lengthens', 'true')
    await expect((await preset(slots, 4))).toHaveAttribute(
      'title',
      '4 slots — rewrites your file and snaps notes to the grid (changes timing), and makes 3 notes longer',
    )
    // CONTROL: refining is offered too, is cued as the rewrite it is, and floors nothing.
    await expect((await preset(slots, 8))).toBeEnabled()
    await expect((await preset(slots, 8))).not.toHaveAttribute('data-resolution-lengthens', 'true')
    // reduce 5 → 4: hits snap to the nearest of the 4 slots
    await (await preset(slots, 4)).click()
    await page.waitForTimeout(120)
    expect(await getStrudelCode(page)).toBe('$: s("bd ~ sn bd")')
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(4)
  })

  /**
   * #1140 — THE ÷2 / ×2 BUTTONS, THROUGH THE BROWSER.
   *
   * #1059 made the relative steps the control's primary gesture and demoted the
   * presets to a dropdown, but every browser arm above still reaches the control
   * through that dropdown. So the gesture a user actually makes was verified only
   * by unit tests driving `ResolutionControl` with a stub `slotState` — which
   * cannot see the wiring between the button and the real model, and that wiring is
   * where the enabled-but-inert class has landed every previous time (#1010 P4c:
   * 483 grid + 123 roll dead targets, whole suite green).
   */
  test('step grid: the ×2 / ÷2 walk refines and returns without ever writing (#1059)', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await boot(page)
    await setStrudelCode(page, '$: s("bd ~ sn ~")')
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    const slots = slotsControl(drawer)
    const up = slots.locator('[data-resolution-double]')
    const down = slots.locator('[data-resolution-halve]')
    const readout = slots.locator('[data-resolution-current]')

    // the document's own resolution, and the readout is the only thing telling the
    // user where they are now that the presets are hidden
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(4)
    await expect(readout).toHaveText('4')
    // ×2 announces itself as free BEFORE it is pressed, and carries no write cue
    await expect(up).toHaveAttribute('data-resolution-view', 'true')
    await expect(up).not.toHaveAttribute('data-resolution-writes', 'true')

    // ── climb ──────────────────────────────────────────────────────────────
    await up.click()
    await page.waitForTimeout(120)
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(8)
    await expect(readout).toHaveText('8')
    expect(await getStrudelCode(page)).toBe('$: s("bd ~ sn ~")')

    await up.click()
    await page.waitForTimeout(120)
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(16)
    await expect(readout).toHaveText('16')
    expect(await getStrudelCode(page)).toBe('$: s("bd ~ sn ~")')

    // ── and back down, which is the half the free zone is easiest to get wrong
    // on: descending through a refined view is a VIEW change all the way to the
    // document's own count (2613 grid standings measured, not one write), and only
    // BELOW that count does it become an edit.
    await down.click()
    await page.waitForTimeout(120)
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(8)
    await expect(readout).toHaveText('8')
    expect(await getStrudelCode(page)).toBe('$: s("bd ~ sn ~")')

    await down.click()
    await page.waitForTimeout(120)
    await expect(grid.locator('[data-seq-cell^="0:"]')).toHaveCount(4)
    await expect(readout).toHaveText('4')
    // the whole walk, and the file is the bytes the user typed
    expect(await getStrudelCode(page)).toBe('$: s("bd ~ sn ~")')
    expect(errors).toEqual([])
  })

  test('step grid: ÷2 is an EDIT below the document and FREE above it — one button, two zones (#1059)', async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd ~ sn ~")')
    const drawer = await openPattern(page)
    const slots = slotsControl(drawer)
    const down = slots.locator('[data-resolution-halve]')

    // At the document's own resolution, ÷2 goes BELOW it — a real coarsening. This used
    // to be REFUSED (the writer declined, because P4c preserves note length and half a
    // column has no spelling, and 546 of 546 such grid targets were disabled). #1061 makes
    // it a floor instead: the notes are held at one column of the new grid, so the press
    // is offered — and the whole burden shifts onto the control SAYING what it will do.
    await expect(down).toBeEnabled()
    await expect(down).toHaveAttribute('data-resolution-writes', 'true')
    await expect(down).not.toHaveAttribute('data-resolution-view', 'true')
    await expect(down).toHaveAttribute('data-resolution-lengthens', 'true')
    await expect(down).toHaveAttribute(
      'title',
      '2 slots — rewrites your file, keeps timing, and makes 2 notes longer',
    )

    // …and after refining, the SAME button becomes free, because now it descends
    // INTO the free zone instead of out of it. One button, two zones, and the
    // difference is where the document's own count sits — not which way it points.
    //
    // THIS IS THE ARM THAT CARRIES THE TEST. With the zones now BOTH live, the
    // distinction is no longer enabled-vs-disabled — it is what the button promises, so
    // the free descent must declare no write and no cost, and leave the file untouched.
    await slots.locator('[data-resolution-double]').click()
    await page.waitForTimeout(120)
    await expect(down).toBeEnabled()
    await expect(down).toHaveAttribute('data-resolution-view', 'true')
    await expect(down).not.toHaveAttribute('data-resolution-writes', 'true')
    await expect(down).not.toHaveAttribute('data-resolution-lengthens', 'true')
    expect(await getStrudelCode(page)).toBe('$: s("bd ~ sn ~")')

    // and pressing it really is free: back at the document's own count, byte-identical
    await down.click()
    await page.waitForTimeout(120)
    expect(await getStrudelCode(page)).toBe('$: s("bd ~ sn ~")')
  })

  test('piano roll: reduce a 64-step melody to 16 (quantize) writes a valid 16-slot pattern', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await boot(page)
    await setStrudelCode(
      page,
      '$: note("~ ~ ~ ~ ~ ~ ~ ~ [e4,d5]@4 d5 ~ ~ ~ [g4,a#4]@2 d5 ~ ~ [f5,c#4] ~ ~ b4@4 g4 ~ ~ ~ [c5,d4]@4 e5 ~ f#5 ~ [b4,d4]@2 f5 ~ ~ c5 ~ ~ [g4,a4]@3 d5 ~ ~ ~ d5 e4@8")',
    )
    const drawer = await openPattern(page)
    const slots = slotsControl(drawer)
    // 16 is below the 64-step current → offered as a quantize target
    await expect((await preset(slots, 16))).toBeEnabled()
    await expect((await preset(slots, 16))).toHaveAttribute(
      'data-resolution-quantize',
      'true',
    )
    await (await preset(slots, 16)).click()
    await page.waitForTimeout(150)
    const code = await getStrudelCode(page)
    // the write happened (source changed) and it's a real 16-slot melody
    expect(code).not.toContain('e4@8') // the original long tail is gone
    expect(code).toContain('note(')
    expect(errors).toEqual([])
  })

  test('piano roll: a reduce says what it costs before you press it (#1933)', async ({ page }) => {
    await boot(page)
    // every onset already sits on a column of the 4-grid, so 8→4 moves no timing; each
    // half-column note is held at one column, so the cost is length only
    await setStrudelCode(page, '$: note("c3 ~ e3 ~ g3 ~ a3 ~")')
    const drawer = await openPattern(page)
    await expect(drawer.locator('[data-bottom-panel-tab="piano-roll"]')).toHaveCount(1)
    const slots = slotsControl(drawer)
    await expect(await preset(slots, 4)).toHaveAttribute('data-resolution-quantize', 'true')
    await expect(await preset(slots, 4)).toHaveAttribute('data-resolution-lengthens', 'true')
    await expect(await preset(slots, 4)).toHaveAttribute(
      'title',
      '4 slots — rewrites your file, keeps timing, and makes 4 notes longer',
    )
    await expect(await preset(slots, 4)).not.toHaveAttribute('data-resolution-shortens', 'true')
    // CONTROL: refining is a view, and a view declares no cost
    await expect(await preset(slots, 16)).toHaveAttribute('data-resolution-view', 'true')
    await expect(await preset(slots, 16)).not.toHaveAttribute('data-resolution-lengthens', 'true')
    // and the write is the one the tooltip described
    await (await preset(slots, 4)).click()
    await page.waitForTimeout(120)
    expect(await getStrudelCode(page)).toBe('$: note("c3 e3 g3 a3")')
  })

  test('piano roll: an off-grid reduce says it changes timing; one that moves nothing says it keeps it (#1933)', async ({
    page,
  }) => {
    await boot(page)
    // 5 → 4: four onsets fall between the new columns and every note is held at one column
    await setStrudelCode(page, '$: note("c3 e3 g3 a3 b3")')
    let drawer = await openPattern(page)
    await expect(drawer.locator('[data-bottom-panel-tab="piano-roll"]')).toHaveCount(1)
    await expect(await preset(slotsControl(drawer), 4)).toHaveAttribute(
      'title',
      '4 slots — rewrites your file and snaps notes to the grid (changes timing), and makes 5 notes longer',
    )
    // CONTROL: 6 → 4 is still a quantize, but both onsets and both lengths land on whole
    // columns, so it keeps timing and lengthens nothing
    await boot(page)
    await setStrudelCode(page, '$: note("c3@3 e3@3")')
    drawer = await openPattern(page)
    await expect(drawer.locator('[data-bottom-panel-tab="piano-roll"]')).toHaveCount(1)
    const four = await preset(slotsControl(drawer), 4)
    await expect(four).toHaveAttribute('data-resolution-quantize', 'true')
    await expect(four).not.toHaveAttribute('data-resolution-lengthens', 'true')
    await expect(four).toHaveAttribute('title', '4 slots — rewrites your file, keeps timing')
  })

  test('step grid: a reduce that cuts a note short says so before you press it (#1948)', async ({ page }) => {
    await boot(page)
    // 8 → 4: `bd@7` should be 3.5 columns. The second hit (column 7 → 3.5) lands on the last
    // column, 3, and the held note is cut to the 3 columns before it. The second hit's
    // half-column length is held at one, so one note is longer and one shorter.
    await setStrudelCode(page, '$: s("bd@7 bd")')
    const drawer = await openPattern(page)
    const slots = slotsControl(drawer)
    const four = await preset(slots, 4)
    await expect(four).toHaveAttribute('data-resolution-quantize', 'true')
    await expect(four).toHaveAttribute('data-resolution-shortens', 'true')
    await expect(four).toHaveAttribute(
      'title',
      '4 slots — rewrites your file and snaps notes to the grid (changes timing), and makes 1 note longer and 1 note shorter',
    )
    // and the write is the one the tooltip described: the held note now spans 3 of 4
    await four.click()
    await page.waitForTimeout(120)
    expect(await getStrudelCode(page)).toBe('$: s("bd _ _ bd")')
  })

  test('piano roll: a reduce that cuts a note short says so before you press it (#1948)', async ({ page }) => {
    await boot(page)
    // 8 → 4: `c3@7` scales to 3.5 columns, rounds to 4, and is clamped to the 3 before `e3`
    await setStrudelCode(page, '$: note("c3@7 e3")')
    const drawer = await openPattern(page)
    await expect(drawer.locator('[data-bottom-panel-tab="piano-roll"]')).toHaveCount(1)
    const four = await preset(slotsControl(drawer), 4)
    await expect(four).toHaveAttribute('data-resolution-shortens', 'true')
    await expect(four).toHaveAttribute(
      'title',
      '4 slots — rewrites your file and snaps notes to the grid (changes timing), and makes 1 note longer and 1 note shorter',
    )
    await four.click()
    await page.waitForTimeout(120)
    expect(await getStrudelCode(page)).toBe('$: note("c3@3 e3")')
  })

  test('piano roll: adding slots keeps notes single-slot, and 8→4 round-trips (#607)', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await boot(page)
    await setStrudelCode(page, '$: note("c3 e3 g3 a3")')
    const drawer = await openPattern(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    const slots = slotsControl(drawer)
    await expect(grid).toHaveCount(1)

    // 4 → 8 is a whole multiple, so it is a VIEW (#1057): the roll draws twice as
    // finely and the document is untouched. This used to assert
    // `'$: note("c3 ~ e3 ~ g3 ~ a3 ~")'` — the rewrite the phase removed.
    await expect((await preset(slots, 8))).toHaveAttribute(
      'data-resolution-view',
      'true',
    )
    await (await preset(slots, 8)).click()
    await page.waitForTimeout(120)
    expect(await getStrudelCode(page)).toBe('$: note("c3 e3 g3 a3")')

    // 8 → 4 returns to the document's own resolution — also a view, also no write.
    await (await preset(slots, 4)).click()
    await page.waitForTimeout(120)
    expect(await getStrudelCode(page)).toBe('$: note("c3 e3 g3 a3")')
    expect(errors).toEqual([])
  })

  test('piano roll: a refined view leaves BOTH the notes and the .gain alone (#1057)', async ({
    page,
  }) => {
    // This was #607's browser coverage for "velocities re-align when slots are
    // added". A whole-multiple target no longer adds slots to the document at all,
    // so the gesture cannot reach that rule any more — and the coordinated write is
    // exactly what must NOT happen here. `.gain` is the second write-back range, so
    // it is the sharper of the two assertions: a view that quietly rewrote only the
    // gain mini would still look right in the roll.
    //
    // #607's re-alignment rule is unchanged and still governs `quantizePianoRollTo`
    // when slots really are added; its coverage is the op-level `#607` cases in
    // `packages/editor/src/codeView/notation/__tests__/resolution.test.ts`.
    await boot(page)
    const src = '$: note("c3 e3 g3 a3").gain("1 0.8 0.6 0.4")'
    await setStrudelCode(page, src)
    const drawer = await openPattern(page)
    const slots = slotsControl(drawer)
    await (await preset(slots, 8)).click()
    await page.waitForTimeout(120)
    expect(await getStrudelCode(page)).toBe(src)
  })
})
