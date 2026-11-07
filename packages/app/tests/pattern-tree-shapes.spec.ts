/**
 * What the bar's tree learned to hold (#2454, part of #2295), in the real app.
 *
 * The unit tests pin the tree and the cells. Only the panel shows that a press on a drawn cell
 * of a pattern written with feet reaches the step writer now, and that a repeat longer than
 * 12 bars draws instead of leaving an empty panel.
 *
 *   - a pattern written with feet: a click writes the step's own bytes, and Strudel plays
 *     exactly that change, asked of the page's own Strudel on the code read back;
 *   - a repeat of 16 bars draws all 16, look-only, and a click writes nothing;
 *   - CONTROL: a pattern that repeats within 12 bars still opens the column grid.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'

async function boot(page: Page, code: string): Promise<void> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 460 } })
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await seedCode(page, code)
}

async function columnGrid(page: Page, code: string): Promise<Locator> {
  await boot(page, code)
  const seq = page.locator('[data-bottom-panel-tab="sequencer"]')
  await expect(seq.locator('[data-seq-cell]').first()).toBeVisible()
  return seq
}

async function row(seq: Locator, sound: string): Promise<number> {
  const labels = await seq.locator('[data-seq-voice]').evaluateAll((els) => els.map((e) => e.getAttribute('data-seq-voice')))
  const i = labels.indexOf(sound)
  expect(i, `a row for ${sound} (rows: ${labels.join(', ')})`).toBeGreaterThanOrEqual(0)
  return i
}

/** what Strudel plays for the code's mini over one cycle, as `sound@begin`, asked of the page's own Strudel */
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

test.describe('what the tree holds (#2454)', () => {
  test('feet: a click erases a step, adds to a step, and splits a step, in the step’s own text', async ({ page }) => {
    const code = '$: s("bd sd . hh")'
    const seq = await columnGrid(page, code)
    expect(await plays(page, code)).toEqual(['bd@0', 'hh@1/2', 'sd@1/4'])
    const hh = await row(seq, 'hh')
    const bd = await row(seq, 'bd')

    await seq.locator(`[data-seq-cell="${hh}:2"]`).click()
    await expect.poll(() => editorValue(page)).toBe('$: s("bd sd . ~")')
    expect(await plays(page, '$: s("bd sd . ~")')).toEqual(['bd@0', 'sd@1/4'])

    // the row it emptied stays on screen, so the same cell puts the note back
    await seq.locator(`[data-seq-cell="${hh}:2"]`).click()
    await expect.poll(() => editorValue(page)).toBe(code)

    // the snap half of a foot's one step splits that step
    await seq.locator(`[data-seq-cell="${hh}:3"]`).click()
    await expect.poll(() => editorValue(page)).toBe('$: s("bd sd . hh*2")')
    expect(await plays(page, '$: s("bd sd . hh*2")')).toEqual(['bd@0', 'hh@1/2', 'hh@3/4', 'sd@1/4'])

    await seq.locator(`[data-seq-cell="${bd}:1"]`).click()
    await expect.poll(() => editorValue(page)).toBe('$: s("bd [bd,sd] . hh*2")')
    expect(await plays(page, '$: s("bd [bd,sd] . hh*2")')).toEqual(['bd@0', 'bd@1/4', 'hh@1/2', 'hh@3/4', 'sd@1/4'])
  })

  test('a repeat of 16 bars draws all of them, and a click writes nothing', async ({ page }) => {
    const code = '$: s("crowd/16")'
    await boot(page, code)
    const grid = page.locator('[data-tree-grid]')
    await expect(grid).toHaveCount(1)
    await expect(grid).toHaveAttribute('data-tree-bars', '16')
    await expect(grid.locator('[data-seq-ruler-label][data-ruler-bar]')).toHaveCount(16)
    await expect(grid.locator('[data-tree-hit]')).toHaveCount(1)
    await grid.locator('[data-tree-row]').click()
    expect(await editorValue(page)).toBe(code)
  })

  test('CONTROL: a repeat within 12 bars still opens the column grid', async ({ page }) => {
    const seq = await columnGrid(page, '$: s("<bd sd>")')
    await expect(seq.locator('[data-seq-cell]').first()).toBeVisible()
    await expect(page.locator('[data-tree-grid]')).toHaveCount(0)
  })
})
