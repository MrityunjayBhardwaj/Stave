/**
 * What the step grids do with a chain's `.gain`: they read it and never write it (#2606).
 *
 *  - a click under a gain rest is refused and says why: the hit would play nothing (#2467);
 *  - no cell offers a velocity, and a vertical drag on a lit cell is a click, in both grids;
 *  - Settings has no velocity drag switch any more;
 *  - Note Colour = By velocity tints each hit by the level it plays at, in both grids.
 *
 * Real pointer gestures in the real app, with the code read back from the editor and, for the
 * gain rest, what the page's own Strudel plays, hit by hit.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'

async function open(page: Page, code: string, gridMode: 'exact' | 'lcm' = 'exact'): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 460 }, gridMode })
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await seedCode(page, code)
  const grid = page.locator('[data-bottom-panel-tab="sequencer"]')
  await expect(grid.locator('[data-seq-cell]').first(), `the ${gridMode} grid must open for ${code}`).toBeVisible()
  if (gridMode === 'exact') await expect(page.locator('[data-exact-grid]')).toHaveCount(1)
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

test.describe('the step grids do not edit velocity (#2606)', () => {
  for (const mode of ['exact', 'lcm'] as const) {
    test(`${mode}: no cell claims a level, and a vertical drag on a lit cell is a click`, async ({ page }) => {
      const code = '$: s("bd sd").gain("0.5 1")'
      const grid = await open(page, code, mode)
      const lit = grid.locator('[data-seq-cell][aria-pressed="true"]')
      // CONTROL: the lit cells are drawn, so "no data-gain" is about velocity, not an empty grid
      await expect(lit).toHaveCount(2)
      expect(await lit.evaluateAll((els) => els.map((e) => e.getAttribute('data-gain')))).toEqual([null, null])
      await dragUpDown(page, lit.first(), 40)
      // the press erased bd, as a click does, and the .gain is exactly as written
      await expect.poll(() => editorValue(page)).toBe('$: s("~ sd").gain("0.5 1")')
    })
  }

  test('Settings has no velocity drag switch', async ({ page }) => {
    await open(page, '$: s("bd sd")')
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByText('Editor Settings...').click()
    await page.getByTestId('settings-shell').waitFor({ timeout: 5000 })
    await page.getByTestId('settings-nav-pattern').click()
    // CONTROL: the Pattern & Timeline section is showing
    await expect(page.getByTestId('setting-noteColor')).toBeVisible()
    await expect(page.getByTestId('setting-velocityDrag')).toHaveCount(0)
  })
})

test.describe('Note Colour = By velocity tints each hit by its level (#428, #2606)', () => {
  for (const mode of ['exact', 'lcm'] as const) {
    test(`${mode}: loud and soft hits differ in colour, and every hit is full height`, async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem('stave:visualEdit.noteColorMode', 'velocity'))
      const grid = await open(page, '$: s("bd bd bd bd").gain("1 0.2 1 0.2")', mode)
      const fills = grid.locator('[data-seq-fill]')
      await expect(fills).toHaveCount(4)
      const looks = await fills.evaluateAll((els) =>
        els.map((e) => {
          const r = (e as HTMLElement).getBoundingClientRect()
          return { color: getComputedStyle(e as HTMLElement).backgroundColor, height: Math.round(r.height) }
        }),
      )
      // loud hits share one colour, soft hits another
      expect(looks[0].color).toBe(looks[2].color)
      expect(looks[1].color).toBe(looks[3].color)
      expect(looks[0].color).not.toBe(looks[1].color)
      // velocity is not drawn as height any more: one height for all
      expect(new Set(looks.map((l) => l.height)).size).toBe(1)
    })
  }
})
