import { test, expect, type Page } from '@playwright/test'
import { gzipSync } from 'zlib'
import { editorValue } from './_appBoot'

// #2423 — each file owns its background.
//   File mode (default): a pattern's pane shows the viz its code names WITH THE
//   CODE'S OPTIONS; a viz file's own background uses its own settings — never the
//   pattern's options — even when both draw the same viz file.
//   Workspace mode is a PATTERN's setting: that pattern's background covers every
//   pane (a viz pane with its own background, another pattern's pane), and setting
//   it back to File gives each pane its own again.
//
// Observed in PIXELS with an options-sensitive probe: it paints RED when
// `stave.options.theme === 'black'`, BLUE for any other options, GREEN for none,
// read from the screen in each pane's empty corner (the editor is see-through).

test.describe.configure({ timeout: 120_000 })

const PROBE = `function setup() { createCanvas(stave.width, stave.height) }
function draw() {
  const o = stave.options || {}
  if (o.theme === 'black') background(230, 0, 0)
  else if (Object.keys(o).length) background(0, 0, 230)
  else background(0, 210, 0)
}
`
const TRACK = '$: note("c3 e3 g3 c4 g3 e3").s("sawtooth").lpf(1200).gain(.7)'
const SONG = `${TRACK}\nall(x => x.viz("ProbeA", { theme: 'black' }))`
const OTHER = `${TRACK}\nall(x => x.viz("ProbeA", { theme: 'white' }))`
const groupsLoc = (page: Page) => page.locator('[data-workspace-group]')
const activeTab = (page: Page) => page.locator('[data-workspace-tab][data-tab-active="true"]').first()

function shareHash(): string {
  const manifest = {
    schemaVersion: 1,
    project: { name: 'background owns its options', sharedAt: Date.now() },
    files: [
      { id: 'pa', path: 'ProbeA.p5', language: 'p5js', content: PROBE },
      { id: 'sg', path: 'song.strudel', language: 'strudel', content: SONG },
      { id: 'ot', path: 'other.strudel', language: 'strudel', content: OTHER },
    ],
    fileOrder: { '': ['pa', 'sg', 'ot'] },
    subfolderOrder: {},
  }
  const b64 = gzipSync(Buffer.from(JSON.stringify(manifest))).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `#share=${b64}`
}

async function openFromTree(page: Page, name: string): Promise<void> {
  await page.locator('[data-file-tree-item]').filter({ hasText: name }).first().dblclick()
  await expect(activeTab(page)).toHaveText(new RegExp(name.replace('.', '\\.')), { timeout: 15_000 })
}

