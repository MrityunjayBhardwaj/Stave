import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

import { bootApp, editorValue, seedCode } from './_appBoot'
import type { AssetProbe } from '../src/e2e/assetProbe'

/**
 * #2231 — a project is saved as `<name>.stave`, and `.zip` archives still open.
 *
 * The file is the same zip as before (a `stave.json` manifest, the files, and
 * `assets/`); only its name changed. So each arm checks what comes BACK: the
 * code of the project's file, and its take, both its record and its bytes.
 * Before each import the asset store is wiped, the way a second machine has
 * none of the takes, so the bytes found afterwards came out of the file.
 *
 * `project-before-2231.zip` was exported by main at aef32c66 (the exporter
 * before #2231, unchanged apart from the download name) from a project whose
 * `pattern.strudel` holds FIXTURE_CODE and which has one take, `fixture_take`.
 */

const FIXTURE = path.join(__dirname, 'fixtures', 'project-before-2231.zip')
const FIXTURE_CODE = 's("bd ~ sd ~").gain(0.8) // project-file fixture, exported before #2231'
const FIXTURE_TAKE = 'fixture_take'
const FIXTURE_HASH = 'a5380431d916578b3eb005ce13a493f093bbf0e04646a99245df0488eb512f4b'

/** What the page holds before an import, so an arm can tell the import changed it. */
const OTHER_CODE = 's("hh*8") // not the imported project'

declare global {
  interface Window {
    __staveAssetProbe?: AssetProbe
  }
}

async function boot(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 })
  await bootApp(page, { e2eHooks: true })
  await page.waitForFunction(() => Boolean(window.__staveAssetProbe), { timeout: 30_000 })
}

/** A short mono wav, authored here. */
function wavBase64(seconds: number, freq: number, rate = 22050): string {
  const frames = Math.round(seconds * rate)
  const buf = Buffer.alloc(44 + frames * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + frames * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(frames * 2, 40)
  for (let i = 0; i < frames; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 0.4 * 32767), 44 + i * 2)
  }
  return buf.toString('base64')
}

/** The take's record name and whether its bytes are in the store. */
async function take(page: Page, name: string): Promise<{ named: boolean; bytes: boolean }> {
  return page.evaluate(async (n) => {
    const p = window.__staveAssetProbe!
    const record = (await p.docList()).find((r) => r.name === n)
    if (!record) return { named: false, bytes: false }
    const hashes = (await p.list()).map((a) => a.hash)
    return { named: true, bytes: hashes.includes(record.blobHash) }
  }, name)
}

/** Wipe the take's bytes, the way a second machine has none of them. */
async function forgetAssets(page: Page): Promise<void> {
  await page.evaluate(() => window.__staveAssetProbe!.reset())
}

/** Drop desktop files on the sidebar's file list, the way a Finder drag does. */
async function dropOnSidebar(page: Page, files: Array<{ name: string; base64: string }>): Promise<void> {
  await page.evaluate((list) => {
    const target = document.querySelector('[data-sidebar] > div:nth-child(2)')!
    const dt = new DataTransfer()
    for (const f of list) {
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))
      dt.items.add(new File([bytes], f.name))
    }
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
    }
  }, files)
}

/**
 * The newest toast that isn't the global error catch's. A viz worker closed while it
 * loads can toast an unrelated `Uncaught …` error during boot (#2245); an import that
 * fails still shows its own message here.
 */
async function lastToast(page: Page): Promise<string> {
  const toast = page.locator('[data-testid="toast"]').filter({ hasNotText: /^Uncaught / }).last()
  await toast.waitFor()
  return (await toast.textContent()) ?? ''
}

const pickerInput = (page: Page) => page.locator('input[type="file"][accept*=".stave"]')

