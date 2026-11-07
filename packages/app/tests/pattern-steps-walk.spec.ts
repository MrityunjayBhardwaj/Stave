/**
 * Split, paint, cursor and resize walk STEPS, not columns (#2293).
 *
 * Real mouse and keys on the Pattern tab's grid, on nested patterns. Every edit is read back
 * from the code editor and checked against what the page's own Strudel plays (onset AND
 * end, over two cycles): it must change by exactly the intended hits, nothing else.
 *
 * - A click on a column part-way through a plain step SPLITS it (`bd` → `[bd bd]`), one
 *   replacement at the step's name.
 * - A paint drag paints the STEPS it crosses, at any depth, and passes over the snap
 *   halves of a step — it never splits.
 * - The arrow keys walk the steps a row draws: into a group and out of it, never onto a
 *   column in the middle of a step.
 * - ⌥⇧→ / ⌥⇧← lengthen and shorten a note inside its group, written as the note already
 *   writes its length (`bd@2` → `bd@3`); a length its group cannot take is refused and the
 *   code is left alone.
 *
 * Each arm is chosen so today's column road writes something else (or nothing), so each
 * goes red when its path is put back.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue, pinLcmGrid } from './_appBoot'


pinLcmGrid(test)
async function open(page: Page, code: string): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 460 } })
  await seedCode(page, code)
  const seq = page.locator('[data-bottom-panel-tab="sequencer"]')
  await expect(seq, `the sequencer must open for ${code}`).toHaveCount(1)
  await expect(seq.locator('[data-seq-cell]').first()).toBeVisible()
  return seq
}
const cell = (seq: Locator, key: string): Locator => seq.locator(`[data-seq-cell="${key}"]`)
async function row(seq: Locator, sound: string): Promise<number> {
  const labels = await seq.locator('[data-seq-voice]').evaluateAll((els) => els.map((e) => e.getAttribute('data-seq-voice')))
  const i = labels.indexOf(sound)
  expect(i, `a row for ${sound} (rows: ${labels.join(', ')})`).toBeGreaterThanOrEqual(0)
  return i
}

/** what the page's own Strudel plays for the mini in `code` over two cycles, as `sound@begin-end` */
async function plays(page: Page, code: string): Promise<string[]> {
  const m = /s\("([^"]*)"\)/.exec(code)
  if (!m) throw new Error(`no mini in ${code}`)
  await page.waitForFunction(() => typeof (window as unknown as { mini?: unknown }).mini === 'function')
  const out = await page.evaluate((text) => {
    type Frac = { toFraction: () => string }
    type Hap = { hasOnset: () => boolean; value: unknown; whole: { begin: Frac; end: Frac } }
    const mini = (window as unknown as { mini: (s: string) => { queryArc: (a: number, b: number) => Hap[] } }).mini
    return mini(text)
      .queryArc(0, 2)
      .filter((h) => h.hasOnset())
      .map((h) => `${String(h.value)}@${h.whole.begin.toFraction()}-${h.whole.end.toFraction()}`)
  }, m[1])
  return out.sort()
}
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
async function becomes(page: Page, before: string, want: string, heard: string[]): Promise<void> {
  await expect.poll(() => editorValue(page)).toBe(want)
  expect(await change(page, before, want), `${before} → ${want}`).toEqual([...heard].sort())
}
/** the cell the keyboard cursor is on */
async function cursorAt(seq: Locator): Promise<string | null> {
  return seq.locator('[role="gridcell"][aria-selected="true"] > [data-seq-cell]').first().getAttribute('data-seq-cell')
}

const NESTED = '$: s("bd [~ bd] sd [hh [~ cp]]")'

