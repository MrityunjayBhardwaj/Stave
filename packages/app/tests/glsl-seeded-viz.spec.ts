/**
 * GLSL SEEDED-`.viz()` PATH (#293) — the regression gate for P118/PV88.
 *
 * `glsl-path-coverage.spec.ts` mounts GLSL via `__staveRegisterViz`, which
 * injects straight into the named-viz registry — it does NOT exercise the
 * workspace-file → `registerAllVizFiles` filter → named-viz path. That FILTER
 * is exactly what P118 broke: `registerAllVizFiles` excluded `glsl`, so the
 * bundled `Prism.glsl` starter file (seeded at startup) was never registered
 * as a named viz, and inline `.viz("Prism")` mounted NOTHING — silently
 * (worker:0, no error). tsc + 40 unit tests were green; only live observation
 * caught it.
 *
 * This spec closes that hole on the REAL path: Prism is ADDED from the Viz
 * library (#834) — `viz_lib/Prism/Prism.glsl` — and registered as a named viz
 * by the runtime "Add to workspace" path (`registerAddedViz`, the same
 * `isVizLanguage` allow-list). The spec then drives inline `.viz("Prism")` and
 * OBSERVES the worker mount + draw frames + painted pixels. If a future renderer
 * kind is dropped from the allow-list (`isVizLanguage` / `VIZ_LANGUAGES`) — or
 * the library add stops registering — this goes red.
 *
 * Run HEADED on real GPU (P108) with per-test context isolation (PV84):
 *   E2E_VERIFY=1 pnpm --filter @stave/app exec playwright test glsl-seeded-viz.spec.ts --headed --timeout=180000 --workers=1
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { vizFrameHashes, distinct } from './_vizFrames'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function open(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__STAVE_PERF__ = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__STAVE_E2E__ = true
    try {
      localStorage.setItem('stave.viz.worker', '1') // force the worker path
    } catch {
      /* ignore */
    }
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(2500) // let startup seed + registerAllVizFiles (on mount) run
  return { ctx, page }
}

/** Add the Prism package from the Viz library (#834) — it is no longer seeded
 *  at project creation, so the runtime "Add to workspace" path is what
 *  registers it as a named viz (`registerAddedViz` → `.viz("Prism")` resolves). */
async function addPrismFromLibrary(page: Page): Promise<void> {
  await page.locator('[data-activity-bar] button[aria-label="Library"]').click()
  const panel = page.locator('[data-asset-library]')
  await panel.waitFor({ timeout: 10000 })
  await panel.locator('[data-filter="asset-type-filter"]').selectOption('viz')
  const prism = panel.locator('[data-asset-row="viz:prism"]')
  await prism.hover()
  await prism.locator('[data-asset-insert]').click()
  await page.getByText('Added Prism → viz_lib/Prism/. Use .viz("Prism").').waitFor({ timeout: 5000 })
  await page.waitForTimeout(400) // let the file-list → registerAllVizFiles register it
  // The add auto-opens Prism.glsl; switch back to the pattern editor to run code.
  await page.locator('[data-workspace-tab="tab-pattern.strudel"]').click()
  await page.waitForTimeout(400)
}

async function setCode(page: Page, code: string): Promise<void> {
  const ok = await page.evaluate((c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = (window as any).monaco?.editor?.getEditors?.()?.[0]
    if (!e) return false
    e.getModel()?.setValue(c)
    return true
  }, code)
  expect(ok).toBe(true)
  await page.waitForTimeout(250)
}

async function press(page: Page, key: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window as any).monaco?.editor?.getEditors?.()?.[0]?.focus())
  await page.keyboard.press(key)
}

async function scrollTo(page: Page, top: number): Promise<void> {
  await page.evaluate((t) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).monaco?.editor?.getEditors?.()?.[0]?.setScrollTop(t)
  }, top)
}

interface Snap {
  worker: number
  glsl: number
  glctx: number
  draw: { count: number; p95: number } | null
}
async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (window as any).__stavePerf?.snapshot?.()
    const d = s?.sections?.['viz.worker.draw'] ?? null
    return {
      worker: s?.gauges?.['viz.worker'] ?? 0,
      glsl: s?.gauges?.['viz.glsl'] ?? 0,
      glctx: s?.gauges?.['viz.glctx'] ?? 0,
      draw: d ? { count: d.count, p95: d.p95 } : null,
    }
  })
}

test.describe('#293 GLSL seeded-`.viz()` path — P118/PV88 regression gate', () => {
  test.skip(!process.env.E2E_VERIFY, 'acceptance gate — set E2E_VERIFY=1')

  test('the bundled Prism.glsl starter mounts in the worker via inline `.viz("Prism")` and PAINTS', async ({
    browser,
  }) => {
    const { ctx, page } = await open(browser)
    try {
      // Prism is added from the Viz library (#834) — no longer seeded — so the
      // runtime "Add to workspace" path registers it as a named viz. Then
      // reference it from inline `.viz("Prism")`.
      await addPrismFromLibrary(page)
      const program = `$: s("bd*4, ~ sd, hh*8").bank("RolandTR909").viz('Prism')`
      await setCode(page, program)
      await press(page, `${MOD}+Enter`)
      await page.waitForTimeout(3500)
      await scrollTo(page, 0) // keep the inline zone on-screen (PV78)
      await page.waitForTimeout(1500)

      const m = await snap(page)
      console.log(`[#293] .viz('Prism') → ${JSON.stringify(m)}`)

      // The P118 gate + control probe: the bundled glsl resolved as a named viz
      // and mounted in the WORKER (not nothing — the bug — and not a fallback).
      expect(m.worker, "bundled glsl `.viz('Prism')` mounted in the worker (P118 gate)").toBeGreaterThan(0)
      expect(m.glsl, 'no main-thread fallback').toBe(0)
      expect(m.glctx, 'a live GL context was accounted (#266)').toBeGreaterThanOrEqual(1)
      expect(m.draw, 'viz.worker.draw populated (the #230 bridge fired for glsl)').not.toBeNull()
      expect(m.draw!.count, 'glsl draw frames recorded').toBeGreaterThan(0)

      // Lokāyata: the canvas actually PAINTS animated frames (not black/frozen).
      // PV90: measure via the COMPOSITOR (page.screenshot clip), not element
      // canvas.screenshot() — the latter readback false-positives on worker viz.
      const canvas = page.locator('[data-viz-zone] canvas').first()
      await canvas.waitFor({ timeout: 15000 })
      const frames = await vizFrameHashes(page, '[data-viz-zone] canvas', 5, 600)
      const d = distinct(frames)
      const box = await canvas.boundingBox()
      const paintBuf = box
        ? await page.screenshot({ clip: box, path: 'test-results/glsl-seeded.png' })
        : Buffer.from([])
      console.log(`[#293] distinct=${d}/5 paintPNG=${paintBuf.length}B hashes=${frames.join(',')}`)

      expect(d, 'the bundled glsl canvas animates frame-to-frame').toBeGreaterThanOrEqual(3)
      expect(paintBuf.length, 'the bundled glsl canvas paints pixels').toBeGreaterThan(3000)
    } finally {
      await ctx.close()
    }
  })
})
