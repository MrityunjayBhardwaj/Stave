/**
 * Asset Library — Viz card LIVE hover preview (#838).
 *
 * A viz card shows a static tile at rest; on HOVER it renders the real shader
 * live in the viz worker, muted, driven by the demo drum-pattern feed. This
 * proves:
 *   - hovering a viz card mounts a <canvas> into its preview host,
 *   - leaving tears it back down (only one preview is ever alive),
 *   - (GPU-gated) the shader actually PAINTS and ANIMATES — verified via
 *     COMPOSITOR capture sampled over time (never a canvas readback — PV90/PV93).
 *
 * The paint/animation assertion needs a real GPU (worker GLSL), so it is gated
 * like the other viz gates and runs headed:
 *   E2E_VERIFY=1 pnpm --filter @stave/app exec playwright test viz-hover-preview --headed --workers=1
 */
import { test, expect, type Page, type Locator } from '@playwright/test'
import { createHash } from 'node:crypto'

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    ;(window as unknown as { __STAVE_E2E__?: boolean }).__STAVE_E2E__ = true
    try {
      localStorage.setItem('stave.viz.worker', '1') // realistic worker path
    } catch {
      /* ignore */
    }
  })
  await page.goto('/')
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 30_000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 30_000 },
  )
}

async function openVizLibrary(page: Page): Promise<Locator> {
  await page.locator('[data-activity-bar] button[aria-label="Library"]').click()
  const panel = page.locator('[data-asset-library]')
  await panel.waitFor({ timeout: 10_000 })
  await panel.locator('[data-filter="asset-type-filter"] button[data-chip="viz"]').click()
  await page.waitForTimeout(150)
  return panel
}

test.describe('Asset Library — viz card hover preview (#838)', () => {
  test('hovering a viz card mounts a live canvas; leaving tears it down', async ({ page }) => {
    await boot(page)
    const panel = await openVizLibrary(page)

    const card = panel.locator('[data-asset-row="viz:prism"]')
    await expect(card).toBeVisible()
    const previewCanvas = panel.locator('[data-viz-preview="viz:prism"] canvas')

    // At rest: static tile only, no live canvas.
    await expect(previewCanvas).toHaveCount(0)

    // Hover → the worker viz mounts a canvas into the preview host.
    await card.hover()
    await expect(previewCanvas).toHaveCount(1, { timeout: 10_000 })

    // Leave → the preview is disposed (canvas removed, worker released).
    // Move the pointer to the panel header, well away from the card.
    await panel.locator('[data-asset-search]').hover()
    await expect(previewCanvas).toHaveCount(0, { timeout: 10_000 })
  })

  test('the live preview actually paints and animates @gpu', async ({ page }) => {
    test.skip(!process.env.E2E_VERIFY, 'GPU paint check — set E2E_VERIFY=1 and run headed')
    await boot(page)
    const panel = await openVizLibrary(page)

    const card = panel.locator('[data-asset-row="viz:prism"]')
    await card.hover()
    const previewCanvas = panel.locator('[data-viz-preview="viz:prism"] canvas')
    await expect(previewCanvas).toHaveCount(1, { timeout: 10_000 })
    await page.waitForTimeout(1200) // let the worker warm + the demo loop run

    // COMPOSITOR capture (page.screenshot), never a canvas readback (PV90). Sample
    // the card region over ~1.2s (a full demo cycle, PV93) and count distinct
    // frames — an animating shader yields > 1.
    const box = await card.boundingBox()
    expect(box).toBeTruthy()
    const hashes = new Set<string>()
    for (let i = 0; i < 8; i++) {
      const buf = await page.screenshot({ clip: box! })
      // Hash the WHOLE frame — a header/top-rows prefix is black in every frame
      // (the animated bright centre is lower), so a prefix fingerprint reads
      // static even while the shader moves (a PV90/P121-class instrument trap).
      hashes.add(createHash('sha1').update(buf).digest('hex'))
      await page.waitForTimeout(150)
    }
    // Save the last frame for visual confirmation.
    await card.screenshot({ path: 'test-results/viz-hover-preview-prism.png' })
    expect(hashes.size, 'preview animates (distinct compositor frames)').toBeGreaterThan(1)
  })
})

