import { test, expect, type Page } from '@playwright/test'
import { gzipSync } from 'zlib'
import { editorValue } from './_appBoot'

// #2395 — the options the code gives a background belong to the pattern whose
// background it is, in every pane at once, not only in the focused one.
//
// Two patterns draw the SAME viz file with different options, side by side. Each
// pane must show its own pattern's options before Play, while playing, after
// Stop and after a reload (when only the focused pattern has been read yet), and
// a pattern opened later in a pane where another one was closed must not inherit
// the closed pattern's options.
//
// Observed in PIXELS with an options-sensitive probe: RED when
// `stave.options.theme === 'black'`, BLUE for any other options, GREEN for none,
// read in each pane's empty bottom-right corner with the code text hidden.

test.describe.configure({ timeout: 150_000 })

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
const PLAIN = `${TRACK}\nall(x => x.viz("ProbeA"))`
const groupsLoc = (page: Page) => page.locator('[data-workspace-group]')
const activeTab = (page: Page) => page.locator('[data-workspace-tab][data-tab-active="true"]').first()
const tabIn = (page: Page, pane: number, name: string) =>
  groupsLoc(page).nth(pane).locator('[data-workspace-tab]').filter({ hasText: name }).first()

function shareHash(): string {
  const manifest = {
    schemaVersion: 1,
    project: { name: 'background options per pattern', sharedAt: Date.now() },
    files: [
      { id: 'pa', path: 'ProbeA.p5', language: 'p5js', content: PROBE },
      { id: 'sg', path: 'song.strudel', language: 'strudel', content: SONG },
      { id: 'ot', path: 'other.strudel', language: 'strudel', content: OTHER },
      { id: 'pl', path: 'plain.strudel', language: 'strudel', content: PLAIN },
    ],
    fileOrder: { '': ['pa', 'sg', 'ot', 'pl'] },
    subfolderOrder: {},
  }
  const b64 = gzipSync(Buffer.from(JSON.stringify(manifest))).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `#share=${b64}`
}

/** Pixel reads see whatever is drawn over the background: hide the code text. */
async function hideCodeText(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '.monaco-editor .view-lines, .monaco-editor .margin, .monaco-editor .view-overlays { visibility: hidden !important; }',
  })
}

async function openFromTree(page: Page, name: string): Promise<void> {
  await page.locator('[data-file-tree-item]').filter({ hasText: name }).first().dblclick()
  await expect(activeTab(page)).toHaveText(new RegExp(name.replace('.', '\\.')), { timeout: 15_000 })
}

/** focus a pane (click its empty corner) and open `name` from the tree into it */
async function openInPane(page: Page, pane: number, name: string): Promise<void> {
  const bb = await groupsLoc(page).nth(pane).boundingBox()
  await page.mouse.click(bb!.x + bb!.width - 40, bb!.y + bb!.height - 60)
  await page.locator('[data-file-tree-item]').filter({ hasText: name }).first().dblclick()
  await expect(groupsLoc(page).nth(pane).locator('[data-workspace-tab][data-tab-active="true"]'))
    .toHaveText(new RegExp(name.replace('.', '\\.')), { timeout: 15_000 })
}

/** drag `name`'s tab from the left pane into the right pane */
async function dragTabRight(page: Page, name: string): Promise<void> {
  const src = await tabIn(page, 0, name).boundingBox()
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
  const shot = await page.screenshot({ clip: { x, y, width: 1, height: 1 } }).catch(() => null)
  if (!shot) return 'no read'
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
  }, shot.toString('base64'))
  if (r > 120 && g < 80 && b < 80) return 'RED'
  if (b > 120 && r < 80 && g < 80) return 'BLUE'
  if (g > 120 && r < 80 && b < 80) return 'GREEN'
  return `none(${r},${g},${b})`
}
async function expectPanes(page: Page, want: string[], moment: string): Promise<void> {
  // every pane in one read, so a failure names all of them
  const read = async () => {
    const out: string[] = []
    for (let i = 0; i < want.length; i++) out.push(await paneColour(page, i))
    return out.join(' | ')
  }
  await expect.poll(read, { timeout: 10_000, message: `${moment}: panes` }).toBe(want.join(' | '))
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

/** song.strudel (black) on the left, other.strudel (white) on the right, song focused */
async function twoPatternsSideBySide(page: Page): Promise<void> {
  page.on('dialog', (d) => d.accept())
  await page.goto(`/${shareHash()}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 60_000 })
  await openFromTree(page, 'other.strudel')
  await expect.poll(() => editorValue(page), { timeout: 15_000 }).toBe(OTHER)
  await openFromTree(page, 'song.strudel')
  await expect.poll(() => editorValue(page), { timeout: 15_000 }).toBe(SONG)
  await hideCodeText(page)
  await page.locator('[data-testid^="group-split-"]').first().click()
  await expect(groupsLoc(page)).toHaveCount(2)
  await dragTabRight(page, 'other.strudel')
  await tabIn(page, 0, 'song.strudel').click()
  await expect(groupsLoc(page).nth(1).locator('[data-workspace-tab][data-tab-active="true"]')).toHaveText(/other\.strudel/)
}

test('two patterns, one viz file: each pane keeps its own pattern’s options through Play, Stop and a reload', async ({ page }) => {
  await twoPatternsSideBySide(page)
  await expectPanes(page, ['RED', 'BLUE'], 'before Play')
  await play(page)
  await expectPanes(page, ['RED', 'BLUE'], 'playing')
  await stop(page)
  await expectPanes(page, ['RED', 'BLUE'], 'after Stop')

  // after a reload only the focused pattern has been read by the editor: the
  // pattern in the other pane still owns its options
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(groupsLoc(page)).toHaveCount(2, { timeout: 60_000 })
  await expect(tabIn(page, 1, 'other.strudel')).toBeVisible({ timeout: 60_000 })
  await hideCodeText(page)
  await expectPanes(page, ['RED', 'BLUE'], 'after a reload')
})

test('a pattern opened where another was closed does not inherit the closed one’s options', async ({ page }) => {
  await twoPatternsSideBySide(page)
  await expectPanes(page, ['RED', 'BLUE'], 'side by side')

  // open plain.strudel beside other.strudel in the right pane, then close
  // other.strudel: plain.strudel (no options → GREEN) takes the pane
  await openInPane(page, 1, 'plain.strudel')
  await tabIn(page, 1, 'other.strudel').click()
  await tabIn(page, 1, 'other.strudel').locator('[data-testid^="tab-close-"]').first().click()
  await expect(groupsLoc(page).nth(1).locator('[data-workspace-tab]').filter({ hasText: 'other.strudel' })).toHaveCount(0)
  await expect(groupsLoc(page).nth(1).locator('[data-workspace-tab][data-tab-active="true"]')).toHaveText(/plain\.strudel/)
  await expectPanes(page, ['RED', 'GREEN'], 'plain.strudel where other.strudel was')

  // and other.strudel, reopened, brings its own options back from its code
  await openInPane(page, 1, 'other.strudel')
  await expectPanes(page, ['RED', 'BLUE'], 'other.strudel reopened')
})
