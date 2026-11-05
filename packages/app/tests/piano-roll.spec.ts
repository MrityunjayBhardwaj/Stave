/**
 * Piano Roll tab — #383. Note grid over a `note(...)` pattern's mini-notation.
 *
 * Observes:
 *   - a melody renders notes on the right pitch rows / step columns;
 *   - clicking an empty cell places a note that round-trips the mini-notation;
 *   - clicking a note selects it; Delete removes it (#432 — was click-removes);
 *   - a sound pattern (not a melody) falls back to standby.
 */
import { test, expect, type Page } from '@playwright/test'
import { pinLcmGrid } from './_appBoot'

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

async function openRoll(page: Page) {
  const drawer = page.locator('[data-bottom-panel="root"]')
  await drawer.locator('[data-bottom-panel="toggle"]').click()
  await drawer.locator('role=tab[name="Pattern"]').click()
  return drawer
}

/** Drag the drawer taller so the whole roll (rows + the velocity lane) is
 *  on-screen. In the short default drawer a low note can sit below the fold; a
 *  raw-mouse drag (unlike `.click()`) doesn't auto-scroll, so enlarge first. */
async function enlargeDrawer(page: Page): Promise<void> {
  const handle = page.locator('[data-bottom-panel="resize-handle"]')
  const hb = await handle.boundingBox()
  if (!hb) return
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + hb.width / 2, hb.y - 320, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(200)
}

