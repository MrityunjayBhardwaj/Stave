/**
 * Per-note velocity (#409) — vertical drag on a cell/note sets its `.gain`.
 *
 * Observes (AnviDev: verify AND observe):
 *   - dragging a Sequencer cell DOWN writes a parallel `.gain("…")` aligned to
 *     the columns, and the cell's fill height drops (a softer hit);
 *   - dragging it back to neutral removes the `.gain` method entirely;
 *   - the `.gain` round-trips: re-reading the code shows the same level.
 * The Piano Roll velocity test lives below once the shared path is extended.
 */
import { test, expect, type Page, type Locator } from '@playwright/test'
import { pinLcmGrid } from './_appBoot'
import { slotsControl, preset } from './_resolutionControl'

// The tests titled `(LCM grid)` pin the shared-grid writer's results (Settings › Grid, #2294).
pinLcmGrid(test)

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
    const target =
      editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    if (!target) return false
    target.getModel()?.setValue(c)
    target.setPosition({ lineNumber: 1, column: 1 })
    target.focus()
    return true
  }, code)
  expect(ok).toBe(true)
  await page.waitForTimeout(150)
}

async function strudelValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } })
      .monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; getValue: () => string } | null
    }>
    const target =
      editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    return target?.getModel()?.getValue() ?? ''
  })
}

async function openSequencer(page: Page): Promise<Locator> {
  const drawer = page.locator('[data-bottom-panel="root"]')
  await drawer.locator('[data-bottom-panel="toggle"]').click()
  await drawer.locator('role=tab[name="Pattern"]').click()
  return drawer
}

/** Press on a cell, drag vertically by `dy` px (down = positive = softer), release. */
async function dragVertical(page: Page, cell: Locator, dy: number): Promise<void> {
  await cell.scrollIntoViewIfNeeded() // the roll's velocity lane sits below the fold
  const box = await cell.boundingBox()
  if (!box) throw new Error('cell has no box')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx, cy + dy, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(100)
}

