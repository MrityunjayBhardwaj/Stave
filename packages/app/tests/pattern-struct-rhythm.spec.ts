/**
 * #2120 — a rhythm line in `.struct(…)` opens in the Pattern tab with the chords it
 * plays drawn on it, and a step click stays in the line.
 *
 * Before the fix a cursor in a rhythm line bound the chords (`chord(vamp)`), so the
 * line the musician was looking at could not be edited from the grid. The unit suites
 * cover the lookup and the chart against Strudel; this covers the gesture: click into
 * the line, see the chords on it, click a step, and find only that line changed.
 */
import { test, expect, type Page } from '@playwright/test'

const LINE_2 = '~ x x ~ x ~ x x ~ x ~ x x ~ x ~'
const SONG = `const roll = (n, seed) => irand(n).early(seed * 13.7).segment(1).slow(64)
const vamp = "<Em9 A13>"
const clavM = "<1 1 0 1>"
const clav = chord(vamp).voicing()
  .struct(roll(3, 3).pick([
    "x ~ x x ~ x ~ x x ~ x ~ ~ x ~ x",
    "${LINE_2}",
    "x x ~ x ~ x x ~ x ~ ~ x ~ x x ~"
  ]))
  .s("gm_clavinet").clip(0.25).lpf(3000).gain(0.4).mask(clavM)

$: clav`

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('stave:bottomPanel.height', '440')
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.activeTabId', 'pattern')
    } catch {
      /* ignore */
    }
  })
  await page.goto('/')
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () =>
      ((window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco?.editor?.getEditors?.()
        ?.length ?? 0) > 0,
    { timeout: 20_000 },
  )
}

async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    type Ed = { getModel: () => { getLanguageId?: () => string; getValue: () => string; setValue: (s: string) => void } | null }
    const eds = (window as unknown as { monaco: { editor: { getEditors: () => Ed[] } } }).monaco.editor.getEditors()
    return (eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]).getModel()!.getValue()
  })
}

async function seed(page: Page, doc: string): Promise<void> {
  await page.evaluate((c) => {
    type Ed = { getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null }
    const eds = (window as unknown as { monaco: { editor: { getEditors: () => Ed[] } } }).monaco.editor.getEditors()
    ;(eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]).getModel()!.setValue(c)
  }, doc)
}

/** A real click into the code, a few characters into the first line holding `text`.
 *  The point comes from the editor rather than a `.view-line` element, which Monaco
 *  swaps out while it redraws the freshly seeded text. */
async function clickInto(page: Page, text: string): Promise<void> {
  const point = await page.evaluate((t) => {
    type Ed = {
      getModel: () => { getLanguageId?: () => string; getValue: () => string } | null
      getScrolledVisiblePosition: (p: { lineNumber: number; column: number }) => { left: number; top: number; height: number } | null
      getDomNode: () => HTMLElement | null
    }
    const eds = (window as unknown as { monaco: { editor: { getEditors: () => Ed[] } } }).monaco.editor.getEditors()
    const ed = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    const lineNumber = ed.getModel()!.getValue().split('\n').findIndex((l) => l.includes(t)) + 1
    const at = ed.getScrolledVisiblePosition({ lineNumber, column: 8 })
    const rect = ed.getDomNode()!.getBoundingClientRect()
    return at && { x: rect.left + at.left, y: rect.top + at.top + at.height / 2 }
  }, text)
  if (!point) throw new Error(`line holding ${text} is not on screen`)
  await page.mouse.click(point.x, point.y)
}

