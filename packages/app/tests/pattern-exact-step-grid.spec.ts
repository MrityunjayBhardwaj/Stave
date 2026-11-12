/**
 * The step grid in Exact: drawn and edited from the bar's tree, with no equal columns (#2458).
 *
 * Real pointer and keyboard gestures in the real app. Each edit reads the code back from the
 * editor, and asks the page's own Strudel what it now plays, because the unit tests pin the
 * writer and the cells and only the panel shows a press reaches them.
 *
 * Cells are named `row:bar:n/d`, an exact share of the bar: there are no columns to name.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue, evalCode, stopCode } from './_appBoot'

async function open(page: Page, code: string): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 460 } })
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await seedCode(page, code)
  const grid = page.locator('[data-exact-grid]')
  await expect(grid, `the Exact grid must open for ${code}`).toHaveCount(1)
  await expect(grid.locator('[data-seq-cell]').first()).toBeVisible()
  return grid
}

async function rowOf(grid: Locator, sound: string): Promise<number> {
  const labels = await grid.locator('[data-seq-voice]').evaluateAll((els) => els.map((e) => e.getAttribute('data-seq-voice')))
  const i = labels.indexOf(sound)
  expect(i, `a row for ${sound} (rows: ${labels.join(', ')})`).toBeGreaterThanOrEqual(0)
  return i
}
const cell = (grid: Locator, row: number, bar: number, at: string): Locator => grid.locator(`[data-seq-cell="${row}:${bar}:${at}"]`)

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
async function writes(page: Page, target: Locator, want: string, heard: string[]): Promise<void> {
  await target.click()
  await expect.poll(() => editorValue(page)).toBe(want)
  expect(await plays(page, want), want).toEqual([...heard].sort())
}

test.describe('the step grid in Exact (#2458)', () => {
  test('a click erases a note and fills a rest, at any depth, in the step’s own text', async ({ page }) => {
    const code = '$: s("bd [~ bd] sd [hh [~ cp]]")'
    const grid = await open(page, code)
    const bd = await rowOf(grid, 'bd')
    const cp = await rowOf(grid, 'cp')
    await writes(page, cell(grid, bd, 0, '1/4'), '$: s("bd [bd bd] sd [hh [~ cp]]")', ['bd@0', 'bd@1/4', 'bd@3/8', 'sd@1/2', 'hh@3/4', 'cp@15/16'])
    await writes(page, cell(grid, bd, 0, '1/4'), code, ['bd@0', 'bd@3/8', 'sd@1/2', 'hh@3/4', 'cp@15/16'])
    await writes(page, cell(grid, cp, 0, '7/8'), '$: s("bd [~ bd] sd [hh [cp cp]]")', ['bd@0', 'bd@3/8', 'sd@1/2', 'hh@3/4', 'cp@7/8', 'cp@15/16'])
  })

  test('a row a click empties stays, and a click on it puts the note back', async ({ page }) => {
    const grid = await open(page, '$: s("bd sd")')
    const sd = await rowOf(grid, 'sd')
    await writes(page, cell(grid, sd, 0, '1/2'), '$: s("bd ~")', ['bd@0'])
    expect(await rowOf(grid, 'sd')).toBe(sd)
    await writes(page, cell(grid, sd, 0, '1/2'), '$: s("bd sd")', ['bd@0', 'sd@1/2'])
  })

  test('one hit of a generator writes out only that step', async ({ page }) => {
    const grid = await open(page, '$: s("hh*4 sd")')
    const hh = await rowOf(grid, 'hh')
    await writes(page, cell(grid, hh, 0, '1/8'), '$: s("[hh ~ hh hh] sd")', ['hh@0', 'hh@1/4', 'hh@3/8', 'sd@1/2'])
  })

  test('a euclid hit clicked off and on again is the euclid it was (#2437)', async ({ page }) => {
    const code = '$: s("bd(3,8) sd")'
    const grid = await open(page, code)
    const bd = await rowOf(grid, 'bd')
    await writes(page, cell(grid, bd, 0, '3/16'), '$: s("[bd ~ ~ ~ ~ ~ bd ~] sd")', ['bd@0', 'bd@3/8', 'sd@1/2'])
    await writes(page, cell(grid, bd, 0, '3/16'), code, ['bd@0', 'bd@3/16', 'bd@3/8', 'sd@1/2'])
  })

  test('a pattern too fine for columns opens and edits', async ({ page }) => {
    const code = '$: s("hh hh [hh hh] hh [hh hh hh] hh hh [hh hh hh hh]")'
    const grid = await open(page, code)
    await expect(page.locator('[data-tree-grid]')).toHaveCount(0)
    const hh = await rowOf(grid, 'hh')
    await cell(grid, hh, 0, '1/8').click()
    await expect.poll(() => editorValue(page)).toBe('$: s("hh ~ [hh hh] hh [hh hh hh] hh hh [hh hh hh hh]")')
  })

  test('a refused cell is inert, says why, and a click writes nothing', async ({ page }) => {
    const code = '$: s("hh*<2 4> sd")'
    const grid = await open(page, code)
    const hh = await rowOf(grid, 'hh')
    const target = cell(grid, hh, 0, '0/1')
    await expect(target).toHaveAttribute('data-seq-cell-inert', 'true')
    await expect(target).toHaveAttribute('title', /operator/)
    await target.click({ force: true })
    expect(await editorValue(page)).toBe(code)
  })

  test('a paint drag fills the steps it crosses as one undo step, and stays in its row', async ({ page }) => {
    const code = '$: s("bd ~ ~ ~, hh ~ ~ ~")'
    const grid = await open(page, code)
    const bd = await rowOf(grid, 'bd')
    const a = await cell(grid, bd, 0, '1/4').boundingBox()
    const b = await cell(grid, bd, 0, '3/4').boundingBox()
    await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2)
    await page.mouse.down()
    await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 12 })
    await page.mouse.up()
    await expect.poll(() => editorValue(page)).toBe('$: s("bd bd bd bd, hh ~ ~ ~")')
  })

  test('a paint drag passes over a step’s snap halves, and does not leave its row', async ({ page }) => {
    const grid = await open(page, '$: s("bd [hh hh] ~ ~")')
    const bd = await rowOf(grid, 'bd')
    const hh = await rowOf(grid, 'hh')
    // the snap halves of the two rests are drawn wide enough to enter
    await expect(cell(grid, bd, 0, '5/8')).toHaveAttribute('data-seq-splits', 'true')
    const a = await cell(grid, bd, 0, '1/2').boundingBox()
    const half = await cell(grid, bd, 0, '5/8').boundingBox()
    const b = await cell(grid, bd, 0, '3/4').boundingBox()
    const other = await cell(grid, hh, 0, '3/4').boundingBox()
    await page.mouse.move(a!.x + 4, a!.y + a!.height / 2)
    await page.mouse.down()
    await page.mouse.move(half!.x + half!.width / 2, half!.y + half!.height / 2, { steps: 6 })
    await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 6 })
    // and wander into the row below, over a rest of its own
    await page.mouse.move(other!.x + other!.width / 2, other!.y + other!.height / 2, { steps: 4 })
    await page.mouse.up()
    await expect.poll(() => editorValue(page)).toBe('$: s("bd [hh hh] bd bd")')
  })

  test('the length handle sets a note’s length in its own text', async ({ page }) => {
    const grid = await open(page, '$: s("bd ~ ~ ~")')
    const handle = grid.locator('[data-seq-resize]').first()
    await expect(handle).toBeVisible()
    const h = await handle.boundingBox()
    const bd = await rowOf(grid, 'bd')
    const to = await cell(grid, bd, 0, '1/4').boundingBox()
    await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2)
    await page.mouse.down()
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => editorValue(page)).toBe('$: s("bd@2 ~ ~")')
  })

  test('a note held into a `~@n` rest shortens the rest and keeps its `@` (#2541)', async ({ page }) => {
    const grid = await open(page, '$: s("bd ~@3 sd")')
    const bd = await rowOf(grid, 'bd')
    await cell(grid, bd, 0, '0/1').focus()
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await expect.poll(() => editorValue(page)).toBe('$: s("bd@2 ~@2 sd")')
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await expect.poll(() => editorValue(page)).toBe('$: s("bd@3 ~ sd")')
  })

  test('the arrow keys walk steps across rows, and Enter edits the step under the cursor', async ({ page }) => {
    const grid = await open(page, '$: s("bd [~ sd]")')
    const bd = await rowOf(grid, 'bd')
    const first = cell(grid, bd, 0, '0/1')
    await first.focus()
    await page.keyboard.press('ArrowRight')
    await expect(grid.locator('[aria-selected="true"]')).toHaveAttribute('data-seq-at', '0.500000')
    await page.keyboard.press('ArrowRight')
    await expect(grid.locator('[aria-selected="true"]')).toHaveAttribute('data-seq-at', '0.750000')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowDown')
    await expect(grid.locator('[aria-selected="true"]')).toHaveAttribute('data-seq-cell', /^1:/)
    await page.keyboard.press('Enter')
    await expect.poll(() => editorValue(page)).toBe('$: s("bd [sd sd]")')
    // the cursor stays in the grid, so the next key still lands
    await page.keyboard.press('Enter')
    await expect.poll(() => editorValue(page)).toBe('$: s("bd [~ sd]")')
  })

  test('add a voice: it stays staged until its first hit, which writes it; remove takes it out', async ({ page }) => {
    const grid = await open(page, '$: s("bd ~")')
    await grid.locator('[data-seq-add-voice]').selectOption('sd')
    const sd = await rowOf(grid, 'sd')
    expect(await editorValue(page)).toBe('$: s("bd ~")')
    await writes(page, cell(grid, sd, 0, '1/2'), '$: s("bd sd")', ['bd@0', 'sd@1/2'])
    await grid.locator('[data-seq-remove-voice="sd"]').click()
    await expect.poll(() => editorValue(page)).toBe('$: s("bd ~")')
    await expect(grid.locator('[data-seq-voice="sd"]')).toHaveCount(0)
  })

  test('the + handle adds a bar that continues the pattern', async ({ page }) => {
    const grid = await open(page, '$: s("bd sd")')
    await grid.locator('[data-extend-handle], button[aria-label*="bar"]').first().click()
    await expect.poll(() => editorValue(page)).not.toBe('$: s("bd sd")')
    await expect(page.locator('[data-exact-grid]')).toHaveAttribute('data-tree-bars', '2')
  })

  test('zoom opens a group, and the ruler names its steps', async ({ page }) => {
    const grid = await open(page, '$: s("bd [hh [cp cp]] sd ~")')
    const labels = (): Promise<string[]> => grid.locator('[data-seq-ruler-label]').evaluateAll((els) => els.map((e) => e.textContent ?? ''))
    expect(await labels()).toEqual(['1', '1.2', '1.3', '1.4'])
    for (let i = 0; i < 6; i++) await grid.getByRole('button', { name: /zoom in/i }).click()
    expect(await labels()).toEqual(expect.arrayContaining(['1.2.2']))
    const bd = await rowOf(grid, 'bd')
    await expect(cell(grid, bd, 0, '1/8')).toHaveAttribute('data-seq-splits', 'true')
  })

  test('the playhead moves at the exact position while the pattern plays', async ({ page }) => {
    const grid = await open(page, '$: s("bd sd hh cp")')
    await evalCode(page)
    const line = grid.locator('[data-seq-playhead-line]')
    await expect(line).toBeVisible({ timeout: 15000 })
    const first = await line.getAttribute('data-tree-playhead')
    await expect.poll(() => line.getAttribute('data-tree-playhead')).not.toBe(first)
    await expect(grid.locator('[data-seq-cell][data-playing="true"]').first()).toBeVisible()
    await stopCode(page)
  })

  test('⌘Z after a step click undoes it, and ⌘⇧Z redoes it, while the cursor stays in the grid', async ({ page }) => {
    const grid = await open(page, '$: s("bd ~")')
    const bd = await rowOf(grid, 'bd')
    await cell(grid, bd, 0, '1/2').click()
    await expect.poll(() => editorValue(page)).toBe('$: s("bd bd")')
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => editorValue(page)).toBe('$: s("bd ~")')
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect.poll(() => editorValue(page)).toBe('$: s("bd bd")')
  })

  test('a `-` rest is a place to fill, and `[bd hh]*2` draws both copies, an edit changing the step written once', async ({ page }) => {
    const grid = await open(page, '$: s("bd - bd")')
    const bd = await rowOf(grid, 'bd')
    await expect(cell(grid, bd, 0, '1/3')).toHaveAttribute('aria-pressed', 'false')
    await writes(page, cell(grid, bd, 0, '1/3'), '$: s("bd bd bd")', ['bd@0', 'bd@1/3', 'bd@2/3'])
    await seedCode(page, '$: s("[bd hh]*2")')
    const hh = await rowOf(grid, 'hh')
    await expect(cell(grid, hh, 0, '3/4')).toHaveAttribute('aria-pressed', 'true')
    await writes(page, cell(grid, hh, 0, '3/4'), '$: s("[bd ~]*2")', ['bd@0', 'bd@1/2'])
  })

  test('a sound-first line names the note each step plays', async ({ page }) => {
    const grid = await open(page, '$: s("piano piano").note("c3 e3")')
    await expect(grid.locator('[data-seq-sound-first]')).toBeVisible()
    await expect(grid.locator('[data-seq-step-note-label]')).toHaveText(['c3', 'e3'])
  })

  test('a chord chart says where its rhythm is', async ({ page }) => {
    const grid = await open(page, '$: chord("<C F>").struct("x x")')
    await expect(grid.locator('[data-seq-chord-chart]')).toContainText('.struct')
    await expect(grid.locator('[data-seq-add-voice]')).toHaveCount(0)
  })

  test('each part sits at its own steps, every step editable, and their edges line up', async ({ page }) => {
    const grid = await open(page, '$: s("bd ~ ~ ~, ~ sd ~ sd, hh*8")')
    const [bd, sd, hh] = [await rowOf(grid, 'bd'), await rowOf(grid, 'sd'), await rowOf(grid, 'hh')]
    await expect(grid.locator(`[data-seq-cell^="${bd}:"]`)).toHaveCount(4)
    await expect(grid.locator(`[data-seq-cell^="${sd}:"]`)).toHaveCount(4)
    await expect(grid.locator(`[data-seq-cell^="${hh}:"]`)).toHaveCount(8)
    await expect(grid.locator('[data-seq-cell-inert="true"]')).toHaveCount(0)
    await expect(grid.getByRole('gridcell', { name: 'sd step 2', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.getByRole('gridcell', { name: 'sd step 3', exact: true })).toHaveAttribute('aria-pressed', 'false')
    // a snare step stands over exactly the two hats of its time
    const box = await cell(grid, sd, 0, '1/4').boundingBox()
    const h3 = await cell(grid, hh, 0, '1/4').boundingBox()
    const h4 = await cell(grid, hh, 0, '3/8').boundingBox()
    expect(Math.abs(box!.x - h3!.x)).toBeLessThan(1)
    expect(Math.abs(box!.x + box!.width - (h4!.x + h4!.width))).toBeLessThan(1)
  })

  test('keys step over a whole step and act on it; ↓ lands on the step playing then, and ↑ comes back', async ({ page }) => {
    const grid = await open(page, '$: s("~ sd ~ sd, hh*8")')
    const selected = grid.locator('[role="gridcell"][aria-selected="true"]')
    await grid.getByRole('gridcell', { name: 'sd step 2', exact: true }).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(selected).toHaveAttribute('aria-label', 'sd step 1')
    await page.keyboard.press('ArrowDown')
    await expect(selected).toHaveAttribute('aria-label', 'hh step 1')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowRight')
    await expect(selected).toHaveAttribute('aria-label', 'sd step 2')
    await page.keyboard.press('ArrowDown')
    await expect(selected).toHaveAttribute('aria-label', 'hh step 3')
    await page.keyboard.press('ArrowUp')
    await expect(selected).toHaveAttribute('aria-label', 'sd step 2')
    // each hat of `hh*8` is edited on its own, so each is a step the arrows stop on
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowRight')
    await expect(selected).toHaveAttribute('aria-label', 'hh step 4')
    // back up to the snare's row, one step on, and the key edits the step it is on
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect.poll(() => editorValue(page)).toBe('$: s("~ sd sd sd, hh*8")')
  })

  test('the length handle on a step of its own part drags by whole steps of that part', async ({ page }) => {
    const grid = await open(page, '$: s("~ sd ~ ~, hh*8")')
    const sd = await rowOf(grid, 'sd')
    const handle = grid.locator(`[data-seq-resize="${sd}:0:1/4"]`)
    await expect(handle).toHaveCount(1)
    const h = await handle.boundingBox()
    const t = await cell(grid, sd, 0, '1/2').boundingBox()
    await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2)
    await page.mouse.down()
    await page.mouse.move(t!.x + t!.width / 2, t!.y + t!.height / 2, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => editorValue(page)).toBe('$: s("~ sd@2 ~, hh*8")')
  })

  test('a row as the text writes it: plain steps, a step holding two as small boxes, hh*8 one step with 8 places', async ({ page }) => {
    const grid = await open(page, '$: s("bd [~ bd] sd ~, hh*8")')
    const bd = await rowOf(grid, 'bd')
    const hh = await rowOf(grid, 'hh')
    const row = (r: number): Locator => grid.locator('[role="row"][data-tree-row]').nth(r)
    await expect(row(bd).locator('[data-tree-step]')).toHaveCount(4)
    await expect(row(bd).locator('[data-tree-inner]')).toHaveCount(2)
    await expect(row(hh).locator('[data-tree-step]')).toHaveCount(1)
    await expect(grid.locator(`[data-seq-cell^="${hh}:"]`)).toHaveCount(8)
    const inner = await row(bd).locator('[data-tree-inner]').first().boundingBox()
    const plain = await row(bd).locator('[data-tree-step]').first().boundingBox()
    expect(inner!.height).toBeLessThan(plain!.height - 4)
  })

  test('steps come from the pattern itself, each bar in turn, with a line before each step', async ({ page }) => {
    const grid = await open(page, '$: s("<bd [~ bd]>@2 hh@2 bd <bd ~> [hh bd] [~ hh]")')
    const labels = await grid.locator('[data-seq-ruler-label]').evaluateAll((els) => els.map((e) => e.textContent ?? ''))
    const bar = (b: number): string[] => ['', '.2', '.3', '.4', '.5', '.6', '.7'].map((x) => `${b}${x}`)
    expect(labels).toEqual([...bar(1), ...bar(2)])
    // six lines a bar, in both rows, over two bars
    await expect(grid.locator('[data-tree-line]')).toHaveCount(24)
  })

  test('1× keeps every step closed; zooming in opens the levels the text writes, and the ruler names them', async ({ page }) => {
    const grid = await open(page, '$: s("bd [hh [hh hh]] sd [~ cp]")')
    const labels = (): Promise<string[]> => grid.locator('[data-seq-ruler-label]').evaluateAll((els) => els.map((e) => e.textContent ?? ''))
    await expect(grid.locator('[data-grid-zoom-level]')).toHaveText('1×')
    expect(await labels()).toEqual(['1', '1.2', '1.3', '1.4'])
    await grid.locator('[data-grid-zoom-in]').click()
    await expect(grid.locator('[data-grid-zoom-level]')).toHaveText('1.5×')
    await expect.poll(labels).toEqual(['1', '1.2', '1.2.2', '1.2.2.2', '1.3', '1.4', '1.4.2'])
    await grid.locator('[data-grid-zoom-out]').click()
    await expect.poll(labels).toEqual(['1', '1.2', '1.3', '1.4'])
  })

  test('a click on a step is the same edit whether the step it sits in is open or not', async ({ page }) => {
    const code = '$: s("bd [hh [hh hh]] sd [~ cp]")'
    let grid = await open(page, code)
    let sd = await rowOf(grid, 'sd')
    await cell(grid, sd, 0, '3/8').click()
    await expect.poll(() => editorValue(page)).not.toBe(code)
    const closed = await editorValue(page)
    grid = await open(page, code)
    sd = await rowOf(grid, 'sd')
    await grid.locator('[data-grid-zoom-in]').click()
    await cell(grid, sd, 0, '3/8').click()
    await expect.poll(() => editorValue(page)).not.toBe(code)
    expect(await editorValue(page)).toBe(closed)
  })

  test('CONTROL: a pattern that plays numbers does not open as a row of sounds', async ({ page }) => {
    await bootApp(page, { drawer: { tabId: 'pattern', height: 460 } })
    await seedCode(page, '$: note("0 2 4")')
    await expect(page.locator('[data-exact-grid]')).toHaveCount(0)
  })
})