/** boot, and make ProbeA.p5 its own background (from its own tab) */
async function boot(page: Page): Promise<void> {
  page.on('dialog', (d) => d.accept())
  await page.goto(`/${shareHash()}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 60_000 })
  await openFromTree(page, 'ProbeA.p5')
  await page.locator('[data-testid="viz-chrome-settings"]').first().click()
  await page.locator('[data-testid="viz-preview-mode-backdrop"]').first().click()
  await page.keyboard.press('Escape')
  await expect.poll(() => paneColour(page, 0), { timeout: 10_000 }).toBe('GREEN')
}

/** split, and drag `name`'s tab from the left pane into the new right pane */
async function splitWith(page: Page, name: string): Promise<void> {
  await page.locator('[data-testid^="group-split-"]').first().click()
  await expect(groupsLoc(page)).toHaveCount(2)
  await dragTabRight(page, name)
}
/** drag `name`'s tab from the left pane into the right pane */
async function dragTabRight(page: Page, name: string): Promise<void> {
  const src = await groupsLoc(page).nth(0).locator('[data-workspace-tab]').filter({ hasText: name }).first().boundingBox()
  const dst = await groupsLoc(page).nth(1).boundingBox()
  await page.mouse.move(src!.x + src!.width / 2, src!.y + src!.height / 2)
  await page.mouse.down()
  await page.mouse.move(src!.x + src!.width / 2 + 30, src!.y + src!.height / 2 + 10, { steps: 5 })
  await page.mouse.move(dst!.x + dst!.width / 2, dst!.y + dst!.height / 2, { steps: 20 })
  await page.mouse.up()
  await expect(groupsLoc(page).nth(1).locator('[data-workspace-tab]').filter({ hasText: name })).toHaveCount(1)
}

/** the colour on screen in a pane's empty bottom-right corner */
async function paneColour(page: Page, i: number): Promise<string> {
  const bb = await groupsLoc(page).nth(i).boundingBox()
  if (!bb) return 'no pane'
  const x = Math.round(bb.x + bb.width - 30)
  const y = Math.round(bb.y + bb.height - 40)
  const png = (await page.screenshot({ clip: { x, y, width: 1, height: 1 } })).toString('base64')
  const [r, g, b] = await page.evaluate(async (data) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + data
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3))
  }, png)
  if (r > 120 && g < 80 && b < 80) return 'RED'
  if (b > 120 && r < 80 && g < 80) return 'BLUE'
  if (g > 120 && r < 80 && b < 80) return 'GREEN'
  return `none(${r},${g},${b})`
}
async function expectPanes(page: Page, want: string[], moment: string): Promise<void> {
  for (let i = 0; i < want.length; i++) {
    await expect.poll(() => paneColour(page, i), { timeout: 10_000, message: `${moment}: pane ${i}` }).toBe(want[i])
  }
}

const chrome = (page: Page) => page.locator('[data-strudel-runtime-chrome="root"]')
async function play(page: Page): Promise<void> {
  await chrome(page).getByRole('button', { name: /Play/ }).first().click()
  await page.waitForTimeout(2500)
}
async function stop(page: Page): Promise<void> {
  await chrome(page).getByRole('button', { name: /Stop/ }).first().click()
  await page.waitForTimeout(1200)
}
async function setSpan(page: Page, span: 'file' | 'workspace'): Promise<void> {
  await page.locator('[data-testid="strudel-chrome-bg-toggle"]').first().click()
  await page.locator('[data-testid="backdrop-chrome-vizspan"]').selectOption(span)
  await page.keyboard.press('Escape')
}

test('File mode, split: the pattern pane has the code’s options, the viz pane its own', async ({ page }) => {
  await boot(page)
  await openFromTree(page, 'song.strudel')
  await expect.poll(() => editorValue(page)).toBe(SONG)
  await splitWith(page, 'ProbeA.p5')
  await groupsLoc(page).nth(0).locator('[data-workspace-tab]').filter({ hasText: 'song.strudel' }).first().click()

  await expectPanes(page, ['RED', 'GREEN'], 'before Play') // the viz pane was RED before #2423
  await play(page)
  await expectPanes(page, ['RED', 'GREEN'], 'playing')
  await stop(page)
  await expectPanes(page, ['RED', 'GREEN'], 'after Stop')
  await expect(page.locator('[data-workspace-background="workspace"]')).toHaveCount(0)
})

test('File mode, one pane: switching tabs gives each file its own options', async ({ page }) => {
  await boot(page)
  await openFromTree(page, 'song.strudel')
  await expectPanes(page, ['RED'], 'pattern tab')
  await play(page)
  await openFromTree(page, 'ProbeA.p5')
  await expectPanes(page, ['GREEN'], 'viz tab while the pattern plays') // was RED
  await openFromTree(page, 'song.strudel')
  await expectPanes(page, ['RED'], 'back on the pattern')
  await stop(page)
  await openFromTree(page, 'ProbeA.p5')
  await expectPanes(page, ['GREEN'], 'viz tab after Stop')
})

test('Workspace is the pattern’s setting: its background covers a viz pane and another pattern’s pane; File restores each', async ({ page }) => {
  await boot(page)
  await openFromTree(page, 'other.strudel')
  await openFromTree(page, 'song.strudel')
  await splitWith(page, 'ProbeA.p5')
  await groupsLoc(page).nth(0).locator('[data-workspace-tab]').filter({ hasText: 'song.strudel' }).first().click()
  await expectPanes(page, ['RED', 'GREEN'], 'File mode')

  // song.strudel → Workspace: its background (RED, the code's options) covers both panes
  await setSpan(page, 'workspace')
  await expect(page.locator('[data-workspace-background="workspace"]')).toHaveCount(1)
  await expect(page.locator('[data-workspace-background]')).toHaveCount(1)
  await expectPanes(page, ['RED', 'RED'], 'song set to Workspace (viz pane covered)')
  await play(page)
  await expectPanes(page, ['RED', 'RED'], 'Workspace, playing')
  await stop(page)
  await expectPanes(page, ['RED', 'RED'], 'Workspace, after Stop')

  // another pattern in the right pane is covered too; its own span (File) does not matter
  await dragTabRight(page, 'other.strudel')
  await expect(groupsLoc(page).nth(1).locator('[data-workspace-tab][data-tab-active="true"]')).toHaveText(/other\.strudel/)
  await expectPanes(page, ['RED', 'RED'], 'Workspace covers another pattern’s pane')

  // back to File, from the pattern that set it: each pane its own again
  await groupsLoc(page).nth(0).locator('[data-workspace-tab]').filter({ hasText: 'song.strudel' }).first().click()
  await setSpan(page, 'file')
  await expect(page.locator('[data-workspace-background="workspace"]')).toHaveCount(0)
  await expectPanes(page, ['RED', 'BLUE'], 'File again: other.strudel shows its own (white → BLUE)')
  await groupsLoc(page).nth(1).locator('[data-workspace-tab]').filter({ hasText: 'ProbeA.p5' }).first().click()
  await expectPanes(page, ['RED', 'GREEN'], 'File again: the viz pane its own')
})