test.describe('#2120 — a .struct rhythm line', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page)
    await seed(page, SONG)
    await clickInto(page, LINE_2)
  })

  test('draws the chords on the line under the cursor', async ({ page }) => {
    const drawer = page.locator('[data-bottom-panel="root"]')
    const hits = LINE_2.split(' ').filter((s) => s === 'x').length
    // the strip names the chord in each bar, and each chord has its row
    await expect(drawer.locator('[data-rhythm-chord]')).toHaveText(['Em9', 'A13', 'Em9', 'A13'])
    await expect(drawer.locator('[data-rhythm-row]')).toHaveCount(2)
    // four bars: the chords repeat every 2 and the mask `<1 1 0 1>` every 4
    await expect(drawer.locator('[data-rhythm-cell^="0:"]')).toHaveCount(64)
    // Em9 plays the line's hits in bars 1 and 3, A13 in bars 2 and 4; each is greyed in the other's
    await expect(drawer.locator('[data-rhythm-cell^="0:"][aria-pressed="true"]')).toHaveCount(2 * hits)
    await expect(drawer.locator('[data-rhythm-cell^="1:"][aria-pressed="true"]')).toHaveCount(2 * hits)
    await expect(drawer.locator('[data-rhythm-cell^="0:"][data-rhythm-other]')).toHaveCount(32)
    await expect(drawer.locator('[data-rhythm-cell="0:1"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(drawer.locator('[data-rhythm-cell="1:17"]')).toHaveAttribute('aria-pressed', 'true')
  })

  test('a click on an empty step in bar 2 changes that line and nothing else', async ({ page }) => {
    const drawer = page.locator('[data-bottom-panel="root"]')
    await drawer.locator('[data-rhythm-cell="1:16"]').click()
    await expect.poll(() => code(page)).not.toBe(SONG)
    const after = await code(page)
    const changed = SONG.split('\n').flatMap((l, i) => (l === after.split('\n')[i] ? [] : [i + 1]))
    expect({ changed, line7: after.split('\n')[6] }).toEqual({
      changed: [7],
      line7: `    "${LINE_2.replace(/^~/, 'x')}",`,
    })
    // and it shows in both bars
    await expect(drawer.locator('[data-rhythm-cell="0:0"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(drawer.locator('[data-rhythm-cell="1:16"]')).toHaveAttribute('aria-pressed', 'true')
  })

  test('a greyed step is not that chord’s, and a click there writes nothing', async ({ page }) => {
    const drawer = page.locator('[data-bottom-panel="root"]')
    const cell = drawer.locator('[data-rhythm-cell="0:16"]')
    await expect(cell).toHaveAttribute('aria-disabled', 'true')
    // forced: an inert cell is skipped by Playwright's own wait, which is the point
    await cell.click({ force: true })
    // the live control: the same click one row down writes
    await drawer.locator('[data-rhythm-cell="1:16"]').click()
    await expect.poll(() => code(page)).not.toBe(SONG)
    expect((await code(page)).split('\n')[6]).toBe(`    "${LINE_2.replace(/^~/, 'x')}",`)
  })
})

test('#2120 — the .mask silences bar 3: its hits are hollow, and a click there writes nothing', async ({ page }) => {
  await boot(page)
  await seed(page, SONG)
  await clickInto(page, LINE_2)
  const drawer = page.locator('[data-bottom-panel="root"]')
  const hits = LINE_2.split(' ').filter((s) => s === 'x').length
  await expect(drawer.locator('[data-rhythm-chart-line]')).toContainText('Hollow steps are silenced by .mask(…)')
  // bar 3 is Em9's (columns 32–47), and every hit there is silenced; no other bar's is
  await expect(drawer.locator('[data-rhythm-silenced]')).toHaveCount(hits)
  const hollow = drawer.locator('[data-rhythm-cell="0:33"]')
  await expect(hollow).toHaveAttribute('data-rhythm-silenced', 'true')
  await expect(hollow).toHaveAttribute('aria-disabled', 'true')
  await expect(drawer.locator('[data-rhythm-cell="0:1"]')).not.toHaveAttribute('data-rhythm-silenced', 'true')
  // forced past Playwright's own wait for an enabled control; then the live control writes
  await hollow.click({ force: true })
  await drawer.locator('[data-rhythm-cell="1:16"]').click()
  await expect.poll(() => code(page)).not.toBe(SONG)
  expect((await code(page)).split('\n')[6]).toBe(`    "${LINE_2.replace(/^~/, 'x')}",`)
})

test('#2142 — a chord progression written inside chord("…") opens as a chord chart', async ({ page }) => {
  await boot(page)
  await seed(page, '$: chord("<Em9 A13>").voicing().s("piano")')
  await clickInto(page, 'chord("<Em9')
  const drawer = page.locator('[data-bottom-panel="root"]')
  await expect(drawer.locator('[data-seq-chord-chart]')).toContainText('each lane is a chord')
  await expect(drawer.locator('[data-seq-voice]')).toHaveText(['Em9', 'A13'])
})

test('#2120 — on the chords, the chord chart says where its rhythm is', async ({ page }) => {
  await boot(page)
  await seed(page, SONG)
  await clickInto(page, 'chord(vamp)')
  const drawer = page.locator('[data-bottom-panel="root"]')
  await expect(drawer.locator('[data-seq-chord-chart]')).toContainText('.struct(…)')
  await expect(drawer.locator('[data-rhythm-chart]')).toHaveCount(0)
})

test('#2120 — a rhythm bound to a name has no line to open, so the chart does not point at one', async ({ page }) => {
  await boot(page)
  // the chords through a name: a `chord("…")` literal opens no chart at all yet (#2142)
  await seed(page, 'const rh = "x ~ x x"\nconst v = "<Em9 A13>"\n$: chord(v).voicing().struct(rh).s("piano")')
  await clickInto(page, 'chord(v)')
  const chart = page.locator('[data-bottom-panel="root"] [data-seq-chord-chart]')
  await expect(chart).toHaveText('Chord chart — each lane is a chord, not a sound.')
})

test('#2120 — chords and a rhythm that come round past 12 bars say why they are not drawn together', async ({ page }) => {
  await boot(page)
  await seed(page, '$: chord("<Em9 A13 Dm7 G7 Cmaj7>").voicing()\n  .struct(\n    "<[x ~] [~ x] [x x]>"\n  ).s("piano")')
  await clickInto(page, '"<[x ~]')
  const drawer = page.locator('[data-bottom-panel="root"]')
  await expect(drawer.locator('[data-seq-notice]')).toContainText('come round after 15 bars, more than the 12 this grid draws')
  await expect(drawer.locator('[data-rhythm-chart]')).toHaveCount(0)
})
