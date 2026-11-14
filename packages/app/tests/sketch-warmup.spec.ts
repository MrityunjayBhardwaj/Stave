/**
 * #2560 — the pattern's viz sketches warm up hidden before Play.
 *
 * Small three.js sketches (no network assets) that say what they do on the
 * console — the worker's console reaches the page's — so the spec reads:
 *   - `TOP` each time a sketch's top level runs (one instance = one TOP);
 *   - `FRAME n` for its first frames.
 * Each sketch's top level waits a moment before its loop, like a sketch loading
 * a model, so "built before Play" and "built at Play" can be told apart.
 *
 *   1. an inline `.viz()` builds hidden before Play: its top level runs and it
 *      draws its one hidden warm-up frame while stopped, nothing is on screen,
 *      and Play shows it without running the top level again;
 *   2. after Stop the zone's sketch is reused for the next Play — still one
 *      instance, no second top level;
 *   3. a sketch that never finishes loading holds Play under "Loading visuals…"
 *      and the music starts within the cap;
 *   4. a background's top level runs once when its file opens.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, evalCode, seedCode, stopCode } from './_appBoot'

const PATTERN_TAB = '[data-workspace-tab="tab-pattern.strudel"]'
const LCD_STATE = '[data-stave-lcd-state]'

/** A sketch that tags its console lines with `name`; its top level waits `loadMs`
 *  before starting its loop (a stand-in for loading a model), or forever. */
function sketch(name: string, loadMs: number | 'never'): string {
  const wait = loadMs === 'never' ? 'await new Promise(() => {})' : `await new Promise((ok) => setTimeout(ok, ${loadMs}))`
  return `import * as THREE from 'three'
console.log('WARMSPEC ${name} TOP')
${wait}
const renderer = new THREE.WebGLRenderer()
renderer.setClearColor(0xff0000)
let n = 0
renderer.setAnimationLoop(() => {
  n++
  if (n <= 3) console.log('WARMSPEC ${name} FRAME ' + n)
  renderer.clear()
})
`
}

async function boot(page: Page): Promise<string[]> {
  const lines: string[] = []
  page.on('console', (m) => {
    const t = m.text()
    if (t.startsWith('WARMSPEC ')) lines.push(t.slice('WARMSPEC '.length))
  })
  await bootApp(page, { e2eHooks: true })
  return lines
}

/** Make `<name>.three` through the New file prompt, put `code` in it and save. */
async function makeThreeFile(page: Page, name: string, code: string): Promise<void> {
  await page.locator('[data-sidebar]').hover()
  await page.locator('[data-sidebar] button[title="New file"]').click()
  await page.keyboard.type(`${name}.three`)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  const id = await page.evaluate(
    ([n, c]) => {
      const w = window as unknown as {
        __staveOverrideVizFile: (n: string, c: string) => string | null
        __staveSaveVizFileById: (id: string) => boolean
      }
      const fid = w.__staveOverrideVizFile(n, c)
      if (fid) w.__staveSaveVizFileById(fid)
      return fid
    },
    [name, code] as const,
  )
  expect(id, `${name}.three exists`).not.toBeNull()
  await page.locator(PATTERN_TAB).click()
  await page.waitForTimeout(300)
}

const count = (lines: string[], line: string): number => lines.filter((l) => l === line).length

/** What of the sketch is on screen: zones in the editor, and warm containers a
 *  person could see (nothing hidden on the way up, inside the window). */
async function onScreen(page: Page): Promise<{ zones: number; warm: number; warmVisible: number }> {
  return page.evaluate(() => {
    const shown = (el: Element): boolean => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e)
        if (cs.visibility === 'hidden' || cs.display === 'none') return false
      }
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight
    }
    const warm = [...document.querySelectorAll('[data-viz-warm]')]
    return {
      zones: document.querySelectorAll('.monaco-editor [data-viz-zone]').length,
      warm: warm.length,
      warmVisible: warm.filter(shown).length,
    }
  })
}

