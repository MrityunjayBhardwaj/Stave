/**
 * Mixer channel-strip row — S0 (#540). Read-only projection: one strip per
 * top-level statement, cursor-independent, with name / source / pan / gain
 * readouts derived purely from the document.
 *
 * The strip band shares the Pattern ▸ Mixer column with the #381 param panel,
 * which keeps priority in a short drawer — so these assert the strips' presence
 * and content in the DOM (always rendered, scrollable) rather than fixed screen
 * coordinates.
 */
import { test, expect, type Page } from '@playwright/test'

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
  const ok = await page.evaluate((c) => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
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

/**
 * open the global Mixer console tab (#540 / S4 — the strip band lives here now)
 * and return a locator SCOPED to its panel. Both tab bodies stay mounted (the
 * bottom panel only hides the inactive one), so the Pattern tab's local strip
 * also carries `data-mixer-strip-id` — scoping the returned locator to the
 * console panel keeps strip selectors unambiguous.
 */
async function openMixer(page: Page) {
  const root = page.locator('[data-bottom-panel="root"]')
  await root.locator('[data-bottom-panel="toggle"]').click()
  await root.locator('role=tab[name="Mixer"]').click()
  return root.locator('[data-bottom-panel-tab="mixer-console"]')
}

/** open the Pattern tab — its grid (sequencer/roll) sits beside the cursor
 *  track's local mixer strip, so a grid edit and that track's meter are
 *  co-visible (the global Mixer tab shows strips but not the grid). Returns a
 *  locator scoped to the Pattern panel. */
async function openPattern(page: Page) {
  const root = page.locator('[data-bottom-panel="root"]')
  await root.locator('[data-bottom-panel="toggle"]').click()
  await root.locator('role=tab[name="Pattern"]').click()
  return root.locator('[data-bottom-panel-tab="pattern"]')
}

/** drag the drawer taller so the full strip (incl. fader) is on screen */
async function enlargeDrawer(page: Page): Promise<void> {
  const handle = page.locator('[data-bottom-panel="resize-handle"]')
  const hb = await handle.boundingBox()
  if (!hb) return
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + hb.width / 2, hb.y - 320, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(150)
}

async function strudelValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; getValue: () => string } | null }> } } }).monaco
    const eds = m?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    return t?.getModel()?.getValue() ?? ''
  })
}

async function undo(page: Page): Promise<void> {
  await page.evaluate(() => {
    const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string } | null; trigger: (s: string, id: string, p: unknown) => void }> } } }).monaco
    const eds = m?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.trigger('test', 'undo', null)
  })
  await page.waitForTimeout(60)
}

/** vertical drag on a strip's fader by `dyUp` pixels (up = louder) */
async function dragFader(page: Page, drawer: ReturnType<Page['locator']>, stripId: string, dyUp: number): Promise<void> {
  const fader = drawer.locator(`[data-mixer-strip-id="${stripId}"] [data-mixer-strip-fader]`)
  const box = await fader.boundingBox()
  if (!box) throw new Error(`no fader box for ${stripId}`)
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx, cy - dyUp, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(80)
}

/** the strudel editor's current caret line (1-based), or -1 if no editor */
async function cursorLine(page: Page): Promise<number> {
  return page.evaluate(() => {
    const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string } | null; getPosition: () => { lineNumber: number } | null }> } } }).monaco
    const eds = m?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    return t?.getPosition?.()?.lineNumber ?? -1
  })
}

test.describe('Mixer strip row (#540 / S0)', () => {
  test('renders one strip per top-level statement, in source order', async ({ page }) => {
    await boot(page)
    await setStrudelCode(
      page,
      ['$: s("bd sn")', 'd1: note("c e g").sound("piano")', '$: s("hh*4")'].join('\n'),
    )
    const drawer = await openMixer(page)
    const strips = drawer.locator('[data-mixer-strip]')
    await expect(strips).toHaveCount(3)
    // names: anonymous $: fall back to head/source; the named track keeps its label
    // (a mix console names channels — the source line was dropped in S4).
    await expect(strips.nth(1).locator('[data-mixer-strip-name]')).toHaveText('d1')
    // kinds projected from the head fn
    await expect(strips.nth(0)).toHaveAttribute('data-mixer-strip-kind', 'step')
    await expect(strips.nth(1)).toHaveAttribute('data-mixer-strip-kind', 'roll')
  })

  test('reads gain as a dB fader readout, pan as L/C/R', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd").gain(1).pan(0.8)')
    const drawer = await openMixer(page)
    const strip = drawer.locator('[data-mixer-strip]').first()
    await expect(strip.locator('[data-mixer-strip-db]')).toHaveText('0.0') // gain 1 = 0 dB
    await expect(strip.locator('[data-mixer-strip-pan]')).toHaveText('R60') // 0.8 → R60
  })

  test('hands off a signal gain (fader disabled, shown as "sig")', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd").gain(sine)')
    const drawer = await openMixer(page)
    const strip = drawer.locator('[data-mixer-strip]').first()
    await expect(strip.locator('[data-mixer-strip-gain]')).toHaveText('sig')
  })

  test('re-derives the strip list when the document changes (pure projection)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd")')
    const drawer = await openMixer(page)
    await expect(drawer.locator('[data-mixer-strip]')).toHaveCount(1)
    await setStrudelCode(page, '$: s("bd")\n$: s("hh")\nd1: note("c e")')
    await expect(drawer.locator('[data-mixer-strip]')).toHaveCount(3)
  })
})

test.describe('Mixer strip write-back (#540 / S1)', () => {
  test('dragging a fader sets that track gain; siblings byte-identical; one undo', async ({ page }) => {
    await boot(page)
    const original = '$: s("bd").gain(0.5)\nd1: note("c e").gain(0.8)\n$: s("hh*4").gain(0.5)'
    await setStrudelCode(page, original)
    const drawer = await openMixer(page)
    await enlargeDrawer(page)

    // drag the SECOND anonymous strip (#1 = the hh*4 line) up → louder
    await dragFader(page, drawer, '#1', 40)
    const after = await strudelValue(page)
    const lines = after.split('\n')
    // only the third line changed; lines 0 and 1 are byte-identical
    expect(lines[0]).toBe('$: s("bd").gain(0.5)')
    expect(lines[1]).toBe('d1: note("c e").gain(0.8)')
    const m = lines[2].match(/^\$: s\("hh\*4"\)\.gain\((\d*\.?\d+)\)$/)
    expect(m, `unexpected line: ${lines[2]}`).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThan(0.5)

    // one undo reverts the whole drag
    await undo(page)
    expect(await strudelValue(page)).toBe(original)
  })

  // #1918 — Strudel plays the LAST of two calls to one control, so the strip must
  // show that one and a drag must rewrite it; the earlier call stays byte-identical.
  test('a doubled call: the strip reads and writes the call that plays', async ({ page }) => {
    await boot(page)
    const original = '$: s("bd").gain(0.5).gain(0.8).pan(0.1).pan(0.9)'
    await setStrudelCode(page, original)
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    const strip = drawer.locator('[data-mixer-strip]').first()
    await expect(strip.locator('[data-mixer-strip-db]')).toHaveText('-1.9') // 0.8, not 0.5 (-6.0)
    await expect(strip.locator('[data-mixer-strip-pan]')).toHaveText('R80') // 0.9, not 0.1 (L80)
    await dragFader(page, drawer, '#0', 30)
    const after = await strudelValue(page)
    const m = after.match(/^\$: s\("bd"\)\.gain\(0\.5\)\.gain\((\d*\.?\d+)\)\.pan\(0\.1\)\.pan\(0\.9\)$/)
    expect(m, `unexpected document: ${after}`).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThan(0.8)
    await undo(page)
    expect(await strudelValue(page)).toBe(original)
  })

  test('dragging a fader on a track with no .gain inserts one', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd")')
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    await dragFader(page, drawer, '#0', 30)
    expect(await strudelValue(page)).toMatch(/^\$: s\("bd"\)\.gain\(\d*\.?\d+\)$/)
  })

  test('a managed velocity gain rescales proportionally (ceiling-anchored)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd sn").gain("0.5 1")')
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    await dragFader(page, drawer, '#0', -30) // drag DOWN → quieter
    const after = await strudelValue(page)
    const m = after.match(/gain\("([\d.]+) ([\d.]+)"\)/)
    expect(m, `unexpected: ${after}`).not.toBeNull()
    const [a, b] = [Number(m![1]), Number(m![2])]
    expect(b).toBeLessThan(1) // ceiling came down
    expect(a / b).toBeCloseTo(0.5, 2) // shape (0.5 : 1) preserved
  })

  test('dragging pan writes .pan', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd")')
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    const pan = drawer.locator('[data-mixer-strip-id="#0"] [data-mixer-strip-pan-control]')
    const box = await pan.boundingBox()
    if (!box) throw new Error('no pan box')
    const cy = box.y + box.height / 2
    await page.mouse.move(box.x + box.width / 2, cy)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 40, cy, { steps: 8 }) // drag right → R
    await page.mouse.up()
    await page.waitForTimeout(80)
    expect(await strudelValue(page)).toMatch(/^\$: s\("bd"\)\.pan\(0\.[5-9]\d*\)$/)
  })

  test('a signal .gain stays read-only (drag is a no-op)', async ({ page }) => {
    await boot(page)
    const original = '$: s("bd").gain(sine)'
    await setStrudelCode(page, original)
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    await dragFader(page, drawer, '#0', 40)
    expect(await strudelValue(page)).toBe(original)
  })
})

