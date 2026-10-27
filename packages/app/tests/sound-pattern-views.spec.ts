/**
 * A track whose sound is a pattern shows which sound plays where (#2226).
 *
 * `.sound("piano gm_electric_guitar_muted")` plays piano for the first half of the
 * bar and the guitar for the second. Here, in the real app:
 *  - the piano roll colours each note by the sound it plays, with a key, and a
 *    one-sound track looks as it always did;
 *  - with `<…>` under a two-bar roll, bar 1 is piano and bar 2 the guitar;
 *  - a sound lane under the roll draws the sound pattern's own blocks, and a
 *    block's pick writes only its own name; a pattern one pass can't draw truly
 *    says why;
 *  - the Song timeline, expanded, gives each sound a labelled row of its own,
 *    piano included, under the track's own header row;
 *  - the Mixer strip says "2 sounds", with the names on hover.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, evalCode } from './_appBoot'

const GUITAR = 'gm_electric_guitar_muted'
const MULTI = `$: note("48 67 63 [62, 58]").sound("piano ${GUITAR}")`

async function code(page: Page): Promise<string> {
  return page.evaluate(() => {
    const m = (window as unknown as { monaco: { editor: { getEditors: () => Array<{ getModel: () => { getValue: () => string } | null }> } } }).monaco
    return m.editor.getEditors()[0]?.getModel()?.getValue() ?? ''
  })
}

async function cursorAt(page: Page, line: number, column = 8): Promise<void> {
  await page.evaluate(
    ([l, c]) => {
      const eds = (window as unknown as { monaco: { editor: { getEditors: () => Array<{ setPosition: (p: object) => void; focus: () => void }> } } }).monaco.editor.getEditors()
      eds[0].setPosition({ lineNumber: l, column: c })
      eds[0].focus()
    },
    [line, column] as const,
  )
}

/** open the Pattern tab on `doc`'s first line; its roll */
async function roll(page: Page, doc: string) {
  await bootApp(page)
  await seedCode(page, doc)
  await cursorAt(page, 1)
  const drawer = page.locator('[data-bottom-panel="root"]')
  await drawer.locator('[data-bottom-panel="toggle"]').click()
  await drawer.locator('role=tab[name="Pattern"]').click()
  const panel = drawer.locator('[data-bottom-panel-tab="piano-roll"]')
  await panel.locator('[data-roll-fill]').first().waitFor({ timeout: 15_000 })
  return panel
}

/** every note head's cell (`midi:column`) → the sounds it is tagged with */
async function noteTags(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate(() => {
    const out: Record<string, string | null> = {}
    document.querySelectorAll('[data-roll-cell]').forEach((el) => {
      const fill = el.querySelector('[data-roll-fill]:not([data-roll-sustain])')
      if (fill) out[el.getAttribute('data-roll-cell')!] = fill.getAttribute('data-roll-note-sounds')
    })
    return out
  })
}

