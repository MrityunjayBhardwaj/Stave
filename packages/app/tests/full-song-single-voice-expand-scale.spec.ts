/**
 * Full-song view: a single-voice expanded lane scales with the Timeline sub-row
 * setting, like multi-voice lanes (#647).
 *
 * Bug: `computeLaneLayout` only scaled lanes with >= 2 voices; a single-voice
 * lane expanded to a fixed `EXPANDED_ROW_HEIGHT` (96px) that ignored the
 * setting. So a lone melodic lane (e.g. `$: note(...)`) stayed frozen at 96 while
 * its neighbours grew/shrank with the slider — "really small" at a high setting.
 *
 * Fix: a single MELODIC voice → 4 × subRowHeight (a tall, scaling pitch band);
 * a single PERCUSSIVE voice → 1 × subRowHeight. Guard: the melodic lane's
 * expanded height tracks the slider and equals 4 × the setting.
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const MELODIC_ROWS = 4
// d1 = 2-voice stack, d2 = single melodic note pattern, d3 = 3-voice drum stack.
const CODE = `setcps(130/240)

$: stack(
  note("c4 e4 g4 b4").s("sawtooth").gain(0.3),
  note("e3 g3 b3 e4").s("sine").gain(0.15)
).viz("pianoroll")

$: note("<c2 [g2 c2] f2 [g2 eb2]>").s("square").gain(0.4).viz("pitchwheel")

$: stack(
  s("hh*8").gain(0.3),
  s("bd [~ bd] ~ bd").gain(0.5),
  s("~ sd ~ [sd cp]").gain(0.4)
).viz("wordfall")
`

async function bootAt(page: Page, subRow: number) {
  // A tall viewport + tall drawer so the fully-expanded song (up to ~480px at the
  // max sub-row) FITS without vertical overflow — otherwise the gutter rows get
  // squished (the separate #645 gutter-collapse bug, not yet on this base) and
  // the measured height under-reads the true layout height.
  await page.setViewportSize({ width: 1280, height: 1100 })
  await page.addInitScript(
    ([sub]: string[]) => {
      try {
        window.localStorage.setItem('stave:bottomPanel.height', '860')
        window.localStorage.setItem('stave:bottomPanel.open', 'true')
        window.localStorage.setItem('stave:bottomPanel.activeTabId', 'musical-timeline')
        window.localStorage.setItem('stave:musicalTimeline.subRowHeight', sub)
      } catch {}
    },
    [String(subRow)],
  )
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () => (((window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco?.editor?.getEditors?.()?.length) ?? 0) > 0,
    { timeout: 20_000 },
  )
  await page.evaluate((c) => {
    const eds = ((window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; setValue?: (v: string) => void } | null; focus: () => void }> } } }).monaco?.editor?.getEditors?.()) ?? []
    const ed = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    ed?.focus()
    ed?.getModel()?.setValue?.(c)
  }, CODE)
  await page.waitForTimeout(500)
  await page.keyboard.press(`${MOD}+Enter`)
  await page.waitForTimeout(1500)
}

async function heightsByLane(page: Page): Promise<Record<string, number>> {
  await page.locator('[data-full-song-lane]').first().waitFor({ timeout: 10_000 })
  const expanders = page.locator('[data-full-song-lane-expand]')
  const n = await expanders.count()
  for (let i = 0; i < n; i++) { await expanders.nth(i).click({ force: true }); await page.waitForTimeout(120) }
  await page.waitForTimeout(300)
  return await page.evaluate(() => {
    const out: Record<string, number> = {}
    for (const l of Array.from(document.querySelectorAll('[data-full-song="lane-labels"] [data-full-song-lane]')) as HTMLElement[]) {
      const k = l.getAttribute('data-full-song-lane')
      if (k) out[k] = Math.round(l.getBoundingClientRect().height)
    }
    return out
  })
}

test('#647 — a single melodic lane scales with the sub-row setting (small slider)', async ({ page }) => {
  await bootAt(page, 12)
  const h = await heightsByLane(page)
  // d2 is the lone melodic lane → 4 × 12 = 48 (was frozen at 96).
  expect(h.d2).toBe(MELODIC_ROWS * 12)
})

test('#647 — the same melodic lane grows with the setting (large slider)', async ({ page }) => {
  await bootAt(page, 48)
  const h = await heightsByLane(page)
  // 4 × 48 = 192 — it MOVED with the slider instead of staying 96.
  expect(h.d2).toBe(MELODIC_ROWS * 48)
  // d1 (2 voices, under its header row #2226) and d3 (multi-voice) scale too —
  // all expanded lanes respond.
  expect(h.d1).toBe(3 * 48)
})