// A config/transport line (`setcps`, `samples`) is filtered out of the strips
// (#559), so the strip-array index is off-by-one from the detected-chunk index
// for every track after it. The write path must address a strip's chunk by its
// ABSOLUTE source index (`strip.index`), not the strip position — otherwise the
// fader/knob edit lands on the PREVIOUS statement (onto `setcps` for the first
// strip). This is the "the mixer set the modifier onto setcps" bug.
test.describe('Mixer write-back with a leading config line (#559 off-by-one)', () => {
  test('the face fader edits the first TRACK, never the setcps line above it', async ({ page }) => {
    await boot(page)
    const original = 'setcps(0.5)\n$: s("bd").gain(0.5)\nd1: s("hh*4").gain(0.8)'
    await setStrudelCode(page, original)
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    // #0 is the FIRST TRACK (setcps has no strip). Dragging it down must edit
    // that track's gain, not write a modifier onto the setcps line.
    await dragFader(page, drawer, '#0', -30)
    const lines = (await strudelValue(page)).split('\n')
    expect(lines[0]).toBe('setcps(0.5)') // config line BYTE-IDENTICAL
    const m = lines[1].match(/^\$: s\("bd"\)\.gain\((\d*\.?\d+)\)$/)
    expect(m, `unexpected track line: ${lines[1]}`).not.toBeNull()
    expect(Number(m![1])).toBeLessThan(0.5) // the first TRACK got quieter
    expect(lines[2]).toBe('d1: s("hh*4").gain(0.8)') // sibling byte-identical
  })

  test('the expand drawer binds + writes to the right track past a config line', async ({ page }) => {
    await boot(page)
    const original = 'setcps(0.5)\n$: s("bd").gain(0.5)\nd1: note("c e").lpf(800)'
    await setStrudelCode(page, original)
    const drawer = await openMixer(page)
    await enlargeDrawer(page)

    await toggleExpand(page, drawer, 'd1')
    // The drawer must READ d1's chain (an lpf knob), not the previous track's.
    const d1Drawer = drawer.locator('[data-mixer-expand-for="d1"]')
    await expect(d1Drawer.locator('[data-knob="lpf"]')).toHaveCount(1)

    const slider = d1Drawer.locator('[data-knob="lpf"] [role="slider"]')
    await slider.scrollIntoViewIfNeeded()
    const box = await slider.boundingBox()
    if (!box) throw new Error('no lpf knob box')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 40, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(80)

    const lines = (await strudelValue(page)).split('\n')
    expect(lines[0]).toBe('setcps(0.5)') // config line untouched
    expect(lines[1]).toBe('$: s("bd").gain(0.5)') // previous track untouched
    const m = lines[2].match(/^d1: note\("c e"\)\.lpf\((\d*\.?\d+)\)$/)
    expect(m, `unexpected d1 line: ${lines[2]}`).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThan(800) // d1's OWN lpf changed
  })
})

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/** evaluate/play the current doc. Focuses the STRUDEL editor (not just
 * `getEditors()[0]`, which may be another Monaco instance after the mixer is
 * open / a control was clicked) so the Cmd+Enter eval keybinding lands. */
async function play(page: Page): Promise<void> {
  await page.evaluate(() => {
    const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string } | null; focus: () => void; setPosition: (p: { lineNumber: number; column: number }) => void }> } } }).monaco
    const eds = m?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.setPosition({ lineNumber: 1, column: 1 })
    t?.focus()
  })
  await page.waitForTimeout(50)
  await page.keyboard.press(`${MOD}+Enter`)
}

/** the live fill height (0..100) of a strip's meter bar. */
async function meterFill(
  page: Page,
  drawer: ReturnType<Page['locator']>,
  stripId: string,
): Promise<number> {
  return drawer
    .locator(`[data-mixer-strip-id="${stripId}"] [data-mixer-meter-fill]`)
    // vertical (console) strips paint the fill HEIGHT; the Pattern-tab horizontal
    // strip (#600) paints its WIDTH — read whichever this strip set.
    .evaluate((e) => parseFloat((e as HTMLElement).style.height) || parseFloat((e as HTMLElement).style.width) || 0)
}

/** click a strip's mute button. */
async function clickMute(
  page: Page,
  drawer: ReturnType<Page['locator']>,
  stripId: string,
): Promise<void> {
  await drawer.locator(`[data-mixer-strip-id="${stripId}"] [data-mixer-strip-mute]`).click()
  await page.waitForTimeout(80)
}