test.describe('split, paint, cursor and resize walk steps (#2293)', () => {
  test('split: a click on a step’s second half adds the hit there, and the step’s own hit keeps the first half (LCM grid)', async ({ page }) => {
    const seq = await open(page, NESTED)
    const bd = await row(seq, 'bd')
    // `bd` is columns 0–3 of the bar's 16: column 2 is its second half
    const half = cell(seq, `${bd}:2`)
    await expect(half).toHaveAttribute('data-seq-splits', 'true')
    await expect(half).toHaveAttribute('title', /Splits this step/)
    await half.click()
    // two equal hits of one sound are written `bd*2` (#2326)
    await becomes(page, NESTED, '$: s("bd*2 [~ bd] sd [hh [~ cp]]")', [
      '-bd@0-1/4', '+bd@0-1/8', '+bd@1/8-1/4',
      '-bd@1-5/4', '+bd@1-9/8', '+bd@9/8-5/4',
    ])
  })

  test('split, a step another sound plays: the row’s sound joins it as the second half (LCM grid)', async ({ page }) => {
    const seq = await open(page, NESTED)
    const cp = await row(seq, 'cp')
    // `sd` is columns 8–11: column 10 is its half, on the cp row
    await cell(seq, `${cp}:10`).click()
    await becomes(page, NESTED, '$: s("bd [~ bd] [sd cp] [hh [~ cp]]")', [
      '-sd@1/2-3/4', '+sd@1/2-5/8', '+cp@5/8-3/4',
      '-sd@3/2-7/4', '+sd@3/2-13/8', '+cp@13/8-7/4',
    ])
  })

  test('paint: a drag paints every step it crosses, at any depth, and never splits one (LCM grid)', async ({ page }) => {
    const code = '$: s("bd [~ ~] ~ ~")'
    const seq = await open(page, code)
    const bd = await row(seq, 'bd')
    // eight columns: `bd` 0–1, the group's rests 2 and 3, the last two rests 4–5 and 6–7.
    // Columns 5 and 7 are halves of a plain step: a drag crosses them and must not split.
    await expect(seq.locator(`[data-seq-cell^="${bd}:"]`)).toHaveCount(8)
    const box = await cell(seq, `${bd}:2`).boundingBox()
    const last = await cell(seq, `${bd}:7`).boundingBox()
    if (!box || !last) throw new Error('no boxes')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    // slow, through every box: each step the pointer enters is painted once
    const steps = 24
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(box.x + box.width / 2 + ((last.x + last.width * 0.75 - box.x - box.width / 2) * i) / steps, box.y + box.height / 2)
      await page.waitForTimeout(60)
    }
    await page.mouse.up()
    // every rest became a kick, in its own place; no step was cut in two
    await becomes(page, code, '$: s("bd [bd bd] bd bd")', [
      '+bd@1/4-3/8', '+bd@3/8-1/2', '+bd@1/2-3/4', '+bd@3/4-1',
      '+bd@5/4-11/8', '+bd@11/8-3/2', '+bd@3/2-7/4', '+bd@7/4-2',
    ])
  })

  test('cursor: the arrows walk the steps a row draws, into a group and out of it (LCM grid)', async ({ page }) => {
    const seq = await open(page, NESTED)
    const bd = await row(seq, 'bd')
    await cell(seq, `${bd}:0`).focus()
    await expect.poll(() => cursorAt(seq)).toBe(`${bd}:0`)
    // `bd` (0–3), then the group's `~` (4) and `bd` (6), then `sd` (8)
    const walk: string[] = []
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight')
      walk.push((await cursorAt(seq)) ?? '?')
    }
    expect(walk).toEqual([`${bd}:4`, `${bd}:6`, `${bd}:8`])
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    expect(await cursorAt(seq)).toBe(`${bd}:4`)
    // Enter on the step the cursor is on is the click on it: the group's rest becomes a kick
    await page.keyboard.press('Enter')
    await becomes(page, NESTED, '$: s("bd [bd bd] sd [hh [~ cp]]")', ['+bd@1/4-3/8', '+bd@5/4-11/8'])
    // nothing written by walking
    expect(await editorValue(page)).toBe('$: s("bd [bd bd] sd [hh [~ cp]]")')
  })

  test('resize: ⌥⇧→ and ⌥⇧← change the note’s length in its own spelling (LCM grid)', async ({ page }) => {
    const code = '$: s("bd@2 ~ sd ~")'
    const seq = await open(page, code)
    const bd = await row(seq, 'bd')
    await cell(seq, `${bd}:0`).focus()
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await becomes(page, code, '$: s("bd@3 sd ~")', ['-bd@0-2/5', '+bd@0-3/5', '-bd@1-7/5', '+bd@1-8/5'])
    await page.keyboard.press('Alt+Shift+ArrowLeft')
    await becomes(page, '$: s("bd@3 sd ~")', code, ['-bd@0-3/5', '+bd@0-2/5', '-bd@1-8/5', '+bd@1-7/5'])
  })

  // a length is written `@n` (#2326)
  test('resize, held notes: the rest after the note is taken into its `@n`, and back (LCM grid)', async ({ page }) => {
    const code = '$: s("hh sd ~ ~")'
    const seq = await open(page, code)
    const sd = await row(seq, 'sd')
    await cell(seq, `${sd}:1`).focus()
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await becomes(page, code, '$: s("hh sd@2 ~")', ['-sd@1/4-1/2', '+sd@1/4-3/4', '-sd@5/4-3/2', '+sd@5/4-7/4'])
    await page.keyboard.press('Alt+Shift+ArrowLeft')
    await becomes(page, '$: s("hh sd@2 ~")', code, ['-sd@1/4-3/4', '+sd@1/4-1/2', '-sd@5/4-7/4', '+sd@5/4-3/2'])
  })

  test('resize inside a group: the note takes the rest after it, and nothing outside the group moves', async ({ page }) => {
    const code = '$: s("hh [sd ~ ~] hh")'
    const seq = await open(page, code)
    const sd = await row(seq, 'sd')
    await seq.locator(`[data-seq-cell^="${sd}:"][aria-pressed="true"]`).first().focus()
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await becomes(page, code, '$: s("hh [sd@2 ~] hh")', ['-sd@1/3-4/9', '+sd@1/3-5/9', '-sd@4/3-13/9', '+sd@4/3-14/9'])
  })

  test('resize refused: a note with another note after it in its group keeps its length, and the code is left alone (LCM grid)', async ({ page }) => {
    const code = '$: s("[bd sd] ~")'
    const seq = await open(page, code)
    const bd = await row(seq, 'bd')
    await cell(seq, `${bd}:0`).focus()
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await page.waitForTimeout(200)
    expect(await editorValue(page)).toBe(code)
  })
})
