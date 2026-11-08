/**
 * pickRestart section EDITING — #667 (Pattern grid) + #668 (honest Mixer gain).
 *
 * The 5-track pickRestart song already PLAYS + arranges (Timeline #463) + shows
 * Mixer strips. The gaps were EDITING: a caret inside a `pickRestart({…})`
 * section fell to standby (Pattern couldn't reach the section's `s()/note()`),
 * and the strip fader read a false unity (1 / 0.0 dB) while the real levels lived
 * on the sections. This observes both closed in the real browser:
 *
 *  - #667: caret in a drum section → the SequencerGrid mounts (not standby), and
 *          a cell toggle writes a SURGICAL byte edit to that section only.
 *  - #668: the pick track's Mixer strip reads `sig` (honest foreign) instead of a
 *          lying unity; a sibling plain track's scalar gain is unaffected.
 *
 * Discriminating: without the chunkDetect descent the grid stays standby (count
 * 0); without the readGainState fix the drums strip reads `1`, not `sig`.
 */
import { test, expect, type Page } from '@playwright/test'
import { pinLcmGrid } from './_appBoot'


pinLcmGrid(test)
const SONG = `drums: "<~@2 verse@2 chorus@2>".pickRestart({
  verse: s("bd ~ sd ~").bank("RolandTR909").gain(0.8),
  chorus: s("sd ~ sd ~").bank("RolandTR909").gain(0.5),
})
bass: note("c3 e3 g3").s("sawtooth").gain(0.7)`

const EDITED_VERSE = `drums: "<~@2 verse@2 chorus@2>".pickRestart({
  verse: s("bd bd sd ~").bank("RolandTR909").gain(0.8),
  chorus: s("sd ~ sd ~").bank("RolandTR909").gain(0.5),
})
bass: note("c3 e3 g3").s("sawtooth").gain(0.7)`

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
    }>
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    if (!target) return false
    target.getModel()?.setValue(c)
    target.focus()
    return true
  }, code)
  expect(ok).toBe(true)
  await page.waitForTimeout(150)
}

/** put the caret just inside the first occurrence of `needle` (a section mini) */
async function caretInside(page: Page, needle: string): Promise<void> {
  await page.evaluate((n) => {
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
    const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
      getModel: () => { getLanguageId?: () => string; getValue: () => string; getPositionAt: (o: number) => { lineNumber: number; column: number } } | null
      setPosition: (p: { lineNumber: number; column: number }) => void
      focus: () => void
    }>
    const t = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    const model = t?.getModel()
    if (!model) return
    const off = model.getValue().indexOf(n)
    t.setPosition(model.getPositionAt(off + 2))
    t.focus()
  }, needle)
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

async function openPattern(page: Page) {
  const root = page.locator('[data-bottom-panel="root"]')
  await root.locator('[data-bottom-panel="toggle"]').click()
  await root.locator('role=tab[name="Pattern"]').click()
  return root.locator('[data-bottom-panel-tab="pattern"]')
}

async function openMixer(page: Page) {
  const root = page.locator('[data-bottom-panel="root"]')
  await root.locator('role=tab[name="Mixer"]').click()
  return root.locator('[data-bottom-panel-tab="mixer-console"]')
}

test('#667: caret in a pick section opens the SequencerGrid + surgical edit (LCM grid)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await boot(page)
  await setStrudelCode(page, SONG)
  await openPattern(page)
  await caretInside(page, 'bd ~ sd ~') // inside the drums.verse section

  // #667: the section binds the step grid instead of falling to standby.
  const grid = page.locator('[data-bottom-panel-tab="sequencer"]')
  await expect(grid).toHaveCount(1)
  await expect(grid.locator('[data-seq-cell="0:0"]')).toHaveAttribute('aria-pressed', 'true') // bd@0
  await expect(grid.locator('[data-seq-cell="0:1"]')).toHaveAttribute('aria-pressed', 'false')

  // Toggle bd on at column 1 → the section mini becomes "bd bd sd ~".
  await grid.locator('[data-seq-cell="0:1"]').click()
  await page.waitForTimeout(150)

  // #667 write-back is SURGICAL: only the verse section changed; the chorus,
  // both gains, and the bass track are byte-identical.
  expect(await strudelValue(page)).toBe(EDITED_VERSE)

  expect(errors, `unexpected errors:\n${errors.join('\n')}`).toEqual([])
})

test('#668: pick track Mixer fader reads sig (not a lying unity)', async ({ page }) => {
  await boot(page)
  await setStrudelCode(page, SONG)
  await openMixer(page)

  const mixer = page.locator('[data-bottom-panel-tab="mixer-console"]')
  // #668: gains live on the sections (0.8 / 0.5), so the outer strip is honest —
  // `sig` (foreign), NOT a false `1`.
  await expect(mixer.locator('[data-mixer-strip-id="drums"] [data-mixer-strip-gain]')).toHaveText('sig')
  // A sibling plain track's scalar gain is unaffected by the fix.
  await expect(mixer.locator('[data-mixer-strip-id="bass"] [data-mixer-strip-gain]')).toHaveText('0.7')
})
