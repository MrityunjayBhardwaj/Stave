import { test, expect, type Page } from '@playwright/test'
import { gzipSync } from 'node:zlib'

// #2322 — ✎ (Edit viz file) on an inline `.viz("fold")` opened `fold.strudel`,
// a PATTERN sharing the visual's name, instead of the `Fold.p5` sketch the zone
// was drawing: the lookup matched any file by basename and took the first.
// It now opens the file behind the zone's preset (or, while that is still
// unresolved, the viz file the renderer registers under the name).

const SKETCH = `function setup() { createCanvas(400, 200) }
function draw() { background(20, 40, 160) }
`
const PATTERN = `$: note("c3 e3 g3").s("sawtooth").viz("fold")
`

/** A `#share=` link carrying a pattern and a sketch that share a basename. */
function shareHash(): string {
  const manifest = {
    schemaVersion: 1,
    project: { name: 'Edit viz name clash', sharedAt: Date.now() },
    files: [
      // the pattern FIRST in the list — the order the old lookup tripped on
      { id: 'clash-track', path: 'fold.strudel', language: 'strudel', content: PATTERN },
      { id: 'clash-viz', path: 'Fold.p5', language: 'p5js', content: SKETCH },
    ],
    fileOrder: { '': ['clash-track', 'clash-viz'] },
    subfolderOrder: {},
  }
  const b64 = gzipSync(Buffer.from(JSON.stringify(manifest))).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `#share=${b64}`
}

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function openClashAndPlay(page: Page): Promise<void> {
  page.on('dialog', (d) => d.accept())
  await page.goto(`/${shareHash()}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 60_000 })
  await page.getByText('fold.strudel', { exact: true }).first().click()
  await expect(activeTab(page)).toHaveText(/fold\.strudel/, { timeout: 15_000 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window as any).monaco?.editor?.getEditors?.()?.[0]?.focus())
  await page.keyboard.press(`${MOD}+Enter`)
  await expect(page.locator('[data-viz-zone-track]').first()).toBeVisible({ timeout: 15_000 })
}

function activeTab(page: Page) {
  return page.locator('[data-workspace-tab][data-tab-active="true"]').first()
}

/** Hover the zone — the action bar takes its viz id from the mouse move. */
async function hoverZone(page: Page): Promise<void> {
  const box = await page.locator('[data-viz-zone-track]').first().boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.move(box!.x + box!.width / 2 + 5, box!.y + box!.height / 2 + 5)
  await expect(page.locator('[data-viz-actions]')).toHaveAttribute('data-viz-id', 'fold')
}

test('✎ opens the sketch the zone draws, not the pattern sharing its name', async ({ page }) => {
  await openClashAndPlay(page)
  await hoverZone(page)
  // the zone resolved its preset — the sketch's — before the click
  await expect(page.locator('[data-viz-actions]')).toHaveAttribute('data-preset-id', 'user_Fold')
  await page.locator('button[title="Edit viz file"]').first().click()
  await expect(activeTab(page)).toHaveText(/Fold\.p5/, { timeout: 5_000 })
  // nothing was renamed along the way
  await expect(page.locator('[data-workspace-tab]', { hasText: 'fold.strudel' })).toHaveCount(1)
})

test('✎ before the preset resolves still opens the sketch, by name', async ({ page }) => {
  await openClashAndPlay(page)
  await hoverZone(page)
  // the async preset lookup can lose the race with a fast click — the bar
  // then carries no preset id and the name decides
  await page.locator('[data-viz-actions]').evaluate((el) => el.setAttribute('data-preset-id', ''))
  await page.locator('button[title="Edit viz file"]').first().click()
  await expect(activeTab(page)).toHaveText(/Fold\.p5/, { timeout: 5_000 })
})