test.describe('project files (#2231)', () => {
  test('Export as .stave downloads <name>.stave holding stave.json, the code and the take', async ({ page }) => {
    await boot(page)
    const code = 's("bd sd").room(0.2) // exported as .stave'
    await seedCode(page, code)
    await page.evaluate(async (b64) => {
      const p = window.__staveAssetProbe!
      const { record } = await p.import(b64, 'audio/wav', 'my-take.wav', await p.docList())
      await p.docAdd(record)
    }, wavBase64(0.25, 440))
    await expect.poll(() => take(page, 'my_take')).toEqual({ named: true, bytes: true })

    await page.getByRole('button', { name: 'File', exact: true }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.locator('[data-stave-menu-item]', { hasText: 'Export as .stave' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.stave$/)

    const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()))
    const manifest = JSON.parse(await zip.file('stave.json')!.async('string'))
    expect(manifest.schemaVersion).toBe(1)
    const strudel = manifest.files.find((f: { language: string }) => f.language === 'strudel')
    expect(await zip.file(strudel.path)!.async('string')).toBe(code)
    const record = manifest.assets.find((a: { name: string }) => a.name === 'my_take')
    expect(zip.file(`assets/${record.blobHash}`)).not.toBeNull()

    // …and the same file opens through the picker, on a machine without the take.
    await seedCode(page, OTHER_CODE)
    await forgetAssets(page)
    await pickerInput(page).setInputFiles({
      name: download.suggestedFilename(),
      mimeType: 'application/zip',
      buffer: fs.readFileSync(await download.path()),
    })
    expect(await lastToast(page)).toMatch(/^Imported /)
    await expect.poll(() => editorValue(page)).toBe(code)
    await expect.poll(() => take(page, 'my_take')).toEqual({ named: true, bytes: true })
  })

  test('a .stave file opens through the picker', async ({ page }) => {
    await boot(page)
    await seedCode(page, OTHER_CODE)
    await forgetAssets(page)
    await pickerInput(page).setInputFiles({
      name: 'My Song.stave',
      mimeType: '',
      buffer: fs.readFileSync(FIXTURE),
    })
    expect(await lastToast(page)).toMatch(/^Imported Untitled/)
    await expect.poll(() => editorValue(page)).toBe(FIXTURE_CODE)
    await expect.poll(() => take(page, FIXTURE_TAKE)).toEqual({ named: true, bytes: true })
  })

  test('a .zip exported before .stave still opens through the picker', async ({ page }) => {
    await boot(page)
    await seedCode(page, OTHER_CODE)
    await forgetAssets(page)
    await pickerInput(page).setInputFiles(FIXTURE)
    expect(await lastToast(page)).toMatch(/^Imported Untitled/)
    await expect.poll(() => editorValue(page)).toBe(FIXTURE_CODE)
    await expect.poll(() => take(page, FIXTURE_TAKE)).toEqual({ named: true, bytes: true })
    expect(await page.evaluate(() => window.__staveAssetProbe!.list().then((l) => l.map((a) => a.hash)))).toContain(FIXTURE_HASH)
  })

  test('a .stave file dropped on the sidebar opens as a project', async ({ page }) => {
    await boot(page)
    await seedCode(page, OTHER_CODE)
    await forgetAssets(page)
    await dropOnSidebar(page, [{ name: 'My Song.stave', base64: fs.readFileSync(FIXTURE).toString('base64') }])
    expect(await lastToast(page)).toMatch(/^Imported Untitled/)
    await expect.poll(() => editorValue(page)).toBe(FIXTURE_CODE)
    await expect.poll(() => take(page, FIXTURE_TAKE)).toEqual({ named: true, bytes: true })
  })

  test('a stems .zip dropped on the sidebar is not taken for a project', async ({ page }) => {
    await boot(page)
    await seedCode(page, OTHER_CODE)
    const stems = new JSZip()
    stems.file('01-drums.wav', Buffer.from(wavBase64(0.1, 220), 'base64'))
    const bytes = await stems.generateAsync({ type: 'nodebuffer' })
    await dropOnSidebar(page, [{ name: 'Untitled-stems.zip', base64: bytes.toString('base64') }])
    expect(await lastToast(page)).toContain('Not a Stave archive')
    await page.waitForTimeout(500)
    expect(await editorValue(page)).toBe(OTHER_CODE)
  })
})
