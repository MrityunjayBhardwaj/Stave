import { test, expect, type Page } from '@playwright/test'
import { gzipSync } from 'zlib'
import { editorValue } from './_appBoot'
import { vizPixelStats } from './_vizFrames'

// #2413 / #2414 — the background a pattern's CODE declares belongs to that
// pattern file. It shows while that file is the active tab, never on another
// tab, and it follows the code: deleting or clearing it takes it away without a
// re-run. The "set bg" button names what is on screen, so it can always clear it.
//
// Observed in PIXELS: two sketches paint solid red and solid green, read through
// the compositor (`vizPixelStats` — the canvas lives in a worker, #875). Synth
// notes only: drum samples don't load headless.

const solid = (r: number, g: number, b: number) =>
  `function setup() { createCanvas(stave.width, stave.height) }\nfunction draw() { background(${r}, ${g}, ${b}) }\n`
const TRACKS = `$: note("c3 e3 g3 c4").s("sawtooth").gain(.3)
$: note("c2 g2").s("square").gain(.2).viz("scope")`
const MASTER = 'all(x => x.viz("Red"))'
const SONG = `${TRACKS}\n${MASTER}`

// a share-link boot and import come before every test's own steps
test.describe.configure({ timeout: 90_000 })

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const BG = '[data-workspace-background]'
const TOGGLE = '[data-testid="strudel-chrome-bg-toggle"]'
const CLEAR = '[data-testid="backdrop-popover"] [data-testid="backdrop-chrome-clear"]'

function shareHash(song: string): string {
  const manifest = {
    schemaVersion: 1,
    project: { name: 'code background follows its file', sharedAt: Date.now() },
    files: [
      { id: 'red', path: 'Red.p5', language: 'p5js', content: solid(230, 0, 0) },
      { id: 'grn', path: 'Green.p5', language: 'p5js', content: solid(0, 210, 0) },
      { id: 'sng', path: 'song.strudel', language: 'strudel', content: song },
    ],
    fileOrder: { '': ['red', 'grn', 'sng'] },
    subfolderOrder: {},
  }
  const b64 = gzipSync(Buffer.from(JSON.stringify(manifest))).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `#share=${b64}`
}

/**
 * fraction of the pane's background that is solid red / solid green — 0 when the
 * pane has no background (counted first: a bounding box waits for its element)
 */
async function bgFrac(page: Page, range: Parameters<typeof vizPixelStats>[2]): Promise<number> {
  if ((await page.locator(`${BG} canvas`).count()) === 0) return 0
  return (await vizPixelStats(page, `${BG} canvas`, range)).frac
}
const red = (page: Page) => () => bgFrac(page, { rMin: 121, gMax: 79, bMax: 89 })
const green = (page: Page) => () => bgFrac(page, { gMin: 121, rMax: 79, bMax: 89 })

async function expectRed(page: Page): Promise<void> {
  await expect.poll(red(page), { timeout: 10_000 }).toBeGreaterThan(0.4)
}
async function expectGreen(page: Page): Promise<void> {
  await expect.poll(green(page), { timeout: 10_000 }).toBeGreaterThan(0.4)
  expect(await red(page)()).toBeLessThan(0.05)
}
/** no red anywhere on the pane's background — a cleared background stays cleared */
async function expectNoRed(page: Page): Promise<void> {
  await expect.poll(red(page), { timeout: 10_000 }).toBeLessThan(0.05)
  await page.waitForTimeout(1500)
  expect(await red(page)()).toBeLessThan(0.05)
}