test.describe('Mixer strip mute (#543 / S3)', () => {
  test('mute marks the file orthogonally to gain; un-mute round-trips byte-identical', async ({
    page,
  }) => {
    await boot(page)
    // named tracks → the muted track keeps a stable id (`d1`), so the strip is
    // easy to address before and after the toggle.
    const original = 'd1: s("bd").gain(0.5)\n$: s("hh*4")'
    await setStrudelCode(page, original)
    const drawer = await openMixer(page)

    // mute d1 → the `_` marker is prefixed; `.gain(0.5)` is UNTOUCHED (orthogonal,
    // V-mixer-2) and the sibling line is byte-identical.
    await clickMute(page, drawer, 'd1')
    const muted = await strudelValue(page)
    expect(muted.split('\n')[0]).toBe('_d1: s("bd").gain(0.5)')
    expect(muted.split('\n')[1]).toBe('$: s("hh*4")')

    // the strip reflects the muted state but keeps its name `d1`.
    const strip = drawer.locator('[data-mixer-strip-id="d1"]')
    await expect(strip).toHaveAttribute('data-mixer-strip-muted', '')
    await expect(strip.locator('[data-mixer-strip-mute]')).toHaveAttribute('aria-pressed', 'true')
    await expect(strip.locator('[data-mixer-strip-name]')).toHaveText('d1')

    // un-mute → the marker is removed; the document is the exact original.
    await clickMute(page, drawer, 'd1')
    expect(await strudelValue(page)).toBe(original)
    await expect(strip.locator('[data-mixer-strip-mute]')).toHaveAttribute('aria-pressed', 'false')
  })

  test('the mute control is disabled on a bare-expression strip (no label to carry)', async ({
    page,
  }) => {
    await boot(page)
    await setStrudelCode(page, 's("bd*4")')
    const drawer = await openMixer(page)
    await expect(drawer.locator('[data-mixer-strip] [data-mixer-strip-mute]')).toBeDisabled()
  })

  test('a `_`-muted track is silent (dark meter) while a sibling plays (GR3, per-track)', async ({
    page,
  }) => {
    await boot(page)
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    // d1 is muted (`_d1`), d2 plays. Named tracks → stable ids d1/d2. The mute
    // WRITE itself is covered by the round-trip test above; here we observe the
    // ENGINE effect of the idiom: the engine skips `_d1` entirely (no scheduler),
    // so d1's meter stays dark while d2 moves — and crucially d2 still plays, so
    // the `_d1` label neither errors the eval nor shifts d2's captureId (GR3).
    await setStrudelCode(page, '_d1: s("bd*8").gain(0.9)\nd2: s("hh*8").gain(0.9)')

    let d1Max = 0
    let d2Max = 0
    // Re-eval up to 3× (the editor→file sync can race the first eval — S2 note).
    for (let attempt = 0; attempt < 3 && d2Max < 15; attempt++) {
      await play(page)
      await page.waitForTimeout(500)
      d1Max = 0
      d2Max = 0
      for (let i = 0; i < 30; i++) {
        d1Max = Math.max(d1Max, await meterFill(page, drawer, 'd1'))
        d2Max = Math.max(d2Max, await meterFill(page, drawer, 'd2'))
        await page.waitForTimeout(33)
      }
    }
    expect(d2Max, 'sibling d2 plays — `_d1` does not break the eval or shift its captureId').toBeGreaterThan(15)
    expect(d1Max, 'muted `_d1` is silent — dark meter').toBeLessThan(8)
  })

  test('LIVE mute: clicking mute while playing silences the track immediately (no manual re-eval)', async ({
    page,
  }) => {
    await boot(page)
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    await setStrudelCode(page, 'd1: s("bd*8").gain(0.9)\nd2: s("hh*8").gain(0.9)')

    // start playback; both meters move.
    let d1Max = 0
    let d2Max = 0
    for (let attempt = 0; attempt < 3 && (d1Max < 15 || d2Max < 15); attempt++) {
      await play(page)
      await page.waitForTimeout(500)
      d1Max = 0
      d2Max = 0
      for (let i = 0; i < 30; i++) {
        d1Max = Math.max(d1Max, await meterFill(page, drawer, 'd1'))
        d2Max = Math.max(d2Max, await meterFill(page, drawer, 'd2'))
        await page.waitForTimeout(33)
      }
    }
    expect(d1Max, 'd1 plays before muting').toBeGreaterThan(15)
    expect(d2Max, 'd2 plays before muting').toBeGreaterThan(15)

    // click mute on d1 — and DO NOT re-evaluate. Live mute re-evals the playing
    // file itself, so d1 goes silent (dark) within a beat while d2 keeps moving.
    await clickMute(page, drawer, 'd1')
    expect((await strudelValue(page)).split('\n')[0]).toBe('_d1: s("bd*8").gain(0.9)')
    await page.waitForTimeout(600)
    let d1Muted = 0
    let d2Still = 0
    for (let i = 0; i < 30; i++) {
      d1Muted = Math.max(d1Muted, await meterFill(page, drawer, 'd1'))
      d2Still = Math.max(d2Still, await meterFill(page, drawer, 'd2'))
      await page.waitForTimeout(33)
    }
    expect(d1Muted, 'live mute silences d1 immediately — dark, no manual eval').toBeLessThan(8)
    expect(d2Still, 'sibling d2 keeps playing').toBeGreaterThan(15)
  })

  test('LIVE fader: dragging the fader while playing changes the level immediately (no manual re-eval)', async ({
    page,
  }) => {
    await boot(page)
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    await setStrudelCode(page, 'd1: s("bd*8").gain(0.9)')

    // start playback; the meter runs high at gain 0.9.
    let high = 0
    for (let attempt = 0; attempt < 3 && high < 15; attempt++) {
      await play(page)
      await page.waitForTimeout(500)
      high = 0
      for (let i = 0; i < 30; i++) {
        high = Math.max(high, await meterFill(page, drawer, 'd1'))
        await page.waitForTimeout(33)
      }
    }
    expect(high, 'd1 runs high at gain 0.9').toBeGreaterThan(15)

    // drag the fader DOWN — and DO NOT re-evaluate. The gesture-end live re-eval
    // applies the lower gain, so the meter drops within a beat on its own.
    await dragFader(page, drawer, 'd1', -55) // negative = down → quieter
    expect(await strudelValue(page)).toMatch(/gain\(0?\.\d+\)/) // gain lowered, still scalar
    await page.waitForTimeout(600)
    let low = 0
    for (let i = 0; i < 30; i++) {
      low = Math.max(low, await meterFill(page, drawer, 'd1'))
      await page.waitForTimeout(33)
    }
    expect(low, 'meter follows the lowered fader live').toBeLessThan(high - 8)
  })

  test('LIVE sequencer: silencing a track\'s steps while playing goes dark immediately (centralised at the write path)', async ({
    page,
  }) => {
    await boot(page)
    // The Pattern tab shows the Sequencer grid beside the cursor track's LOCAL
    // mixer strip (with its meter) — so we can edit the steps and watch the
    // meter in one view. Editing the sequencer is a DIFFERENT surface than the
    // mixer write path, so this proves the live re-eval is centralised at
    // Writeback (the meter darkens with no manual eval).
    const drawer = await openPattern(page)
    await enlargeDrawer(page)
    await setStrudelCode(page, 'd1: s("bd*4")')

    let lit = 0
    for (let attempt = 0; attempt < 3 && lit < 15; attempt++) {
      await play(page)
      await page.waitForTimeout(500)
      lit = 0
      for (let i = 0; i < 30; i++) {
        lit = Math.max(lit, await meterFill(page, drawer, 'd1'))
        await page.waitForTimeout(33)
      }
    }
    expect(lit, 'd1 pulses at bd*4').toBeGreaterThan(15)

    // turn every step OFF in the sequencer — no manual re-eval. Each toggle is a
    // Writeback gesture, so it re-evals on release; once the track has no hits its
    // meter goes dark while it's still "playing".
    const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')
    for (let s = 0; s < 4; s++) {
      const cell = grid.locator(`[data-seq-cell="0:${s}"]`)
      if ((await cell.count()) && (await cell.getAttribute('aria-pressed')) === 'true') {
        await cell.click()
        await page.waitForTimeout(60)
      }
    }
    // Let the live re-eval land AND the already-scheduled haps flush — Strudel
    // schedules a cycle ahead, so a silenced pattern fades over ~1 cycle rather
    // than cutting instantly (unlike mute, which removes the scheduler outright).
    await page.waitForTimeout(3200)
    // Measure the SUSTAINED level (mean of several reads) — the track is now
    // silent, so the fill sits at ~0; a max-of-window would catch a flush blip.
    let sum = 0
    const N = 12
    for (let i = 0; i < N; i++) {
      sum += await meterFill(page, drawer, 'd1')
      await page.waitForTimeout(40)
    }
    expect(sum / N, 'silencing the steps darkens the meter live, no manual eval').toBeLessThan(8)
  })
})

