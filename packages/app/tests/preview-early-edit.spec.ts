/**
 * #2217 — an edit made the moment an editor is created reaches the file.
 *
 * Opening a preview to the side re-creates the file's editor. The Monaco wrapper
 * creates the editor in one React commit and only subscribes to its changes in
 * the next, so an edit in between showed in the editor but never reached the
 * file: the preview kept running the old code until the next edit.
 *
 * The edit is made from Monaco's own "editor created" event, queued as a
 * microtask: that runs after the commit that created the editor and before
 * React's next one, so it lands in the gap every time rather than by timing.
 * The preview runs `osc(10).out()` only if the file got it, and that code
 * throws (Hydra's functions are on `s`), so a Hydra row in the log is the proof.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp } from './_appBoot'

const hydraRows = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    ((window as any).__staveGetLog?.() ?? []) // eslint-disable-line @typescript-eslint/no-explicit-any
      .filter((e: any) => e.runtime === 'hydra') // eslint-disable-line @typescript-eslint/no-explicit-any
      .map((e: any) => `${e.source}:${e.line}`)) // eslint-disable-line @typescript-eslint/no-explicit-any

/** open kaleidoscope.hydra and its preview beside it; `edit` is set in the re-created editor's first moment */
async function openPreview(page: Page, edit: string | null): Promise<void> {
  await page.locator('[data-file-tree-item*="kaleidoscope"]').first().dblclick()
  await expect.poll(() => page.evaluate(() =>
    (window as any).monaco.editor.getEditors().some((x: any) => x.getModel()?.getLanguageId?.() === 'hydra'))).toBe(true) // eslint-disable-line @typescript-eslint/no-explicit-any
  await page.evaluate((code) => {
    const m = (window as any).monaco // eslint-disable-line @typescript-eslint/no-explicit-any
    const w = window as any // eslint-disable-line @typescript-eslint/no-explicit-any
    w.__earlyEdits = 0
    const sub = m.editor.onDidCreateEditor((e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      sub.dispose()
      if (code === null) return
      queueMicrotask(() => {
        if (e.getModel()?.getLanguageId?.() !== 'hydra') return
        e.getModel().setValue(code)
        w.__earlyEdits++
      })
    })
    const fire = (key: string, meta: boolean) =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, metaKey: meta, ctrlKey: meta }))
    fire('k', true)
    return new Promise((r) => setTimeout(() => { fire('v', false); r(null) }, 16))
  }, edit)
  await expect(page.locator('[data-renderer="hydra"]')).toHaveCount(1, { timeout: 10_000 })
}

test.beforeEach(async ({ page }) => {
  await bootApp(page, { e2eHooks: true })
})

test('an edit made as the editor is re-created reaches the preview (#2217)', async ({ page }) => {
  await openPreview(page, 'osc(10).out()')
  expect(await page.evaluate(() => (window as any).__earlyEdits), 'the edit was made in the new editor').toBe(1) // eslint-disable-line @typescript-eslint/no-explicit-any
  await expect.poll(() => hydraRows(page), { timeout: 10_000 }).toEqual(['preset/viz/kaleidoscope.hydra:1'])
})

test('opening the preview without an edit leaves the file as it was', async ({ page }) => {
  await openPreview(page, null)
  // the bundled sketch draws without an error; give a stray write time to show
  await page.waitForTimeout(2000)
  expect(await hydraRows(page)).toEqual([])
})
