/**
 * The Pattern tab draws the steps AS WRITTEN, and a ruler that counts them (#1841).
 *
 * Stage 1 of the pattern-grid epic (#1832), visuals only: the lines and labels come from
 * the regions the parser already records for the writers, re-expressed in drawn columns.
 * `bd [~ bd] sd ~` is eight columns and four written steps, and used to look like eight.
 *
 * WHY A BROWSER TEST. `writtenSteps.test.ts` pins the columns; only a rendered panel can
 * show that a line is actually drawn in the gap before its cell (and not before a plain
 * column), that the ruler's labels sit over the right cells, and that the ruler follows
 * the row the cursor is on when `,`-parts split the bar differently.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode } from './_appBoot'

async function open(page: Page, code: string, tab: 'sequencer' | 'piano-roll'): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 460 } })
  await seedCode(page, code)
  const panel = page.locator(`[data-bottom-panel-tab="${tab}"]`)
  await expect(panel, `the ${tab} must open for ${code}`).toHaveCount(1)
  return panel
}

/** the ruler's labels, as `column=text` */
async function ruler(panel: Locator, attr: string): Promise<string[]> {
  return panel
    .locator(`[${attr}]`)
    .evaluateAll((els, a) => els.map((e) => `${e.getAttribute(a)}=${e.textContent}`), attr)
}

/** the drawn line in the gap before a cell: its box-shadow, or 'none' */
async function lineBefore(cell: Locator): Promise<string> {
  return cell.evaluate((e) => getComputedStyle(e).boxShadow)
}

test.describe('sequencer: step lines and a step ruler (#1841)', () => {
  test('a group inside a step: four written steps over eight columns', async ({ page }) => {
    const seq = await open(page, '$: s("bd [~ bd] sd ~")', 'sequencer')
    expect(await ruler(seq, 'data-seq-ruler-label')).toEqual(['0=1', '2=1.2', '4=1.3', '6=1.4'])

    // a line in the gap before each written step, in every row, and none before a plain column.
    // In Exact a written step of several columns is drawn as one step (#1861), and the line
    // sits on that step, before its first cell; a one-column step keeps it on its cell.
    const starts = await seq
      .locator('[data-seq-step-start="true"]')
      .evaluateAll((els) => els.map((e) => e.querySelector('[data-seq-cell]')?.getAttribute('data-seq-cell')))
    expect(starts).toEqual(['0:2', '0:4', '0:6', '1:2', '1:4', '1:6'])
    const stepOf = (key: string) => seq.locator(`[data-seq-step-start="true"]:has([data-seq-cell="${key}"])`)
    expect(await lineBefore(stepOf('0:2'))).not.toBe('none')
    const cellBox = (key: string) => seq.locator(`[role="gridcell"]:has(> [data-seq-cell="${key}"])`)
    expect(await lineBefore(cellBox('0:1'))).toBe('none')
  })

  test('rows from different parts draw their own lines, and the ruler follows the cursor row', async ({
    page,
  }) => {
    // `bd sd` splits the bar in two, `hh hh hh` in three: 6 shared columns
    const seq = await open(page, '$: s("bd sd, hh hh hh")', 'sequencer')
    const starts = await seq
      .locator('[role="gridcell"][data-seq-step-start="true"] > [data-seq-cell]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-seq-cell')))
    // rows: bd (part 0), sd (part 0), hh (part 1)
    expect(starts).toEqual(['0:3', '1:3', '2:2', '2:4'])

    // no cursor yet: the first row's steps
    expect(await ruler(seq, 'data-seq-ruler-label')).toEqual(['0=1', '3=1.2'])
    // move the cursor to the hh row with the real keys
    await seq.locator('[data-seq-cell="1:0"]').focus()
    await page.keyboard.press('ArrowDown')
    await expect(seq.locator('[role="gridcell"][aria-selected="true"] > [data-seq-cell="2:0"]')).toHaveCount(1)
    await expect.poll(() => ruler(seq, 'data-seq-ruler-label')).toEqual(['0=1', '2=1.2', '4=1.3'])
  })

  test('`@` counts as steps the way Strudel does: `bd@3 sd` is four (#1845)', async ({ page }) => {
    const seq = await open(page, '$: s("bd@3 sd")', 'sequencer')
    expect(await ruler(seq, 'data-seq-ruler-label')).toEqual(['0=1', '1=1.2', '2=1.3', '3=1.4'])
    // a step line inside the held kick, as well as before the snare
    const starts = await seq
      .locator('[role="gridcell"][data-seq-step-start="true"] > [data-seq-cell]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-seq-cell')))
    expect(starts).toEqual(['0:1', '0:2', '0:3', '1:1', '1:2', '1:3'])
  })

  test('a leaf-read pattern has no written-step regions: bar numbers only, no step lines', async ({ page }) => {
    const seq = await open(page, '$: s("<bd [~ bd]>@2 hh@2 bd <bd ~> [hh bd] [~ hh]")', 'sequencer')
    expect(await ruler(seq, 'data-seq-ruler-label')).toEqual(['0=1', '16=2'])
    await expect(seq.locator('[data-seq-step-start]')).toHaveCount(0)
  })
})

