/**
 * The piano roll drawn from the pattern's own divisions (#1834, epic #1832).
 *
 * A melody the roll's columns cannot hold — an onset between them, a note held for 15
 * sixteenths of a sixteenth — used to open as "isn't grid-editable". It now draws
 * look-only from Strudel's tree: every note at its exact time and length on its pitch,
 * the part's steps as lines, the ruler naming them by place, zoom opening levels.
 *
 * Observed in the REAL app with the real mouse and wheel. The melody is a real one from
 * the corpus (`C4 D4 [A5 Bb5@15] A5 C4 D4 Eb4 D4`).
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootApp, seedCode, editorValue } from './_appBoot'

const MELODY = '$: note("C4 D4 [A5 Bb5@15] A5 C4 D4 Eb4 D4").s("piano")'

async function open(page: Page, code: string): Promise<Locator> {
  await bootApp(page, { drawer: { tabId: 'pattern', height: 460 } })
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await seedCode(page, code)
  const roll = page.locator('[data-tree-roll]')
  await expect(roll, `the tree roll must open for ${code}`).toHaveCount(1)
  return roll
}

const labels = (roll: Locator): Promise<string[]> =>
  roll.locator('[data-roll-ruler-label]').evaluateAll((els) => els.map((e) => e.textContent ?? ''))

/** each note's pitch and its start and length as shares of the bar, read off the screen */
const notesOnScreen = (roll: Locator): Promise<string[]> =>
  roll.evaluate((el) => {
    const track = el.querySelector('[role="cell"]')!.getBoundingClientRect()
    return [...el.querySelectorAll<HTMLElement>('[data-tree-note]')].map((n) => {
      const r = n.getBoundingClientRect()
      return `${n.dataset.treeNote}@${((r.left - 1 - track.left) / track.width).toFixed(3)}+${((r.width + 1) / track.width).toFixed(3)}`
    })
  })

test.describe('a piano roll drawn from the tree, look-only (#1834)', () => {
  test('every note at its exact time and length, on its pitch; the ruler names the eight steps; a click writes nothing', async ({ page }) => {
    const roll = await open(page, MELODY)
    await expect(roll.locator('[data-roll-look-only]')).toContainText('Look only')
    await expect(roll.locator('[data-tree-note]')).toHaveCount(9)
    expect(await labels(roll)).toEqual(['1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8'])
    const notes = await notesOnScreen(roll)
    // C4 D4, then A5 a sixteenth of the third eighth, Bb5 the other fifteen
    expect(notes.slice(0, 4)).toEqual(['60@0.000+0.125', '62@0.125+0.125', '81@0.250+0.008', '82@0.258+0.117'])
    // the rows run from the lowest note to the highest
    const keys = await roll.locator('[data-roll-key]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-roll-key'))))
    expect(keys[0]).toBe(82)
    expect(keys[keys.length - 1]).toBe(60)

    const before = await editorValue(page)
    const n = (await roll.locator('[data-tree-note]').nth(1).boundingBox())!
    await page.mouse.click(n.x + n.width / 2, n.y + n.height / 2)
    await page.mouse.dblclick(n.x + 3, n.y + n.height / 2)
    expect(await editorValue(page)).toBe(before)
  })

  test('zooming in opens the step that holds two notes, and the notes stay where they play', async ({ page }) => {
    const roll = await open(page, MELODY)
    const at1 = await notesOnScreen(roll)
    // over the top rows (the low notes sit below the panel's fold)
    const n = (await roll.locator('[data-roll-key]').first().boundingBox())!
    await page.mouse.move(n.x + n.width + 40, n.y + n.height / 2)
    await page.keyboard.down('Control')
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, -100)
      await page.waitForTimeout(60)
    }
    await page.keyboard.up('Control')
    await expect(roll.locator('[data-grid-zoom-level]')).toHaveText('16×')
    await expect.poll(() => labels(roll)).toContain('1.3.2')
    // `[A5 Bb5@15]` is sixteen steps the way Strudel counts `@` (#1845): fifteen lines inside it
    await expect(roll.locator('[data-tree-line="2"]')).toHaveCount(15)
    await roll.evaluate((el) => { el.scrollLeft = 0 })
    expect(await notesOnScreen(roll)).toEqual(at1)
  })

  test('a melody of numbers draws on its numbers\' rows', async ({ page }) => {
    const roll = await open(page, '$: n("0 [2 [4 [7*4 [9]]]] 5 [~ 3]").scale("C:major").s("piano")')
    const keys = await roll.locator('[data-roll-key]').evaluateAll((els) => els.map((e) => e.textContent))
    expect(keys[0]).toBe('9')
    expect(keys[keys.length - 1]).toBe('0')
    await expect(roll.locator('[data-tree-note]')).toHaveCount(10)
    expect(await labels(roll)).toEqual(['1', '1.2', '1.3', '1.4'])
  })

  test('the playhead moves with the exact position playing', async ({ page }) => {
    const roll = await open(page, MELODY)
    await page.evaluate(() => {
      const eds = (window as unknown as { monaco: { editor: { getEditors: () => { getModel: () => { getValue: () => string } | null; focus: () => void }[] } } }).monaco.editor.getEditors()
      ;(eds.find((e) => e.getModel()?.getValue().includes('$:')) ?? eds[0]).focus()
    })
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Enter`)
    const head = roll.locator('[data-tree-playhead-line]')
    await expect(head).toBeVisible({ timeout: 10_000 })
    const t: number[] = []
    for (let i = 0; i < 8; i++) {
      const v = await head.getAttribute('data-tree-playhead')
      if (v !== null) t.push(Number(v))
      await page.waitForTimeout(37)
    }
    expect(new Set(t).size).toBeGreaterThan(4)
    expect(t.some((v) => Math.abs(v * 8 - Math.round(v * 8)) > 0.05)).toBe(true)
  })

  test('CONTROL: a melody the roll holds opens the column roll, as before', async ({ page }) => {
    await bootApp(page, { drawer: { tabId: 'pattern', height: 460 } })
    await seedCode(page, '$: note("c4 [e4 g4] a4").s("piano")')
    await expect(page.locator('[data-bottom-panel-tab="piano-roll"] [data-roll-cell]').first()).toBeVisible()
    await expect(page.locator('[data-tree-roll]')).toHaveCount(0)
  })
})
