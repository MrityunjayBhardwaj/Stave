/**
 * The piano roll edits a step's own text (#2294, stage 4 of the plan on #1832).
 *
 * Real mouse and keys on the roll, on a nested melody. Each edit is read back from the
 * code editor and checked against what the page's own Strudel plays, onset and end, over
 * two cycles: add, delete, length and move change exactly the intended note.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'

const ROLL = '[data-bottom-panel-tab="piano-roll"]'

async function open(page: Page, code: string, first: string): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 520 } })
  await seedCode(page, code)
  const roll = page.locator(ROLL)
  await expect(roll.locator(first)).toBeVisible({ timeout: 10_000 })
  return roll
}
const cell = (roll: Locator, key: string): Locator => roll.locator(`[data-roll-cell="${key}"]`)

/** what the page's own Strudel plays for the mini in `code` over two cycles, as `note@begin-end` */
async function plays(page: Page, code: string): Promise<string[]> {
  const m = /note\("([^"]*)"\)/.exec(code)
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

const NESTED = '$: note("c4 [e4 [g4 a4]] b4").s("piano")'

test.describe('the roll edits a step’s own text (#2294)', () => {
  test('add: a click inside a note’s step splits it there', async ({ page }) => {
    const roll = await open(page, NESTED, '[data-roll-cell="60:0"]')
    // twelve columns: c4 is columns 0–3, so column 2 is half way through it
    await cell(roll, '62:2').click()
    await becomes(page, NESTED, '$: note("[c4 d4] [e4 [g4 a4]] b4").s("piano")', [
      '-c4@0-1/3', '+c4@0-1/6', '+d4@1/6-1/3',
      '-c4@1-4/3', '+c4@1-7/6', '+d4@7/6-4/3',
    ])
  })

  test('delete: a click on a note two levels down makes that note a rest', async ({ page }) => {
    const roll = await open(page, NESTED, '[data-roll-cell="67:6"]')
    await cell(roll, '67:6').click()
    await becomes(page, NESTED, '$: note("c4 [e4 [~ a4]] b4").s("piano")', ['-g4@1/2-7/12', '-g4@3/2-19/12'])
  })

  test('length: ⌥⇧→ takes in the rest after the note as `@2`, ⌥⇧← gives it back', async ({ page }) => {
    const code = '$: note("c4 ~ e4 ~").s("piano")'
    const roll = await open(page, code, '[data-roll-cell="60:0"]')
    await cell(roll, '60:0').focus()
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await becomes(page, code, '$: note("c4@2 e4 ~").s("piano")', ['-c4@0-1/4', '+c4@0-1/2', '-c4@1-5/4', '+c4@1-3/2'])
    await page.keyboard.press('Alt+Shift+ArrowLeft')
    await becomes(page, '$: note("c4@2 e4 ~").s("piano")', code, ['-c4@0-1/2', '+c4@0-1/4', '-c4@1-3/2', '+c4@1-5/4'])
  })

  test('move: ⌥→ leaves a rest where the note was and writes it where it lands', async ({ page }) => {
    const code = '$: note("c4 ~ e4 ~").s("piano")'
    const roll = await open(page, code, '[data-roll-cell="60:0"]')
    await cell(roll, '60:0').focus()
    await page.keyboard.press('Alt+ArrowRight')
    await becomes(page, code, '$: note("~ c4 e4 ~").s("piano")', ['-c4@0-1/4', '+c4@1/4-1/2', '-c4@1-5/4', '+c4@5/4-3/2'])
  })

  test('move across places: the repeat the note sits in is written out, the dragged copy alone moves', async ({ page }) => {
    const code = '$: note("[c4 e4]*2 ~").s("piano")'
    const roll = await open(page, code, '[data-roll-cell="64:1"]')
    // eight columns: the repeat is columns 0–3 (copy 2's e4 is column 3), the rest 4–7
    await cell(roll, '64:3').focus()
    await page.keyboard.press('Alt+ArrowRight')
    await becomes(page, code, '$: note("[[c4 e4] [c4 ~]] e4").s("piano")', ['-e4@3/8-1/2', '+e4@1/2-1', '-e4@11/8-3/2', '+e4@3/2-2'])
  })
})
