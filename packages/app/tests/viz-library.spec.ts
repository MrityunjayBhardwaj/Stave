/**
 * Asset Library — Viz library (#834): curated viz *packages* you ADD to the
 * workspace.
 *
 * End-to-end proof that the Viz filter lists a small curated shelf of
 * non-default viz (Prism + Pulse Grid), and that a row's `+` = "Add to
 * workspace" materialises the package under `viz_lib/<Name>/` — a `.glsl` file
 * that registers as a named viz — idempotently.
 *
 * Nothing is seeded into IndexedDB: the library is a static in-app corpus, so
 * the Viz rows are present on boot. Registration/materialisation is observed
 * via the `__staveOverrideVizFile` hook (finds a viz-language workspace file by
 * basename — the exact predicate the named-viz bridge uses) and the file tree.
 */
import { test, expect, type Page } from '@playwright/test'

async function boot(page: Page): Promise<void> {
  // Enable the `__stave*` E2E hooks (e.g. `__staveOverrideVizFile`) — they are
  // gated on this flag and must be set before the app mounts.
  await page.addInitScript(() => {
    ;(window as unknown as { __STAVE_E2E__?: boolean }).__STAVE_E2E__ = true
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

async function openLibrary(page: Page) {
  await page.locator('[data-activity-bar] button[aria-label="Library"]').click()
  const panel = page.locator('[data-asset-library]')
  await panel.waitFor({ timeout: 10_000 })
  await page.waitForTimeout(200)
  return panel
}

async function showVizType(page: Page, panel: ReturnType<Page['locator']>) {
  await panel.locator('[data-filter="asset-type-filter"] button[data-chip="viz"]').click()
  await page.waitForTimeout(100)
}

/** Drag the viz card PREVIEW HEIGHT slider (#838) to its minimum through the real
 *  gesture: File ▸ Editor Settings… → the Visualization section → focus the range
 *  input → Home (the native "go to min" key) → Close.
 *
 *  `exact` on the File button — the name match is a case-insensitive substring, so
 *  a bare 'File' also hits the "New file" (+) button. And the unified settings
 *  shell (#739) renders ONE section at a time behind a nav: the slider is not in
 *  the DOM until "Visualization" is selected. */
async function setVizPreviewHeightToMin(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByText('Editor Settings...').click()
  await page.getByTestId('settings-shell').waitFor({ timeout: 5000 })
  await page.getByTestId('settings-nav-viz').click()
  const slider = page.getByTestId('setting-vizPreviewHeight')
  await slider.waitFor({ timeout: 5000 })
  await slider.focus()
  await page.keyboard.press('Home')
  // Scoped + exact: any other control whose label contains "Close" would also
  // be hit by an unscoped substring match on 'Close'. Same trap as the
  // File button above — the accessible name is a substring match, not an id.
  await page
    .getByTestId('settings-shell')
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await page.waitForTimeout(200)
}

/** Whether a viz-language workspace file with the given basename exists (the
 *  same predicate the named-viz bridge registers on). Returns the file id. */
async function vizFileId(page: Page, basename: string): Promise<string | null> {
  return page.evaluate(
    (name) =>
      (window as unknown as {
        __staveOverrideVizFile?: (b: string, c: string) => string | null
      }).__staveOverrideVizFile?.(name, `// probe ${Date.now()}`) ?? null,
    basename,
  )
}

test.describe('Asset Library — Viz library (#834)', () => {
  test('lists the curated viz packages (Prism + Pulse Grid) grouped under GLSL', async ({ page }) => {
    await boot(page)
    const panel = await openLibrary(page)

    // Viz is a first-class type — its chip is present without any seeding.
    const typeRow = panel.locator('[data-filter="asset-type-filter"]')
    await expect(typeRow.locator('button[data-chip="viz"]')).toBeVisible()
    await showVizType(page, panel)

    const prism = panel.locator('[data-asset-row="viz:prism"]')
    await expect(prism).toBeVisible()
    await expect(prism).toContainText('Prism')
    await expect(prism).toContainText('GLSL')

    const pulse = panel.locator('[data-asset-row="viz:pulse-grid"]')
    await expect(pulse).toBeVisible()
    await expect(pulse).toContainText('Pulse Grid')
  })

  test('each viz row shows a baked thumbnail (#836)', async ({ page }) => {
    await boot(page)
    const panel = await openLibrary(page)
    await showVizType(page, panel)

    // Every curated package renders a leading thumbnail whose src is a baked PNG
    // data-URI (not the SVG placeholder fallback, not an empty box).
    for (const id of ['prism', 'pulse-grid']) {
      const thumb = panel.locator(`img[data-asset-thumb="viz:${id}"]`)
      await expect(thumb, `${id} thumbnail is present`).toBeVisible()
      await expect(thumb).toHaveAttribute('src', /^data:image\/png/)
    }

    // Visual observation of the whole shelf with thumbnails.
    await panel.screenshot({ path: 'test-results/viz-library-thumbs.png' })
  })

  test('the cards are aspect-true and REFLOW — one column when they are big, two when small (#836/#838)', async ({
    page,
  }) => {
    // The shelf is a wrapping flex grid whose cards are sized by each shader's
    // aspect at the Settings preview height (#838). So the column count is not a
    // fixed layout choice — it FALLS OUT of card width vs the 260px sidebar:
    // a 2:1 shader at the default 96px is ~192px wide and only one fits across
    // 236px of content; at the 48px minimum it is ~96px and two fit.
    //
    // This asserts the reflow itself, driven by the real Settings gesture. The
    // spec used to assert "side by side" unconditionally — true when the cards
    // were small, false since #838 gave them a bigger default height.
    await boot(page)
    const panel = await openLibrary(page)
    await showVizType(page, panel)

    // The FIRST TWO cards on the shelf, whichever they are: a row is shared by
    // neighbours, and which packages are neighbours changes as the shelf grows
    // (#1996 put Night Drive ahead of Prism, which split Prism and Pulse Grid
    // across two rows and failed this test without any layout change).
    const cards = panel.locator('[data-asset-row^="viz:"]')
    const prism = cards.nth(0)
    const pulse = cards.nth(1)
    // Aspect-true is a claim about the shader FRAME, not the card: the card box
    // also contains the name + renderer text, and that chrome is a fixed height
    // that does NOT scale with the preview. Measuring the card would compare a
    // ratio polluted by non-scaling chrome — it happens to come out close, which
    // is worse than failing, so measure the thumbnail.
    const prismThumb = panel.locator('img[data-asset-thumb^="viz:"]').nth(0)
    await expect(prism).toBeVisible()
    await expect(pulse).toBeVisible()
    await expect(prismThumb).toBeVisible()

    // At the default height the cards are too wide to share a row → stacked.
    const bigPrism = (await prism.boundingBox())!
    const bigPulse = (await pulse.boundingBox())!
    const bigThumb = (await prismThumb.boundingBox())!
    expect(bigPulse.y).toBeGreaterThan(bigPrism.y + bigPrism.height - 8) // below, not beside

    // Shrink the preview height to its minimum via Settings → the cards narrow…
    await setVizPreviewHeightToMin(page)
    await expect
      .poll(async () => (await prism.boundingBox())!.width)
      .toBeLessThan(bigPrism.width)
    const smallPrism = (await prism.boundingBox())!
    const smallPulse = (await pulse.boundingBox())!
    const smallThumb = (await prismThumb.boundingBox())!

    // …the frame really did shrink, and it kept its aspect (scale, not distort).
    expect(smallThumb.height).toBeLessThan(bigThumb.height)
    const aspect = (b: { width: number; height: number }) => b.width / b.height
    expect(Math.abs(aspect(smallThumb) - aspect(bigThumb))).toBeLessThan(0.05)

    // …and the grid reflows them onto ONE row, side by side.
    expect(Math.abs(smallPrism.y - smallPulse.y)).toBeLessThan(8) // same row
    expect(smallPulse.x).toBeGreaterThan(smallPrism.x + smallPrism.width - 8) // to the right

    await panel.screenshot({ path: 'test-results/viz-library-reflow.png' })
  })

  test('the row action is "Add to workspace", not "Insert"', async ({ page }) => {
    await boot(page)
    const panel = await openLibrary(page)
    await showVizType(page, panel)
    const prism = panel.locator('[data-asset-row="viz:prism"]')
    await prism.hover()
    await expect(prism.locator('[data-asset-insert]')).toHaveAttribute('aria-label', /Add to workspace/)
  })

  test('adding Prism materialises viz_lib/Prism/Prism.glsl and registers it', async ({ page }) => {
    await boot(page)
    // Not present before the add.
    expect(await vizFileId(page, 'Prism')).toBeNull()

    const panel = await openLibrary(page)
    await showVizType(page, panel)
    const prism = panel.locator('[data-asset-row="viz:prism"]')
    await prism.hover()
    await prism.locator('[data-asset-insert]').click()

    // Guiding toast names the destination + how to use it.
    await expect(page.getByText('Added Prism → viz_lib/Prism/. Use .viz("Prism").')).toBeVisible()

    // The file now exists in the workspace as a viz-language file named "Prism"
    // (the predicate the named-viz bridge registers on, so `.viz("Prism")`
    // resolves). Its exact path (`viz_lib/Prism/Prism.glsl`) is proven by the
    // `planVizLibFiles` unit test + the toast above.
    expect(await vizFileId(page, 'Prism')).not.toBeNull()

    // The added file auto-opens as the active editor tab (desired UX — the user
    // lands on the shader they just added).
    await expect(
      page.locator('[data-workspace-tab][data-tab-active="true"]'),
    ).toContainText('Prism.glsl')

    // The add (which churns the provider list via `notifyAssetProvidersChanged`)
    // must NOT bounce the Type filter off Viz — the row stays put.
    await expect(panel.locator('[data-filter="asset-type-filter"] button[data-chip="viz"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(prism).toBeVisible()
  })

  test('adding Pulse Grid (a name with a space) materialises + is recognised', async ({ page }) => {
    await boot(page)
    expect(await vizFileId(page, 'Pulse Grid')).toBeNull()

    const panel = await openLibrary(page)
    await showVizType(page, panel)
    const pulse = panel.locator('[data-asset-row="viz:pulse-grid"]')
    await pulse.hover()
    await pulse.locator('[data-asset-insert]').click()

    await expect(
      page.getByText('Added Pulse Grid → viz_lib/Pulse Grid/. Use .viz("Pulse Grid").'),
    ).toBeVisible()
    // The spaced folder/file path resolves as a viz-language file named
    // "Pulse Grid" (so `.viz("Pulse Grid")` registers) — the one thing that
    // could differ from Prism.
    expect(await vizFileId(page, 'Pulse Grid')).not.toBeNull()
  })

  test('lists the film sketches, the p5 ones under P5 (#1992)', async ({ page }) => {
    await boot(page)
    const panel = await openLibrary(page)
    await showVizType(page, panel)

    for (const [id, name, group] of [
      ['night-drive', 'Night Drive', 'GLSL'],
      ['tunnel', 'Tunnel', 'GLSL'],
      ['robot-guitarist', 'Robot Guitarist', 'P5'],
      ['sunset-drive', 'Sunset Drive', 'P5'],
    ]) {
      const row = panel.locator(`[data-asset-row="viz:${id}"]`)
      await expect(row, name).toBeVisible()
      await expect(row).toContainText(name)
      await expect(row).toContainText(group)
    }
  })

  test('adding Sunset Drive (the first p5 package) materialises + is recognised (#1992)', async ({ page }) => {
    await boot(page)
    expect(await vizFileId(page, 'Sunset Drive')).toBeNull()

    const panel = await openLibrary(page)
    await showVizType(page, panel)
    const sunset = panel.locator('[data-asset-row="viz:sunset-drive"]')
    await sunset.hover()
    await sunset.locator('[data-asset-insert]').click()

    await expect(
      page.getByText('Added Sunset Drive → viz_lib/Sunset Drive/. Use .viz("Sunset Drive").'),
    ).toBeVisible()
    // A `.p5` file is recognised as a viz-language file by the same predicate
    // the named-viz bridge registers on, as the `.glsl` packages are.
    expect(await vizFileId(page, 'Sunset Drive')).not.toBeNull()
  })

  test('adding the same package twice is idempotent (no duplicate)', async ({ page }) => {
    await boot(page)
    const panel = await openLibrary(page)
    await showVizType(page, panel)
    const prism = panel.locator('[data-asset-row="viz:prism"]')

    await prism.hover()
    await prism.locator('[data-asset-insert]').click()
    await expect(page.getByText('Added Prism → viz_lib/Prism/. Use .viz("Prism").')).toBeVisible()

    // Second add — the stable workspace id means it's already there.
    await prism.hover()
    await prism.locator('[data-asset-insert]').click()
    await expect(page.getByText('Prism is already in your workspace.')).toBeVisible()
  })
})
