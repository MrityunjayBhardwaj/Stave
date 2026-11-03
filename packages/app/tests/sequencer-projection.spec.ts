/**
 * Behaviour-projection for the Sequencer grid — #922.
 *
 * A pattern whose note string the two-level Step→Slot model can't represent
 * (elongation `@n`, nested groups `[a [b c]]`) used to fall to code-only. The
 * projection reads what the pattern PLAYS (haps) and shows an ordinary grid, and
 * tiles the write-back to krill's top-level element spans so an edit stays local
 * (span surgery) — the unedited notation is copied back byte-for-byte.
 *
 * Observes the REAL app + REAL document:
 *   - a refused-by-syntax pattern now OPENS an editable Sequencer grid;
 *   - the projected cells match what Strudel plays;
 *   - toggling one cell writes back a hap-faithful document, and unrelated
 *     notation (a nested group) rides back verbatim.
 */
import { test, expect, type Page } from '@playwright/test'

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
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    return target?.getModel()?.getValue() ?? ''
  })
}

async function openSequencer(page: Page) {
  const drawer = page.locator('[data-bottom-panel="root"]')
  await drawer.locator('[data-bottom-panel="toggle"]').click()
  await drawer.locator('role=tab[name="Pattern"]').click()
  return drawer
}

test.describe('Sequencer behaviour-projection (#922)', () => {
  test('an `@n` elongation pattern opens an editable grid and edits locally', async ({ page }) => {
    // `bd@2 hh` has no place in the two-level model (elongation isn't a grid
    // concept) but plays [bd ~ hh]. The projection shows that grid.
    await boot(page)
    await setStrudelCode(page, '$: s("bd@2 hh")')
    const drawer = await openSequencer(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    await expect(grid).toHaveCount(1)
    // projected onset columns: bd at 0 (held over col 1), hh at 2
    await expect(grid.locator('[data-seq-cell="0:0"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-seq-cell="0:1"]')).toHaveAttribute('aria-pressed', 'false')
    await expect(grid.locator('[data-seq-cell="1:2"]')).toHaveAttribute('aria-pressed', 'true')
    // TOGGLE bd OFF. The write is byte surgery, not a re-emit: the `bd` leaf is
    // replaced where it stands and the `@2` hold it was carrying stays put, so a
    // gesture that did not touch the elongation does not respell it (#1233/#1245).
    //
    // This assertion used to read `~ ~ hh`, which is what the ELEMENT writer
    // produced — the same music, blown open into one column per step.
    // `surgery-preserves-spelling.spec.ts` names that spelling as the destruction
    // class the whole arc exists to stop: "it plays identically, it re-parses,
    // every spelling assertion elsewhere still holds. It is simply not what they
    // wrote." This was one of those assertions elsewhere (#1266).
    await grid.locator('[data-seq-cell="0:0"]').click()
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: s("~@2 hh")')
    // …AND THE MUSIC DID NOT MOVE. A rest emits no hap, so `~@2` and `~ ~` query
    // identically and `hh` still lands two thirds of the way through the cycle.
    // A string compare alone cannot tell a preserved spelling from a corrupted
    // one, so ask the projection: re-opened on the written bytes, one cell is
    // still lit in column 2. Asked by column rather than by `lane:col` because
    // which lane survives an emptied row is a different question (#1161).
    await expect(grid.locator('[data-seq-cell$=":2"][aria-pressed="true"]')).toHaveCount(1)
  })

  test('a nested group opens and an unrelated edit copies the group back verbatim', async ({
    page,
  }) => {
    // `bd [hh [hh hh]] sd` — a two-level-deep group the model can't hold, but it
    // plays a plain 12-step grid. Editing the bd must leave the nested group
    // untouched byte-for-byte (span surgery), never a flat rebuild.
    await boot(page)
    await setStrudelCode(page, '$: s("bd [hh [hh hh]] sd")')
    const drawer = await openSequencer(page)
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    await expect(grid).toHaveCount(1)
    await expect(grid.locator('[data-seq-cell="0:0"]')).toHaveAttribute('aria-pressed', 'true')
    // toggle the leading bd off; the nested group + sd ride back unchanged
    await grid.locator('[data-seq-cell="0:0"]').click()
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: s("~ [hh [hh hh]] sd")')
  })

  test('a per-cycle-varying pattern still falls back to code (projection declines)', async ({
    page,
  }) => {
    // `bd?` degrades per cycle — not a static grid. The projection declines and
    // the syntactic refusal stands: the Sequencer shows standby, not a false grid.
    await boot(page)
    await setStrudelCode(page, '$: s("bd? hh sd cp")')
    const drawer = await openSequencer(page)
    // standby (not an editable grid) — the pattern is code-editable only
    await expect(drawer.locator('[data-bottom-panel-tab="sequencer"] [data-seq-cell]')).toHaveCount(
      0,
    )
  })
})

/**
 * #991 — a pattern whose period runs past the element writer's four-bar cap.
 *
 * `hacking/8` is one sample stretched over eight cycles. Its period is 8, so
 * every projection used to decline it as "does not repeat within 4 bars" and the
 * Sequencer showed standby. The LEAF projection looks out to twelve bars, because
 * the cap's stated reason — `spliceAltGrid` respelling an edited element as
 * `<b0 b1 …>` — is a property of a writer this path never reaches.
 *
 * The observation that settled the UX question: a wide view here is not a wall of
 * columns. `MAX_STEPS` caps `perBar × bars` at 64 independently, so a pattern that
 * reaches eight bars must be COARSE — this one is eight columns TOTAL, narrower
 * than the twelve-column nested-group grid above. Asserted here as a real click on
 * a real panel, because "the view opens" and "the view can be worked with" are
 * different claims and only the second one matters.
 */
test('a period longer than four bars opens a coarse grid; its stretched step keeps its `/8`', async ({
  page,
}) => {
  await boot(page)
  await setStrudelCode(page, '$: s("hacking/8")')
  const drawer = await openSequencer(page)
  const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
  await expect(grid).toHaveCount(1)
  // eight bars, one column each — the whole period is visible at once
  await expect(grid.locator('[data-seq-cell]')).toHaveCount(8)
  await expect(grid.locator('[data-seq-cell="0:0"]')).toHaveAttribute('aria-pressed', 'true')
  for (let c = 1; c < 8; c++) {
    await expect(grid.locator(`[data-seq-cell="0:${c}"]`)).toHaveAttribute('aria-pressed', 'false')
  }
  // `hacking/8` is one text its own `/8` stretches over eight bars: the step's op makes
  // where it sounds, so a click on it is refused and says why (#2292)
  await expect(grid.locator('[data-seq-cell="0:0"]')).toHaveAttribute('title', /operator on its step/)
  await grid.locator('[data-seq-cell="0:0"]').click({ force: true })
  await page.waitForTimeout(150)
  expect(await strudelValue(page)).toBe('$: s("hacking/8")')
})

/**
 * #994 — a pattern the edit-safety probe used to refuse for a property of its own
 * marker. `<bd hh sd hh>*2` is an ordinary alternation played twice per cycle; the
 * projection declined it `edit-unsafe` because splicing `__stave_probe__` into it
 * elongated the token before the marker, so the probe compared the pattern against
 * a different one and concluded the writer was unsafe.
 *
 * Driven on the real panel rather than asserted through the parser, because the
 * claim being made is that the user gets a WORKING view: four columns, three
 * sounds, and a click that writes one token.
 */
test('a pattern the probe marker used to refuse opens and edits (#994)', async ({ page }) => {
  await boot(page)
  await setStrudelCode(page, '$: s("<bd hh sd hh>*2")')
  const drawer = await openSequencer(page)
  const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
  await expect(grid).toHaveCount(1)
  // two bars of two columns; bd, hh and sd each own a lane
  await expect(grid.locator('[data-seq-cell="0:0"]')).toHaveAttribute('aria-pressed', 'true')
  await grid.locator('[data-seq-cell="0:0"]').click()
  await page.waitForTimeout(80)
  // only `bd`'s own bytes moved — the alternation and its `*2` came back verbatim
  expect(await strudelValue(page)).toBe('$: s("<~ hh sd hh>*2")')
})
