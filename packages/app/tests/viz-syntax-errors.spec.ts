/**
 * #2220 — a syntax error in a p5 or Hydra visual is a p5 or Hydra row, with its
 * file, its line in the user's code, and a squiggle. It used to be a "Stave"
 * row with no file and no line: the sketch is compiled when its renderer is
 * built, which after the worker fails is inside a worker-message handler, so the
 * throw reached only the global catch.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp } from './_appBoot'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const ROW = '[data-testid="console-row"]'

/** `background(0` is never closed; the parser stops at the `}` on line 6 */
const P5_BROKEN = 'function setup() {\n  createCanvas(200, 200)\n}\nfunction draw() {\n  background(0\n}\n'
/** the call is never closed: the code ends on line 1 */
const HYDRA_BROKEN = 's.osc(10).out(\n'

const openConsole = (page: Page) => page.locator('[data-activity-bar] [data-panel-id="console"]').click()

/** the squiggled lines on the open editor in `language` */
const squiggles = (page: Page, language: string): Promise<number[]> =>
  page.evaluate((l) => {
    const m = (window as any).monaco // eslint-disable-line @typescript-eslint/no-explicit-any
    const e = m.editor.getEditors().find((x: any) => x.getModel()?.getLanguageId?.() === l) // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!e) return []
    return m.editor.getModelMarkers({ resource: e.getModel().uri }).map((x: any) => x.startLineNumber) // eslint-disable-line @typescript-eslint/no-explicit-any
  }, language)

/** the log's error rows as [runtime, file, line, message] */
const errors = (page: Page): Promise<Array<[string, string | undefined, number | undefined, string]>> =>
  page.evaluate(() =>
    ((window as any).__staveGetLog?.() ?? []) // eslint-disable-line @typescript-eslint/no-explicit-any
      .filter((e: any) => e.level === 'error') // eslint-disable-line @typescript-eslint/no-explicit-any
      .map((e: any) => [e.runtime, e.source, e.line, e.message])) // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The preview has drawn a frame; an edit made before that is lost (#2217). The
 * worker times its `draw`; main-thread p5 times only its per-frame `p5.bus`.
 */
async function previewDrew(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const sections = (window as any).__stavePerf?.snapshot?.()?.sections ?? {} // eslint-disable-line @typescript-eslint/no-explicit-any
    return Object.entries(sections).some(([k, v]: [string, any]) => /draw|\.bus$/.test(k) && v?.count > 0) // eslint-disable-line @typescript-eslint/no-explicit-any
  }), { timeout: 15_000 }).toBe(true)
}

/** set the model of the open editor in `language` */
async function setCodeIn(page: Page, language: string, code: string): Promise<void> {
  const ok = await page.evaluate(([c, l]) => {
    const e = (window as any).monaco.editor.getEditors().find((x: any) => x.getModel()?.getLanguageId?.() === l) // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!e) return false
    e.getModel().setValue(c)
    e.focus()
    return true
  }, [code, language])
  expect(ok, `an editor in ${language}`).toBe(true)
}

/** Cmd+K V — open the active file's preview beside it */
async function previewToSide(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fire = (key: string, meta: boolean) =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, metaKey: meta, ctrlKey: meta }))
    fire('k', true)
    return new Promise((r) => setTimeout(() => { fire('v', false); r(null) }, 16))
  })
}

async function openPreview(page: Page, fileId: string, language: string, renderer: string): Promise<void> {
  await page.locator(`[data-file-tree-item="${fileId}"]`).dblclick()
  await expect.poll(() => page.evaluate((l) =>
    (window as any).monaco.editor.getEditors().some((x: any) => x.getModel()?.getLanguageId?.() === l), language)).toBe(true) // eslint-disable-line @typescript-eslint/no-explicit-any
  await previewToSide(page)
  await expect(page.locator(`[data-renderer="${renderer}"]`)).toHaveCount(1, { timeout: 10_000 })
  await previewDrew(page)
}

/** live worker-rendered visuals: which path the sketch ran on */
const workerVizCount = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__stavePerf?.snapshot?.()?.gauges?.['viz.worker'] ?? 0) // eslint-disable-line @typescript-eslint/no-explicit-any

for (const worker of [true, false]) {
  test.describe(worker ? 'in the viz worker (falls back to the main thread)' : 'on the main thread', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((w) => {
        (window as any).__STAVE_PERF__ = true // eslint-disable-line @typescript-eslint/no-explicit-any
        try { localStorage.setItem('stave.viz.worker', w ? '1' : '0') } catch { /* private mode */ }
      }, worker)
      await bootApp(page, { e2eHooks: true })
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    })

    test('a p5 syntax error in the preview is a p5 row on its line, with a squiggle', async ({ page }) => {
      await openPreview(page, 'viz:__bundled_scope_p5__', 'p5js', 'p5')
      expect(await workerVizCount(page) > 0).toBe(worker)
      await setCodeIn(page, 'p5js', P5_BROKEN)
      await expect.poll(() => errors(page), { timeout: 15_000 }).not.toEqual([])
      await page.waitForTimeout(1000)
      expect(await errors(page)).toEqual([['p5', 'preset/viz/scope.p5', 6, 'missing ) after argument list']])
      await openConsole(page)
      await expect(page.locator(ROW).filter({ hasText: 'missing ) after argument list' })).toHaveAttribute('data-line', '6')
      await expect.poll(() => squiggles(page, 'p5js')).toEqual([6])
    })

    test('a Hydra syntax error in the preview says where the code ends, not a brace that isn’t there', async ({ page }) => {
      await openPreview(page, 'viz:__bundled_kaleidoscope_hydra__', 'hydra', 'hydra')
      expect(await workerVizCount(page) > 0).toBe(worker)
      await setCodeIn(page, 'hydra', HYDRA_BROKEN)
      await expect.poll(() => errors(page), { timeout: 15_000 }).not.toEqual([])
      await page.waitForTimeout(1000)
      expect(await errors(page)).toEqual([['hydra', 'preset/viz/kaleidoscope.hydra', 1, 'Unexpected end of code']])
      await expect.poll(() => squiggles(page, 'hydra')).toEqual([1])
    })

    test('a p5 visual used through .viz() with a syntax error says so on its line', async ({ page }) => {
      // no preview: `.viz()` is the one place it runs
      const id = await page.evaluate((c) => (window as any).__staveOverrideVizFile('scope', c), P5_BROKEN) // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(id).toBeTruthy()
      await page.evaluate((i) => (window as any).__staveSaveVizFileById(i), id) // eslint-disable-line @typescript-eslint/no-explicit-any
      await setCodeIn(page, 'strudel', "$: s(\"bd*4\").viz('scope')\n")
      await page.keyboard.press(`${MOD}+Enter`)
      await expect.poll(() => errors(page), { timeout: 15_000 }).not.toEqual([])
      await page.waitForTimeout(1000)
      // the file a visual used by name reports against is #2218's; here, the runtime and the line
      const rows = await errors(page)
      expect(rows.map(([rt, , line, msg]) => [rt, line, msg])).toEqual([['p5', 6, 'missing ) after argument list']])
      await page.keyboard.press(`${MOD}+Period`)
    })
  })
}