test.describe('piano roll: step lines and a step ruler (#1841)', () => {
  test('a melody with groups: the ruler counts its written steps and the lines sit before them', async ({
    page,
  }) => {
    const roll = await open(page, '$: note("c4 [e4 g4] a4 [b4 c5 d5]").s("piano")', 'piano-roll')
    expect(await ruler(roll, 'data-roll-ruler-label')).toEqual(['0=1', '6=1.2', '12=1.3', '18=1.4'])
    const cols = await roll
      .locator('[role="gridcell"][data-roll-step-start="true"] > [data-roll-cell]')
      .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-roll-cell')!.split(':')[1]))])
    expect(cols).toEqual(['6', '12', '18'])
  })

  test('a bar line and a written-step line are drawn differently; a plain column has none', async ({ page }) => {
    // two bars (the `< >` step alternates), each with four written steps
    const roll = await open(page, '$: note("c4 [e4 g4] <a4 b4> c5").s("piano")', 'piano-roll')
    const labels = await ruler(roll, 'data-roll-ruler-label')
    const colOf = (text: string) => labels.find((l) => l.endsWith(`=${text}`))!.split('=')[0]
    const cellAt = (col: string) => roll.locator(`[role="gridcell"]:has(> [data-roll-cell$=":${col}"])`).first()
    const bar = await lineBefore(cellAt(colOf('2')))
    const step = await lineBefore(cellAt(colOf('1.2')))
    const plain = await lineBefore(cellAt(String(Number(colOf('1.2')) + 1)))
    expect(bar).not.toBe('none')
    expect(step).not.toBe('none')
    expect(bar, 'the bar line must be stronger than a step line, not the same line').not.toBe(step)
    expect(plain).toBe('none')
  })
})

test.describe('ruler labels that do not fit are hidden, never run together (#1843)', () => {
  /** each label: its text, whether it is shown, and its box */
  async function labelBoxes(panel: Locator, attr: string) {
    return panel.locator(`[${attr}]`).evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        return { text: e.textContent ?? '', shown: getComputedStyle(e).visibility !== 'hidden', left: r.left, right: r.right }
      }),
    )
  }
  const touching = (ls: { text: string; shown: boolean; left: number; right: number }[]) => {
    const shown = ls.filter((l) => l.shown)
    return shown.slice(1).flatMap((l, i) => (l.left < shown[i].right ? [`${shown[i].text}|${l.text}`] : []))
  }
  const hh32 = Array(32).fill('hh').join(' ')
  // an alternation used as a step: twelve bars of four steps, crowded at 1024px
  const bars = 'bd hh hh <sd hh cp oh lt mt ht rim cb cr rd sh>'

  test('narrow steps: the shown labels never touch, and the hidden ones sit between them', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    for (const [code, tab, attr] of [
      [`$: s("${hh32}")`, 'sequencer', 'data-seq-ruler-label'],
      [`$: note("${Array(32).fill('c4').join(' ')}").s("piano")`, 'piano-roll', 'data-roll-ruler-label'],
    ] as const) {
      const panel = await open(page, code, tab)
      const ls = await labelBoxes(panel, attr)
      expect(ls, `${tab}: every step keeps its label`).toHaveLength(32)
      expect(touching(ls), `${tab}: shown labels that touch`).toEqual([])
      expect(ls[0].shown, `${tab}: the bar number shows`).toBe(true)
      const hidden = ls.filter((l) => !l.shown).length
      expect(hidden, `${tab}: at 1024px some labels must give way`).toBeGreaterThan(0)
      expect(hidden, `${tab}: and not all of them`).toBeLessThan(31)
    }
  })

  test('bar numbers show before any step label', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    const seq = await open(page, `$: s("${bars}")`, 'sequencer')
    const ls = await labelBoxes(seq, 'data-seq-ruler-label')
    expect(touching(ls)).toEqual([])
    const barLabels = ls.filter((l) => !l.text.includes('.'))
    expect(barLabels.map((l) => l.text)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
    expect(barLabels.every((l) => l.shown), 'every bar number shows').toBe(true)
  })

  test('narrowing the window re-fits the ruler without a re-render', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const seq = await open(page, `$: s("${hh32}")`, 'sequencer')
    expect((await labelBoxes(seq, 'data-seq-ruler-label')).filter((l) => !l.shown)).toEqual([])
    await page.setViewportSize({ width: 1024, height: 900 })
    await expect.poll(async () => touching(await labelBoxes(seq, 'data-seq-ruler-label'))).toEqual([])
    expect((await labelBoxes(seq, 'data-seq-ruler-label')).filter((l) => !l.shown).length).toBeGreaterThan(0)
    // …and widening it again brings them all back
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect.poll(async () => (await labelBoxes(seq, 'data-seq-ruler-label')).filter((l) => !l.shown).length).toBe(0)
  })

  test('with room, every label shows', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const seq = await open(page, `$: s("${hh32}")`, 'sequencer')
    const ls = await labelBoxes(seq, 'data-seq-ruler-label')
    expect(ls.filter((l) => !l.shown).map((l) => l.text)).toEqual([])
    expect(touching(ls)).toEqual([])
  })
})