// midi: c3=48, e3=52, g3=55
test.describe('Piano Roll (#383)', () => {
  test('renders notes on the right pitch rows and steps', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 ~ e3 g3")')
    const drawer = await openRoll(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(grid).toHaveCount(1)
    await expect(grid.locator('[data-roll-cell="48:0"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-roll-cell="52:2"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-roll-cell="55:3"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-roll-cell="48:1"]')).toHaveAttribute('aria-pressed', 'false')
  })

  test('a negative euclid renders the notes it inverts, not an empty grid (#917)', async ({
    page,
  }) => {
    // `(-5,8)` = the 3 steps a euclidean 5 leaves out (cols 1, 4, 7 — matches
    // Strudel's queryArc). Before #917 a guard drew an empty grid for a pattern
    // that plays.
    await boot(page)
    await setStrudelCode(page, '$: note("c3(-5,8)")')
    const drawer = await openRoll(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(grid).toHaveCount(1)
    for (const step of [1, 4, 7]) {
      await expect(grid.locator(`[data-roll-cell="48:${step}"]`)).toHaveAttribute('aria-pressed', 'true')
    }
    // and a step it does NOT play stays empty
    await expect(grid.locator('[data-roll-cell="48:0"]')).toHaveAttribute('aria-pressed', 'false')
  })

  test('shows the note name inside each note bar (#605)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 ~ e3 g3")')
    const drawer = await openRoll(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    // the head cell of each note carries its name (uppercase letter)
    await expect(grid.locator('[data-roll-cell="48:0"] [data-roll-note-name]')).toHaveText('C3')
    await expect(grid.locator('[data-roll-cell="52:2"] [data-roll-note-name]')).toHaveText('E3')
    await expect(grid.locator('[data-roll-cell="55:3"] [data-roll-note-name]')).toHaveText('G3')
    // an empty cell has no name label
    await expect(grid.locator('[data-roll-cell="48:1"] [data-roll-note-name]')).toHaveCount(0)
  })

  test('placing a note round-trips the mini-notation', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 ~ ~ ~")')
    const drawer = await openRoll(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await grid.locator('[data-roll-cell="52:2"]').click() // place e3 at step 2
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: note("c3 ~ e3 ~")')
  })

  test('placing a note keeps the `-` rest the user typed elsewhere (#916)', async ({ page }) => {
    // Span surgery for the roll: editing one step must not rewrite the others.
    // Before #916 this placed note rebuilt the whole mini and normalized the
    // user's `-` to `~` — `c3 - e3 ~` came back `c3 ~ e3 e3`. Now the untouched
    // `- ` region emits its own bytes and only step 3 changes.
    await boot(page)
    await setStrudelCode(page, '$: note("c3 - e3 ~")')
    const drawer = await openRoll(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await grid.locator('[data-roll-cell="52:3"]').click() // place e3 at step 3
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: note("c3 - e3 e3")')
  })

  /**
   * #920 — a `<...>` alternation used as a sequence element. `note("c3 <e3 g3>")`
   * opens as a 2-bar roll: c3 static across both bars, the `<e3 g3>` slot
   * alternating. Deleting the bar-1 note empties that slot → `note("c3 <e3 ~>")`,
   * the leading c3 untouched — never a whole-cycle `<[c3 e3] [c3 ~]>` rebuild.
   */
  test('opens and edits a <...>-as-element roll pattern (#920)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 <e3 g3>")')
    const drawer = await openRoll(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    // c3 in both bars (steps 0 & 2), e3 in bar 0 (step 1), g3 in bar 1 (step 3)
    await expect(grid.locator('[data-roll-cell="48:0"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-roll-cell="48:2"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-roll-cell="52:1"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-roll-cell="55:3"]')).toHaveAttribute('aria-pressed', 'true')
    await grid.locator('[data-roll-cell="55:3"]').click() // delete g3 in bar 1
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: note("c3 <e3 ~>")')
  })

  test('clicking a note deletes it (click-toggle)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 ~ ~ ~")')
    const drawer = await openRoll(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await grid.locator('[data-roll-cell="48:0"]').click() // click a note → removes it
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: note("~ ~ ~ ~")')
  })

  test('dragging a note moves it in pitch and time (#391)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 ~ ~ ~")')
    const drawer = await openRoll(page)
    await enlargeDrawer(page) // a low note can sit below the fold in the short drawer; show it first
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    const from = await grid.locator('[data-roll-cell="48:0"]').boundingBox() // c3 step0
    const to = await grid.locator('[data-roll-cell="52:2"]').boundingBox() // e3 step2
    if (!from || !to) throw new Error('missing cells')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: note("~ ~ e3 ~")')
  })

  test('dragging the right-edge handle resizes a note duration to `@n` (#391/#405)', async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 ~ ~ ~")')
    const drawer = await openRoll(page)
    await enlargeDrawer(page) // a low note can sit below the fold in the short drawer; show it first
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    // grab c3's right-edge resize handle and drag right to step 2 (→ duration 3)
    const handle = await grid.locator('[data-roll-resize="48:0"]').boundingBox()
    const to = await grid.locator('[data-roll-cell="48:2"]').boundingBox()
    if (!handle || !to) throw new Error('missing handle/cell')
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: note("c3@3 ~")')
    // the note now spans steps 0–2 (head + sustained tail cells on)
    await expect(grid.locator('[data-roll-cell="48:2"]')).toHaveAttribute('aria-pressed', 'true')
  })

  // drag the right-edge resize handle of the note at midi:start to a target step
  async function resizeDrag(
    page: Page,
    grid: ReturnType<Page['locator']>,
    midi: number,
    start: number,
    toStep: number,
  ): Promise<void> {
    const handle = await grid.locator(`[data-roll-resize="${midi}:${start}"]`).boundingBox()
    const to = await grid.locator(`[data-roll-cell="${midi}:${toStep}"]`).boundingBox()
    if (!handle || !to) throw new Error('missing handle/cell')
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(90)
  }

  test('stretching ONE note of a chord resizes only that note (#628) (LCM grid)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("[c3,e3] ~ ~ ~")')
    const drawer = await openRoll(page)
    await enlargeDrawer(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await resizeDrag(page, grid, 48, 0, 2) // grab c3 (not e3), stretch to step 2
    // c3 grows to @3, e3 stays a single step → independent durations as parallel lanes
    const code = await strudelValue(page)
    expect(code).toContain(',') // two lanes
    expect(code).toContain('c3@3')
    expect(code).toContain('e3')
    // c3 now spans step 2; e3 does not (only c3 stretched)
    await expect(grid.locator('[data-roll-cell="48:2"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[data-roll-cell="52:2"]')).toHaveAttribute('aria-pressed', 'false')
  })

  test('stretching a note OVER a following note sustains under it (#628) (LCM grid)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 e3 g3 a3")') // adjacent — was a no-op before #628
    const drawer = await openRoll(page)
    await enlargeDrawer(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await resizeDrag(page, grid, 48, 0, 2) // stretch c3 over e3+g3
    // c3 sustains 3 steps under the following onsets (no longer capped/no-op)
    expect(await strudelValue(page)).toBe('$: note("c3@3 a3, ~ e3 g3 ~")')
    await expect(grid.locator('[data-roll-cell="48:2"]')).toHaveAttribute('aria-pressed', 'true')
  })

  test('a near-miss on the right edge resizes (not deletes) the note (#530)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 ~ ~ ~")')
    const drawer = await openRoll(page)
    await enlargeDrawer(page) // a low note can sit below the fold in the short drawer; show it first
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    const cell = await grid.locator('[data-roll-cell="48:0"]').boundingBox()
    const to = await grid.locator('[data-roll-cell="48:2"]').boundingBox()
    if (!cell || !to) throw new Error('missing cells')
    // grab the right edge but land ~6px short of it — a realistic miss inside the
    // note body. Before #530 this started a move and a no-move release DELETED
    // the note; now the right grab zone treats it as resize intent.
    const x = cell.x + cell.width - 6
    const y = cell.y + cell.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, y, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: note("c3@3 ~")')
    await expect(grid.locator('[data-roll-cell="48:2"]')).toHaveAttribute('aria-pressed', 'true')
  })

  test('a near-miss press with no drag does not delete the note (#530)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 ~ ~ ~")')
    const drawer = await openRoll(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    const cell = await grid.locator('[data-roll-cell="48:0"]').boundingBox()
    if (!cell) throw new Error('missing cell')
    // press in the right grab zone, release without moving → resize intent, a
    // no-move resize is a no-op (NOT a delete).
    await page.mouse.move(cell.x + cell.width - 6, cell.y + cell.height / 2)
    await page.mouse.down()
    await page.mouse.up()
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: note("c3 ~ ~ ~")')
  })

  test('pitch range stays put when a note is removed (#391)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c5 ~ ~ ~")') // c5 = midi 72
    const drawer = await openRoll(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(grid.locator('[data-roll-cell="72:0"]')).toHaveCount(1)
    await grid.locator('[data-roll-cell="72:0"]').click() // click c5 → removes it
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: note("~ ~ ~ ~")')
    // the c5 row is still rendered (range didn't collapse to the default octave)
    await expect(grid.locator('[data-roll-cell="72:0"]')).toHaveCount(1)
  })

  /**
   * THE ROLL'S HALF of "a panel may draw rows the document does not hold, free" — the
   * same rule the Sequencer's *"a lane emptied of its last note…"* arm pins, satisfied by
   * a different carrier. The grid keeps an emptied lane by RETAINING its model, because
   * sound names are categorical and there is no next sound after `bd`. The roll does not
   * need to: pitch is ORDINAL, so a row below the content is a well-defined row, and the
   * padded + sticky range simply keeps drawing it.
   *
   * ⚠ c6 (midi 84), NOT c5. The neighbouring #391 test above uses c5 = 72, which is
   * exactly the top of the default c3–c5 range — so its row survives whether or not the
   * sticky range does anything, and it passes with the stickiness removed. Choosing a
   * pitch OUTSIDE the default range is the whole difference between an arm and a green
   * light: after the delete the model holds no pitch at all, so `rollContentRange` falls
   * back to c3–c5 and row 84 is drawn only because the range never shrank.
   *
   * It asserts all three things the grid's arm does, because two of them are separately
   * losable: the document really does lose the note, the row is still on screen, and
   * clicking it back restores the source BYTE-FOR-BYTE. The third is what makes the row
   * an affordance rather than a decoration.
   */
  test('a row emptied of its last note stays on screen and takes the note back (#1163)', async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c6 ~ ~ ~")') // c6 = midi 84, above the c3–c5 default
    const drawer = await openRoll(page)
    await enlargeDrawer(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(grid.locator('[data-roll-cell="84:0"]')).toHaveCount(1)

    await grid.locator('[data-roll-cell="84:0"]').click() // click the note → removes it
    await expect.poll(() => strudelValue(page)).toBe('$: note("~ ~ ~ ~")')

    // the row the document no longer holds is still drawn…
    await expect(grid.locator('[data-roll-cell="84:0"]')).toHaveCount(1)
    // …and it is still a live cell, not a picture of one
    await grid.locator('[data-roll-cell="84:0"]').click()
    await expect.poll(() => strudelValue(page)).toBe('$: note("c6 ~ ~ ~")')
  })

  /**
   * THE OTHER CARRIER, and the one #1163 is actually about. The arm above rests on the
   * sticky range; this one rests on the PADDING, and they are separately losable — the
   * padded row exists on a freshly-opened pattern where nothing has been deleted and the
   * stickiness has had nothing to do.
   *
   * `viewPlacesNotes` probes exactly this row to decide whether to grey the whole
   * surface, and until #1163 it took it as `min − 1` on the assumption that the display
   * pads below. This is the observation that assumption stood in for: the row two
   * semitones under the content is drawn, takes a click, and writes.
   *
   * c4 = 60, so `rollContentRange` gives lo = 58 (a#3) — a row the document does not
   * mention at all.
   */
  test('a padded row below the content is drawn and takes a note (#1163)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c4 ~ ~ ~")') // c4 = midi 60 → padded down to 58
    const drawer = await openRoll(page)
    await enlargeDrawer(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')

    await expect(grid.locator('[data-roll-cell="58:1"]')).toHaveCount(1)
    await grid.locator('[data-roll-cell="58:1"]').click()
    await expect.poll(() => strudelValue(page)).toBe('$: note("c4 a#3 ~ ~")')
  })

  test('a sound pattern adaptively shows the Sequencer, not the Piano Roll (#398)', async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd ~ sn ~")')
    const drawer = await openRoll(page)
    // the Pattern tab switches the grid by pattern kind: a drum pattern gets the
    // Sequencer step grid — the Piano Roll is not shown.
    await expect(drawer.locator('[data-bottom-panel-tab="sequencer"]')).toHaveCount(1)
    await expect(drawer.locator('[data-bottom-panel-tab="piano-roll"]')).toHaveCount(0)
  })

  test('a melody adaptively shows the Piano Roll (#398)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c3 ~ e3 g3")')
    const drawer = await openRoll(page)
    await expect(drawer.locator('[data-bottom-panel-tab="piano-roll"]')).toHaveCount(1)
    await expect(drawer.locator('[data-bottom-panel-tab="sequencer"]')).toHaveCount(0)
  })

  test('the velocity lane scrolls into view inside the grid scroll area (reverted #604/#624)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: note("c1 c6")') // ~5 octaves → rows overflow the panel
    const drawer = await openRoll(page)
    const panel = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    const scroller = panel.locator('[data-pattern-scroll]')
    const lane = panel.locator('[data-roll-velocity-lane]')
    await expect(lane).toHaveCount(1)
    // The lane is the LAST child INSIDE the scroll area — no longer pinned (#604
    // sticky) or pulled out as a footer (#624). A tall pitch range pushes it
    // below the fold; scrolling the area to the bottom brings it into view (the
    // always-visible scrollbar is how you reach it).
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(80)
    await expect(lane).toBeInViewport()
  })

  test('the grid scroll area opts into the always-visible scrollbar (W3)', async ({ page }) => {
    // Cross-package wiring guard: the editor marks the scroll container with
    // `data-pattern-scroll`, and the app's globals.css styles its webkit
    // scrollbar so it's always visible (non-overlay) when the grid overflows.
    // The actual scrollbar paint can't be asserted headless (headless Chromium
    // renders 0-width overlay bars regardless of CSS), so guard the wiring: the
    // attribute is present AND a matching stylesheet rule is loaded.
    await boot(page)
    await setStrudelCode(page, '$: note("c1 c6")')
    const drawer = await openRoll(page)
    const scroller = drawer.locator('[data-bottom-panel-tab="piano-roll"] [data-pattern-scroll]')
    await expect(scroller).toHaveCount(1)
    await expect(scroller).toHaveCSS('overflow-y', 'auto') // visible only when overflowing
    const ruleLoaded = await page.evaluate(() => {
      for (const ss of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(ss.cssRules)) {
            if ((rule as CSSStyleRule).selectorText?.includes('data-pattern-scroll') &&
                (rule as CSSStyleRule).selectorText?.includes('-webkit-scrollbar')) return true
          }
        } catch {
          /* cross-origin sheet — skip */
        }
      }
      return false
    })
    expect(ruleLoaded).toBe(true)
  })

  // Audition (#633): clicking/dragging a left piano key plays the pitch but must
  // NOT edit the document or throw. (Audio output itself isn't assertable
  // headless — that's the tunnel ear-test; here we guard the gesture's safety.)
  test('clicking a piano key auditions without editing the document (#633)', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await boot(page)
    await setStrudelCode(page, '$: note("c3 e3 g3").s("sawtooth")')
    const drawer = await openRoll(page)
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(roll).toHaveCount(1)
    const before = await strudelValue(page)
    const keyC3 = roll.locator('[data-roll-key="48"]') // c3
    await expect(keyC3).toHaveCount(1)
    await expect(keyC3).toHaveCSS('cursor', 'pointer') // interactive affordance
    await expect(keyC3).toHaveAttribute('title', /Play/)
    await keyC3.click()
    await page.waitForTimeout(100)
    expect(await strudelValue(page)).toBe(before) // audition never edits
    expect(errors).toEqual([]) // try/catch swallows an unready audio graph
  })

  test('dragging across piano keys auditions without editing the document (#633)', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await boot(page)
    await setStrudelCode(page, '$: note("c3 e3 g3").s("sawtooth")')
    const drawer = await openRoll(page)
    await enlargeDrawer(page) // keys on-screen; raw-mouse drag doesn't auto-scroll
    const roll = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    const before = await strudelValue(page)
    const a = await roll.locator('[data-roll-key="48"]').boundingBox() // c3
    const b = await roll.locator('[data-roll-key="55"]').boundingBox() // g3
    if (!a || !b) throw new Error('piano keys not on-screen')
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }) // glissando
    await page.mouse.up()
    await page.waitForTimeout(100)
    expect(await strudelValue(page)).toBe(before) // a key-drag never edits
    expect(errors).toEqual([])
  })
})

