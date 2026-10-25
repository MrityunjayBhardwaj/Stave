/**
 * Rearranging the Files panel (#2089) and keeping names unique (#2090).
 *
 * Every test drives the real HTML5 drag (Playwright's dragTo dispatches
 * dragstart / dragover / drop with a live DataTransfer) or the real context
 * menu and dialog, on the project a fresh browser opens with, and reads the
 * tree back from the DOM — and again after a reload where persistence is the
 * point.
 *
 * The fresh project: `pattern.strudel`, then `preset/viz/` holding the viz
 * presets, shown alphabetically (fscope.p5, kaleidoscope.hydra, …, wordfall.p5),
 * then `viz_lib/Sunset Drive/`, the Starter's backdrop (#2240).
 */
import { test, expect, type Locator, type Page } from '@playwright/test'

import { waitForEditorLoaded } from './_appBoot'

const fileRow = (page: Page, name: string): Locator =>
  page.locator('[data-sidebar] [data-file-tree-item]').filter({ has: page.locator(`text="${name}"`) }).first()
const folderRow = (page: Page, path: string): Locator => page.locator(`[data-sidebar] [data-folder-path="${path}"]`)

/** The tree as shown: `D path` for a folder, `name` for a file, indented by depth. */
async function tree(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-sidebar] [data-folder-path], [data-sidebar] [data-file-tree-item]')].map((r) => {
      const depth = ((parseInt((r as HTMLElement).style.paddingLeft) || 8) - 8) / 12
      const label = r.hasAttribute('data-folder-path') ? 'D ' + r.getAttribute('data-folder-path') : (r.textContent ?? '').trim()
      return '  '.repeat(depth) + label
    }),
  )
}

/** What sits directly inside the folder `path`, in the order shown. */
async function childrenOf(page: Page, path: string): Promise<string[]> {
  const rows = await tree(page)
  const at = rows.findIndex((r) => r.trim() === `D ${path}`)
  if (at < 0) return []
  const indent = (r: string) => r.length - r.trimStart().length
  const children: string[] = []
  for (const r of rows.slice(at + 1)) {
    if (indent(r) <= indent(rows[at])) break
    if (indent(r) === indent(rows[at]) + 2) children.push(r.trim())
  }
  return children
}

/** The files of `preset/viz` in the order shown. */
async function vizFiles(page: Page): Promise<string[]> {
  return (await childrenOf(page, 'preset/viz')).filter((r) => !r.startsWith('D '))
}

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForEditorLoaded(page)
  await fileRow(page, 'spiral.p5').waitFor()
}

async function reload(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForEditorLoaded(page)
  await fileRow(page, 'spiral.p5').waitFor()
}

/** A point inside a row: `at` 0 = top edge, 1 = bottom edge. */
async function at(row: Locator, fraction: number): Promise<{ x: number; y: number }> {
  const box = await row.boundingBox()
  if (!box) throw new Error('row not on screen')
  return { x: box.width / 2, y: Math.max(1, Math.min(box.height - 1, box.height * fraction)) }
}

async function dragOnto(page: Page, source: Locator, target: Locator, fraction: number): Promise<void> {
  await source.dragTo(target, { targetPosition: await at(target, fraction) })
}

async function dragToTopLevel(page: Page, source: Locator): Promise<void> {
  const list = page.locator('[data-sidebar] > div').nth(1)
  const box = await list.boundingBox()
  if (!box) throw new Error('no list')
  await source.dragTo(list, { targetPosition: { x: box.width / 2, y: box.height - 10 } })
}

async function lastToast(page: Page): Promise<string> {
  const toast = page.locator('[data-testid="toast"]').last()
  await toast.waitFor()
  return (await toast.textContent()) ?? ''
}

