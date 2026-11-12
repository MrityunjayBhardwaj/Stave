/**
 * Slots on the Exact step grid: snap and zoom, never a write (#2526).
 *
 * Real presses on the inspector's Slots control and real clicks on the grid. Each step reads
 * the code back from the editor; a click on a snap place also asks the page's own Strudel what
 * the pattern now plays, because the unit tests pin the cells and only the panel shows the
 * control reaches them.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'
import { slotsControl, preset } from './_resolutionControl'

async function open(page: Page, code: string): Promise<{ grid: Locator; slots: Locator }> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 520 } })
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await seedCode(page, code)
  const drawer = page.locator('[data-bottom-panel="root"]')
  const grid = drawer.locator('[data-exact-grid]')
  await expect(grid, `the Exact grid must open for ${code}`).toHaveCount(1)
  await expect(grid.locator('[data-seq-cell]').first()).toBeVisible()
  return { grid, slots: slotsControl(drawer) }
}

/** the places row 0 draws in bar 0, by name */
const placesOf = (grid: Locator): Promise<string[]> =>
  grid.locator('[data-seq-cell^="0:0:"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-seq-cell') ?? ''))

/** what the mini plays over one cycle, as `sound@begin`, asked of the page's own Strudel */
async function plays(page: Page, code: string): Promise<string[]> {
  const m = /s\("([^"]*)"\)/.exec(code)
  if (!m) throw new Error(`no mini in ${code}`)
  await page.waitForFunction(() => typeof (window as unknown as { mini?: unknown }).mini === 'function')
  const out = await page.evaluate((text) => {
    type Hap = { hasOnset: () => boolean; value: unknown; whole: { begin: { toFraction: () => string } } }
    const mini = (window as unknown as { mini: (s: string) => { queryArc: (a: number, b: number) => Hap[] } }).mini
    return mini(text)
      .queryArc(0, 1)
      .filter((h) => h.hasOnset())
      .map((h) => `${String(h.value)}@${h.whole.begin.toFraction()}`)
  }, m[1])
  return out.sort()
}

test.describe('Slots on the Exact step grid (#2526)', () => {
  test('reads the pattern’s own places; ×2 and back are views that write nothing; below the pattern is unavailable', async ({ page }) => {
    const code = '$: s("bd ~ sd ~")'
    const { grid, slots } = await open(page, code)
    await expect(slots.locator('[data-resolution-current]')).toHaveText('4')
    expect(await placesOf(grid)).toEqual(['0:0:0/1', '0:0:1/4', '0:0:1/2', '0:0:3/4'])

    // ÷2 from the pattern's own count would be a rewrite: Exact does not offer it
    const halve = slots.locator('[data-resolution-halve]')
    await expect(halve).not.toHaveAttribute('data-resolution-view', 'true')
    await expect(halve).not.toHaveAttribute('data-resolution-writes', 'true')

    // ×2 is a view: twice the places, the code as it was
    const double = slots.locator('[data-resolution-double]')
    await expect(double).toHaveAttribute('data-resolution-view', 'true')
    await double.click()
    await expect(slots.locator('[data-resolution-current]')).toHaveText('8')
    await expect.poll(() => placesOf(grid)).toHaveLength(8)
    expect(await editorValue(page)).toBe(code)

    // and back down to the pattern's own count is a view too
    await expect(halve).toHaveAttribute('data-resolution-view', 'true')
    await halve.click()
    await expect(slots.locator('[data-resolution-current]')).toHaveText('4')
    await expect.poll(() => placesOf(grid)).toHaveLength(4)
    expect(await editorValue(page)).toBe(code)
  })

  test('a click on a place the snap made splits that step, in its own text, and Strudel plays it there', async ({ page }) => {
    const { grid, slots } = await open(page, '$: s("bd ~ sd ~")')
    await (await preset(slots, 16)).click()
    await expect.poll(() => placesOf(grid)).toHaveLength(16)
    // the second of the four places inside the first `~` (1/4 … 1/2)
    await grid.locator('[data-seq-cell="0:0:5/16"]').click()
    const want = '$: s("bd [~ bd ~ ~] sd ~")'
    await expect.poll(() => editorValue(page)).toBe(want)
    expect(await plays(page, want)).toEqual(['bd@0', 'bd@5/16', 'sd@1/2'])
    // the text now spells 16 places itself, so 16 stays 16 (no second ×4 under the pointer)
    await expect(slots.locator('[data-resolution-current]')).toHaveText('16')
    await expect.poll(() => placesOf(grid)).toHaveLength(16)
  })

  test('the snap is for this pattern only: another pattern opens at its own places', async ({ page }) => {
    const { grid, slots } = await open(page, '$: s("bd ~ sd ~")\n$: s("hh hh")')
    await page.evaluate(() => {
      type Ed = { getModel: () => { getLanguageId?: () => string } | null; setPosition: (p: { lineNumber: number; column: number }) => void; focus: () => void }
      const eds = ((window as unknown as { monaco: { editor: { getEditors: () => Ed[] } } }).monaco.editor.getEditors() ?? []) as Ed[]
      const ed = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
      ed.setPosition({ lineNumber: 1, column: 6 })
      ed.focus()
    })
    await expect.poll(() => placesOf(grid)).toHaveLength(4)
    await slots.locator('[data-resolution-double]').click()
    await expect.poll(() => placesOf(grid)).toHaveLength(8)
    await page.evaluate(() => {
      type Ed = { getModel: () => { getLanguageId?: () => string } | null; setPosition: (p: { lineNumber: number; column: number }) => void; focus: () => void }
      const eds = ((window as unknown as { monaco: { editor: { getEditors: () => Ed[] } } }).monaco.editor.getEditors() ?? []) as Ed[]
      const ed = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
      ed.setPosition({ lineNumber: 2, column: 6 })
      ed.focus()
    })
    // `hh hh` has 2 places; a snap carried over from the first pattern (8) would draw 8 here
    await expect(slots.locator('[data-resolution-current]')).toHaveText('2')
    await expect.poll(() => placesOf(grid)).toHaveLength(2)
  })
})