test.describe('the piano roll keeps its track chip clear of the grid (#1844)', () => {
  async function geometry(roll: Locator) {
    return roll.evaluate((el) => {
      const box = (e: Element | null | undefined) => {
        if (!e) return null
        const b = e.getBoundingClientRect()
        return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }
      }
      const header = el.querySelector('[data-roll-header]')
      return {
        panel: box(el),
        chip: box(header?.firstElementChild),
        hint: box(el.querySelector('[data-roll-no-placement]')),
        scroll: box(el.querySelector('[data-pattern-scroll]')),
        firstCell: box(el.querySelector('[data-roll-cell]')),
      }
    })
  }

  test('the chip sits above the first pitch row, not on it', async ({ page }) => {
    const roll = await open(page, '$: note("[0 ~] [2 [0 2]] [4 4*2] [[4 ~] [2 ~] 0@2]").s("sawtooth")', 'piano-roll')
    const g = await geometry(roll)
    expect(g.chip, 'the track chip is shown').not.toBeNull()
    expect(g.chip!.bottom).toBeLessThanOrEqual(g.scroll!.top)
    expect(g.chip!.bottom).toBeLessThanOrEqual(g.firstCell!.top)
    // and the scroll area ends inside the panel, so the bottom rows are not cut off
    expect(g.scroll!.bottom).toBeLessThanOrEqual(g.panel!.bottom + 0.5)
  })

  test('the edit-only statement shares the chip’s line, beside it', async ({ page }) => {
    // still read leaf by leaf — an `@` beside a `<…>` element — so it cannot take a new
    // note (this was `c3 e3 g3, c5 [d5 e5] f5 g5 a5`, which #1849 opened with its steps)
    const roll = await open(page, '$: note("c4 e4 g4 <d5 e5> ~ g4@2").s("sawtooth")', 'piano-roll')
    const g = await geometry(roll)
    expect(g.hint, 'this melody can only be edited in place').not.toBeNull()
    expect(g.hint!.left).toBeGreaterThanOrEqual(g.chip!.right)
    expect(g.hint!.bottom).toBeLessThanOrEqual(g.scroll!.top)
    expect(g.scroll!.bottom).toBeLessThanOrEqual(g.panel!.bottom + 0.5)
  })
})

/**
 * A pattern made of parts keeps its written steps when one part needs more than the flat
 * reading (#1849). Each part below opened with step lines alone, and together they used to
 * fall to the leaf reading: no step lines, and edit-only.
 */
test.describe('parts that need more than the flat reading keep their steps (#1849)', () => {
  test('grid: `bd@3 sd, hh!6` draws each part its own steps, and is not edit-only', async ({ page }) => {
    const seq = await open(page, '$: s("bd@3 sd, hh!6")', 'sequencer')
    // rows bd, sd (part 0: bd held three steps, then sd) and hh (part 1: six steps)
    const starts = await seq
      .locator('[role="gridcell"][data-seq-step-start="true"] > [data-seq-cell]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-seq-cell')))
    expect(starts).toEqual(['0:3', '0:6', '0:9', '1:3', '1:6', '1:9', '2:2', '2:4', '2:6', '2:8', '2:10'])
    expect(await ruler(seq, 'data-seq-ruler-label')).toEqual(['0=1', '3=1.2', '6=1.3', '9=1.4'])
    await expect(seq.locator('[data-seq-no-placement]')).toHaveCount(0)
  })

  test('roll: parts of different widths share one grid, the lines follow the part with most notes', async ({
    page,
  }) => {
    // 3 and 5 written steps over one bar → 30 shared columns; `c5 [d5 e5] f5 g5 a5` has more notes
    const roll = await open(page, '$: note("c3 e3 g3, c5 [d5 e5] f5 g5 a5").s("piano")', 'piano-roll')
    expect(await ruler(roll, 'data-roll-ruler-label')).toEqual(['0=1', '6=1.2', '12=1.3', '18=1.4', '24=1.5'])
    const cols = await roll
      .locator('[role="gridcell"][data-roll-step-start="true"] > [data-roll-cell]')
      .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-roll-cell')!.split(':')[1]))])
    expect(cols).toEqual(['6', '12', '18', '24'])
    await expect(roll.locator('[data-roll-no-placement]')).toHaveCount(0)
  })
})