test.describe('rearranging (#2089)', () => {
  test('the first reorder in a folder moves only the dragged file', async ({ page }) => {
    await open(page)
    const before = await vizFiles(page)
    await dragOnto(page, fileRow(page, 'spiral.p5'), fileRow(page, 'fscope.p5'), 0.2)
    const expected = ['spiral.p5', ...before.filter((n) => n !== 'spiral.p5')]
    await expect.poll(() => vizFiles(page)).toEqual(expected)
    await reload(page)
    expect(await vizFiles(page)).toEqual(expected)
  })

  test('a file dropped beside a file in another folder moves there, at that spot', async ({ page }) => {
    await open(page)
    await dragOnto(page, fileRow(page, 'pattern.strudel'), fileRow(page, 'kaleidoscope.hydra'), 0.8)
    await expect.poll(async () => (await vizFiles(page)).slice(0, 3)).toEqual(['fscope.p5', 'kaleidoscope.hydra', 'pattern.strudel'])
    expect((await tree(page))[0]).toBe('D preset')
  })

  test('a file dropped on the edge of a folder row lands beside the folder', async ({ page }) => {
    await open(page)
    await dragOnto(page, fileRow(page, 'spiral.p5'), folderRow(page, 'preset'), 0.1)
    await expect.poll(async () => (await tree(page)).slice(0, 3)).toEqual(['pattern.strudel', 'spiral.p5', 'D preset'])
  })

  test('a folder dropped beside a file in another folder moves there, and the folder it leaves stays', async ({ page }) => {
    await open(page)
    await dragOnto(page, folderRow(page, 'preset/viz'), fileRow(page, 'pattern.strudel'), 0.2)
    await expect.poll(async () => (await tree(page)).filter((r) => !r.startsWith(' '))).toEqual(['D viz', 'pattern.strudel', 'D preset', 'D viz_lib'])
    await reload(page)
    expect((await tree(page)).filter((r) => !r.startsWith(' '))).toContain('D preset')
  })

  test('a folder keeps its order when it moves and when it is renamed', async ({ page }) => {
    await open(page)
    await dragOnto(page, fileRow(page, 'wordfall.p5'), fileRow(page, 'fscope.p5'), 0.2)
    await expect.poll(async () => (await vizFiles(page))[0]).toBe('wordfall.p5')
    const ordered = await vizFiles(page)

    await dragToTopLevel(page, folderRow(page, 'preset/viz'))
    await folderRow(page, 'viz').waitFor()
    await expect.poll(() => childrenOf(page, 'viz')).toEqual(ordered)

    await folderRow(page, 'viz').click({ button: 'right' })
    await page.getByRole('button', { name: /^Rename/ }).first().click()
    await page.keyboard.press('Meta+A')
    await page.keyboard.type('vis')
    await page.keyboard.press('Enter')
    await folderRow(page, 'vis').waitFor()
    await expect.poll(() => childrenOf(page, 'vis')).toEqual(ordered)
    await reload(page)
    expect(await childrenOf(page, 'vis')).toEqual(ordered)
  })

  test('a drag that ends without a drop leaves no highlight', async ({ page }) => {
    await open(page)
    await page.evaluate(() => {
      const src = [...document.querySelectorAll('[data-file-tree-item]')].find((r) => r.textContent?.includes('spiral.p5'))!
      const dst = document.querySelector('[data-folder-path="preset"]')!
      const dt = new DataTransfer()
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
      const r = dst.getBoundingClientRect()
      dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: r.top + r.height / 2 }))
    })
    // the hover does highlight it…
    await expect.poll(() => folderRow(page, 'preset').evaluate((el) => (el as HTMLElement).style.background)).not.toBe('')
    await page.evaluate(() => {
      const src = [...document.querySelectorAll('[data-file-tree-item]')].find((r) => r.textContent?.includes('spiral.p5'))!
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
    })
    // …and ending the drag clears it
    await expect.poll(() => folderRow(page, 'preset').evaluate((el) => (el as HTMLElement).style.background)).toBe('')
  })

  test('a desktop file dropped on a file row is imported into that file\'s folder', async ({ page }) => {
    await open(page)
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('[data-file-tree-item]')].find((r) => r.textContent?.includes('kaleidoscope.hydra'))!
      const dt = new DataTransfer()
      dt.items.add(new File(['// from the desktop'], 'mine.p5'))
      for (const type of ['dragenter', 'dragover', 'drop']) row.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
    })
    await expect.poll(() => vizFiles(page)).toContain('mine.p5')
  })

  test('a new folder does not open its hidden placeholder in a tab', async ({ page }) => {
    await open(page)
    const language = () =>
      page.evaluate(() => (window as unknown as { monaco: { editor: { getEditors: () => Array<{ getModel: () => { getLanguageId: () => string } | null }> } } }).monaco.editor.getEditors()[0]?.getModel()?.getLanguageId())
    expect(await language()).toBe('strudel')
    await page.locator('[data-sidebar]').hover()
    await page.locator('[data-sidebar] button[title="New folder"]').click()
    await page.keyboard.type('sketches')
    await page.keyboard.press('Enter')
    await folderRow(page, 'sketches').waitFor()
    await page.waitForTimeout(500)
    expect(await language()).toBe('strudel')
    expect(await page.getByText('.keep', { exact: true }).count()).toBe(0)
  })

  test('undo takes back a reorder in one step', async ({ page }) => {
    await open(page)
    const before = await vizFiles(page)
    await dragOnto(page, fileRow(page, 'spiral.p5'), fileRow(page, 'fscope.p5'), 0.2)
    await expect.poll(async () => (await vizFiles(page))[0]).toBe('spiral.p5')
    await page.locator('[data-sidebar] > div').first().click()
    await page.keyboard.press('Meta+z')
    await expect.poll(() => vizFiles(page)).toEqual(before)
  })
})

