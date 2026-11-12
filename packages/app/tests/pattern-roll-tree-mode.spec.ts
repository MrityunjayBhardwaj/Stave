/**
 * The piano roll on the tree grid (Settings › Grid › Exact), on the fixtures of the roll's
 * older specs (#2294).
 *
 * Those specs pin the shared-grid writer and run on the LCM grid (`… (LCM grid)`). Here the
 * same documents and gestures run on Exact, where every edit is of one note's own text:
 *
 *   - an edit that writes is read back from the code editor and checked against what the
 *     page's own Strudel plays over two cycles: exactly the note added, removed or split in;
 *   - an edit the step writer refuses leaves the document byte-for-byte and says why;
 *   - a length handle is drawn only where the step writer would write a length (#1322).
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'
import { expectRefusalReported } from './_console'

const ROLL = '[data-bottom-panel-tab="piano-roll"]'

async function open(page: Page, code: string, first: string): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 520 }, gridMode: 'exact' })
  await seedCode(page, code)
  const roll = page.locator(ROLL)
  await expect(roll.locator(first)).toBeVisible({ timeout: 10_000 })
  return roll
}
const cell = (roll: Locator, key: string): Locator => roll.locator(`[data-roll-cell="${key}"]`)

async function centre(loc: Locator): Promise<{ x: number; y: number }> {
  const b = await loc.boundingBox()
  if (!b) throw new Error('no box')
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

/** what the page's own Strudel plays for the mini in `code` over two cycles, as `value@begin-end` */
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
async function staysAndSays(page: Page, code: string, phrase: string): Promise<void> {
  await page.waitForTimeout(400)
  expect(await editorValue(page)).toBe(code)
  await expectRefusalReported(page, phrase)
}

test.describe('the roll on the tree grid edits one note’s own text (#2294)', () => {
  test('length: a note with no rest after it gets no handle; one that can give room back is refused growing, and says why', async ({ page }) => {
    // every note is followed by a note and is one column long: no length is writable
    const dense = '$: note("g c g c g c g c")'
    let roll = await open(page, dense, '[data-roll-cell="48:1"]')
    await expect(cell(roll, '48:1')).toHaveAttribute('data-roll-resize-inert', 'true')
    await expect(cell(roll, '48:7')).toHaveAttribute('data-roll-resize-inert', 'true')
    await expect(roll.locator('[data-roll-resize]')).toHaveCount(0)

    // c3 can give a column back, so it keeps its handle — but it cannot grow over e3
    const code = '$: note("[c3@3 e3] [~ g2@2 b2]")'
    roll = await open(page, code, '[data-roll-cell="48:0"]')
    await expect(roll.locator('[data-roll-resize="48:0"]')).toHaveCount(1)
    await drag(page, await centre(roll.locator('[data-roll-resize="48:0"]')), await centre(cell(roll, '48:3')))
    await staysAndSays(page, code, "Couldn't set that length — the next step is not a rest this note can take in")
  })

  // #2443: `b2` is one step but three of the roll's columns (`[c3 e3 g3]` sets them at sixths).
  // Its handle pulled back one column cuts it inside its own text; nothing else moves.
  test('length: a drag back by part of a step writes the step as note and rest (#2443)', async ({ page }) => {
    const code = '$: note("[c3 e3 g3] b2")'
    const roll = await open(page, code, '[data-roll-cell="47:3"]')
    await drag(page, await centre(roll.locator('[data-roll-resize="47:3"]')), await centre(cell(roll, '47:4')))
    await becomes(page, code, '$: note("[c3 e3 g3] [b2@2 ~]")', ['-b2@1/2-1', '+b2@1/2-5/6', '-b2@3/2-2', '+b2@3/2-11/6'])
  })

  test('length: one note of a chord, by key, is refused and says why', async ({ page }) => {
    const code = '$: note("[c3,e3] ~ ~ ~")'
    const roll = await open(page, code, '[data-roll-cell="48:0"]')
    await cell(roll, '48:0').focus()
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await staysAndSays(page, code, "Couldn't set that length — the next step is not a rest this note can take in")
  })

  test('move: a note whose copies come from outside its step is refused, and says why', async ({ page }) => {
    const code = '$: note("- - - <b3 [b3 b3]>")'
    const roll = await open(page, code, '[data-roll-cell="59:6"]')
    await drag(page, await centre(cell(roll, '59:6')), await centre(cell(roll, '59:4')))
    await staysAndSays(page, code, "Couldn't move that note there — the note plays in several places")
  })

  test('add into a repeat: a click on a hit makes a chord, a click part-way splits it, the repeat written out', async ({ page }) => {
    const code = '$: note("<c2*2 g2*3 [a g] c2*6>")'
    let roll = await open(page, code, '[data-roll-cell="36:6"]')
    await cell(roll, '36:6').click()
    await becomes(page, code, '$: note("<c2*2 [[c2,g2] g2 g2] [a g] c2*6>")', ['+c2@1-4/3'])
    roll = await open(page, code, '[data-roll-cell="36:7"]')
    await cell(roll, '36:7').click()
    // the first g2 is cut to its first half and c2 plays its second
    await becomes(page, code, '$: note("<c2*2 [[g2 c2] g2 g2] [a g] c2*6>")', ['+c2@7/6-4/3', '+g2@1-7/6', '-g2@1-4/3'])
  })

  test('delete in a stack of alternations: that note alone becomes a rest', async ({ page }) => {
    const code = '$: note("<g1, c1> - <c3, g4 - - >")'
    let roll = await open(page, code, '[data-roll-cell="48:2"]')
    await cell(roll, '48:2').click()
    await becomes(page, code, '$: note("<g1, c1> - <~, g4 - - >")', ['-c3@2/3-1', '-c3@5/3-2'])
    roll = await open(page, code, '[data-roll-cell="67:2"]')
    await cell(roll, '67:2').click()
    await becomes(page, code, '$: note("<g1, c1> - <c3, ~ - - >")', ['-g4@2/3-1'])
  })

  test('delete inside an alternation under a repeat: that one value becomes a rest', async ({ page }) => {
    const code = '$: note("<0 2 0 4>*4, <4 6 4 8>*2, -4*4")'
    const roll = await open(page, code, '[data-roll-cell="4:3"]')
    await cell(roll, '4:3').click()
    await becomes(page, code, '$: note("<0 2 0 ~>*4, <4 6 4 8>*2, -4*4")', ['-4@3/4-1', '-4@7/4-2'])
  })

  test('a move where the columns are not whole is refused, and says why', async ({ page }) => {
    const code = '$: note("c4@1.5 e4@1.2")'
    const roll = await open(page, code, '[data-roll-cell="60:0"]')
    await drag(page, await centre(cell(roll, '60:0')), await centre(cell(roll, '60:1')))
    await staysAndSays(page, code, "Couldn't move that note there — the pattern's lengths do not add up to whole columns here")
  })

  test('add into a one-step bar: the note is one column long', async ({ page }) => {
    const MELODY = 'e4 d4 c4 d4 e4 e4 e4@2'
    const code = `$: note("<[${MELODY}] ~>")`
    const roll = await open(page, code, '[data-roll-cell="62:10"]')
    await cell(roll, '62:10').click()
    await becomes(page, code, `$: note("<[${MELODY}] [~ ~ d4 ~ ~ ~ ~ ~]>")`, ['+d4@5/4-11/8'])
  })
})
