/**
 * INLINE-VIZ HOT-RELOAD GATE (PV89 + PV90).
 *
 * Closes the save→repaint coverage gap that `glsl-seeded-viz.spec.ts` (mount-on-
 * load) does NOT cover: editing a referenced viz preset's CODE and saving must
 * re-create the running inline `.viz('name')` worker with the NEW sketch.
 *
 * Construction follows the two hard-won invariants:
 *   - PV89: keep the PATTERN editor MOUNTED across the edit+save (no tab switch —
 *     a tab switch unmounts it). We edit the preset content via `__staveOverrideVizFile`
 *     and fire the real save via `__staveSaveVizFileById`, both without switching tabs.
 *   - PV90: measure paint via the COMPOSITOR (`page.screenshot` clip, overlay-excluded),
 *     NOT element `canvas.screenshot()` — the latter false-positives "animation" on a
 *     re-mounted transferred OffscreenCanvas (this is what misdiagnosed P121).
 *
 * The method is self-checked by two controls in ONE run: the bundled animated Prism
 * must read distinct > 1 BEFORE, and the static magenta shader must read distinct === 1
 * AFTER. If a future change actually breaks the hot-reload, AFTER stays animated → red.
 *
 *   E2E_VERIFY=1 pnpm --filter @stave/app exec playwright test viz-hot-reload.spec.ts --headed --timeout=180000 --workers=1
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { vizFrameHashes, distinct } from './_vizFrames'

// A valid single-pass ShaderToy `mainImage` that paints ONE flat colour — no iTime,
// no iChannel0, so it can NEVER animate. distinct === 1 ⇒ the new shader is live.
const STATIC_GLSL = `void mainImage(out vec4 fragColor, in vec2 fragCoord){ fragColor = vec4(1.0, 0.0, 1.0, 1.0); }`

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
  await page.waitForTimeout(2500) // startup seed + registerAllVizFiles
  return { ctx, page }
}

/** Add the Prism package from the Viz library (#834) — it is no longer seeded,
 *  so the runtime "Add to workspace" path registers it as a named viz. */
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

test.describe('inline `.viz()` hot-reload — save→repaint (PV89/PV90)', () => {
  test.skip(!process.env.E2E_VERIFY, 'acceptance gate — set E2E_VERIFY=1')

  test('editing a referenced .glsl preset + save repaints the running inline viz', async ({ browser }) => {
    const { ctx, page } = await open(browser)
    try {
      // Prism is added from the Viz library (#834), then referenced by a pattern.
      await addPrismFromLibrary(page)
      const program = `$: s("bd*4, ~ sd, hh*8").bank("RolandTR909").viz('Prism')`
      await page.evaluate((c) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = (window as any).monaco?.editor?.getEditors?.()?.[0]
        e?.getModel()?.setValue(c)
      }, program)
      await page.waitForTimeout(250)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.evaluate(() => (window as any).monaco?.editor?.getEditors?.()?.[0]?.focus())
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
      await page.waitForTimeout(3500)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.evaluate(() => (window as any).monaco?.editor?.getEditors?.()?.[0]?.setScrollTop(0))
      await page.waitForTimeout(1500)

      // CONTROL (PV90): the animated Prism must read as animating via the same method.
      const before = await vizFrameHashes(page, '[data-viz-zone] canvas', 5, 400)
      expect(before.length, 'inline viz mounted (a canvas exists)').toBeGreaterThan(0)
      expect(distinct(before), 'control: animated Prism reads distinct>1 (method detects motion)').toBeGreaterThan(1)

      // Edit the preset to a static shader WITHOUT a tab switch (pattern editor stays
      // mounted — PV89), then fire the REAL save (flush → register → onNamedVizChanged).
      const fileId = await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (code) => (window as any).__staveOverrideVizFile('Prism', code),
        STATIC_GLSL,
      )
      expect(fileId, 'Prism.glsl workspace file found').not.toBeNull()
      const saved = await page.evaluate(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (id) => (window as any).__staveSaveVizFileById(id),
        fileId,
      )
      expect(saved, 'save hook fired').toBe(true)

      await page.waitForTimeout(3000)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.evaluate(() => (window as any).monaco?.editor?.getEditors?.()?.[0]?.setScrollTop(0))
      await page.waitForTimeout(1500)

      // THE GATE (PV90): the inline viz now paints the static shader → distinct === 1.
      const after = await vizFrameHashes(page, '[data-viz-zone] canvas', 6, 350)
      const d = distinct(after)
      console.log(`[viz-hot-reload] before distinct=${distinct(before)} after distinct=${d} (${after.join(',')})`)
      expect(d, 'after editing to a static shader + save, the inline viz stops animating').toBe(1)
    } finally {
      await ctx.close()
    }
  })
})