test.describe('Mixer live meters (#540 / S2)', () => {
  test('each strip fuses a meter keyed by its captureId; dark before play', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd*4")\nd1: note("c e g")')
    const drawer = await openMixer(page)
    await enlargeDrawer(page)

    // one meter per strip, keyed by the strip's captureId (the analyser join).
    await expect(drawer.locator('[data-mixer-strip-meter]')).toHaveCount(2)
    await expect(
      drawer.locator('[data-mixer-strip-id="#0"] [data-mixer-meter-capture="$0"]'),
    ).toBeVisible()
    await expect(
      drawer.locator('[data-mixer-strip-id="d1"] [data-mixer-meter-capture="d1"]'),
    ).toBeVisible()

    // nothing playing yet → both bars dark.
    expect(await meterFill(page, drawer, '#0')).toBeLessThan(2)
    expect(await meterFill(page, drawer, 'd1')).toBeLessThan(2)
  })

  test('a playing track lights its own meter; a silent track stays dark (per-track)', async ({
    page,
  }) => {
    await boot(page)
    // Open the mixer BEFORE evaluating so the meter's bus subscription is live
    // when the program publishes (and pinned to this file, not the bus default).
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    await setStrudelCode(page, '$: s("bd*8").gain(0.9)\n$: silence')

    // Poll for the loud track's meter to move; re-eval once if the first
    // evaluate raced the editor→file sync.
    let loudMax = 0
    let quietMax = 0
    for (let attempt = 0; attempt < 2 && loudMax < 15; attempt++) {
      await play(page)
      await page.waitForTimeout(500)
      loudMax = 0
      quietMax = 0
      for (let i = 0; i < 30; i++) {
        loudMax = Math.max(loudMax, await meterFill(page, drawer, '#0'))
        quietMax = Math.max(quietMax, await meterFill(page, drawer, '#1'))
        await page.waitForTimeout(33)
      }
    }

    // The loud track's meter moves; the silent track's stays dark — proof the
    // join is per-track (a master-mix tap would light both).
    expect(loudMax).toBeGreaterThan(15)
    expect(quietMax).toBeLessThan(8)
  })
})

/** click a strip's ▸/◂ expand toggle (Mixer console only). */
async function toggleExpand(
  page: Page,
  drawer: ReturnType<Page['locator']>,
  stripId: string,
): Promise<void> {
  await drawer.locator(`[data-mixer-strip-id="${stripId}"] [data-mixer-strip-expand]`).click()
  await page.waitForTimeout(60)
}

test.describe('Mixer strip expand drawer (#550 / S4b)', () => {
  test('the ▸ toggle opens that strip\'s drawer inline; ◂ collapses it (sticky)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd").gain(0.5)\nd1: note("c e").lpf(800)')
    const drawer = await openMixer(page)

    // nothing expanded by default
    await expect(drawer.locator('[data-mixer-expand-drawer]')).toHaveCount(0)

    await toggleExpand(page, drawer, 'd1')
    await expect(drawer.locator('[data-mixer-expand-for="d1"]')).toHaveCount(1)
    await expect(
      drawer.locator('[data-mixer-strip-id="d1"] [data-mixer-strip-expand]'),
    ).toHaveAttribute('aria-expanded', 'true')

    // sticky: it stays open until toggled again
    await toggleExpand(page, drawer, 'd1')
    await expect(drawer.locator('[data-mixer-expand-for="d1"]')).toHaveCount(0)
  })

  test('the drawer binds to THAT strip\'s chain, not the cursor\'s track', async ({ page }) => {
    await boot(page)
    // cursor lands on line 1 (#0, a gain track); d1 carries an lpf instead.
    await setStrudelCode(page, '$: s("bd").gain(0.2)\nd1: note("c e").lpf(800)')
    const drawer = await openMixer(page)

    await toggleExpand(page, drawer, 'd1')
    const d1Drawer = drawer.locator('[data-mixer-expand-for="d1"]')
    // d1's own chain → an lpf knob; NOT the cursor track's gain(0.2).
    await expect(d1Drawer.locator('[data-knob="lpf"]')).toHaveCount(1)
    await expect(d1Drawer.locator('[data-knob="gain"]')).toHaveCount(0)
  })

  test('dragging a knob in the drawer edits only that statement; siblings byte-identical; one undo', async ({
    page,
  }) => {
    await boot(page)
    const original = '$: s("bd").gain(0.5)\nd1: note("c e").lpf(800)\n$: s("hh*4").gain(0.5)'
    await setStrudelCode(page, original)
    const drawer = await openMixer(page)
    await enlargeDrawer(page)

    await toggleExpand(page, drawer, 'd1')
    const slider = drawer.locator('[data-mixer-expand-for="d1"] [data-knob="lpf"] [role="slider"]')
    await expect(slider).toHaveCount(1)
    await slider.scrollIntoViewIfNeeded()
    const box = await slider.boundingBox()
    if (!box) throw new Error('no lpf knob box')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx, cy - 40, { steps: 8 }) // up → louder cutoff
    await page.mouse.up()
    await page.waitForTimeout(80)

    const lines = (await strudelValue(page)).split('\n')
    // only the d1 line changed; the two anonymous gain lines are byte-identical
    expect(lines[0]).toBe('$: s("bd").gain(0.5)')
    expect(lines[2]).toBe('$: s("hh*4").gain(0.5)')
    const m = lines[1].match(/^d1: note\("c e"\)\.lpf\((\d*\.?\d+)\)$/)
    expect(m, `unexpected d1 line: ${lines[1]}`).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThan(800)

    // one undo reverts the whole drag
    await undo(page)
    expect(await strudelValue(page)).toBe(original)
  })

  test('expanding a second strip keeps the first open (multi)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd").gain(0.5)\nd1: note("c e").lpf(800)')
    const drawer = await openMixer(page)

    await toggleExpand(page, drawer, '#0')
    await toggleExpand(page, drawer, 'd1')
    await expect(drawer.locator('[data-mixer-expand-drawer]')).toHaveCount(2)
    await expect(drawer.locator('[data-mixer-expand-for="#0"]')).toHaveCount(1)
    await expect(drawer.locator('[data-mixer-expand-for="d1"]')).toHaveCount(1)
  })

  test('expand never writes the file, and persists across a reload (V-mixer-1)', async ({ page }) => {
    await boot(page)
    const original = '$: s("bd").gain(0.5)\nd1: note("c e").lpf(800)'
    await setStrudelCode(page, original)
    let drawer = await openMixer(page)

    await toggleExpand(page, drawer, 'd1')
    await expect(drawer.locator('[data-mixer-expand-for="d1"]')).toHaveCount(1)
    // expand is UI state — the document is untouched (V-mixer-1).
    expect(await strudelValue(page)).toBe(original)

    // reload: the expanded set is persisted in localStorage (per file), so the
    // d1 drawer re-opens once its strip exists again — without touching the file.
    await page.reload()
    await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 15_000 })
    await page.waitForFunction(
      () => {
        const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
        return (m?.editor?.getEditors?.()?.length ?? 0) > 0
      },
      { timeout: 15_000 },
    )
    drawer = await openMixer(page)
    await setStrudelCode(page, original)
    await expect(drawer.locator('[data-mixer-expand-for="d1"]')).toHaveCount(1)
    expect(await strudelValue(page)).toBe(original)
  })

  test('an expanded anonymous strip stays open when an EARLIER track is muted (#555)', async ({
    page,
  }) => {
    await boot(page)
    // two anonymous tracks (#0, #1) around a named one; #1 = the cp line.
    await setStrudelCode(page, '$: s("bd")\nd1: s("hh")\n$: s("cp")')
    const drawer = await openMixer(page)
    await enlargeDrawer(page)

    // expand the SECOND anonymous strip (#1).
    await toggleExpand(page, drawer, '#1')
    await expect(drawer.locator('[data-mixer-expand-for="#1"]')).toHaveCount(1)

    // mute the FIRST anonymous track (#0). Its engine captureId leaves the count
    // ($1→$0 for #1), but #1's STABLE id does not shift — so its drawer must stay
    // open and bound to #1 (under the old positional id it would have collapsed).
    await clickMute(page, drawer, '#0')
    await expect(drawer.locator('[data-mixer-strip-id="#0"][data-mixer-strip-muted]')).toHaveCount(
      1,
    )
    await expect(drawer.locator('[data-mixer-expand-for="#1"]')).toHaveCount(1)
  })
})

