import { test, expect, type Page } from '@playwright/test'
import { gzipSync } from 'zlib'
import { editorValue } from './_appBoot'

// #2422 — a viz tab's ⏸ pauses only that viz's OWN background: the pane's, while
// the viz file is its active tab. A pattern whose code background is the same viz
// (`all(x => x.viz("ProbeA"))`) keeps running — Play/Stop only start and stop the
// music, and the pattern tab has no pause control to undo it.
//
// Observed in PIXELS with a time-varying probe sketch:
//   left half  red   = audio level (non-zero only while music plays)
//   right half green = frameCount % 256 → differs between two reads ⇒ running
// read from each pane's own background canvas through the compositor.

test.describe.configure({ timeout: 120_000 })

const PROBE = `function setup() { createCanvas(stave.width, stave.height) }
function draw() {
  let level = 0
  if (typeof sig !== 'undefined' && sig) level = Math.max(+sig.rms || 0, +sig.bass || 0, +sig.mid || 0)
  const an = stave.analyser
  if (an && an.frequencyBinCount) {
    const b = new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(b)
    let s = 0; for (let i = 0; i < b.length; i++) s += b[i]
    level = Math.max(level, (s / b.length / 255) * 6)
  }
  noStroke()
  fill(255 * Math.min(1, level), 0, 0); rect(0, 0, width / 2, height)
  fill(0, frameCount % 256, 120); rect(width / 2, 0, width / 2, height)
}
`
const SONG = `$: note("c3 e3 g3 c4 g3 e3").s("sawtooth").lpf(1200).gain(.7)\nall(x => x.viz("ProbeA"))`
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const groupsLoc = (page: Page) => page.locator('[data-workspace-group]')
const activeTab = (page: Page) => page.locator('[data-workspace-tab][data-tab-active="true"]').first()

function shareHash(): string {
  const manifest = {
    schemaVersion: 1,
    project: { name: 'background pause is its own', sharedAt: Date.now() },
    files: [
      { id: 'pa', path: 'ProbeA.p5', language: 'p5js', content: PROBE },
      { id: 'sg', path: 'song.strudel', language: 'strudel', content: SONG },
    ],
    fileOrder: { '': ['pa', 'sg'] },
    subfolderOrder: {},
  }
  const b64 = gzipSync(Buffer.from(JSON.stringify(manifest))).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `#share=${b64}`
}

