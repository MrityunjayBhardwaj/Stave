/**
 * A click edits the clicked step's own text (#2292).
 *
 * Real mouse clicks on the Pattern tab's grid, on a nested pattern that opens today:
 * each click must change only the step's own bytes in the code, and what Strudel plays
 * must change by exactly the hits of that one written step — asked of the page's own
 * Strudel, on the code read back from the editor. A step written
 * once and played twice (`[bd ~]*2`) changes in both places. A click the step writer
 * refuses leaves the code alone and says why on the cell.
 *
 * WHY A BROWSER TEST. The unit tests pin the writer and the column → step mapping; only
 * the panel shows that a press on a drawn cell reaches that writer, that the document gets
 * exactly the step's bytes, and that the grid redraws from what was written.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'

const NESTED = '$: s("bd [~ bd] sd [hh [~ cp]]")'
const COPIES = '$: s("[bd ~]*2 sd")'

async function open(page: Page, code: string): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 460 } })
  await seedCode(page, code)
  const seq = page.locator('[data-bottom-panel-tab="sequencer"]')
  await expect(seq, `the sequencer must open for ${code}`).toHaveCount(1)
  await expect(seq.locator('[data-seq-cell]').first()).toBeVisible()
  return seq
}
const cell = (seq: Locator, key: string): Locator => seq.locator(`[data-seq-cell="${key}"]`)
/** the row of the grid that draws `sound` */
async function row(seq: Locator, sound: string): Promise<number> {
  const labels = await seq.locator('[data-seq-voice]').evaluateAll((els) => els.map((e) => e.getAttribute('data-seq-voice')))
  const i = labels.indexOf(sound)
  expect(i, `a row for ${sound} (rows: ${labels.join(', ')})`).toBeGreaterThanOrEqual(0)
  return i
}

/**
 * What Strudel plays for the mini in `code` over two cycles, as `sound@begin` — asked of
 * the page's own Strudel (`window.mini`, the one the app plays with), not of a copy.
 */
async function plays(page: Page, code: string): Promise<string[]> {
  const m = /s\("([^"]*)"\)/.exec(code)
  if (!m) throw new Error(`no mini in ${code}`)
  // Strudel's functions reach the page's globals once it has loaded
  await page.waitForFunction(() => typeof (window as unknown as { mini?: unknown }).mini === 'function')
  const out = await page.evaluate((text) => {
    type Hap = { hasOnset: () => boolean; value: unknown; whole: { begin: { toFraction: () => string } } }
    const mini = (window as unknown as { mini: (s: string) => { queryArc: (a: number, b: number) => Hap[] } }).mini
    return mini(text)
      .queryArc(0, 2)
      .filter((h) => h.hasOnset())
      .map((h) => `${String(h.value)}@${h.whole.begin.toFraction()}`)
  }, m[1])
  return out.sort()
}
/** what `after` plays that `before` does not (+), and the other way (−) */
async function change(page: Page, before: string, after: string): Promise<string[]> {
  const a = await plays(page, before)
  const b = await plays(page, after)
  const left = [...a]
  const added: string[] = []
  for (const k of b) {
    const i = left.indexOf(k)
    if (i >= 0) left.splice(i, 1)
    else added.push(`+${k}`)
  }
  return [...added, ...left.map((k) => `-${k}`)].sort()
}

/** click the cell, and the code must become `want`, playing exactly `heard` more or less */
async function clickWrites(page: Page, seq: Locator, key: string, want: string, heard: string[]): Promise<void> {
  const before = await editorValue(page)
  await cell(seq, key).click()
  await expect.poll(() => editorValue(page)).toBe(want)
  expect(await change(page, before, want), `${before} → ${want}`).toEqual([...heard].sort())
}

test.describe('a click edits the step’s own text (#2292)', () => {
  test('nested steps: a rest becomes the row’s sound, and a second click takes it back out', async ({ page }) => {
    const seq = await open(page, NESTED)
    const bd = await row(seq, 'bd')
    const cp = await row(seq, 'cp')
    // the rest inside [~ bd]: one kick at 1/4 of each cycle
    await clickWrites(page, seq, `${bd}:4`, '$: s("bd [bd bd] sd [hh [~ cp]]")', ['+bd@1/4', '+bd@5/4'])
    await clickWrites(page, seq, `${bd}:4`, NESTED, ['-bd@1/4', '-bd@5/4'])
    // two levels down: the rest inside [~ cp]
    await clickWrites(page, seq, `${cp}:14`, '$: s("bd [~ bd] sd [hh [cp cp]]")', ['+cp@7/8', '+cp@15/8'])
    await clickWrites(page, seq, `${cp}:14`, NESTED, ['-cp@7/8', '-cp@15/8'])
  })

  test('a step another sound plays: the row joins it as a chord, and leaves it again', async ({ page }) => {
    const seq = await open(page, NESTED)
    const cp = await row(seq, 'cp')
    await clickWrites(page, seq, `${cp}:12`, '$: s("bd [~ bd] sd [[hh,cp] [~ cp]]")', ['+cp@3/4', '+cp@7/4'])
    await clickWrites(page, seq, `${cp}:12`, NESTED, ['-cp@3/4', '-cp@7/4'])
  })

  test('a step written once and played twice changes in both places', async ({ page }) => {
    const seq = await open(page, COPIES)
    const bd = await row(seq, 'bd')
    await clickWrites(page, seq, `${bd}:1`, '$: s("[bd bd]*2 sd")', ['+bd@1/8', '+bd@3/8', '+bd@9/8', '+bd@11/8'])
    // the second copy shows the same step, now a hit; clicking it takes both away again
    await expect(cell(seq, `${bd}:3`)).toHaveAttribute('aria-pressed', 'true')
    await clickWrites(page, seq, `${bd}:3`, COPIES, ['-bd@1/8', '-bd@3/8', '-bd@9/8', '-bd@11/8'])
  })

  test('a column part-way through a step is refused with its reason, and the code is left alone', async ({ page }) => {
    const seq = await open(page, NESTED)
    const bd = await row(seq, 'bd')
    const inside = cell(seq, `${bd}:1`)
    await expect(inside).toHaveAttribute('aria-disabled', 'true')
    await expect(inside).toHaveAttribute('title', /part of a longer step/)
    await inside.click({ force: true })
    await page.waitForTimeout(150)
    expect(await editorValue(page)).toBe(NESTED)
  })

  test('a generated step keeps its generator: a hat inside hh*4 is refused', async ({ page }) => {
    const seq = await open(page, '$: s("bd hh*4")')
    const hh = await row(seq, 'hh')
    const hat = cell(seq, `${hh}:5`)
    await expect(hat).toHaveAttribute('aria-disabled', 'true')
    await expect(hat).toHaveAttribute('title', /operator on its step/)
    await hat.click({ force: true })
    await page.waitForTimeout(150)
    expect(await editorValue(page)).toBe('$: s("bd hh*4")')
  })
})