test.describe('velocity — Sequencer (#409)', () => {
  test('dragging a cell down writes a column-aligned .gain and softens its fill (LCM grid)', async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd hh sn hh")')
    const drawer = await openSequencer(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    await expect(grid).toHaveCount(1)

    const hhLast = grid.locator('[data-seq-cell="1:3"]') // hh lane, last column
    await expect(hhLast).toHaveAttribute('aria-pressed', 'true')
    // neutral: no .gain yet
    expect(await strudelValue(page)).toBe('$: s("bd hh sn hh")')

    // drag the last column down ~40px → ~0.5 (VELOCITY_FULL_PX = 80)
    await dragVertical(page, hhLast, 40)

    const code = await strudelValue(page)
    // a parallel .gain appears, aligned to the 4 columns, last one softened
    expect(code).toMatch(/^\$: s\("bd hh sn hh"\)\.gain\("1 1 1 [\d.]+"\)$/)
    const softened = Number(code.match(/\.gain\("1 1 1 ([\d.]+)"\)/)![1])
    expect(softened).toBeGreaterThan(0)
    expect(softened).toBeLessThan(1)

    // OBSERVE the fill: the softened cell's fill is shorter than a neutral one
    const fillH = async (sel: string): Promise<number> => {
      const box = await grid.locator(`${sel} [data-seq-fill]`).boundingBox()
      return box?.height ?? -1
    }
    const softH = await fillH('[data-seq-cell="1:3"]')
    const fullH = await fillH('[data-seq-cell="1:1"]')
    expect(softH).toBeGreaterThan(0)
    expect(softH).toBeLessThan(fullH - 2)
  })

  test('dragging back to neutral removes the .gain method (LCM grid)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd hh sn hh")')
    const drawer = await openSequencer(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    const hhLast = grid.locator('[data-seq-cell="1:3"]')

    await dragVertical(page, hhLast, 40) // soften
    expect(await strudelValue(page)).toMatch(/\.gain\(/)

    await dragVertical(page, hhLast, -60) // drag well past full → clamps to neutral
    expect(await strudelValue(page)).toBe('$: s("bd hh sn hh")') // .gain removed
  })

  test('reads an existing column .gain back onto the grid (round-trip) (LCM grid)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd hh sn hh").gain("1 0.5 1 0.25")')
    await page.evaluate(() => {
      const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
      const eds = (monaco?.editor?.getEditors?.() ?? []) as Array<{
        getModel: () => { getValue: () => string } | null
        focus: () => void
        setPosition: (p: { lineNumber: number; column: number }) => void
      }>
      const t = eds.find((e) => e.getModel()?.getValue?.().includes('bd hh sn hh')) ?? eds[0]
      t?.focus()
      t?.setPosition({ lineNumber: 1, column: 8 }) // inside the head mini
    })
    await page.waitForTimeout(120)
    const drawer = await openSequencer(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    await expect(grid).toHaveCount(1)
    // the softened columns expose their level via data-gain
    await expect(grid.locator('[data-seq-cell="1:1"]')).toHaveAttribute('data-gain', '0.5')
    await expect(grid.locator('[data-seq-cell="1:3"]')).toHaveAttribute('data-gain', '0.25')
    await expect(grid.locator('[data-seq-cell="0:0"]')).toHaveAttribute('data-gain', '1')
  })

  test('reads a scalar .gain(0.4) as a uniform base and expands it on drag (LCM grid)', async ({ page }) => {
    await boot(page)
    // a track-level numeric .gain (the Mixer-knob form, as in the starter patterns)
    await setStrudelCode(page, '$: s("bd hh sn hh").gain(0.4)')
    const drawer = await openSequencer(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    await expect(grid).toHaveCount(1)
    // every cell reads the 0.4 base (velocity is enabled, fills at 40%)
    await expect(grid.locator('[data-seq-cell="0:0"]')).toHaveAttribute('data-gain', '0.4')
    await expect(grid.locator('[data-seq-cell="2:2"]')).toHaveAttribute('data-gain', '0.4')

    // drag the sn column down → the scalar expands to a per-column string,
    // the base 0.4 preserved on the untouched columns
    await dragVertical(page, grid.locator('[data-seq-cell="2:2"]'), 16)
    const code = await strudelValue(page)
    expect(code).toMatch(/^\$: s\("bd hh sn hh"\)\.gain\("0\.4 0\.4 [\d.]+ 0\.4"\)$/)
    const softened = Number(code.match(/\.gain\("0\.4 0\.4 ([\d.]+) 0\.4"\)/)![1])
    expect(softened).toBeLessThan(0.4)
  })
})