test.describe('#2560 viz sketches warm up hidden before Play', () => {
  test.describe.configure({ timeout: 120_000 })

  test('an inline sketch builds hidden before Play, shows at Play, and is reused after Stop', async ({ page }) => {
    const lines = await boot(page)
    await makeThreeFile(page, 'Warm', sketch('Warm', 1500))
    await seedCode(page, `$: s("bd*4").gain(0).viz("Warm")`)

    // Built and drawn once (its warm-up frame) while stopped…
    await expect.poll(() => count(lines, 'Warm FRAME 1'), { timeout: 30_000 }).toBe(1)
    expect(count(lines, 'Warm TOP'), 'the top level ran before Play').toBe(1)
    // …with nothing on screen.
    const before = await onScreen(page)
    expect(before.zones, 'no inline zone before Play').toBe(0)
    expect(before.warm, 'the warm sketch exists').toBe(1)
    expect(before.warmVisible, 'and is not visible').toBe(0)
    await expect(page.locator(LCD_STATE)).toHaveText('STOP')

    // Play shows it, at once, without building it again.
    await evalCode(page)
    await expect(page.locator(LCD_STATE)).toHaveText('PLAY', { timeout: 15_000 })
    await expect(page.locator('.monaco-editor [data-viz-zone] canvas').first()).toBeVisible({ timeout: 5_000 })
    await expect.poll(() => count(lines, 'Warm FRAME 2'), { timeout: 5_000 }).toBe(1)
    expect(count(lines, 'Warm TOP'), 'Play adopted the warm sketch').toBe(1)

    // Stop, let the warm-up run again, Play again: still one instance.
    await stopCode(page)
    await expect(page.locator(LCD_STATE)).toHaveText('STOP')
    await page.waitForTimeout(2_500)
    expect(count(lines, 'Warm TOP'), 'after Stop the zone sketch is reused, not built again').toBe(1)
    expect((await onScreen(page)).warm, 'no hidden second copy').toBe(0)
    await evalCode(page)
    await expect(page.locator(LCD_STATE)).toHaveText('PLAY', { timeout: 15_000 })
    await page.waitForTimeout(1_000)
    expect(count(lines, 'Warm TOP'), 'the next Play adopted it too').toBe(1)
    await stopCode(page)
  })

  test('a sketch that never finishes loading holds Play under "Loading visuals…", then the music starts within the cap', async ({ page }) => {
    const lines = await boot(page)
    await makeThreeFile(page, 'Never', sketch('Never', 'never'))
    await seedCode(page, `$: s("bd*4").gain(0).viz("Never")`)
    await expect.poll(() => count(lines, 'Never TOP'), { timeout: 30_000 }).toBe(1)
    await page.waitForTimeout(500)

    await evalCode(page)
    const loading = page.locator('[data-stave-loading-visuals]')
    await expect(loading).toBeVisible({ timeout: 10_000 })
    await expect(loading).toHaveText('Loading visuals…')
    const shownAt = Date.now()
    await expect(page.locator(LCD_STATE)).toHaveText('PLAY', { timeout: 30_000 })
    const waited = Date.now() - shownAt
    console.log(`[#2560] held for ${waited} ms after "Loading visuals…" appeared`)
    expect(waited, 'it really waited').toBeGreaterThan(15_000)
    expect(waited, 'and never past the 20 s cap').toBeLessThan(22_000)
    await expect(loading).toHaveCount(0)
    await stopCode(page)
  })

  test("a background's top level runs once when its file opens", async ({ page }) => {
    const lines = await boot(page)
    await makeThreeFile(page, 'Back', sketch('Back', 300))
    await seedCode(page, `$: s("bd*4").gain(0)\nall(x => x.viz("Back"))`)
    await expect.poll(() => count(lines, 'Back FRAME 1'), { timeout: 30_000 }).toBeGreaterThan(0)
    await page.waitForTimeout(2_000) // a reload used to land ~300 ms after open
    expect(count(lines, 'Back TOP'), 'one instance').toBe(1)
  })
})