async function boot(page: Page, song = SONG): Promise<void> {
  page.on('dialog', (d) => d.accept())
  await page.goto(`/${shareHash(song)}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 60_000 })
  // from the file tree: the import re-renders the tab strip, so a tab found a
  // moment ago can be gone by the time it is clicked
  await page.locator('[data-file-tree-item]').filter({ hasText: 'song.strudel' }).first().dblclick()
  await expect(page.locator('[data-workspace-tab][data-tab-active="true"]').first()).toHaveText(/song\.strudel/, {
    timeout: 15_000,
  })
  await expect.poll(() => editorValue(page), { timeout: 15_000 }).toBe(song)
}

/** open a file as a permanent tab (double-click in the file tree) and wait for it to be active */
async function openTab(page: Page, name: string): Promise<void> {
  const inTabs = page.locator('[data-workspace-tab]').filter({ hasText: name }).first()
  if (await inTabs.count()) await inTabs.click()
  else await page.locator('[data-file-tree-item]').filter({ hasText: name }).first().dblclick()
  await expect(page.locator('[data-workspace-tab][data-tab-active="true"]').first()).toHaveText(
    new RegExp(name.replace('.', '\\.')),
    { timeout: 15_000 },
  )
}

const chrome = (page: Page) => page.locator('[data-strudel-runtime-chrome="root"]')
async function play(page: Page): Promise<void> {
  await chrome(page).getByRole('button', { name: /Play/ }).first().click()
  await page.waitForTimeout(2500)
}
async function stop(page: Page): Promise<void> {
  await chrome(page).getByRole('button', { name: /Stop/ }).first().click()
  await page.waitForTimeout(1500)
}

/** delete the master line (the document's last line) with the real keyboard */
async function deleteMasterLine(page: Page): Promise<void> {
  await page.locator('.monaco-editor .view-line').first().click()
  await page.keyboard.press(`${MOD}+ArrowDown`)
  await page.keyboard.press(`${MOD}+Shift+K`)
  await expect.poll(() => editorValue(page)).not.toContain(MASTER)
  expect(await editorValue(page)).toContain('$: note("c2 g2")') // only that line went
}

/** remove the inline `.viz("scope")` from the second track with the real keyboard */
async function deleteInlineViz(page: Page): Promise<void> {
  await page.locator('.monaco-editor .view-line').filter({ hasText: 'c2 g2' }).first().click()
  await page.keyboard.press('End')
  for (let i = 0; i < '.viz("scope")'.length; i++) await page.keyboard.press('Backspace')
  await expect.poll(() => editorValue(page)).not.toContain('.viz("scope")')
}

async function clearFromPopover(page: Page): Promise<void> {
  await page.locator(TOGGLE).click()
  await page.locator(CLEAR).click()
}

/** the "set bg" button says nothing is set */
async function expectButtonUnset(page: Page): Promise<void> {
  await expect(page.locator(TOGGLE)).toHaveAttribute('data-pinned', 'false')
  await expect(page.locator(TOGGLE)).toContainText('set bg')
}

// ── 1. the code's background stays with its file ─────────────────────────────
test("a played pattern's background stays on its own tab; another tab shows its own", async ({ page }) => {
  await boot(page)
  // Green.p5 is its own background
  await openTab(page, 'Green.p5')
  await page.locator('[data-testid="viz-chrome-settings"]').first().click()
  await page.locator('[data-testid="viz-preview-mode-backdrop"]').first().click()
  await page.keyboard.press('Escape')
  await expectGreen(page)

  await openTab(page, 'song.strudel')
  await expectRed(page) // never played: the code's background
  await openTab(page, 'Green.p5')
  await expectGreen(page) // before any Play

  await openTab(page, 'song.strudel')
  await play(page)
  await expectRed(page)
  await openTab(page, 'Green.p5')
  await expectGreen(page) // after song.strudel played (was red)

  await openTab(page, 'song.strudel')
  await stop(page)
  await openTab(page, 'Green.p5')
  await expectGreen(page) // after Stop (was red)

  // pressing Play on Green.p5 itself
  await page.locator('[data-testid="viz-chrome-open-preview"]').first().click()
  await page.waitForTimeout(1500)
  await expectGreen(page) // (was red)

  // and back on the pattern, its background shows again
  await openTab(page, 'song.strudel')
  await expectRed(page)
  await expect(page.locator(TOGGLE)).toContainText('bg: Red')
})

// ── 2. clearing the code's background clears it ──────────────────────────────
const CLEARS: ReadonlyArray<readonly [string, (page: Page) => Promise<void>]> = [
  ['deleting the all() line while playing', async (page) => {
    await play(page)
    await deleteMasterLine(page)
  }],
  ['Stop, then deleting the line', async (page) => {
    await play(page)
    await stop(page)
    await deleteMasterLine(page)
  }],
  ['Stop, then Clear in the "set bg" popover', async (page) => {
    await play(page)
    await stop(page)
    await clearFromPopover(page)
  }],
  ['deleting an inline .viz("scope") first, then the line', async (page) => {
    await play(page)
    await deleteInlineViz(page)
    await deleteMasterLine(page)
  }],
  ['Clear in the popover while still playing', async (page) => {
    await play(page)
    await clearFromPopover(page)
  }],
  ['never played, then Clear', async (page) => {
    await clearFromPopover(page)
  }],
]
for (const [how, removeIt] of CLEARS) {
  test(`the pattern's background is gone after ${how}`, async ({ page }) => {
    await boot(page)
    await expectRed(page)
    await removeIt(page)
    await expectNoRed(page) // no re-run asked for
    await expectButtonUnset(page)
    expect(await editorValue(page)).not.toContain('all(x')
  })
}

// ── 3. the button names a background the code set, and clears it (#2414) ─────
test('a code background with nothing pinned: the button names it and Clear removes it', async ({ page }) => {
  // a TRACK-level background: the code reader doesn't see it, so nothing is pinned —
  // it is on screen only through the evaluation
  const song = `$: note("c3 e3 g3 c4").s("sawtooth").gain(.3).viz("Red", { backdrop: true })`
  await boot(page, song)
  await play(page)
  await expectRed(page)
  await expect(page.locator(TOGGLE)).toHaveAttribute('data-pinned', 'true')
  await expect(page.locator(TOGGLE)).toContainText('bg: Red')

  await stop(page)
  await expectRed(page) // the background keeps running across Stop
  await expect(page.locator(TOGGLE)).toContainText('bg: Red')

  await clearFromPopover(page)
  await expectNoRed(page)
  await expectButtonUnset(page)
})

test('picking another background over a code background shows the one picked', async ({ page }) => {
  const song = `$: note("c3 e3 g3 c4").s("sawtooth").gain(.3).viz("Red", { backdrop: true })`
  await boot(page, song)
  await play(page)
  await expectRed(page)
  await stop(page)

  await page.locator(TOGGLE).click()
  const picker = page.locator('[data-testid="backdrop-popover-picker"]')
  const greenId = await picker.locator('option').evaluateAll(
    (os) => os.map((o) => [o.getAttribute('value'), o.textContent ?? ''] as const).find(([, t]) => /green/i.test(t))?.[0] ?? null,
  )
  expect(greenId).not.toBeNull()
  await picker.selectOption(greenId!)
  await page.keyboard.press('Escape')
  await expectGreen(page) // it used to say "bg: Green" with red still up
  await expect(page.locator(TOGGLE)).toContainText('bg: Green')
})