async function boot(page: Page): Promise<void> {
  page.on('dialog', (d) => d.accept())
  await page.goto(`/${shareHash()}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 60_000 })
  await openFromTree(page, 'song.strudel')
  await expect.poll(() => editorValue(page), { timeout: 15_000 }).toBe(SONG)
}

async function openFromTree(page: Page, name: string): Promise<void> {
  await page.locator('[data-file-tree-item]').filter({ hasText: name }).first().dblclick()
  await expect(activeTab(page)).toHaveText(new RegExp(name.replace('.', '\\.')), { timeout: 15_000 })
}

/** ProbeA as its own background, from its own tab — this is what gives it a ⏸ button */
async function pinProbeAsItsOwnBackground(page: Page): Promise<void> {
  await openFromTree(page, 'ProbeA.p5')
  await page.locator('[data-testid="viz-chrome-settings"]').first().click()
  await page.locator('[data-testid="viz-preview-mode-backdrop"]').first().click()
  await page.keyboard.press('Escape')
}

const vizButton = (page: Page) => page.locator('[data-testid="viz-chrome-open-preview"]').first()
const chrome = (page: Page) => page.locator('[data-strudel-runtime-chrome="root"]')
async function playPattern(page: Page): Promise<void> {
  await chrome(page).getByRole('button', { name: /Play/ }).first().click()
  await page.waitForTimeout(2500)
}
async function stopPattern(page: Page): Promise<void> {
  await chrome(page).getByRole('button', { name: /Stop/ }).first().click()
  await page.waitForTimeout(1200)
}

/** one read of a pane's probe: [audio red at the left quarter, frame green at the right quarter] */
async function readPane(page: Page, i: number): Promise<[number, number] | null> {
  const id = await groupsLoc(page).nth(i).getAttribute('data-workspace-group')
  const canvas = page.locator(`[data-workspace-group="${id}"] [data-workspace-background] canvas`).first()
  if ((await canvas.count()) === 0) return null
  const png = (await canvas.screenshot()).toString('base64')
  return page.evaluate(async (data) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + data
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0)
    const y = Math.floor(img.height * 0.8)
    const l = g.getImageData(Math.floor(img.width * 0.25), y, 1, 1).data
    const r = g.getImageData(Math.floor(img.width * 0.75), y, 1, 1).data
    return [l[0], r[1]] as [number, number]
  }, png)
}

/** is the pane's background running (its frame counter moves), and its peak audio level */
async function paneState(page: Page, i: number): Promise<{ running: boolean; audio: number }> {
  const reads: Array<[number, number] | null> = []
  for (let k = 0; k < 4; k++) {
    reads.push(await readPane(page, i))
    await page.waitForTimeout(250)
  }
  const ok = reads.filter((r): r is [number, number] => r !== null)
  if (ok.length === 0) return { running: false, audio: 0 }
  return { running: new Set(ok.map((r) => r[1])).size > 1, audio: Math.max(...ok.map((r) => r[0])) }
}

async function expectRunning(page: Page, i: number, what: string, audible = false): Promise<void> {
  await expect
    .poll(async () => {
      const s = await paneState(page, i)
      return s.running && (!audible || s.audio > 20)
    }, { timeout: 10_000, message: `${what}: running${audible ? ' and audio-reactive' : ''}` })
    .toBe(true)
}
async function expectFrozen(page: Page, i: number, what: string): Promise<void> {
  await expect.poll(async () => (await paneState(page, i)).running, { timeout: 10_000, message: `${what}: frozen` }).toBe(false)
}

test('split, the same viz on both sides: ⏸ on the viz tab freezes only its own pane', async ({ page }) => {
  await boot(page)
  await pinProbeAsItsOwnBackground(page)
  await openFromTree(page, 'song.strudel')
  // split, then drag ProbeA's tab into the new right pane
  await page.locator('[data-testid^="group-split-"]').first().click()
  await expect(groupsLoc(page)).toHaveCount(2)
  const src = await groupsLoc(page).nth(0).locator('[data-workspace-tab]').filter({ hasText: 'ProbeA.p5' }).first().boundingBox()
  const dst = await groupsLoc(page).nth(1).boundingBox()
  await page.mouse.move(src!.x + src!.width / 2, src!.y + src!.height / 2)
  await page.mouse.down()
  await page.mouse.move(src!.x + src!.width / 2 + 30, src!.y + src!.height / 2 + 10, { steps: 5 })
  await page.mouse.move(dst!.x + dst!.width / 2, dst!.y + dst!.height / 2, { steps: 20 })
  await page.mouse.up()
  await expect(groupsLoc(page).nth(1).locator('[data-workspace-tab]').filter({ hasText: 'ProbeA.p5' })).toHaveCount(1)
  await groupsLoc(page).nth(0).locator('[data-workspace-tab]').filter({ hasText: 'song.strudel' }).first().click()

  await playPattern(page)
  await expectRunning(page, 0, 'pattern pane, playing', true)
  await expectRunning(page, 1, 'viz pane, playing')

  await expect(vizButton(page)).toContainText('Pause')
  await vizButton(page).click()
  await expectFrozen(page, 1, 'viz pane after ⏸')
  await expectRunning(page, 0, 'pattern pane after ⏸ on the viz tab', true) // froze before #2422

  await expect(vizButton(page)).toContainText('Play')
  await vizButton(page).click()
  await expectRunning(page, 1, 'viz pane after ▶')
  await expectRunning(page, 0, 'pattern pane after ▶', true)
})

test('one pane: ⏸ on the viz tab, back to the pattern — the pattern’s background runs and follows the music', async ({ page }) => {
  await boot(page)
  await pinProbeAsItsOwnBackground(page)
  await expectRunning(page, 0, 'viz tab, its own background')
  await vizButton(page).click()
  await expectFrozen(page, 0, 'viz tab after ⏸') // its own background still pauses

  await openFromTree(page, 'song.strudel')
  await expectRunning(page, 0, 'pattern tab, after the viz was paused') // froze before #2422
  await playPattern(page)
  await expectRunning(page, 0, 'pattern tab, playing', true)
  await stopPattern(page)
  await expectRunning(page, 0, 'pattern tab, after Stop')
  await playPattern(page)
  await expectRunning(page, 0, 'pattern tab, playing again', true)

  // and the viz's own background is still paused when you go back to it
  await openFromTree(page, 'ProbeA.p5')
  await expect(vizButton(page)).toContainText('Play')
  await expectFrozen(page, 0, 'viz tab again, still paused')
  await page.keyboard.press(`${MOD}+Period`) // tidy: stop the music
})
