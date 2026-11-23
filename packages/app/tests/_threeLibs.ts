/**
 * Shared by the library specs (#2639, #2643): open a project the way a shared
 * one arrives (a `#share=` link, then Import), play its pattern so its `.three`
 * sketch mounts, and collect what the sketch reported plus the Console's three
 * rows.
 *
 * A sketch reports by posting on the `stave-test-libs` BroadcastChannel (a
 * worker's console doesn't always reach the test in Firefox).
 */
import { expect, chromium, firefox, webkit, type Page, type BrowserContext, type TestInfo } from '@playwright/test'
import zlib from 'node:zlib'

export const ENGINES = { chromium, firefox, webkit } as const
export type EngineName = keyof typeof ENGINES
export type Mode = 'worker' | 'main'

export interface ProjectFile {
  id: string
  path: string
  language: string
  content: string
}

export interface ConsoleRow {
  level: string
  message: string
  line?: number
}

/** The `#share=` fragment for a project holding `files`. */
export function shareHash(name: string, files: ProjectFile[]): string {
  const manifest = { schemaVersion: 1, project: { name, sharedAt: Date.now() }, files, fileOrder: { '': files.map((f) => f.id) }, subfolderOrder: {} }
  return zlib.gzipSync(Buffer.from(JSON.stringify(manifest))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Open `files` as a shared project and Import it; the file tree then shows them. */
export async function openShared(page: Page, mode: Mode, name: string, files: ProjectFile[]): Promise<void> {
  page.on('dialog', (d) => d.accept())
  await page.addInitScript((m: Mode) => {
    const w = window as unknown as { __STAVE_E2E__?: boolean; __libResults?: unknown[] }
    w.__STAVE_E2E__ = true
    w.__libResults = []
    new BroadcastChannel('stave-test-libs').onmessage = (e) => w.__libResults!.push(e.data)
    try {
      localStorage.setItem('stave.viz.worker', m === 'main' ? '0' : '1')
    } catch {
      /* ignore */
    }
  }, mode)
  await page.goto(`/#share=${shareHash(name, files)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 120_000 })
  await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 120_000 })
  await expect(page.locator('[data-file-tree-item]').filter({ hasText: files[0].path }).first()).toBeVisible({ timeout: 30_000 })
}

/** Open the pattern file and press Play; wait until the sketch reports or the Console has a three row. */
export async function playPattern<T>(page: Page, patternPath: string, waitMs = 60_000): Promise<{ results: T[]; rows: ConsoleRow[] }> {
  await page.locator('[data-file-tree-item]').filter({ hasText: patternPath }).first().dblclick()
  await page.waitForTimeout(1500)
  await page.locator('[data-strudel-runtime-chrome="root"]').getByRole('button', { name: /Play/ }).first().click()
  await expect.poll(async () => (await libResults(page)).length + (await threeRows(page)).length, { timeout: waitMs }).toBeGreaterThan(0).catch(() => {})
  await page.waitForTimeout(1000)
  return { results: (await libResults(page)) as T[], rows: await threeRows(page) }
}

export async function libResults(page: Page): Promise<unknown[]> {
  return page.evaluate(() => ((window as unknown as { __libResults?: unknown[] }).__libResults ?? []).slice())
}

export async function threeRows(page: Page): Promise<ConsoleRow[]> {
  return page.evaluate(() => {
    const get = (window as unknown as { __staveGetLog?: () => Array<{ runtime: string; level: string; message: string; line?: number }> }).__staveGetLog
    return (get?.() ?? []).filter((r) => r.runtime === 'three').map((r) => ({ level: r.level, message: r.message, line: r.line }))
  })
}

/** Launch `engine` with the project's base URL (a describe can't switch engines). */
export async function onEngine(engine: EngineName, info: TestInfo, fn: (page: Page, context: BrowserContext) => Promise<void>): Promise<void> {
  const browser = await ENGINES[engine].launch()
  try {
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1440, height: 900 } })
    await fn(await context.newPage(), context)
  } finally {
    await browser.close()
  }
}

/** Sketch source: count the red pixels on the renderer's own context (call after rendering). */
export const COUNT_RED = `const countRed = (renderer) => {
  const gl = renderer.getContext(); const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
  const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
  let red = 0, lit = 0; for (let i = 0; i < px.length; i += 4) { if (px[i] > 60 && px[i + 1] < 40) red++; if (px[i] + px[i + 1] + px[i + 2] > 60) lit++ }
  return { red, lit, of: w * h }
}
const realm = typeof WorkerGlobalScope !== 'undefined' ? 'worker' : 'main'
const report = (r) => { new BroadcastChannel('stave-test-libs').postMessage({ realm, ...r }); console.log('[lib] ' + JSON.stringify(r)) }
`