test.describe('velocity — Piano Roll (#409)', () => {
  test('dragging a note bar down writes a structure-aligned .gain', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 e3 g3 c4")')
    const drawer = await openSequencer(page) // the Pattern tab adapts to the roll
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(roll).toHaveCount(1)
    await expect(roll.locator('[data-roll-velocity-lane]')).toHaveCount(1)
    expect(await strudelValue(page)).toBe('$: note("c3 e3 g3 c4")') // neutral, no .gain

    // drag the col-1 (e3) velocity bar down → softer
    await dragVertical(page, roll.locator('[data-vel-col="1"]'), 40)
    const code = await strudelValue(page)
    expect(code).toMatch(/^\$: note\("c3 e3 g3 c4"\)\.gain\("1 [\d.]+ 1 1"\)$/)
    const v = Number(code.match(/\.gain\("1 ([\d.]+) 1 1"\)/)![1])
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(1)
  })

  test('per-chord: one bar drives both chord notes (shared gain)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("[c3,e3] g3")')
    const drawer = await openSequencer(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(roll).toHaveCount(1)
    // one bar at col 0 for the whole [c3,e3] chord
    await dragVertical(page, roll.locator('[data-vel-col="0"]'), 40)
    // a single shared gain token for the chord, the other note neutral
    expect(await strudelValue(page)).toMatch(/^\$: note\("\[c3,e3\] g3"\)\.gain\("[\d.]+ 1"\)$/)
  })

  test('dragging back to neutral removes the .gain method', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 e3 g3 c4")')
    const drawer = await openSequencer(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await dragVertical(page, roll.locator('[data-vel-col="1"]'), 40)
    expect(await strudelValue(page)).toMatch(/\.gain\(/)
    await dragVertical(page, roll.locator('[data-vel-col="1"]'), -60)
    expect(await strudelValue(page)).toBe('$: note("c3 e3 g3 c4")')
  })

  test('reads an existing .gain back onto the lane bars', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 e3 g3").gain("1 0.5 1")')
    const drawer = await openSequencer(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(roll).toHaveCount(1)
    await expect(roll.locator('[data-vel-bar="1"]')).toHaveAttribute('data-gain', '0.5')
    await expect(roll.locator('[data-vel-bar="0"]')).toHaveAttribute('data-gain', '1')
  })

  test('a note placed in a slot that only exists at a finer view is velocity-editable (#607) (LCM grid)', async ({
    page,
  }) => {
    // THE RULE IS UNCHANGED; THE GESTURE THAT REACHES IT HAD TO MOVE (#1126).
    //
    // This used to refine `note("c3 e3 g3 a3")` to 8 and assert the document had been
    // rewritten `c3 ~ e3 ~ g3 ~ a3 ~` — the rewrite #1057 removed on purpose. Its two
    // siblings in `resolution.spec.ts` were corrected then and this third copy was
    // missed, so it has been red ever since.
    //
    // It was then missed a SECOND time, for a different change: #1059 moved the
    // absolute presets behind the readout's double-click, and the direct click here
    // waited out the whole timeout on a locator that never resolves (#1157). Reaching
    // the control now goes through `_resolutionControl`, which all three specs share,
    // so a third change to this control cannot miss a copy.
    //
    // Repairing the assertion alone would not have been enough, and that is the part
    // worth writing down: refining creates no empty slots any more, because a note now
    // SPANS the columns it covers. In `c3 e3 g3 a3` at eight columns every column is
    // covered, so "the new empty slot 1" does not exist — it is c3's own second half,
    // and clicking it toggles c3 off. (Observed, and it is not a refinement bug: the
    // same click with NO refinement deletes c3 identically.)
    //
    // So the fixture carries a REST, whose second half is a genuine column the document
    // could not previously address. Placing there is the same locality the grid shows in
    // `resolution.spec.ts` — the writer edits the one region you touched and spells the
    // subdivision as a group, rather than respelling the bar.
    await boot(page)
    await setStrudelCode(page, '$: note("c3 ~ e3 ~")')
    const drawer = await openSequencer(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await (await preset(slotsControl(drawer), 8)).click()
    await page.waitForTimeout(120)
    // refining is a VIEW: eight columns drawn, document untouched
    await expect(roll.locator('[data-vel-col]')).toHaveCount(8)
    expect(await strudelValue(page)).toBe('$: note("c3 ~ e3 ~")')

    // column 3 is the rest's second half — reachable only at this view
    await roll.locator('[data-roll-cell="48:3"]').click()
    await page.waitForTimeout(150)
    expect(await strudelValue(page)).toBe('$: note("c3 [~ c3] e3 ~")')

    // …and the note that lands there is velocity-editable, which is what #607 is about
    await expect(roll.locator('[data-vel-bar="3"]')).toHaveCount(1)
    await dragVertical(page, roll.locator('[data-vel-col="3"]'), 40)
    const after = await strudelValue(page)
    // the gain is structure-aligned (rests stay `~`, the held notes keep their `@2`)…
    expect(after).toMatch(/\.gain\("1@2 ~ [\d.]+ 1@2 ~ ~"\)$/)
    // …and the notation the user wrote is still theirs (#1123)
    expect(after).toContain('note("c3 [~ c3] e3 ~")')
  })

  test("a held note's velocity spans all its slots, and any slot drags it (#628)", async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3@3 ~").gain(0.6)') // c3 held over slots 0–2
    const drawer = await openSequencer(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(roll).toHaveCount(1)
    // the velocity bar spans the held note: every covered slot carries 0.6, the
    // trailing rest has none (extending a note carries its velocity forward)
    await expect(roll.locator('[data-vel-bar="0"]')).toHaveAttribute('data-gain', '0.6')
    await expect(roll.locator('[data-vel-bar="1"]')).toHaveAttribute('data-gain', '0.6')
    await expect(roll.locator('[data-vel-bar="2"]')).toHaveAttribute('data-gain', '0.6')
    await expect(roll.locator('[data-vel-bar="3"]')).toHaveCount(0) // rest slot
    // dragging a TAIL slot (col 2) adjusts the whole note's gain
    await dragVertical(page, roll.locator('[data-vel-col="2"]'), 40)
    const code = await strudelValue(page)
    const v = Number(code.match(/\.gain\(([\d.]+)\)/)?.[1] ?? '1')
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(0.6)
  })

  test('a note under a sustain keeps its own velocity; the sustain only fills empty slots (#628)', async ({
    page,
  }) => {
    await boot(page)
    // c3 sustains over slots 0–1; e3 starts at slot 1 with its own gain
    await setStrudelCode(page, '$: note("c3@2 ~ ~, ~ e3 ~ ~").gain("0.4 0.9 ~ ~")')
    const drawer = await openSequencer(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(roll).toHaveCount(1)
    // slot 0: only c3 → its velocity; slot 1: e3 STARTS here → keeps e3's velocity
    // (not c3's, even though c3 sustains across it)
    await expect(roll.locator('[data-vel-bar="0"]')).toHaveAttribute('data-gain', '0.4')
    await expect(roll.locator('[data-vel-bar="1"]')).toHaveAttribute('data-gain', '0.9')
  })

  test('a multi-bar <...> pattern shows the velocity lane and a drag writes <...> (#632)', async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("<c3 e3 g3 c4>")') // 4 bars, one column each (perBar 1)
    const drawer = await openSequencer(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(roll).toHaveCount(1)
    await expect(roll.locator('[data-roll-velocity-lane]')).toHaveCount(1) // lane shows on multi-bar
    await dragVertical(page, roll.locator('[data-vel-col="1"]'), 40)
    // the gain mirrors the note `<...>` structure, bar-for-bar
    expect(await strudelValue(page)).toMatch(/^\$: note\("<c3 e3 g3 c4>"\)\.gain\("<1 [\d.]+ 1 1>"\)$/)
  })

  test('reads an existing multi-bar <...> .gain back onto the lane bars (the reported shape, #632)', async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(
      page,
      '$: note("<[f2,ab2,c3] [db2,f2,ab2] [ab1,c2,eb2] [eb2,g2,bb2]>").gain("<0.5 1 0.3 1>")',
    )
    const drawer = await openSequencer(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(roll).toHaveCount(1)
    await expect(roll.locator('[data-roll-velocity-lane]')).toHaveCount(1)
    await expect(roll.locator('[data-vel-bar="0"]')).toHaveAttribute('data-gain', '0.5')
    await expect(roll.locator('[data-vel-bar="2"]')).toHaveAttribute('data-gain', '0.3')
    // dragging bar 2 down keeps the <...> wrapper and only moves that bar
    await dragVertical(page, roll.locator('[data-vel-col="2"]'), 40)
    expect(await strudelValue(page)).toMatch(/\.gain\("<0\.5 1 [\d.]+ 1>"\)/)
  })

  test('a subdivided multi-bar (perBar>1) keeps the lane hidden (#632)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("<[c3 e3] g3>")') // steps 4, bars 2 → perBar 2
    const drawer = await openSequencer(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(roll).toHaveCount(1)
    await expect(roll.locator('[data-roll-velocity-lane]')).toHaveCount(0)
  })
})

