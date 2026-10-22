/**
 * A note name means on the Song timeline what it means to the sound (#1928).
 *
 * Strudel reads `cs3` as C#3 and a bare `g` as G3 (octave 3 when none is
 * written). The timeline's pitch axis used to read both as "no pitch", so
 * those notes were drawn off their rows. The base canvas
 * (`data-full-song-canvas`) draws the note marks only, so its pixels are a
 * direct readout of where each note sits:
 *
 *   - `<cs3 e3 g a3>` must draw EXACTLY what `<c#3 e3 g3 a3>` draws (same pitches)
 *   - `<c3 e3 g3 a3>` must draw something else (control: pitch reaches the pixels)
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:bottomPanel.height', '320')
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.activeTabId', 'musical-timeline')
    } catch {
      /* ignore */
    }
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 20_000 },
  )
  // #872 — the editor's content is a CONTROLLED value fed by the async project
  // file load. Seeding before that lands lets it overwrite our code, and the app
  // evaluates the STARTER example instead (silently: the spec still runs, just
  // against the wrong song). Wait for the load: the model goes empty → file.
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getValue?: () => string } | null }> } } }).monaco
      const eds = m?.editor?.getEditors?.() ?? []
      return eds.some((e) => (e.getModel()?.getValue?.()?.length ?? 0) > 0)
    },
    { timeout: 20_000 },
  )
}

async function evalCode(page: Page, code: string): Promise<void> {
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
  await page.keyboard.press(`${MOD}+Enter`)
}

/** The base canvas's pixels — the drawn density + note marks. */
const readCanvas = (page: Page) =>
  page.locator('[data-full-song-canvas]').evaluate((el) => (el as HTMLCanvasElement).toDataURL())

async function drawn(page: Page, code: string): Promise<string> {
  await evalCode(page, code)
  await page.locator('[data-full-song="root"]').waitFor({ timeout: 10_000 })
  await expect(page.locator('[data-full-song-lane]')).toHaveCount(1, { timeout: 10_000 })
  await page.waitForTimeout(2000)
  return readCanvas(page)
}

test('a sharp written cs3 and a note with no octave sit on their own rows', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })

  await boot(page)
  const spelled = await drawn(page, '$: note("<c#3 e3 g3 a3>")')
  const strudelSpelling = await drawn(page, '$: note("<cs3 e3 g a3>")')
  const otherPitch = await drawn(page, '$: note("<c3 e3 g3 a3>")')

  // the control: a different first pitch draws differently, so pixels carry pitch
  expect(otherPitch).not.toBe(spelled)
  // the same pitches, spelled the two ways Strudel accepts, draw the same marks
  expect(strudelSpelling).toBe(spelled)
  expect(errors).toEqual([])
})
