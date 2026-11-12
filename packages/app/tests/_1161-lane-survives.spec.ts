/**
 * _1161-lane-survives.spec.ts — OBSERVATION PROBE (inert: `_` prefix).
 *
 * IS #1161 ACTUALLY LIVE IN THE APP?
 *
 * The corpus probe measured 1345 asks where clearing a lane's last cell removes the lane.
 * It measured that by RE-PARSING what the delete wrote — and a fresh parse of
 * `[~ _ _ _, ~ hh ~ hh]` genuinely has no bd lane.
 *
 * But that may not be what the panel does. `useGridModel`'s reconcile keeps the
 * in-progress model whenever it still WRITES the document's bytes, and an all-off lane
 * writes nothing (measured: 957 corpus units, 0 byte differences, with a sounding-lane
 * control arm proving the comparison sees changes). `toggleCell` maps lanes and never
 * prunes them. So the emptied lane may survive in the retained model, and the bug may
 * only exist in the fresh-parse path my probe used.
 *
 * Reading the code cannot settle this — the retention depends on a serialize comparison
 * at runtime. So this drives the real gesture and looks.
 *
 * ⚠ THIS FILE OBSERVES; IT DOES NOT GUARD. Both tests below print their finding and
 * assert nothing about it, which is what an observation probe is for and why it must
 * not be mistaken for a regression arm. The GUARD is
 * `sequencer.spec.ts` › "a lane emptied of its last note stays on screen and takes the
 * note back (#1161)" — in the browser gate's file list, and verified red under two
 * separate breaks (retention off in `useGridModel`; `toggleCell` pruning empty lanes).
 * Kept alongside it because this one also records the deliberate BOUNDARY the guard
 * does not assert: the lane is lost across a statement round-trip, on purpose (#597).
 */
import { test, expect, type Page } from '@playwright/test'
import { pinLcmGrid } from './_appBoot'

// It reads the column grid's cells (`lane:col`), which only LCM draws now (#2458).
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
    const target = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
    if (!target) return false
    target.getModel()?.setValue(c)
    target.setPosition({ lineNumber: 1, column: 1 })
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

async function openSequencer(page: Page) {
  const drawer = page.locator('[data-bottom-panel="root"]')
  await drawer.locator('[data-bottom-panel="toggle"]').click()
  await drawer.locator('role=tab[name="Pattern"]').click()
  return drawer
}

test('#1161 — does a lane survive its last note being cleared? (LCM grid)', async ({ page }) => {
  await boot(page)
  // bd sounds exactly once; hh fills the bar. Clearing bd@0 empties the bd lane.
  await setStrudelCode(page, '$: s("bd ~ ~ ~, hh hh hh hh")')
  const drawer = await openSequencer(page)
  const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')

  const voicesBefore = await grid.locator('[data-seq-voice]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-seq-voice')),
  )
  console.log('  voices BEFORE:', JSON.stringify(voicesBefore))
  await expect(grid.locator('[data-seq-cell="0:0"]')).toHaveAttribute('aria-pressed', 'true')

  // the gesture: clear bd's only hit
  await grid.locator('[data-seq-cell="0:0"]').click()
  await page.waitForTimeout(400)

  const doc = await strudelValue(page)
  const voicesAfter = await grid.locator('[data-seq-voice]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-seq-voice')),
  )
  console.log('  document AFTER:', doc)
  console.log('  voices AFTER: ', JSON.stringify(voicesAfter))

  const bdStillDrawn = voicesAfter.includes('bd')
  console.log(`\n  >>> bd lane still on screen after its last note was cleared: ${bdStillDrawn}`)
  console.log(`  >>> #1161 is ${bdStillDrawn ? 'NOT live on this path' : 'LIVE'}`)

  if (bdStillDrawn) {
    // then the affordance is intact — can the note actually be put back?
    await grid.locator('[data-seq-cell="0:0"]').click()
    await page.waitForTimeout(400)
    const back = await strudelValue(page)
    console.log(`  >>> clicking it back gives: ${back}`)
  }
})

/**
 * THE BOUNDARY OF THE EXISTING MECHANISM. Retention is keyed to the model still writing
 * the document's bytes; a statement change reseeds from a fresh parse, which has no lane.
 * So the question is not "does the lane survive" but "how long".
 */
test('#1161 — does it survive the cursor leaving the statement and coming back? (LCM grid)', async ({
  page,
}) => {
  await boot(page)
  await setStrudelCode(page, '$: s("bd ~ ~ ~, hh hh hh hh")\n$: s("cp cp")')
  const drawer = await openSequencer(page)
  const grid = drawer.locator('[data-bottom-panel-tab="sequencer"]')

  await grid.locator('[data-seq-cell="0:0"]').click() // clear bd
  await page.waitForTimeout(400)
  const afterClear = await grid
    .locator('[data-seq-voice]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-seq-voice')))
  console.log('  voices after clear:      ', JSON.stringify(afterClear))

  const moveTo = async (line: number): Promise<void> => {
    await page.evaluate((ln) => {
      const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } })
        .monaco
      const editors = (monaco?.editor?.getEditors?.() ?? []) as Array<{
        getModel: () => { getLanguageId?: () => string } | null
        setPosition: (p: { lineNumber: number; column: number }) => void
        focus: () => void
      }>
      const t = editors.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? editors[0]
      t?.setPosition({ lineNumber: ln, column: 8 })
      t?.focus()
    }, line)
    await page.waitForTimeout(450)
  }

  await moveTo(2) // onto the other statement
  const away = await grid
    .locator('[data-seq-voice]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-seq-voice')))
  console.log('  voices while away (cp):  ', JSON.stringify(away))

  await moveTo(1) // back to the edited statement
  const back = await grid
    .locator('[data-seq-voice]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-seq-voice')))
  console.log('  voices on return:        ', JSON.stringify(back))
  console.log(`\n  >>> bd survives a round trip through another statement: ${back.includes('bd')}`)
})