test.describe('Asset Library — viz preview height setting (#838)', () => {
  async function openSettingsViz(page: Page) {
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByText('Editor Settings...').click()
    await expect(page.getByTestId('settings-shell')).toBeVisible({ timeout: 4000 })
    await page.getByTestId('settings-nav-viz').click()
  }

  test('a "Preview height" slider is exposed under Visualization', async ({ page }) => {
    await boot(page)
    await openSettingsViz(page)
    await expect(page.getByTestId('setting-vizPreviewHeight')).toBeVisible()
    await expect(page.getByText('Preview height', { exact: true })).toBeVisible()
  })

  test('changing the slider resizes the viz cards (real gesture, end to end)', async ({ page }) => {
    await boot(page)

    // Baseline card height at the default setting.
    let panel = await openVizLibrary(page)
    const box0 = await panel.locator('[data-viz-preview-box="viz:prism"]').boundingBox()
    expect(box0).toBeTruthy()

    // Drive the real slider to a taller value that still fits one column
    // aspect-true (2:1 baked frame → width ≈ 2 × height, and 2×110 < panel width).
    await openSettingsViz(page)
    await page.getByTestId('setting-vizPreviewHeight').fill('110')
    await page.keyboard.press('Escape') // close the settings shell
    await expect(page.getByTestId('settings-shell')).toHaveCount(0)

    // The open library reflects it live: the card grows AND keeps the shader's
    // 2:1 aspect (the width scales with the height, not a fixed-width crop).
    panel = page.locator('[data-asset-library]')
    await expect(panel).toBeVisible()
    await expect
      .poll(async () => (await panel.locator('[data-viz-preview-box="viz:prism"]').boundingBox())?.height ?? 0)
      .toBeGreaterThan(box0!.height)
    const box1 = await panel.locator('[data-viz-preview-box="viz:prism"]').boundingBox()
    expect(Math.abs(box1!.height - 110)).toBeLessThan(6)
    expect(box1!.width / box1!.height, 'card keeps the 2:1 shader aspect').toBeGreaterThan(1.7)
    expect(box1!.width / box1!.height).toBeLessThan(2.3)
    await panel.screenshot({ path: 'test-results/viz-preview-height.png' })

    // Persists across reload (localStorage-backed).
    await page.reload()
    await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 30_000 })
    const panel2 = await openVizLibrary(page)
    const box2 = await panel2.locator('[data-viz-preview-box="viz:prism"]').boundingBox()
    expect(Math.abs(box2!.height - 110)).toBeLessThan(6)
  })

  test('the grid reflows: small cards share a row, large cards stack', async ({ page }) => {
    await boot(page)
    // The first two cards on the shelf, whichever they are: only neighbours can
    // share a row, and which packages are neighbours changes as the shelf grows.
    const prism = () => page.locator('[data-viz-preview-box^="viz:"]').nth(0)
    const pulse = () => page.locator('[data-viz-preview-box^="viz:"]').nth(1)

    // Small height → narrow cards → two per row (same y, side by side).
    await openSettingsViz(page)
    await page.getByTestId('setting-vizPreviewHeight').fill('48')
    await page.keyboard.press('Escape')
    await openVizLibrary(page)
    let a = await prism().boundingBox()
    let b = await pulse().boundingBox()
    expect(Math.abs(a!.y - b!.y), 'small cards share a row').toBeLessThan(8)
    expect(b!.x, 'and sit side by side').toBeGreaterThan(a!.x + a!.width - 8)

    // Large height → wide cards → one per row (stacked: different y).
    await openSettingsViz(page)
    await page.getByTestId('setting-vizPreviewHeight').fill('120')
    await page.keyboard.press('Escape')
    a = await prism().boundingBox()
    b = await pulse().boundingBox()
    expect(b!.y, 'large cards stack').toBeGreaterThan(a!.y + a!.height - 8)
  })
})