/** the live fill height (0..100) of the master meter. */
async function masterFill(page: Page, drawer: ReturnType<Page['locator']>): Promise<number> {
  return drawer
    .locator('[data-mixer-master-meter-fill]')
    .evaluate((e) => parseFloat((e as HTMLElement).style.height) || 0)
}

/** click a strip's solo button. */
async function clickSolo(
  page: Page,
  drawer: ReturnType<Page['locator']>,
  stripId: string,
): Promise<void> {
  await drawer.locator(`[data-mixer-strip-id="${stripId}"] [data-mixer-strip-solo]`).click()
  await page.waitForTimeout(60)
}

/** sustained mean of a sampler over n×40ms (P-MIX-6/8: mean, not max). */
async function sustainedMean(sample: () => Promise<number>, n: number, page: Page): Promise<number> {
  let s = 0
  for (let i = 0; i < n; i++) {
    s += await sample()
    await page.waitForTimeout(40)
  }
  return s / n
}

test.describe('Mixer master + solo (#550 / S5)', () => {
  test('the master strip shows a live meter while playing', async ({ page }) => {
    await boot(page)
    // Open the mixer before evaluating (meter subscription live — P-MIX-4).
    const drawer = await openMixer(page)
    await setStrudelCode(page, 'd1: s("bd*8").gain(0.9)')
    await expect(drawer.locator('[data-mixer-master-strip]')).toHaveCount(1)

    // dark before play
    expect(await masterFill(page, drawer)).toBeLessThan(8)

    let mx = 0
    for (let attempt = 0; attempt < 2 && mx < 15; attempt++) {
      await play(page)
      await page.waitForTimeout(1200) // audio context resume + first hits
      for (let i = 0; i < 25; i++) {
        mx = Math.max(mx, await masterFill(page, drawer))
        await page.waitForTimeout(33)
      }
    }
    // the master output meter moves once audio flows
    expect(mx).toBeGreaterThan(15)
  })

  test('solo writes `_` on non-soloed tracks (silenced + in the file); un-solo restores (#735)', async ({
    page,
  }) => {
    await boot(page)
    // Open the mixer BEFORE evaluating so the meter's bus subscription is live
    // when the program publishes (the documented ordering — P-MIX-4 harness note).
    const drawer = await openMixer(page)
    const original = 'd1: s("bd*8").gain(0.9)\nd2: s("hh*8").gain(0.9)'
    await setStrudelCode(page, original)

    // Poll until d2 is audibly playing (re-eval once if the first play raced the
    // editor→file sync), then sample a sustained mean (P-MIX-6/8).
    let d2pre = 0
    for (let attempt = 0; attempt < 2 && d2pre < 20; attempt++) {
      await play(page)
      await page.waitForTimeout(700)
      d2pre = await sustainedMean(() => meterFill(page, drawer, 'd2'), 12, page)
    }
    expect(d2pre).toBeGreaterThan(20)

    // SOLO d1 → d2 is MUTED IN THE FILE (`_d2`) and silenced; d1 stays audible.
    // (Solo is now a code operation — #735 — so the mute marker, and thus the
    // silence, comes off the file exactly like a hand mute.)
    await clickSolo(page, drawer, 'd1')
    await page.waitForTimeout(2500) // re-eval + a cycle to flush queued haps
    expect(await sustainedMean(() => meterFill(page, drawer, 'd2'), 20, page)).toBeLessThan(8)
    expect(await sustainedMean(() => meterFill(page, drawer, 'd1'), 20, page)).toBeGreaterThan(20)
    expect(await strudelValue(page)).toBe(
      'd1: s("bd*8").gain(0.9)\n_d2: s("hh*8").gain(0.9)',
    ) // solo wrote `_d2`; d1 (soloed) is untouched

    // UNSOLO → the marker is removed, d2 comes back, file back to the original.
    await clickSolo(page, drawer, 'd1')
    await page.waitForTimeout(2500)
    expect(await sustainedMean(() => meterFill(page, drawer, 'd2'), 20, page)).toBeGreaterThan(20)
    expect(await strudelValue(page)).toBe(original)
  })

  test('a solo dims the non-soloed strips (and not the soloed one)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, 'd1: s("bd*8")\nd2: s("hh*8")')
    const drawer = await openMixer(page)

    await clickSolo(page, drawer, 'd1')
    const opacity = (id: string) =>
      drawer.locator(`[data-mixer-strip-id="${id}"]`).evaluate((e) => (e as HTMLElement).style.opacity)
    expect(await opacity('d2')).toBe('0.45') // non-soloed → dimmed
    expect(await opacity('d1')).not.toBe('0.45') // soloed → full
  })
})

// When a strip setting changes, the editor caret follows to that track's
// statement so the user sees which line their fader/knob/rename landed on
// (#595). Every code-writing strip interaction routes through the ONE write
// path (applyToStrip), so the jump is verified through the face fader here.
test.describe('Mixer cursor-follows-strip (#595)', () => {
  test('a fader drag jumps the caret to that track, past a config line', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, 'setcps(0.5)\n$: s("bd").gain(0.5)\nd1: s("hh*4").gain(0.8)')
    expect(await cursorLine(page)).toBe(1) // caret starts on the setcps line
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    // drag the named track's fader (d1, on line 3) — the caret must land there,
    // NOT on the setcps line (the #559 off-by-one applies to the jump too).
    await dragFader(page, drawer, 'd1', 30)
    expect(await cursorLine(page)).toBe(3)
  })

  test('dragging a different strip moves the caret to the new track', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd").gain(0.5)\nd1: note("c e").gain(0.8)\n$: s("hh*4").gain(0.5)')
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    await dragFader(page, drawer, '#0', 20) // first anon track → line 1
    expect(await cursorLine(page)).toBe(1)
    await dragFader(page, drawer, 'd1', 20) // named track → line 2
    expect(await cursorLine(page)).toBe(2)
    await dragFader(page, drawer, '#1', 20) // second anon track → line 3
    expect(await cursorLine(page)).toBe(3)
  })

  test('a drawer knob drag also jumps the caret to that track', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd").gain(0.5)\nd1: note("c e").lpf(800)')
    expect(await cursorLine(page)).toBe(1)
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    // expand d1 (line 2) and drag its lpf knob — the drawer routes through the
    // same applyToStrip path as the face, so the caret follows here too.
    await toggleExpand(page, drawer, 'd1')
    const slider = drawer.locator('[data-mixer-expand-for="d1"] [data-knob="lpf"] [role="slider"]')
    await slider.scrollIntoViewIfNeeded()
    const box = await slider.boundingBox()
    if (!box) throw new Error('no lpf knob box')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx, cy - 40, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(80)
    expect(await cursorLine(page)).toBe(2)
  })
})

/** vertical drag on the MASTER fader by `dyUp` pixels (up = louder). The master
 *  strip is pinned (sticky right) so it's on screen once the drawer is tall. */
async function dragMasterFader(page: Page, drawer: ReturnType<Page['locator']>, dyUp: number): Promise<void> {
  const fader = drawer.locator('[data-mixer-master-fader]')
  const box = await fader.boundingBox()
  if (!box) throw new Error('no master fader box')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx, cy - dyUp, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(80)
}

