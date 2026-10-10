/**
 * Viz-library thumbnail BAKER (#836) — a one-shot tool, not a regression gate.
 *
 * Baked thumbnails let a curated viz package ship a representative frame of the
 * running shader (see `assetLibrary/vizLibrary.ts` `VizLibItem.thumbnail`). We
 * capture that frame the ONLY reliable way for worker-offloaded GLSL: through
 * the COMPOSITOR (`page.screenshot({ clip })`), the last presented frame — never
 * a WebGL canvas readback, which false-positives / blanks on the worker path
 * (PV90). The captured raster is then downscaled to a 64px-tall PNG that
 * PRESERVES the shader's native aspect (the card shows it height-locked,
 * left-aligned) via a plain 2D canvas (a re-encode of an already-rasterised
 * image — no GL readback) and written straight into `vizThumbnails.data.ts`.
 *
 * Because it needs the real GPU it is gated (like the other viz gates) and runs
 * HEADED on real hardware:
 *   E2E_VERIFY=1 pnpm --filter @stave/app exec playwright test viz-thumbnails.bake --headed --workers=1 --timeout=180000
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/** The packages to bake: row id (→ `viz:<id>`) and the `.viz("<name>")` token. */
const PACKAGES = [
  { id: 'prism', name: 'Prism' },
  { id: 'pulse-grid', name: 'Pulse Grid' },
  { id: 'rain-drive', name: 'Rain Drive' },
  { id: 'tunnel', name: 'Tunnel' },
  { id: 'robot-guitarist', name: 'Robot Guitarist' },
  { id: 'sunset-drive', name: 'Sunset Drive' },
]

/** Baked thumbnail HEIGHT (px). The card renders it height-locked with the
 *  shader's native aspect; 64 gives retina crispness at the ~64px display. */
const THUMB_H = 64
/** Safety cap on baked width so a very wide viz zone can't produce a monster
 *  data-URI / overflow the 260px sidebar (crops width, never squishes). */
const THUMB_MAXW = 220

/** The generated `vizThumbnails.data.ts` source, from the baked id→data-URI map. */
function renderDataModule(thumbs: Record<string, string>): string {
  const entries = Object.entries(thumbs)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join('\n')
  return (
    `/**\n` +
    ` * BAKED viz-library thumbnails (#836) — GENERATED, do not hand-edit.\n` +
    ` *\n` +
    ` * Each value is a representative frame of the running shader, captured through\n` +
    ` * the compositor and downscaled to a ${THUMB_H}px-tall (aspect-preserved) PNG data-URI by the baker spec\n` +
    ` * (\`tests/viz-thumbnails.bake.spec.ts\`). Keyed by \`VizLibItem.id\`. Regenerate\n` +
    ` * (and re-commit this file) with:\n` +
    ` *   E2E_VERIFY=1 pnpm --filter @stave/app exec playwright test viz-thumbnails.bake --headed --workers=1\n` +
    ` * A package with no entry here falls back to a renderer-hued placeholder tile\n` +
    ` * (see \`vizThumbnail.ts\`).\n` +
    ` */\n` +
    `export const BAKED_VIZ_THUMBNAILS: Record<string, string> = {\n` +
    `${entries}\n};\n`
  )
}

async function open(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    ;(window as any).__STAVE_E2E__ = true
    try {
      localStorage.setItem('stave.viz.worker', '1') // realistic worker path
    } catch {
      /* ignore */
    }
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(2500) // startup seed + registerAllVizFiles (mount)
  return { ctx, page }
}

/** Add a package from the Viz library — the runtime "Add to workspace" path
 *  registers it as a named viz — then switch back to the pattern editor. */
async function addPackage(page: Page, id: string, name: string): Promise<void> {
  // The ActivityBar button TOGGLES the panel — only click it to OPEN (it stays
  // open across packages, so a second click would close it).
  const panel = page.locator('[data-asset-library]')
  if (!(await panel.isVisible())) {
    await page.locator('[data-activity-bar] button[aria-label="Library"]').click()
    await panel.waitFor({ timeout: 10000 })
  }
  // Ensure the Viz type filter is active and the row is rendered. Adding a
  // package churns the provider list, which can bounce the type filter off Viz
  // and race a single click — so re-click until the row appears (a set type
  // filter skips other providers' rows entirely, filter.ts).
  const row = panel.locator(`[data-asset-row="viz:${id}"]`)
  const vizChip = panel.locator('[data-filter="asset-type-filter"] button[data-chip="viz"]')
  for (let attempt = 0; attempt < 5; attempt++) {
    await vizChip.click().catch(() => {})
    try {
      await row.waitFor({ state: 'visible', timeout: 2000 })
      break
    } catch {
      await page.waitForTimeout(500)
    }
  }
  await row.hover()
  await row.locator('[data-asset-insert]').click()
  await page.getByText(`Use .viz("${name}").`).waitFor({ timeout: 5000 })
  await page.waitForTimeout(400) // file-list → registerAllVizFiles
  await page.locator('[data-workspace-tab="tab-pattern.strudel"]').click()
  await page.waitForTimeout(300)
}