test.describe('velocity — a column splits where its groups are sequential (#1086)', () => {
  // `[c5@0.5 f4@0.5 f5@3]` opens at 4 columns. Column 0 holds TWO groups — c5 over
  // [0, 0.5) and f4 over [0.5, 1.0) — which do not overlap in time, so it splits.
  //
  // A BROWSER TEST because the claim is about rendered geometry. The model has carried
  // f4 the whole time; what it did not have was a bar, and only the pixels can say so.
  //
  // NO DRAG IS ASSERTED HERE, and that is a finding rather than an omission: every
  // column that splits sits in a pattern with a fractional-start note, and the gain
  // writer skips exactly those, so the bars are visual only (#1089).
  const SPLIT = '$: note("[c5@0.5 f4@0.5 f5@3]")'

  test('the group that begins mid-column is drawn at all — it had no bar before', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, SPLIT)
    const drawer = await openSequencer(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(roll.locator('[data-roll-velocity-lane]')).toHaveCount(1)
    // f4 starts at column 0.5. The lane asked `n.start === col`, an equality no
    // fractional start satisfies, so this element did not exist.
    await expect(roll.locator('[data-vel-group="0.5"]')).toHaveCount(1)
  })

  test('the split column draws one bar per group, each at its own offset and width', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, SPLIT)
    const drawer = await openSequencer(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    const col0 = roll.locator('[data-vel-col="0"]')
    await expect(col0.locator('[data-vel-bar]')).toHaveCount(2)
    // Measured against the column's PADDING box, which is what an absolutely
    // positioned child is laid against — the border box reads 2px wider and would
    // make every one of these comparisons quietly wrong.
    const geom = await col0.evaluate((el) => {
      const host = el as HTMLElement
      const inner = host.clientWidth
      const left = host.getBoundingClientRect().left + host.clientLeft
      return Array.from(host.querySelectorAll('[data-vel-bar]')).map((b) => {
        const r = (b as HTMLElement).getBoundingClientRect()
        return {
          group: b.getAttribute('data-vel-group'),
          offset: +((r.left - left) / inner).toFixed(3),
          extent: +(r.width / inner).toFixed(3),
        }
      })
    })
    console.log(`  split column 0: ${JSON.stringify(geom)}`)
    expect(geom).toEqual([
      { group: '0', offset: 0, extent: 0.5 },
      { group: '0.5', offset: 0.5, extent: 0.5 },
    ])
  })

  test('CONTROL — a whole-column pattern is untouched: one full bar per column, still writable', async ({ page }) => {
    // The control must run on a pattern the gain writer SERVES, or it proves nothing
    // about the path this phase leaves alone. `c3 e3 g3 c4` sits on whole columns, so
    // no column splits and the drag still writes — exactly as before.
    await boot(page)
    await setStrudelCode(page, '$: note("c3 e3 g3 c4")')
    const drawer = await openSequencer(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(roll.locator('[data-vel-col="0"] [data-vel-bar]')).toHaveCount(1)
    await expect(roll.locator('[data-vel-col="1"] [data-vel-bar]')).toHaveCount(1)
    const w = await roll.locator('[data-vel-col="1"]').evaluate((el) => {
      const host = el as HTMLElement
      const bar = host.querySelector('[data-vel-bar]') as HTMLElement
      return +(bar.getBoundingClientRect().width / host.clientWidth).toFixed(2)
    })
    expect(w).toBeGreaterThan(0.9) // the pre-existing bar insets 1px each side
    await dragVertical(page, roll.locator('[data-vel-col="1"]'), 40)
    expect(await strudelValue(page)).toMatch(/\.gain\("1 [\d.]+ 1 1"\)/)
  })
})