test.describe('Mixer master strip — mute (#800), and no master pan (#1719)', () => {
  // #1719 — the master strip has NO pan control. `all(x => x.pan(v))` SETS pan
  // on every hap, so the control threw away each track's own pan (127 of 620
  // corpus documents set `.pan`), and nothing a document can write acts on the
  // finished mix: superdough pans per voice, before each orbit's reverb and
  // delay. A control that cannot mean what a master pan means in a DAW is worse
  // than none, so it was removed rather than redefined.
  //
  // A document's own master pan line still PLAYS — removing a control is not
  // removing the code it wrote — and the Mixer leaves it alone.
  test('the master strip has no pan control, and a channel strip still has one', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, 'd1: s("bd").pan(0.2)\nall(x => x.pan(0.65))')
    const drawer = await openMixer(page)
    await enlargeDrawer(page)

    // The control arm: a CHANNEL pan is still projected and still says where the
    // track sits. Without it, an empty master pan would also pass on a Mixer
    // that failed to render at all.
    await expect(drawer.locator('[data-mixer-strip-pan]').first()).toHaveText('L60')

    await expect(drawer.locator('[data-mixer-master-pan]')).toHaveCount(0)
    await expect(drawer.locator('[data-mixer-master-pan-control]')).toHaveCount(0)
  })

  // #2027 — taking the pan control off the master must not take its ROW: without
  // it the master card is one row shorter than a channel card and its meter sits
  // that much higher, so the meters share no baseline. Both cards are measured in
  // the same page, so the figures are compared with each other and never with a
  // number written here.
  test('the master card is as tall as a channel card, and their meters are level', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, 'd1: s("bd")\nd2: s("hh").gain(0.4)')
    const drawer = await openMixer(page)
    await enlargeDrawer(page)

    const box = async (selector: string) => {
      const b = await drawer.locator(selector).first().boundingBox()
      if (!b) throw new Error(`not drawn: ${selector}`)
      return { top: Math.round(b.y), bottom: Math.round(b.y + b.height), height: Math.round(b.height) }
    }
    const channel = await box('[data-mixer-strip]')
    const master = await box('[data-mixer-master-strip]')
    const channelMeter = await box('[data-mixer-strip-meter]')
    const masterMeter = await box('[data-mixer-master-meter]')

    // a card that did not lay out measures 0 and would equal another 0
    expect(channel.height).toBeGreaterThan(100)
    expect(master).toEqual(channel)
    expect(masterMeter).toEqual(channelMeter)
  })

  test("a document's own master pan line survives a master fader drag", async ({ page }) => {
    await boot(page)
    const original = 'd1: s("bd*4").pan(0.2)\nall(x => x.pan(0.65))'
    await setStrudelCode(page, original)
    const drawer = await openMixer(page)
    await enlargeDrawer(page)

    await dragMasterFader(page, drawer, -20) // quieter
    const after = await strudelValue(page)
    // The fader wrote its own line; the pan line and the track's pan are as written.
    expect(after).toContain('all(x => x.pan(0.65))')
    expect(after).toContain('d1: s("bd*4").pan(0.2)')
    expect(after).toMatch(/all\(x => x\.mul\(postgain\(/)
  })

  test('mute adds all(x => silence); unmute removes it; the fader value survives (orthogonal)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd*4")\nall(x => x.gain(0.42))')
    const drawer = await openMixer(page)
    await enlargeDrawer(page)

    // mute → a silence line is appended, the strip flags muted, and the gain the
    // fader reads is UNCHANGED (mute never touches .gain — V-mixer-2)
    await drawer.locator('[data-mixer-master-mute]').click()
    await page.waitForTimeout(80)
    let doc = await strudelValue(page)
    expect(doc).toContain('all(x => silence)')
    expect(doc).toContain('all(x => x.gain(0.42))')
    await expect(drawer.locator('[data-mixer-master-strip][data-mixer-master-muted]')).toHaveCount(1)
    await expect(drawer.locator('[data-mixer-master-gain]')).toHaveText('0.42')

    // unmute → the silence line is removed, the gain line is byte-identical
    await drawer.locator('[data-mixer-master-mute]').click()
    await page.waitForTimeout(80)
    doc = await strudelValue(page)
    expect(doc).not.toContain('silence')
    expect(doc).toBe('$: s("bd*4")\nall(x => x.gain(0.42))')
  })

  test('muting silences the master meter (audio observation)', async ({ page }) => {
    await boot(page)
    // Open the mixer BEFORE evaluating so the meter's bus subscription is live
    // (P-MIX-4). No enlarge — masterFill reads a style percentage, and the mute
    // button is clickable in the console without a taller drawer.
    const drawer = await openMixer(page)
    await setStrudelCode(page, 'd1: s("bd*8").gain(0.9)')

    // play until the master meter is audibly moving (Mod+Enter is a toggle — retry)
    let mx = 0
    for (let attempt = 0; attempt < 2 && mx < 15; attempt++) {
      await play(page)
      await page.waitForTimeout(1200)
      for (let i = 0; i < 25; i++) {
        mx = Math.max(mx, await masterFill(page, drawer))
        await page.waitForTimeout(33)
      }
    }
    expect(mx, 'master meter should move before mute').toBeGreaterThan(15)

    // MUTE → the write re-evals live to all(x => silence); the mix goes silent.
    // The master meter has peak-hold smoothing, so it DECAYS to the floor over a
    // few seconds rather than dropping instantly — poll until it settles low
    // (proves the audio actually stopped, not just that a frame dipped).
    await drawer.locator('[data-mixer-master-mute]').click()
    let settled = 99
    for (let i = 0; i < 16 && settled >= 8; i++) {
      await page.waitForTimeout(400)
      settled = await masterFill(page, drawer)
    }
    expect(settled, 'master meter should decay to silence after mute').toBeLessThan(8)
  })
})

/** vertical drag on a knob inside the master expand drawer by `dyUp` px. */
async function dragMasterKnob(page: Page, drawer: ReturnType<Page['locator']>, name: string, dyUp: number): Promise<void> {
  const knob = drawer.locator(`[data-mixer-expand-for="__master__"] [data-knob="${name}"]`)
  const box = await knob.boundingBox()
  if (!box) throw new Error(`no master knob box: ${name}`)
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx, cy - dyUp, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(80)
}

