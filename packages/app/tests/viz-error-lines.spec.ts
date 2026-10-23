/**
 * A visual's errors, end to end, in the Console: the row names the file and the
 * line, and the file gets its squiggle.
 *
 * - #2210 — a GLSL compile error is ONE row with its line (it used to be written
 *   twice, the second without a line), and through `.viz("Prism")` it names
 *   `viz_lib/Prism/Prism.glsl`, not the visual's name `Prism`.
 * - #2209 — a Hydra error raised in the viz worker names its file.
 * - #2211 — a bare Hydra function says it is on `s`, not "Did you mean" itself.
 * - #2219 — a Hydra visual used through `.viz()` with an error in its code says so
 *   (it used to reach only the browser console), and in the preview it is still
 *   one row.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp } from './_appBoot'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const ROW = '[data-testid="console-row"]'
const GLSL_BROKEN = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(definitely_not_a_real_symbol, 0.0, 0.0, 1.0);
}`

const openConsole = (page: Page) => page.locator('[data-activity-bar] [data-panel-id="console"]').click()

/** the squiggled lines on the open editor in `language` */
const squiggles = (page: Page, language: string): Promise<number[]> =>
  page.evaluate((l) => {
    const m = (window as any).monaco // eslint-disable-line @typescript-eslint/no-explicit-any
    const e = m.editor.getEditors().find((x: any) => x.getModel()?.getLanguageId?.() === l) // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!e) return []
    return m.editor.getModelMarkers({ resource: e.getModel().uri }).map((x: any) => x.startLineNumber) // eslint-disable-line @typescript-eslint/no-explicit-any
  }, language)

/** what the log holds, file by file — the Console's rows come from it */
const logged = (page: Page, runtime: string): Promise<Array<[string | undefined, number | undefined]>> =>
  page.evaluate((rt: string) =>
    ((window as any).__staveGetLog?.() ?? []) // eslint-disable-line @typescript-eslint/no-explicit-any
      .filter((e: any) => e.runtime === rt) // eslint-disable-line @typescript-eslint/no-explicit-any
      .map((e: any) => [e.source, e.line]), // eslint-disable-line @typescript-eslint/no-explicit-any
  runtime)

const workerVizCount = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__stavePerf?.snapshot?.()?.gauges?.['viz.worker'] ?? 0) // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The preview has drawn a frame. An edit made before that is lost (#2217), so
 * every test that edits a preview waits for it first.
 */
async function previewDrew(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const sections = (window as any).__stavePerf?.snapshot?.()?.sections ?? {} // eslint-disable-line @typescript-eslint/no-explicit-any
    return Object.entries(sections).some(([k, v]: [string, any]) => /draw/.test(k) && v?.count > 0) // eslint-disable-line @typescript-eslint/no-explicit-any
  }), { timeout: 15_000 }).toBe(true)
}

/** set the model of the open editor in `language` */
async function setCodeIn(page: Page, language: string, code: string): Promise<void> {
  const ok = await page.evaluate(([c, l]) => {
    const eds = (window as any).monaco.editor.getEditors() // eslint-disable-line @typescript-eslint/no-explicit-any
    const e = eds.find((x: any) => x.getModel()?.getLanguageId?.() === l) // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!e) return false
    e.getModel().setValue(c)
    e.focus()
    return true
  }, [code, language])
  expect(ok, `an editor in ${language}`).toBe(true)
}

/** Cmd+K V — open the active file's preview beside it (the window-level chord) */
async function previewToSide(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fire = (key: string, meta: boolean) =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, metaKey: meta, ctrlKey: meta }))
    fire('k', true)
    return new Promise((r) => setTimeout(() => { fire('v', false); r(null) }, 16))
  })
}

/** add the library's Prism (it opens `viz_lib/Prism/Prism.glsl` in a tab) */
async function addPrism(page: Page): Promise<void> {
  await page.locator('[data-activity-bar] button[aria-label="Library"]').click()
  const panel = page.locator('[data-asset-library]')
  await panel.locator('[data-filter="asset-type-filter"] button[data-chip="viz"]').click()
  const prism = panel.locator('[data-asset-row="viz:prism"]')
  await prism.hover()
  await prism.locator('[data-asset-insert]').click()
  await page.getByText('Added Prism → viz_lib/Prism/. Use .viz("Prism").').waitFor({ timeout: 5000 })
  await page.locator('[data-workspace-tab*="Prism_glsl"]').first().click()
}

async function openKaleidoscopePreview(page: Page, code: string): Promise<void> {
  await page.locator('[data-file-tree-item*="kaleidoscope"]').first().dblclick()
  await expect.poll(() => page.evaluate(() =>
    (window as any).monaco.editor.getEditors().some((x: any) => x.getModel()?.getLanguageId?.() === 'hydra'))).toBe(true) // eslint-disable-line @typescript-eslint/no-explicit-any
  await previewToSide(page)
  await expect(page.locator('[data-renderer="hydra"]')).toHaveCount(1, { timeout: 10_000 })
  await previewDrew(page)
  await setCodeIn(page, 'hydra', code)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { (window as any).__STAVE_PERF__ = true }) // eslint-disable-line @typescript-eslint/no-explicit-any
  await bootApp(page, { e2eHooks: true })
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
})

