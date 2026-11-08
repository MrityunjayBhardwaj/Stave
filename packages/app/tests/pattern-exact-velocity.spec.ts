/**
 * Velocity per step on the Exact step grid (#2468), and the click under a gain rest (#2467).
 *
 * Real pointer gestures in the real app. Each drag reads the code back from the editor and
 * asks the page's own Strudel what `s(…).gain(…)` now plays, hit by hit, because the unit
 * tests pin the writer and only the panel shows a drag reaches it.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'
import { expectRefusalReported } from './_console'

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

/** what `s(sound).gain(gain)` plays in cycle 0, as `sound@begin=level`, asked of the page's own Strudel */
async function heard(page: Page, code: string): Promise<string[]> {
  const m = /s\("([^"]*)"\)(?:\.gain\("([^"]*)"\))?/.exec(code)
  if (!m) throw new Error(`no s("…") in ${code}`)
  await page.waitForFunction(() => typeof (window as unknown as { mini?: unknown }).mini === 'function')
  const out = await page.evaluate(([sm, gm]) => {
    type Hap = { hasOnset: () => boolean; value: Record<string, unknown>; whole: { begin: { toFraction: () => string } } }
    type Pat = { s: () => Pat; gain: (p: Pat) => Pat; queryArc: (a: number, b: number) => Hap[] }
    const mini = (window as unknown as { mini: (s: string) => Pat }).mini
    const p = gm === null ? mini(sm).s() : mini(sm).s().gain(mini(gm))
    return p
      .queryArc(0, 1)
      .filter((h) => h.hasOnset())
      .map((h) => `${String(h.value.s)}@${h.whole.begin.toFraction()}=${String(h.value.gain ?? 1)}`)
  }, [m[1], m[2] ?? null] as const)
  return out.sort()
}

/** press the middle of a cell and drag it `dy` px (down is positive), in small moves like a hand */
async function dragUpDown(page: Page, target: Locator, dy: number): Promise<void> {
  const box = await target.boundingBox()
  if (!box) throw new Error('cell has no box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + dy, { steps: 8 })
  await page.mouse.up()
}

test.describe('velocity per step in Exact (#2468)', () => {
  test('no .gain: a drag writes a new one that mirrors the steps, and the hit plays at its level', async ({ page }) => {
    const grid = await open(page, '$: s("bd [hh hh] sd hh")')
    const bd = await rowOf(grid, 'bd')
    await dragUpDown(page, cell(grid, bd, 0, '0/1'), 40)
    const want = '$: s("bd [hh hh] sd hh").gain("0.5 [1 1] 1 1")'
    await expect.poll(() => editorValue(page)).toBe(want)
    expect(await heard(page, want)).toEqual(['bd@0=0.5', 'hh@1/4=1', 'hh@3/4=1', 'hh@3/8=1', 'sd@1/2=1'])
    await expect(cell(grid, bd, 0, '0/1')).toHaveAttribute('data-gain', '0.5')
  })

  test('an existing .gain: the hit’s own level is rewritten in place, and its fill is that tall', async ({ page }) => {
    const grid = await open(page, '$: s("bd ~ sd ~").gain("0.5 ~ 1 ~")')
    const sd = await rowOf(grid, 'sd')
    const fill = grid.locator(`[data-tree-row="sd"] [data-seq-fill]`)
    const full = (await fill.boundingBox())!.height
    await dragUpDown(page, cell(grid, sd, 0, '1/2'), 20)
    const want = '$: s("bd ~ sd ~").gain("0.5 ~ 0.75 ~")'
    await expect.poll(() => editorValue(page)).toBe(want)
    expect(await heard(page, want)).toEqual(['bd@0=0.5', 'sd@1/2=0.75'])
    await expect(cell(grid, sd, 0, '1/2')).toHaveAttribute('data-gain', '0.75')
    await expect.poll(async () => Math.round(((await fill.boundingBox())!.height / full) * 100)).toBe(75)
  })

  test('one hit of a level its own op repeats: only that hit changes', async ({ page }) => {
    const grid = await open(page, '$: s("hh*4").gain("1*4")')
    const hh = await rowOf(grid, 'hh')
    await dragUpDown(page, cell(grid, hh, 0, '1/4'), 40)
    const want = '$: s("hh*4").gain("[1 0.5 1 1]")'
    await expect.poll(() => editorValue(page)).toBe(want)
    expect(await heard(page, want)).toEqual(['hh@0=1', 'hh@1/2=1', 'hh@1/4=0.5', 'hh@3/4=1'])
  })

  test('one drag is one undo step', async ({ page }) => {
    const code = '$: s("bd sd")'
    const grid = await open(page, code)
    const sd = await rowOf(grid, 'sd')
    await dragUpDown(page, cell(grid, sd, 0, '1/2'), 60)
    await expect.poll(() => editorValue(page)).toBe('$: s("bd sd").gain("1 0.25")')
    await cell(grid, sd, 0, '1/2').focus()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => editorValue(page)).toBe(code)
  })

  test('a drag the .gain cannot take writes nothing, says why, and the cell still clicks', async ({ page }) => {
    const code = '$: s("bd sd hh cp").gain("0.5 1")'
    const grid = await open(page, code)
    const bd = await rowOf(grid, 'bd')
    // velocity is not offered where the writer refuses it: the cell makes no claim of a level (#1839)
    await expect(cell(grid, bd, 0, '0/1')).not.toHaveAttribute('data-gain', /.*/)
    await dragUpDown(page, cell(grid, bd, 0, '0/1'), 40)
    await page.waitForTimeout(300)
    expect(await editorValue(page)).toBe(code)
    await expectRefusalReported(page, "Couldn't change that hit's velocity", 'also covers other places')
    await cell(grid, bd, 0, '0/1').click()
    await expect.poll(() => editorValue(page)).toBe('$: s("~ sd hh cp").gain("0.5 1")')
  })
})

test.describe('a click under a .gain rest (#2467)', () => {
  test('is refused and says why: the hit would play nothing', async ({ page }) => {
    const code = '$: s("bd ~ sd ~").gain("0.5 ~ 1 ~")'
    const grid = await open(page, code)
    const bd = await rowOf(grid, 'bd')
    const under = cell(grid, bd, 0, '1/4')
    await expect(under).toHaveAttribute('data-seq-cell-inert', 'true')
    await expect(under).toHaveAttribute('title', /\.gain has a rest/)
    await under.click({ force: true })
    await page.waitForTimeout(300)
    expect(await editorValue(page)).toBe(code)
    // CONTROL: a place the gain covers still takes the click
    await cell(grid, bd, 0, '1/2').click()
    const want = '$: s("bd ~ [bd,sd] ~").gain("0.5 ~ 1 ~")'
    await expect.poll(() => editorValue(page)).toBe(want)
    expect(await heard(page, want)).toEqual(['bd@0=0.5', 'bd@1/2=1', 'sd@1/2=1'])
  })
})