test.describe('Mixer master strip — expand drawer (#800)', () => {
  const masterDrawer = (drawer: ReturnType<Page['locator']>) =>
    drawer.locator('[data-mixer-expand-for="__master__"]')

  test('expand shows the master INSERT knobs, not gain/pan (strip-owned)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, 'd1: s("bd*4")\nall(x => x.gain(0.8).room(0.3))')
    const drawer = await openMixer(page)
    await drawer.locator('[data-mixer-master-expand]').click()
    await expect(masterDrawer(drawer)).toHaveCount(1)
    // the room insert surfaces a knob; gain + pan do NOT (owned by the fader/pan row)
    await expect(masterDrawer(drawer).locator('[data-knob="room"]')).toHaveCount(1)
    await expect(masterDrawer(drawer).locator('[data-knob="gain"]')).toHaveCount(0)
    await expect(masterDrawer(drawer).locator('[data-knob="pan"]')).toHaveCount(0)
  })

  test('dragging a drawer knob edits that insert literal on the all() line', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, 'd1: s("bd*4")\nall(x => x.gain(0.8).room(0.3))')
    const drawer = await openMixer(page)
    await drawer.locator('[data-mixer-master-expand]').click()
    await enlargeDrawer(page)
    await dragMasterKnob(page, drawer, 'room', 24) // up → larger
    const after = await strudelValue(page)
    // only the room literal moved; gain byte-identical, still one all() line
    expect(after).toMatch(/all\(x => x\.gain\(0\.8\)\.room\((\d*\.?\d+)\)\)/)
    const m = after.match(/\.room\((\d*\.?\d+)\)/)
    expect(Number(m![1])).toBeGreaterThan(0.3)
  })

  test('＋More appends an effect to the master all() line', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, 'd1: s("bd*4")\nall(x => x.gain(0.8))')
    const drawer = await openMixer(page)
    await drawer.locator('[data-mixer-master-expand]').click()
    await masterDrawer(drawer).locator('[data-mixer-add-effect]').click()
    const menu = page.locator('[data-mixer-add-effect-menu]')
    await expect(menu).toBeVisible()
    await menu.locator('[data-mixer-add-effect-item="crush"]').click()
    await page.waitForTimeout(120)
    expect(await strudelValue(page)).toBe('d1: s("bd*4")\nall(x => x.gain(0.8).crush(8))')
  })

  test('adding an effect to an EMPTY master materializes all(x => x.<fx>()); one undo reverts', async ({ page }) => {
    await boot(page)
    const original = 'd1: s("bd*4")'
    await setStrudelCode(page, original)
    const drawer = await openMixer(page)
    await drawer.locator('[data-mixer-master-expand]').click()
    // the empty master drawer still offers ＋More
    await masterDrawer(drawer).locator('[data-mixer-add-effect]').click()
    const menu = page.locator('[data-mixer-add-effect-menu]')
    await expect(menu).toBeVisible()
    await menu.locator('[data-mixer-add-effect-item="crush"]').click()
    await page.waitForTimeout(120)
    // the scaffold + append is a clean single line (no spurious gain(1))
    expect(await strudelValue(page)).toBe('d1: s("bd*4")\nall(x => x.crush(8))')
    // scaffold + append coalesce into ONE undo step
    await undo(page)
    expect(await strudelValue(page)).toBe(original)
  })

  test('the × on a drawer knob removes that insert from the all() line', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, 'd1: s("bd*4")\nall(x => x.gain(0.8).crush(8))')
    const drawer = await openMixer(page)
    await drawer.locator('[data-mixer-master-expand]').click()
    await enlargeDrawer(page)
    // the knob's × affordance removes the method (its data attr is scoped to the knob)
    await masterDrawer(drawer).locator('[data-knob="crush"] [data-knob-remove="crush"]').click()
    await page.waitForTimeout(120)
    expect(await strudelValue(page)).toBe('d1: s("bd*4")\nall(x => x.gain(0.8))')
  })

  test('the fader\'s mul(postgain()) stays off the insert drawer — only real effects show (#1711)', async ({ page }) => {
    // The fader owns its own call; the drawer lists inserts. `mul(postgain(N))` is
    // the fader's line, not an effect, so it must not appear as a knob or row.
    await boot(page)
    await setStrudelCode(page, 'd1: s("bd*4")\nall(x => x.mul(postgain(0.8)).room(0.3))')
    const drawer = await openMixer(page)
    await drawer.locator('[data-mixer-master-expand]').click()
    await enlargeDrawer(page)
    const d = masterDrawer(drawer)
    await expect(d.locator('[data-knob="room"]')).toHaveCount(1)
    const knobs = await d.locator('[data-knob]').evaluateAll((els) => els.map((e) => e.getAttribute('data-knob')))
    const text = (await d.innerText()).replace(/\s+/g, ' ')
    console.log(`[#1711 drawer] knobs=${JSON.stringify(knobs)} text="${text.slice(0, 200)}"`)
    expect(knobs).toEqual(['room'])
    expect(text).not.toMatch(/\bmul\b|postgain/)
    await expect(drawer.locator('[data-mixer-master-gain]')).toHaveText('0.8')
  })

  test('collapse hides the master drawer', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, 'd1: s("bd*4")\nall(x => x.gain(0.8).room(0.3))')
    const drawer = await openMixer(page)
    await drawer.locator('[data-mixer-master-expand]').click()
    await expect(masterDrawer(drawer)).toHaveCount(1)
    await drawer.locator('[data-mixer-master-expand]').click()
    await expect(masterDrawer(drawer)).toHaveCount(0)
  })
})

test.describe('Mixer master strip code counterpart (#792)', () => {
  test('projects the master gain from a legacy doc all(x=>x.gain()) line (code→UI)', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd")\nall(x => x.gain(0.5))')
    const drawer = await openMixer(page)
    await expect(drawer.locator('[data-mixer-master-gain]')).toHaveText('0.5')
  })

  test('an untouched master projects unity from the ABSENCE of a line', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd")')
    const drawer = await openMixer(page)
    await expect(drawer.locator('[data-mixer-master-gain]')).toHaveText('1')
  })

  test('dragging the master fader writes all(x=>x.mul(postgain(N))); one undo reverts (UI→code)', async ({ page }) => {
    await boot(page)
    const original = '$: s("bd*4")'
    await setStrudelCode(page, original)
    const drawer = await openMixer(page)
    await enlargeDrawer(page)

    await dragMasterFader(page, drawer, 30) // up → louder (but gain caps at ≤1)
    const after = await strudelValue(page)
    // the track line is byte-identical; a new all() master line is appended
    expect(after.split('\n')[0]).toBe(original)
    // mul(postgain()), never a plain control: a master `.gain()` or `.postgain()`
    // would overwrite every track's own value instead of scaling the mix (#1711)
    const m = after.match(/all\(x => x\.mul\(postgain\((\d*\.?\d+)\)\)\)/)
    expect(m, `unexpected doc: ${after}`).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThan(0)

    // one undo reverts the whole gesture (the inserted line disappears)
    await undo(page)
    expect(await strudelValue(page)).toBe(original)
  })

  test('dragging the master fader patches an existing all() mul(postgain()) literal in place', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, '$: s("bd*4")\nall(x => x.mul(postgain(0.9)))')
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    await expect(drawer.locator('[data-mixer-master-gain]')).toHaveText('0.9')
    await dragMasterFader(page, drawer, -40) // down → quieter
    const after = await strudelValue(page)
    // still exactly one all() line; the literal moved below 0.9
    expect((after.match(/all\(x => x\./g) ?? []).length).toBe(1)
    const m = after.match(/all\(x => x\.mul\(postgain\((\d*\.?\d+)\)\)\)/)
    expect(m, `unexpected doc: ${after}`).not.toBeNull()
    expect(Number(m![1])).toBeLessThan(0.9)
  })

  test('on a legacy all() gain line the fader rewrites that call to mul(postgain()) (#1711)', async ({ page }) => {
    // Documents written before #1711 hold `all(x => x.gain(N))`, which overwrites
    // every track's gain. The fader still READS it; moving the fader turns that
    // one call into the scaling form and leaves the track lines alone.
    await boot(page)
    await setStrudelCode(page, '$: s("bd*4").gain(0.3)\nall(x => x.gain(0.9))')
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    await expect(drawer.locator('[data-mixer-master-gain]')).toHaveText('0.9')
    await dragMasterFader(page, drawer, -40)
    const after = await strudelValue(page)
    expect(after.split('\n')[0]).toBe('$: s("bd*4").gain(0.3)')
    expect(after).not.toMatch(/all\(x => x\.gain\(/)
    const m = after.match(/all\(x => x\.mul\(postgain\((\d*\.?\d+)\)\)\)/)
    expect(m, `unexpected doc: ${after}`).not.toBeNull()
    expect(Number(m![1])).toBeLessThan(0.9)
  })

  test('a signal master gain disables the fader (reads "sig", no write)', async ({ page }) => {
    await boot(page)
    const original = '$: s("bd")\nall(x => x.gain(sine))'
    await setStrudelCode(page, original)
    const drawer = await openMixer(page)
    await enlargeDrawer(page)
    // foreign → fader dimmed + reads "sig" (not a literal), and a drag makes NO edit (#796)
    await expect(drawer.locator('[data-mixer-master-gain]')).toHaveText('sig')
    await dragMasterFader(page, drawer, 40)
    expect(await strudelValue(page)).toBe(original)
  })
})