test('a GLSL compile error in the preview is one row, with its line and squiggle (#2210)', async ({ page }) => {
  await addPrism(page)
  await previewToSide(page)
  await expect(page.locator('[data-renderer="glsl"]')).toHaveCount(1, { timeout: 10_000 })
  await previewDrew(page)
  await setCodeIn(page, 'glsl', GLSL_BROKEN)
  await openConsole(page)
  const rows = page.locator(ROW).filter({ hasText: 'definitely_not_a_real_symbol' })
  await expect(rows.first()).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => squiggles(page, 'glsl')).toEqual([2])
  // settle, then count: one row, the one with the line
  await page.waitForTimeout(1000)
  await expect(rows).toHaveCount(1)
  await expect(rows).toHaveAttribute('data-line', '2')
  expect(await logged(page, 'glsl')).toEqual([['viz_lib/Prism/Prism.glsl', 2]])
})

test('a GLSL visual used by name reports against its file, not its name (#2210)', async ({ page }) => {
  await addPrism(page) // an editor tab only — no preview, so `.viz()` is the one place it runs
  const id = await page.evaluate((c) => (window as any).__staveOverrideVizFile('Prism', c), GLSL_BROKEN) // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(id).toBeTruthy()
  await page.evaluate((i) => (window as any).__staveSaveVizFileById(i), id) // eslint-disable-line @typescript-eslint/no-explicit-any
  await page.locator('[data-workspace-tab="tab-pattern.strudel"]').click()
  await setCodeIn(page, 'strudel', '$: s("bd*4").viz("Prism")\n')
  await page.keyboard.press(`${MOD}+Enter`)
  await expect.poll(() => logged(page, 'glsl'), { timeout: 15_000 }).toEqual([['viz_lib/Prism/Prism.glsl', 2]])
  await openConsole(page)
  await expect(page.locator(ROW).filter({ hasText: 'definitely_not_a_real_symbol' })).toHaveAttribute('data-line', '2')
  await page.keyboard.press(`${MOD}+Period`)
})

test('a Hydra error raised in the viz worker names its file and gets its squiggle (#2209)', async ({ page }) => {
  await openKaleidoscopePreview(page, 's.osc(10)\n  .rotate(() => s.nope.x)\n  .out()')
  await openConsole(page)
  // the worker starts, runs the sketch, and its first frame throws
  await expect.poll(() => logged(page, 'hydra'), { timeout: 15_000 }).not.toEqual([])
  const row = page.locator(ROW).filter({ hasText: 'reactive fn: Cannot read properties of undefined' })
  await expect(row).toHaveCount(1, { timeout: 10_000 })
  // it ran in the worker, which is where these rows lost their file
  expect(await workerVizCount(page)).toBeGreaterThan(0)
  await expect(row).toHaveAttribute('data-line', '2')
  expect(await logged(page, 'hydra')).toEqual([['preset/viz/kaleidoscope.hydra', 2]])
  await expect.poll(() => squiggles(page, 'hydra')).toEqual([2])
})

test('a bare Hydra function says it is on `s` (#2211)', async ({ page }) => {
  await openKaleidoscopePreview(page, 'osc(10).out()')
  await openConsole(page)
  const row = page.locator(ROW).filter({ hasText: '`osc` is on `s` here — write `s.osc(…)`.' })
  await expect(row).toHaveCount(1, { timeout: 10_000 })
  await expect(page.locator(ROW).filter({ hasText: 'Did you mean' })).toHaveCount(0)
})

test('a Hydra visual used by name with an error in its code reports it against its file (#2219)', async ({ page }) => {
  // no preview: `.viz()` is the one place it runs, and its host only logged to the browser console
  const id = await page.evaluate((c) => (window as any).__staveOverrideVizFile('kaleidoscope', c), 's.osc(10)\n  .notAThing()\n  .out()') // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(id).toBeTruthy()
  await page.evaluate((i) => (window as any).__staveSaveVizFileById(i), id) // eslint-disable-line @typescript-eslint/no-explicit-any
  await setCodeIn(page, 'strudel', "$: s(\"bd*4\").viz('kaleidoscope')\n")
  await page.keyboard.press(`${MOD}+Enter`)
  await expect.poll(() => logged(page, 'hydra'), { timeout: 15_000 }).toEqual([['preset/viz/kaleidoscope.hydra', 2]])
  await openConsole(page)
  await expect(page.locator(ROW).filter({ hasText: 'notAThing is not a function' })).toHaveAttribute('data-line', '2')
  await page.keyboard.press(`${MOD}+Period`)
})

test('a Hydra error in the preview is still one row (#2219)', async ({ page }) => {
  // each main-thread run of the sketch follows a fallback from the worker, which
  // says so once; the error is raised once per run
  let runs = 0
  page.on('console', (m) => { if (m.text().includes('falling back to the main thread')) runs++ })
  await openKaleidoscopePreview(page, 's.osc(10)\n  .notAThing()\n  .out()')
  await expect.poll(() => logged(page, 'hydra'), { timeout: 15_000 }).not.toEqual([])
  await page.waitForTimeout(1000)
  expect(await logged(page, 'hydra')).toEqual([['preset/viz/kaleidoscope.hydra', 2]])
  // one write per run: the Console merges an identical second write into the
  // same row and counts it, so the count is what shows a double write
  expect(runs).toBeGreaterThan(0)
  expect(await page.evaluate(() =>
    ((window as any).__staveGetLog?.() ?? []).filter((e: any) => e.runtime === 'hydra').map((e: any) => e.count))).toEqual([runs]) // eslint-disable-line @typescript-eslint/no-explicit-any
  await expect.poll(() => squiggles(page, 'hydra')).toEqual([2])
})
