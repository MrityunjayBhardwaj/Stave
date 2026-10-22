/**
 * A REFUSED Song Timeline gesture names its cause where the user can find it
 * (#1414) — Playwright observation (AnviDev observe gate).
 *
 * WHAT WAS WRONG. The file route (`commitToFile`) has always refused correctly and has
 * always said so, naming five distinct refusals. All fourteen of its call sites
 * discarded the answer, and twelve of them bailed out one line earlier on an
 * empty edit list without telling anyone either. A gesture that was REFUSED and
 * one that was APPLIED were indistinguishable — to the user, and to us.
 *
 * ⚠ WHY THIS SPEC IS THE ONLY ARM THAT CAN SEE THE APP-SIDE SEAM.
 * `codeView/__tests__/commitToFile.test.ts` covers the writer's five return values
 * at unit level and is break-tested. Nothing at unit level mounts
 * `MusicalTimeline`, so nothing else checks that a refusal actually reaches the
 * Console panel with its cause attached. If this spec is deleted, the reporting
 * can regress to silence and every other arm stays green.
 *
 * THE TRIGGER IS THE REAL RACE, NOT A SYNTHETIC ONE. Of the five refusals,
 * `stale-document` is the one a user can actually provoke: type, then act on the
 * timeline before the IR snapshot's debounce catches up. `snapshot.code` still
 * holds the previous text, so its offsets no longer address the live document
 * and the write is dropped rather than applied at stale offsets. `setValue` is
 * synchronous, so the race is forced deterministically rather than slept on.
 *
 * ⚠ THE OTHER FOUR ARE NOT REACHABLE FROM THE UI TODAY, and that was measured,
 * not assumed: the gesture layer guards them upstream (`S` refuses a clip < 2
 * cycles before `splitArm` can decline; a silenced clip renders as a gap and
 * cannot be selected; `MIN_BARE_SPLIT_SPAN = 2` makes `materializeBareDelete`'s
 * sole-bar refusal unreachable). That is a finding about how often this fires,
 * and it is the reason the fix here is reading the answer rather than porting a
 * writer.
 */
import { test, expect, type Page } from '@playwright/test'
// ⚠ SHARED, not copied (#1443). This spec and the three roll readback specs read the
// same surface; when they each owned a copy of the reader, retiring that surface broke
// six tests and nothing said which reader was wrong.
import { openConsole, staveWarnings } from './_console'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const SONG = 'arrange([2, s("bd")], [2, s("hh")])'

async function bootShell(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:bottomPanel.height', '340')
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.activeTabId', 'musical-timeline')
    } catch {
      /* ignore */
    }
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () => ((window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco?.editor?.getEditors?.()?.length ?? 0) > 0,
    { timeout: 20_000 },
  )
}

function strudelSource(page: Page): Promise<string> {
  return page.evaluate(() => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; getValue: () => string } | null }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    return t?.getModel()?.getValue() ?? ''
  })
}

async function typeSongAndEval(page: Page, code: string): Promise<void> {
  await page.evaluate(() => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string } | null; focus: () => void }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.focus()
  })
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.press('Backspace')
  await page.keyboard.type(code, { delay: 8 })
  await page.waitForTimeout(400)
  await page.keyboard.press(`${MOD}+Enter`)
  await page.waitForTimeout(1800)
}

async function selectFirstClip(page: Page) {
  const grid = page.locator('[data-full-song="grid"]')
  const box = await grid.boundingBox()
  if (!box) throw new Error('no grid box')
  await page.mouse.click(box.x + box.width * 0.25, box.y + 8)
  await expect(page.locator('[data-full-song="clip-selection"]')).toBeVisible({ timeout: 5_000 })
  return grid
}

test('a delete refused by the stale-document guard says so, and changes nothing', async ({ page }) => {
  await bootShell(page)
  await typeSongAndEval(page, SONG)
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400)

  const grid = await selectFirstClip(page)

  // Force the race: change the model synchronously, then fire the gesture before
  // the snapshot debounce catches up.
  await page.evaluate(() => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; getValue: () => string; setValue: (v: string) => void } | null }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    const m = t?.getModel()
    if (m) m.setValue(m.getValue() + '\n// raced')
  })
  await grid.press('Delete')
  await page.waitForTimeout(1200)

  // ⚠ THE LOAD-BEARING ASSERTION. The arrangement is untouched: the write was
  // refused, not applied at offsets that no longer address this document. A
  // named refusal over a corrupted document would be worse than silence.
  const after = await strudelSource(page)
  expect(after).toContain('arrange([2, s("bd")], [2, s("hh")])')
  expect(after).not.toContain('silence')

  // And the user is told which of the five refusals fired.
  await openConsole(page)
  await expect(staveWarnings(page)).toHaveCount(1)
  const text = await staveWarnings(page).first().innerText()
  expect(text).toContain('delete clip was not applied')
  expect(text).toContain('the document changed underneath the gesture')
})

test('a gesture that SUCCEEDS reports nothing — the warning is not always-on', async ({ page }) => {
  // ⚠ THE NEGATIVE CONTROL, and it is what makes the arm above evidence rather
  // than decoration. Same song, same clip, same key — without the forced race.
  // If this ever goes red the reporting has become noise and the other arm stops
  // meaning "a refusal happened".
  await bootShell(page)
  await typeSongAndEval(page, SONG)
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await page.locator('[data-full-song-canvas]').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400)

  const grid = await selectFirstClip(page)
  await grid.press('Delete')

  await expect
    .poll(() => strudelSource(page), { timeout: 8_000 })
    .toContain('arrange([2, silence], [2, s("hh")])')

  await openConsole(page)
  await expect(staveWarnings(page)).toHaveCount(0)
})
