import { test, expect, type Page } from '@playwright/test'

import { bootApp, seedCode } from './_appBoot'

/**
 * #1750 — drag the edge below a track name to resize the Timeline's rows: the
 * edge between two tracks, or (#2084) the last track's own bottom edge, so a
 * song with one track can resize its rows too.
 *
 * The drag writes the ONE shared row-height setting (12–48 px, saved per
 * browser), so every lane follows it and the value survives a reload. The edge
 * grabbed stays under the pointer: read as the lane's own laid-out height
 * (its row's `style.height`) and the edge's position against where the mouse
 * was released.
 */

const KEY = 'stave:musicalTimeline.subRowHeight'

async function rowHeight(page: Page, laneKey: string): Promise<number> {
  return page.locator(`[data-full-song-lane="${laneKey}"]`).evaluate((el) => parseFloat((el as HTMLElement).style.height))
}

async function saved(page: Page): Promise<string | null> {
  return page.evaluate((k) => window.localStorage.getItem(k), KEY)
}

/** Press on the centre of the edge below `laneKey`, move by `dy` in steps, release. */
async function dragEdge(page: Page, laneKey: string, dy: number): Promise<{ releaseY: number }> {
  const edge = page.locator(`[data-full-song-row-edge="${laneKey}"]`)
  const box = (await edge.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + dy, { steps: 8 })
  await page.mouse.up()
  return { releaseY: y + dy }
}

test.describe('timeline row edge resize (#1750)', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page, { drawer: { tabId: 'musical-timeline', height: 420 } })
  })

  test('hovering the edge between two tracks shows a resize cursor; dragging it resizes every row and is kept', async ({ page }) => {
    await seedCode(page, 'setcps(0.5)\n$: note("c3").s("sine")\n$: note("e2").s("square")\n$: s("bd*4")')
    await page.locator('[data-full-song-lane="d3"]').waitFor({ timeout: 30_000 })
    const start = await rowHeight(page, 'd1')
    expect(start).toBe(25) // PRECONDITION: a fresh browser has the default

    // Hover: the strip on the edge below d1 shows the resize cursor and a line.
    const edge = page.locator('[data-full-song-row-edge="d1"]')
    await edge.hover()
    expect(await edge.evaluate((el) => getComputedStyle(el).cursor)).toBe('row-resize')
    await expect(edge).toHaveAttribute('data-active', 'true')
    // #2084 — the last track's bottom edge can be dragged too.
    await expect(page.locator('[data-full-song-row-edge="d3"]')).toHaveCount(1)

    // Down 15 px: one row above the edge, so the row grows by 15.
    const down = await dragEdge(page, 'd1', 15)
    expect(await rowHeight(page, 'd1')).toBe(40)
    expect(await rowHeight(page, 'd2')).toBe(40) // every lane follows the one setting
    expect(await saved(page)).toBe('40')
    // The edge ended under the pointer.
    const after = (await edge.boundingBox())!
    console.log(`[#1750] edge centre ${(after.y + after.height / 2).toFixed(1)} vs release ${down.releaseY.toFixed(1)}`)
    expect(Math.abs(after.y + after.height / 2 - down.releaseY)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: 'test-results/timeline-row-edge-resize.png' })

    // Far up on the edge below d2 (two rows above it): stops at the minimum.
    await dragEdge(page, 'd2', -200)
    expect(await rowHeight(page, 'd1')).toBe(12)
    expect(await saved(page)).toBe('12')

    // Kept across a reload.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-full-song-lane="d1"]').waitFor({ timeout: 30_000 })
    expect(await rowHeight(page, 'd1')).toBe(12)
  })

  test('the edge below an expanded multi-voice lane stays under the pointer', async ({ page }) => {
    await seedCode(page, 'setcps(0.5)\n$: s("bd*2, hh*4, sd")\n$: note("e2").s("square")')
    await page.locator('[data-full-song-lane="d2"]').waitFor({ timeout: 30_000 })
    await page.locator('[data-full-song-lane-expand="d1"]').click()
    const d1 = page.locator('[data-full-song-lane="d1"]')
    await expect(d1).toHaveAttribute('data-expanded', 'true')
    const voices = Number(await d1.getAttribute('data-full-song-voices'))
    expect(voices).toBe(3) // PRECONDITION: three voice sub-rows scale with the setting
    expect(await rowHeight(page, 'd1')).toBe(75)

    // Down 30 px over three rows → each row +10.
    const edge = page.locator('[data-full-song-row-edge="d1"]')
    const down = await dragEdge(page, 'd1', 30)
    expect(await rowHeight(page, 'd1')).toBe(105)
    expect(await rowHeight(page, 'd2')).toBe(35)
    const after = (await edge.boundingBox())!
    expect(Math.abs(after.y + after.height / 2 - down.releaseY)).toBeLessThanOrEqual(1.5)
  })

  test('a song with ONE track resizes its rows by the edge below it (#2084)', async ({ page }) => {
    await seedCode(page, 'setcps(0.5)\n$: note("c3 e3").s("sine")')
    await page.locator('[data-full-song-lane="d1"]').waitFor({ timeout: 30_000 })
    expect(await rowHeight(page, 'd1')).toBe(25) // PRECONDITION: the default

    const edge = page.locator('[data-full-song-row-edge="d1"]')
    await expect(edge).toHaveCount(1)
    await edge.hover()
    expect(await edge.evaluate((el) => getComputedStyle(el).cursor)).toBe('row-resize')

    // Down 15 px: the one row grows by 15, and the edge ends under the pointer.
    const down = await dragEdge(page, 'd1', 15)
    expect(await rowHeight(page, 'd1')).toBe(40)
    expect(await saved(page)).toBe('40')
    const after = (await edge.boundingBox())!
    expect(Math.abs(after.y + after.height / 2 - down.releaseY)).toBeLessThanOrEqual(1)

    // And back up, past the minimum: it stops there.
    await dragEdge(page, 'd1', -100)
    expect(await rowHeight(page, 'd1')).toBe(12)
    expect(await saved(page)).toBe('12')
  })
})