test.describe('a sound that is a pattern is shown where it plays (#2226)', () => {
  test('the piano roll: 48 and 67 are piano, 63 62 58 the guitar, with a key', async ({ page }) => {
    const panel = await roll(page, MULTI)
    expect(await noteTags(page)).toEqual({
      '48:0': 'piano',
      '67:1': 'piano',
      '63:2': GUITAR,
      '62:3': GUITAR,
      '58:3': GUITAR,
    })
    const key = panel.locator('[data-roll-sound-key-item]')
    await expect(key).toHaveCount(2)
    await expect(key.nth(0)).toHaveText('piano')
    await expect(key.nth(1)).toHaveText(GUITAR)
    // the two sounds are drawn in two different colours
    const fills = await panel.locator('[data-roll-cell="48:0"] [data-roll-fill], [data-roll-cell="63:2"] [data-roll-fill]')
      .evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor))
    expect(fills).toHaveLength(2)
    expect(fills[0]).not.toBe(fills[1])
  })

  test('alternation under a two-bar roll: bar 1 piano, bar 2 the guitar', async ({ page }) => {
    await roll(page, `$: note("<c4 e4> g4").sound("<piano ${GUITAR}>")`)
    const tags = await noteTags(page)
    expect(Object.values(tags).sort()).toEqual(['piano', 'piano', GUITAR, GUITAR].sort())
    // columns 0–1 are bar 1, 2–3 bar 2
    for (const [cell, s] of Object.entries(tags)) {
      expect(s, cell).toBe(Number(cell.split(':')[1]) < 2 ? 'piano' : GUITAR)
    }
  })

  test('the sound lane: its own blocks, and a block writes only its own name', async ({ page }) => {
    const panel = await roll(page, MULTI)
    const blocks = panel.locator('[data-roll-sound-block]')
    await expect(blocks).toHaveCount(2)
    await expect(blocks.nth(0)).toHaveAttribute('data-roll-sound-block', 'piano')
    await expect(blocks.nth(1)).toHaveAttribute('data-roll-sound-block', GUITAR)
    // piano's block covers the columns of 48 and 67, the guitar's those of 63 and 62:
    // its first segment starts where the first column does, its last ends with the last
    const edges = async (name: string) => {
      const segs = panel.locator(`[data-roll-sound-segment="${name}"]`)
      const first = (await segs.first().boundingBox())!
      const last = (await segs.last().boundingBox())!
      return [first.x, last.x + last.width]
    }
    const col = async (cell: string) => {
      const r = (await panel.locator(`[data-roll-cell="${cell}"]`).boundingBox())!
      return [r.x, r.x + r.width]
    }
    const [p, g] = [await edges('piano'), await edges(GUITAR)]
    expect(Math.abs(p[0] - (await col('48:0'))[0])).toBeLessThanOrEqual(2)
    expect(Math.abs(p[1] - (await col('67:1'))[1])).toBeLessThanOrEqual(2)
    expect(Math.abs(g[0] - (await col('63:2'))[0])).toBeLessThanOrEqual(2)
    expect(Math.abs(g[1] - (await col('62:3'))[1])).toBeLessThanOrEqual(2)

    await blocks.nth(0).click()
    const menu = page.locator('[data-mixer-sound-menu="sound"]')
    await menu.locator('[data-mixer-sound-search]').fill('sawtooth')
    await menu.locator('[data-mixer-sound-option="sawtooth"]').click()
    await expect.poll(() => code(page)).toBe(`$: note("48 67 63 [62, 58]").sound("sawtooth ${GUITAR}")`)
  })

  test('the sound lane says why when one pass would draw it wrong', async ({ page }) => {
    const panel = await roll(page, '$: note("c4 e4").sound("piano | sawtooth")')
    await expect(panel.locator('[data-roll-sound-lane-read-only]')).toContainText('chosen at random')
    await expect(panel.locator('[data-roll-sound-block]')).toHaveCount(0)
  })

  test('one sound: no key, no tags, no lane — the roll looks as it did', async ({ page }) => {
    const panel = await roll(page, '$: note("c4 e4 g4").sound("piano")')
    await expect(panel.locator('[data-roll-sound-key]')).toHaveCount(0)
    await expect(panel.locator('[data-roll-sound-lane]')).toHaveCount(0)
    expect(Object.values(await noteTags(page))).toEqual([null, null, null])
  })

  test('the Song timeline, expanded: a header row, then a labelled row per sound', async ({ page }) => {
    await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 360 } })
    await seedCode(page, MULTI)
    await evalCode(page)
    const lane = page.locator('[data-full-song-lane]').first()
    await lane.waitFor({ timeout: 15_000 })
    await page.locator('[data-full-song-lane-expand]').first().click()
    // the sounds arrive with the played notes; the lane stays expanded meanwhile
    await expect(lane).toHaveAttribute('data-full-song-voices', '2', { timeout: 10_000 })
    await expect(lane.locator('[data-full-song-voice]')).toHaveText(['piano', GUITAR])
    await expect(lane.locator('[data-full-song-lane-name]')).toHaveText('Track 1')
  })

  test('the Mixer strip says 2 sounds, the names on hover; one sound adds nothing', async ({ page }) => {
    await bootApp(page)
    await seedCode(page, `${MULTI}\n$: note("c4").sound("piano")`)
    const root = page.locator('[data-bottom-panel="root"]')
    await root.locator('[data-bottom-panel="toggle"]').click()
    await root.locator('role=tab[name="Mixer"]').click()
    const mixer = root.locator('[data-bottom-panel-tab="mixer-console"]')
    await mixer.locator('[data-mixer-strip-name]').first().waitFor({ timeout: 10_000 })
    const badge = mixer.locator('[data-mixer-strip-sounds]')
    await expect(badge).toHaveCount(1)
    await expect(badge).toHaveText('2 sounds')
    await expect(badge).toHaveAttribute('title', `piano, ${GUITAR}`)
  })
})