test.describe('names stay unique (#2090)', () => {
  const dups = async (page: Page) => {
    const rows = await tree(page)
    return rows.filter((r, i) => rows.indexOf(r) !== i && !r.trim().startsWith('D '))
  }

  test('moving a file onto a name its new folder has is refused', async ({ page }) => {
    await open(page)
    // a desktop file named like one in preset/viz, dropped at the top level
    await page.evaluate(() => {
      const list = document.querySelector('[data-sidebar] > div:nth-child(2)')!
      const dt = new DataTransfer()
      dt.items.add(new File(['// mine'], 'scope.p5'))
      for (const type of ['dragenter', 'dragover', 'drop']) list.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }))
    })
    await expect.poll(async () => (await tree(page)).filter((r) => r === 'scope.p5').length).toBe(1)
    await dragToTopLevel(page, page.locator('[data-sidebar] [data-file-tree-item]').filter({ has: page.locator('text="scope.p5"') }).first())
    expect(await lastToast(page)).toContain('"scope.p5" already exists in the top level.')
    expect(await dups(page)).toEqual([])
    expect(await vizFiles(page)).toContain('scope.p5')
  })

  test('a new file, a rename and a new folder onto a taken name are refused', async ({ page }) => {
    await open(page)
    await page.locator('[data-sidebar]').hover()
    await page.locator('[data-sidebar] button[title="New file"]').click()
    await page.keyboard.type('pattern.strudel')
    await page.keyboard.press('Enter')
    expect(await lastToast(page)).toContain('"pattern.strudel" already exists in the top level.')

    await fileRow(page, 'scope.p5').click({ button: 'right' })
    await page.getByRole('button', { name: /^Rename/ }).first().click()
    const input = page.locator('[data-sidebar] input')
    await input.fill('spiral.p5')
    await input.press('Enter')
    expect(await lastToast(page)).toContain('"spiral.p5" already exists in "preset/viz".')

    await page.locator('[data-sidebar]').hover()
    await page.locator('[data-sidebar] button[title="New folder"]').click()
    await page.keyboard.type('preset')
    await page.keyboard.press('Enter')
    expect(await lastToast(page)).toContain('"preset" already exists in the top level.')

    expect(await dups(page)).toEqual([])
    expect(await vizFiles(page)).toContain('scope.p5')
  })

  test('duplicating twice picks the next free name', async ({ page }) => {
    await open(page)
    for (let i = 0; i < 2; i++) {
      await fileRow(page, 'spiral.p5').click({ button: 'right' })
      await page.getByText('Duplicate', { exact: true }).first().click()
    }
    await expect.poll(async () => (await vizFiles(page)).filter((n) => n.startsWith('spiral copy'))).toEqual(
      expect.arrayContaining(['spiral copy.p5', 'spiral copy 2.p5']),
    )
    expect(await dups(page)).toEqual([])
  })
})