test.describe('Mixer master — retired synthetic output-gain seam (#794)', () => {
  test('purges legacy stave:mixer.master:* values on boot', async ({ page }) => {
    // Seed the retired per-file master-gain keys BEFORE the app boots (addInitScript
    // runs on every navigation). #794's boot purge must clear them so a stale
    // non-unity value can never double-apply against the code `all()` gain.
    await page.addInitScript(() => {
      localStorage.setItem('stave:mixer.master:fileA', '0.1')
      localStorage.setItem('stave:mixer.master:fileB', '0.5')
      localStorage.setItem('stave:tabs', '[]') // unrelated — must survive
    })
    await boot(page)
    // The purge runs in a boot effect; poll until the legacy keys are gone.
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(localStorage).filter((k) => k.startsWith('stave:mixer.master:')).length,
        ),
      )
      .toBe(0)
    // an unrelated key is untouched
    expect(await page.evaluate(() => localStorage.getItem('stave:tabs'))).toBe('[]')
  })

  test('playback gain tracks the code all() gain only — a stale legacy value is inert', async ({
    page,
  }) => {
    // A legacy synthetic master of 0.1 would previously attenuate the whole mix.
    // Post-#794 the seam is gone and the value is purged, so a loud pattern still
    // drives the master meter — playback level follows the document, not the store.
    await page.addInitScript(() => {
      localStorage.setItem('stave:mixer.master:legacy', '0.1')
    })
    await boot(page)
    const drawer = await openMixer(page)
    await setStrudelCode(page, 'd1: s("bd*8").gain(0.9)')
    await expect(drawer.locator('[data-mixer-master-strip]')).toHaveCount(1)

    let mx = 0
    for (let attempt = 0; attempt < 2 && mx < 15; attempt++) {
      await play(page)
      await page.waitForTimeout(1200)
      for (let i = 0; i < 25; i++) {
        mx = Math.max(mx, await masterFill(page, drawer))
        await page.waitForTimeout(33)
      }
    }
    // meter moves at full level — the stale 0.1 did NOT attenuate the output.
    expect(mx).toBeGreaterThan(15)
  })
})

/**
 * #1097 — a bare document's strip is a real track, not a decoration.
 *
 * Strips come from the parsed document, so a bare statement has always drawn one;
 * the meter comes from `trackSchedulers`, which only the `.p()` hook used to
 * write. The two therefore disagreed: a strip that could never move. These pin
 * the join from the user's side — same music, once bare and once labelled.
 */
test.describe('bare-document strips meter like any other track (#1097)', () => {
  /** poll a strip's meter the way the master-meter tests do — playback is live,
   *  so a single read can land between onsets. */
  async function peakFill(
    page: Page,
    drawer: ReturnType<Page['locator']>,
    stripId: string,
  ): Promise<number> {
    let mx = 0
    for (let attempt = 0; attempt < 2 && mx < 15; attempt++) {
      await play(page)
      await page.waitForTimeout(1200)
      for (let i = 0; i < 25; i++) {
        mx = Math.max(mx, await meterFill(page, drawer, stripId))
        await page.waitForTimeout(33)
      }
    }
    return mx
  }

  test('a lone bare statement drives its meter', async ({ page }) => {
    await boot(page)
    const drawer = await openMixer(page)
    await setStrudelCode(page, 's("bd*8").gain(0.9)')
    // the strip exists — true before this fix too, which is the whole point
    await expect(drawer.locator('[data-mixer-strip-id="#0"]')).toHaveCount(1)
    expect(await peakFill(page, drawer, '#0')).toBeGreaterThan(15)
  })

  test('TWO bare statements stay dark — and the labelled twin proves the meter works', async ({
    page,
  }) => {
    await boot(page)
    const drawer = await openMixer(page)

    // GUARDED CASE: strudel plays only the LAST expression while the strips are
    // numbered from the first, so binding either one would be a guess. No entry
    // is written, and the meters stay where they were (#1096 owns the binding).
    await setStrudelCode(page, 's("bd*8").gain(0.9)\ns("hh*8").gain(0.9)')
    await expect(drawer.locator('[data-mixer-strip-id="#0"]')).toHaveCount(1)
    await expect(drawer.locator('[data-mixer-strip-id="#1"]')).toHaveCount(1)
    expect(await peakFill(page, drawer, '#0')).toBeLessThan(15)

    // POSITIVE CONTROL for that absence: the same two statements, labelled, do
    // move. Without this the dark meters above would be indistinguishable from a
    // test that never managed to play anything.
    await setStrudelCode(page, '$: s("bd*8").gain(0.9)\n$: s("hh*8").gain(0.9)')
    await expect(drawer.locator('[data-mixer-strip-id="#0"]')).toHaveCount(1)
    expect(await peakFill(page, drawer, '#0')).toBeGreaterThan(15)
  })
})

/**
 * #1174 — a strip's `$<n>` must be the slot the ENGINE assigned, not a count of
 * statements.
 *
 * The mixer numbered every unmuted anonymous track, including bare ones; the
 * engine numbers only what reaches `.p()`, which a bare statement never does. So
 * a bare statement above a labelled one shifted the labelled track's join by one
 * and it metered its neighbour.
 *
 * These use DELIBERATELY CONTRASTING gains, because a meter that merely moves
 * does not say which track it belongs to — and the whole defect was a meter
 * moving with the wrong track's signal. Loud ≈ 82, quiet ≈ 35 on the scale the
 * fill height is painted in, so the two are distinguishable by value.
 */
test.describe('a strip joins the slot the engine assigned (#1174)', () => {
  const LOUD = 's("bd*8").gain(0.9)'
  const QUIET = 's("hh*16").gain(0.03)'

  /** peak fill per strip id over live playback */
  async function peaks(
    page: Page,
    drawer: ReturnType<Page['locator']>,
  ): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    for (let attempt = 0; attempt < 2; attempt++) {
      await play(page)
      await page.waitForTimeout(1200)
      for (let i = 0; i < 30; i++) {
        const reads = await drawer.evaluate((root) =>
          [...root.querySelectorAll('[data-mixer-strip-id]')].map((el) => {
            const f = el.querySelector('[data-mixer-meter-fill]') as HTMLElement | null
            const h = f ? parseFloat(f.style.height) || parseFloat(f.style.width) || 0 : 0
            return { id: el.getAttribute('data-mixer-strip-id') ?? '?', h }
          }),
        )
        for (const r of reads) out[r.id] = Math.max(out[r.id] ?? 0, r.h)
        await page.waitForTimeout(33)
      }
      if (Object.values(out).some((v) => v > 15)) break
    }
    return out
  }

  test('a bare statement above a labelled one does not steal its meter', async ({ page }) => {
    await boot(page)
    const drawer = await openMixer(page)
    // Only the labelled statement sounds here — strudel plays the `.p()` registry
    // once anything registers — so the QUIET hi-hat is the only signal present.
    await setStrudelCode(page, `${LOUD}\n$: ${QUIET}`)
    const p = await peaks(page, drawer)
    // the labelled track carries it...
    expect(p['#1']).toBeGreaterThan(15)
    // ...and the bare statement, which is not playing, stays dark. Before the
    // fix these were the other way round: #0 read the hi-hat and #1 read nothing.
    expect(p['#0'] ?? 0).toBeLessThan(15)
  })

  test('a transport head outside the denylist does not shift the meters either', async ({
    page,
  }) => {
    await boot(page)
    const drawer = await openMixer(page)
    // `cpm` is not in NON_TRACK_HEADS and still draws a strip — the point is that
    // it can no longer displace the tracks below it.
    await setStrudelCode(page, `cpm(120)\n$: ${LOUD}\n$: ${QUIET}`)
    const p = await peaks(page, drawer)
    expect(p['#1']).toBeGreaterThan(60) // the loud track, on its own strip
    expect(p['#2']).toBeGreaterThan(15) // the quiet track, on its own strip
    expect(p['#2']).toBeLessThan(60) // and it is the QUIET one, not the loud one
    expect(p['#0'] ?? 0).toBeLessThan(15) // the tempo statement meters nothing
  })

  test('positive control — two labelled tracks each meter their own level', async ({ page }) => {
    await boot(page)
    const drawer = await openMixer(page)
    await setStrudelCode(page, `$: ${LOUD}\n$: ${QUIET}`)
    const p = await peaks(page, drawer)
    expect(p['#0']).toBeGreaterThan(60)
    expect(p['#1']).toBeGreaterThan(15)
    expect(p['#1']).toBeLessThan(60)
  })
})
