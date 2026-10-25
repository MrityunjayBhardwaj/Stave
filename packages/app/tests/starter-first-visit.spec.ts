/**
 * #2240 — what a first visit looks like: the outrun sketch, Sunset Drive behind
 * it before anything plays, Sunset Drive's code open in a second tab, and once
 * it plays, the bass's piano roll and the lead's scope at one height, the knob
 * in the bass line, and no errors.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp } from './_appBoot'
import { vizPixelStats } from './_vizFrames'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

const zoneHeights = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-viz-zone]')].map((z) => [
        z.getAttribute('data-viz-zone-track'),
        (z as HTMLElement).offsetHeight,
      ]),
    ),
  )

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await bootApp(page, { e2eHooks: true })
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
})

test('a first visit opens the song with Sunset Drive behind it and beside it', async ({ page }) => {
  const tabs = page.locator('[data-workspace-tab]')
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(0)).toContainText('pattern.strudel')
  await expect(tabs.nth(1)).toContainText('Sunset Drive.p5')
  // pinned, so it is there before anything plays — and drawing: its hot-pink
  // horizon and sun fill ~11% of the backdrop at 1280×800, ~0.1% once cleared
  await expect(page.getByText('bg: Sunset Drive')).toBeVisible()
  await expect(page.locator('[data-workspace-background]')).toHaveAttribute('data-background-file-id', /^vizlib_sunset-drive_/)
  const pink = async () =>
    (await vizPixelStats(page, '[data-workspace-background]', { rMin: 200, gMax: 120, bMin: 80, bMax: 220 })).frac
  await expect.poll(pink, { timeout: 15_000 }).toBeGreaterThan(0.03)
  const code = await page.evaluate(() =>
    (window as any).monaco.editor.getEditors().find((e: any) => e.getModel()?.getLanguageId?.() === 'strudel')?.getModel().getValue()) // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(code).toContain('// Welcome to Stave!')
})

test('playing it: the two inline visuals at one height, the knob, no errors', async ({ page }) => {
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${MOD}+Enter`)
  await expect.poll(() => zoneHeights(page), { timeout: 15_000 }).toEqual(expect.objectContaining({ bass: expect.any(Number), lead: expect.any(Number) }))
  const h = await zoneHeights(page)
  // both pre-set to 160; the piano roll's own fit-to-width height is the lower bound
  expect(h.lead).toBe(160)
  expect(h.bass).toBeGreaterThanOrEqual(150)
  expect(h.bass).toBeLessThanOrEqual(160)
  await expect(page.locator('input[type="range"]').first()).toBeVisible()
  await page.waitForTimeout(2000)
  const errors = await page.evaluate(() =>
    ((window as any).__staveGetLog?.() ?? []).filter((e: any) => e.level === 'error').map((e: any) => e.message)) // eslint-disable-line @typescript-eslint/no-explicit-any
  // the dev server sometimes fails to hand the viz worker a chunk; that is the
  // dev server, seen on main too, not the sketch
  expect(errors.filter((m: string) => !/importScripts/.test(m))).toEqual([])
  await page.keyboard.press(`${MOD}+Period`)
})