async function setCode(page: Page, code: string): Promise<void> {
  const ok = await page.evaluate((c) => {
    const e = (window as any).monaco?.editor?.getEditors?.()?.[0]
    if (!e) return false
    e.getModel()?.setValue(c)
    return true
  }, code)
  expect(ok).toBe(true)
  await page.waitForTimeout(250)
}

async function evalCode(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).monaco?.editor?.getEditors?.()?.[0]?.focus())
  await page.keyboard.press(`${MOD}+Enter`)
}

/**
 * Capture the liveliest compositor frame of the inline viz canvas, centre-crop
 * to a square, downscale to THUMB², return a `data:image/png` URI. "Liveliest" =
 * the largest PNG across a short burst — a busier (more-lit) frame compresses to
 * more bytes, which for Pulse Grid picks a frame on a pulse rather than a lull.
 */
async function bakeThumb(page: Page): Promise<string> {
  const canvas = page.locator('[data-viz-zone] canvas').first()
  await canvas.waitFor({ timeout: 15000 })
  const box = await canvas.boundingBox()
  if (!box) throw new Error('no viz canvas boundingBox')

  let bestB64 = ''
  let bestLen = 0
  for (let i = 0; i < 8; i++) {
    const buf = await page.screenshot({ clip: box }).catch(() => Buffer.from([]))
    if (buf.length > bestLen) {
      bestLen = buf.length
      bestB64 = buf.toString('base64')
    }
    await page.waitForTimeout(120)
  }
  if (bestLen < 1000) throw new Error(`viz frame looks blank (${bestLen}B)`)

  // Re-encode the rasterised PNG through a 2D canvas — downscale to a fixed
  // HEIGHT, preserving the shader's native aspect (no square crop). If the
  // result would exceed the width cap, centre-crop width (never squish).
  return page.evaluate(
    async ({ b64, h, maxW }) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const scale = h / img.height
      const fullW = Math.max(1, Math.round(img.width * scale))
      const w = Math.min(maxW, fullW)
      // Source rect: centre-crop width when capped so aspect stays true.
      const srcW = Math.round(w / scale)
      const sx = Math.max(0, Math.round((img.width - srcW) / 2))
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, sx, 0, srcW, img.height, 0, 0, w, h)
      return c.toDataURL('image/png')
    },
    { b64: bestB64, h: THUMB_H, maxW: THUMB_MAXW },
  )
}

test.describe('#836 viz thumbnail baker', () => {
  test.skip(!process.env.E2E_VERIFY, 'bake tool — set E2E_VERIFY=1')

  test('bake a frame for each curated viz package', async ({ browser }) => {
    const { ctx, page } = await open(browser)
    const thumbs: Record<string, string> = {}
    try {
      for (const pkg of PACKAGES) {
        await addPackage(page, pkg.id, pkg.name)
        await setCode(page, `$: s("bd*4, ~ sd, hh*8").bank("RolandTR909").viz('${pkg.name}')`)
        await evalCode(page)
        await page.waitForTimeout(3500) // let it warm + animate
        await page.evaluate(() =>
          (window as any).monaco?.editor?.getEditors?.()?.[0]?.setScrollTop(0),
        ) // keep the inline zone on-screen (PV78)
        await page.waitForTimeout(800)

        const uri = await bakeThumb(page)
        thumbs[pkg.id] = uri
        console.log(`[#836] baked ${pkg.id}: ${uri.length}B data-URI`)
        expect(uri.startsWith('data:image/png')).toBe(true)

        // Clear the editor before the next package so zones don't stack.
        await setCode(page, '$: silence')
        await evalCode(page)
        await page.waitForTimeout(600)
      }
      writeFileSync('test-results/viz-thumbs.json', JSON.stringify(thumbs, null, 2))
      // Emit the generated data module directly so regeneration is one command:
      // run this spec, then commit `vizThumbnails.data.ts`. No manual paste step.
      writeFileSync('src/assetLibrary/vizThumbnails.data.ts', renderDataModule(thumbs))
      console.log(`[#836] wrote src/assetLibrary/vizThumbnails.data.ts (${Object.keys(thumbs).join(', ')})`)
      expect(Object.keys(thumbs)).toEqual(PACKAGES.map((p) => p.id))
    } finally {
      await ctx.close()
    }
  })
})
