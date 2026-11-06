import { test, expect, type Page } from '@playwright/test'
import { gzipSync } from 'node:zlib'

// #2412 — re-opening ✂ on an inline viz strip showed the full canvas instead
// of the crop just saved, and a crop saved from that second popup went to a
// different file's crop store (toast said saved, strip unchanged). Saving a
// crop rebuilds the zones, and the rebuild carried the crop handler from the
// editor's FIRST render, whose idea of "the file" was stale.

const SKETCH = `function setup() { createCanvas(stave.width, stave.height) }
function draw() {
  noStroke()
  fill(220, 40, 40); rect(0, 0, width / 2, height / 2)
  fill(40, 180, 40); rect(width / 2, 0, width / 2, height / 2)
  fill(40, 80, 220); rect(0, height / 2, width / 2, height / 2)
  fill(230, 200, 30); rect(width / 2, height / 2, width / 2, height / 2)
}
`
const PATTERN = `$: note("c3 e3 g3").s("sine").gain(.2).viz("RecropProbe")
`

/** A `#share=` link: one sketch, two pattern files that both draw it. */
function shareHash(): string {
  const manifest = {
    schemaVersion: 1,
    project: { name: 'Recrop probe', sharedAt: Date.now() },
    files: [
      { id: 'recrop-viz', path: 'RecropProbe.p5', language: 'p5js', content: SKETCH },
      { id: 'recrop-a', path: 'recropa.strudel', language: 'strudel', content: PATTERN },
      { id: 'recrop-b', path: 'recropb.strudel', language: 'strudel', content: PATTERN },
    ],
    fileOrder: { '': ['recrop-viz', 'recrop-a', 'recrop-b'] },
    subfolderOrder: {},
  }
  const b64 = gzipSync(Buffer.from(JSON.stringify(manifest))).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `#share=${b64}`
}

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

function activeTab(page: Page) {
  return page.locator('[data-workspace-tab][data-tab-active="true"]').first()
}

async function openFile(page: Page, name: string): Promise<void> {
  await page.getByText(name, { exact: true }).last().click()
  await expect(activeTab(page)).toHaveText(new RegExp(name.replace('.', '\\.')), { timeout: 15_000 })
}

async function play(page: Page): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window as any).monaco?.editor?.getEditors?.()?.[0]?.focus())
  await page.keyboard.press(`${MOD}+Enter`)
  await expect(page.locator('[data-viz-zone-track] canvas').first()).toBeVisible({ timeout: 20_000 })
}

async function stop(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Stop/ }).first().click()
}

/** The strip's crop, as the canvas wrapper's transform shows it. */
async function stripTransform(page: Page): Promise<string> {
  return page.locator('[data-viz-zone-track] [data-viz-canvas-wrap]').first()
    .evaluate((el) => (el as HTMLElement).style.transform)
}

/** Hover the strip and press ✂; returns the popup's x/y/w/h readout. */
async function openCrop(page: Page): Promise<string> {
  const box = await page.locator('[data-viz-zone-track]').first().boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.move(box!.x + box!.width / 2 + 5, box!.y + box!.height / 2 + 5)
  await expect(page.locator('[data-viz-actions]')).toHaveAttribute('data-viz-id', 'RecropProbe')
  await page.locator('[data-viz-actions] button').nth(1).click()
  await expect(page.getByTestId('crop-handle-nw')).toBeVisible({ timeout: 10_000 })
  return readout(page)
}

async function readout(page: Page): Promise<string> {
  return page.getByTestId('crop-handle-nw').evaluate((h) => {
    const preview = h.parentElement!.parentElement!
    return Array.from(preview.parentElement!.querySelectorAll('span'))
      .map((s) => s.textContent ?? '').filter((t) => /^[xywh]:/.test(t)).join(' ')
  })
}

/** Drag one edge of the crop box to a fraction of the preview. */
async function dragEdge(page: Page, edge: 'w' | 'e' | 'n', to: number): Promise<void> {
  const geo = await page.getByTestId('crop-handle-nw').evaluate((h) => {
    const visor = h.parentElement!, preview = visor.parentElement!
    const p = preview.getBoundingClientRect(), v = visor.getBoundingClientRect()
    return { p: { x: p.x, y: p.y, w: p.width, h: p.height }, v: { x: v.x, y: v.y, w: v.width, h: v.height } }
  })
  const { p, v } = geo
  let sx: number, sy: number, tx: number, ty: number
  if (edge === 'w') { sx = v.x; sy = v.y + v.h / 2; tx = p.x + to * p.w; ty = sy }
  else if (edge === 'e') { sx = v.x + v.w; sy = v.y + v.h / 2; tx = p.x + to * p.w; ty = sy }
  else { sx = v.x + v.w / 2; sy = v.y; tx = sx; ty = p.y + to * p.h }
  const ix = edge === 'w' ? 1 : edge === 'e' ? -1 : 0
  const iy = edge === 'n' ? 1 : 0
  await page.mouse.move(sx + ix * 6, sy + iy * 6, { steps: 3 })
  await page.mouse.move(sx + ix, sy + iy, { steps: 2 })
  await page.mouse.down()
  await page.mouse.move(tx, ty, { steps: 10 })
  await page.mouse.up()
}

async function saveCrop(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save Crop' }).click()
  await expect(page.getByTestId('crop-handle-nw')).toHaveCount(0)
}

test('✂ re-opens at the saved crop, a second crop applies, and Stop/Play keeps it — on the file the strip belongs to', async ({ page }) => {
  test.setTimeout(120_000)
  page.on('dialog', (d) => d.accept())
  await page.goto(`/${shareHash()}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 60_000 })

  // Visit A first, then crop on B: the strip's own file must take the crop.
  await openFile(page, 'recropa.strudel')
  await openFile(page, 'recropb.strudel')
  await play(page)
  const full = await stripTransform(page)

  // First crop: the bottom-right quarter.
  expect(await openCrop(page)).toBe('x: 0% y: 0% w: 100% h: 100%')
  await dragEdge(page, 'w', 0.5)
  await dragEdge(page, 'n', 0.5)
  const firstCrop = await readout(page)
  expect(firstCrop).not.toBe('x: 0% y: 0% w: 100% h: 100%')
  await saveCrop(page)
  await expect.poll(() => stripTransform(page)).not.toBe(full)
  const firstStrip = await stripTransform(page)

  // Re-open: the popup starts from the crop just saved, not the full canvas.
  expect(await openCrop(page)).toBe(firstCrop)

  // Second crop: narrow it further. The strip must change.
  await dragEdge(page, 'e', 0.75)
  const secondCrop = await readout(page)
  expect(secondCrop).not.toBe(firstCrop)
  await saveCrop(page)
  await expect.poll(() => stripTransform(page)).not.toBe(firstStrip)
  const secondStrip = await stripTransform(page)

  // Stop → Play rebuilds the zones from the stored crop: still the second one.
  await stop(page)
  await play(page)
  await expect.poll(() => stripTransform(page)).toBe(secondStrip)
  expect(await openCrop(page)).toBe(secondCrop)
  await page.keyboard.press('Escape')

  // File A was never cropped: its strip draws the full canvas.
  await stop(page)
  await openFile(page, 'recropa.strudel')
  await play(page)
  await expect.poll(() => stripTransform(page)).toBe(full)
})