/**
 * #924 — the behaviour projection for the Piano Roll. A melody whose note string
 * the two-level model can't represent (a group nested inside a group) still plays
 * an ordinary pitch×time grid; the projection reads what it PLAYS — pitch, onset
 * AND duration — and shows it, copying unedited notation back verbatim on write.
 */
test.describe('Piano Roll behaviour-projection (#924)', () => {
  test('a nested-group melody opens an editable roll and edits copy the group back verbatim', async ({
    page,
  }) => {
    // `c3 [e3 [g3 g3]] c4` is two levels deep — refused by the syntactic model, but
    // plays a plain 12-step roll: c3@0(×4), e3@4(×2), g3@6, g3@7, c4@8(×4).
    await boot(page)
    await setStrudelCode(page, '$: note("c3 [e3 [g3 g3]] c4")')
    const drawer = await openRoll(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(grid).toHaveCount(1)
    await expect(grid.locator('[data-roll-cell="48:0"]')).toHaveAttribute('aria-pressed', 'true') // c3
    await expect(grid.locator('[data-roll-cell="52:4"]')).toHaveAttribute('aria-pressed', 'true') // e3
    await expect(grid.locator('[data-roll-cell="55:6"]')).toHaveAttribute('aria-pressed', 'true') // g3
    await expect(grid.locator('[data-roll-cell="55:7"]')).toHaveAttribute('aria-pressed', 'true') // g3
    await expect(grid.locator('[data-roll-cell="60:8"]')).toHaveAttribute('aria-pressed', 'true') // c4
    // delete the leading c3; the nested group + c4 ride back byte-for-byte
    await grid.locator('[data-roll-cell="48:0"]').click()
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: note("~ [e3 [g3 g3]] c4")')
  })

  test('a numeric nested melody projects and edits locally', async ({ page }) => {
    // `n("0 [2 [4 4]] 7")` — degrees, nested. The projection carries the numeric
    // convention, and deleting the first degree leaves the nested group untouched.
    await boot(page)
    await setStrudelCode(page, '$: n("0 [2 [4 4]] 7")')
    const drawer = await openRoll(page)
    const grid = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
    await expect(grid).toHaveCount(1)
    await grid.locator('[data-roll-cell="0:0"]').click() // delete degree 0
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toBe('$: n("~ [2 [4 4]] 7")')
  })

  test('a per-cycle-varying melody falls back to code (projection declines)', async ({ page }) => {
    // `c3?` degrades per cycle — not a static grid. The projection declines and the
    // Piano Roll shows standby, not a false grid.
    await boot(page)
    await setStrudelCode(page, '$: note("c3? e3 g3 a3")')
    const drawer = await openRoll(page)
    await expect(
      drawer.locator('[data-bottom-panel-tab="piano-roll"] [data-roll-cell]'),
    ).toHaveCount(0)
  })
})
