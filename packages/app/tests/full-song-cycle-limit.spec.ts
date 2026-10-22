/**
 * full-song-cycle-limit — #2109.
 *
 * The Song timeline looks through at most N cycles for a song to come back round
 * (Settings › Pattern & Timeline › Longest timeline, 64 by default, up to 256). A
 * song that has not repeated by then reads "N+ cycles" and pages as it plays.
 *
 * Measured in the running app, through the real gestures: the Settings slider, the
 * transport, and the ruler. What the unit tests cannot show is that the setting
 * reaches the analysis the timeline draws, re-runs it without a re-evaluation, and
 * that the paged window still carries its own notes.
 */
import { test, expect, type Page } from '@playwright/test'

/** Never repeats: an irrational-ratio sweep on a continuous control. */
const NEVER_REPEATS = '$: s("bd*4").cutoff(sine.range(200,2000).slow(97.3))'
/** 80 bars of one repeated bar, then 20 of another: 100 cycles, declared. */
const ARRANGED_100 = '$: arrange([80, s("bd*2")], [20, s("hh*4")])'
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function boot(page: Page, limit?: number): Promise<void> {
  await page.addInitScript((lim) => {
    try {
      localStorage.setItem('stave:bottomPanel.height', '360')
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.activeTabId', 'musical-timeline')
      localStorage.setItem('stave:debug.timelineMarks', '1')
      if (lim !== null && localStorage.getItem('stave:songCycleLimit') === null) {
        localStorage.setItem('stave:songCycleLimit', String(lim))
      }
    } catch {
      /* ignore */
    }
  }, limit ?? null)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getValue?: () => string } | null }> } } }).monaco
      return (m?.editor?.getEditors?.() ?? []).some((e) => (e.getModel()?.getValue?.()?.length ?? 0) > 0)
    },
    { timeout: 20_000 },
  )
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 15_000 })
}

/** setValue in one shot, then evaluate, clearing the previous analysis first. */
async function evaluateCode(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    delete (window as unknown as { __staveTimelineAnalysis?: unknown }).__staveTimelineAnalysis
    const monaco = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null; focus: () => void }> } } }).monaco
    const eds = monaco?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.getModel()?.setValue(c)
    t?.focus()
  }, code)
  await page.waitForTimeout(150)
  await page.keyboard.press(`${MOD}+Enter`)
}

const span = (page: Page) => page.locator('[data-full-song-period]')
const notice = (page: Page) => page.locator('[data-full-song-fallback-notice]')

const onsets = (page: Page): Promise<number[]> =>
  page.evaluate(() =>
    Object.values(
      (window as unknown as { __staveTimelineMarks?: { byLane: Record<string, { onsets: number[] }> } }).__staveTimelineMarks?.byLane ?? {},
    ).flatMap((l) => l.onsets),
  )

async function openLimitSlider(page: Page) {
  await page.getByText('File', { exact: true }).first().click()
  await page.getByText('Editor Settings...', { exact: true }).click()
  await page.getByText('Pattern & Timeline', { exact: true }).first().click()
  const slider = page.locator('[data-testid="setting-songCycleLimit"]')
  await slider.waitFor({ timeout: 10_000 })
  return slider
}

test('the limit is 64 by default, the slider moves it, and the timeline follows without a re-evaluation', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await boot(page)
  await evaluateCode(page, NEVER_REPEATS)
  await expect(span(page)).toHaveAttribute('data-full-song-period', '64+ cycles', { timeout: 60_000 })
  await expect(notice(page)).toHaveText(/showing first 64 cycles/)

  const slider = await openLimitSlider(page)
  expect(await slider.evaluate((el: HTMLInputElement) => [el.min, el.max, el.step, el.value])).toEqual(['16', '256', '16', '64'])
  await slider.focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
  await expect(slider).toHaveValue('128')
  await expect(slider.locator('xpath=following-sibling::*[1]')).toHaveText('128 cycles')
  await page.keyboard.press('Escape')

  // No re-evaluation: the new limit alone re-runs the analysis.
  await expect(span(page)).toHaveAttribute('data-full-song-period', '128+ cycles', { timeout: 60_000 })
  await expect(notice(page)).toHaveText(/showing first 128 cycles/)

  // And it is kept.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 30_000 })
  await evaluateCode(page, NEVER_REPEATS)
  await expect(span(page)).toHaveAttribute('data-full-song-period', '128+ cycles', { timeout: 60_000 })
  expect(errors, errors.join('\n')).toEqual([])
})

test('an arrangement longer than the limit reads "N+" and pages; inside it, it spans its declared end', async ({ page }) => {
  test.setTimeout(180_000)
  await boot(page)
  await evaluateCode(page, ARRANGED_100)
  // Not the 1-cycle loop its first 80 bars repeat at.
  await expect(span(page)).toHaveAttribute('data-full-song-period', '64+ cycles', { timeout: 60_000 })

  const slider = await openLimitSlider(page)
  await slider.focus()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Escape')
  await expect(span(page)).toHaveAttribute('data-full-song-period', 'arranged 100 cycles', { timeout: 60_000 })
})

test('at the default limit the view pages to cycles 64–128, and that window draws its own notes', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await boot(page)
  await evaluateCode(page, NEVER_REPEATS)
  await expect(span(page)).toHaveAttribute('data-full-song-period', '64+ cycles', { timeout: 60_000 })
  await expect.poll(async () => (await onsets(page)).length, { timeout: 60_000 }).toBeGreaterThan(0)
  expect(Math.max(...(await onsets(page)))).toBeLessThan(64)

  // The trigger watches the transport, so play, then seek past three quarters.
  await page.locator('[data-full-song="grid"]').click({ position: { x: 4, y: 4 } })
  await page.keyboard.press('Space')
  const box = await page.locator('[data-full-song="ruler-area"]').boundingBox()
  expect(box, 'no ruler box').not.toBeNull()
  await page.mouse.click(box!.x + box!.width * 0.78, box!.y + box!.height / 2)
  await expect(notice(page)).toHaveText(/showing cycles 64[^0-9]+128/, { timeout: 60_000 })

  await expect.poll(async () => Math.min(...(await onsets(page)), Infinity), { timeout: 60_000 }).toBeGreaterThanOrEqual(64)
  const paged = await onsets(page)
  expect(paged.length, 'the paged window must still draw note marks').toBeGreaterThan(0)
  expect(Math.max(...paged)).toBeLessThan(128)
  await page.keyboard.press('Space')
  expect(errors, errors.join('\n')).toEqual([])
})
