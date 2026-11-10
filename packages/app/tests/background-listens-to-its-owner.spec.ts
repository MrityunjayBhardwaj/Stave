import { test, expect, type Page } from '@playwright/test'
import { gzipSync } from 'zlib'
import { editorValue } from './_appBoot'

// #2426 — a background listens to its OWNER's audio. A pattern's background
// listens to that pattern; a viz file's own background listens to the source
// chosen in that viz's settings. A viz picking an example sound must not move the
// pattern's background, and the pattern's music must not move the viz's own.
//
// Observed in PIXELS with an audio probe in each pane:
//   left half  red   = audio level (non-zero only while its source sounds)
//   right half green = frameCount % 256 (running)
//              blue  = time since setup() / 50 ms, capped (drops => restarted)

test.describe.configure({ timeout: 120_000 })

const PROBE = `let t0
function setup() { createCanvas(stave.width, stave.height); t0 = millis() }
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
  fill(0, frameCount % 256, Math.min(255, (millis() - t0) / 50)); rect(width / 2, 0, width / 2, height)
}
`
const SONG = `$: note("c3 e3 g3 c4 g3 e3").s("sawtooth").lpf(1200).gain(.7)\nall(x => x.viz("ProbeA"))`
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const groupsLoc = (page: Page) => page.locator('[data-workspace-group]')
const activeTab = (page: Page) => page.locator('[data-workspace-tab][data-tab-active="true"]').first()

function shareHash(): string {
  const manifest = {
    schemaVersion: 1,
    project: { name: 'background listens to its owner', sharedAt: Date.now() },
    files: [
      { id: 'pa', path: 'ProbeA.p5', language: 'p5js', content: PROBE },
      { id: 'pb', path: 'ProbeB.p5', language: 'p5js', content: PROBE },
      { id: 'sg', path: 'song.strudel', language: 'strudel', content: SONG },
    ],
    fileOrder: { '': ['pa', 'pb', 'sg'] },
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
  await hideCodeText(page)
}

/**
 * The backgrounds are read from screenshots, which include whatever is drawn over
 * them — and in a 1280×720 window ProbeB's own code reaches the probe's read
 * point (orange `fill(` read as audio 51). Hide the code text so a read sees the
 * background alone.
 */
async function hideCodeText(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '.monaco-editor .view-lines, .monaco-editor .margin, .monaco-editor .view-overlays { visibility: hidden !important; }',
  })
}

async function openFromTree(page: Page, name: string): Promise<void> {
  await page.locator('[data-file-tree-item]').filter({ hasText: name }).first().dblclick()
  await expect(activeTab(page)).toHaveText(new RegExp(name.replace('.', '\\.')), { timeout: 15_000 })
}

/** ProbeA as its own background, from its own tab — this is what gives it a ⏸ button */
async function pinProbeAsItsOwnBackground(page: Page, name = 'ProbeA.p5'): Promise<void> {
  await openFromTree(page, name)
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

/** one read of a pane's probe: [audio red, frame green, clock blue] */
async function readPane(page: Page, i: number): Promise<[number, number, number] | null> {
  const id = await groupsLoc(page).nth(i).getAttribute('data-workspace-group')
  const canvas = page.locator(`[data-workspace-group="${id}"] [data-workspace-background] canvas`).first()
  if ((await canvas.count()) === 0) return null
  // a background remounting (a tab switch) can detach the canvas mid-read: no read
  const shot = await canvas.screenshot().catch(() => null)
  if (!shot) return null
  const png = shot.toString('base64')
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
    return [l[0], r[1], r[2]] as [number, number, number]
  }, png)
}

/** is the pane's background running (its frame counter moves), and its peak audio level */
async function paneState(page: Page, i: number): Promise<{ running: boolean; audio: number }> {
  const reads: Array<[number, number, number] | null> = []
  for (let k = 0; k < 4; k++) {
    reads.push(await readPane(page, i))
    await page.waitForTimeout(250)
  }
  const ok = reads.filter((r): r is [number, number, number] => r !== null)
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

/** the peak audio level a pane's probe shows over ~1 s */
async function peakAudio(page: Page, i: number): Promise<number> {
  return (await paneState(page, i)).audio
}

/** ProbeB's own background, in the right pane, beside the pattern on the left */
async function splitPatternAndProbeB(page: Page): Promise<void> {
  await boot(page)
  await pinProbeAsItsOwnBackground(page, 'ProbeB.p5')
  await openFromTree(page, 'song.strudel')
  await page.locator('[data-testid^="group-split-"]').first().click()
  await expect(groupsLoc(page)).toHaveCount(2)
  const src = await groupsLoc(page).nth(0).locator('[data-workspace-tab]').filter({ hasText: 'ProbeB.p5' }).first().boundingBox()
  const dst = await groupsLoc(page).nth(1).boundingBox()
  await page.mouse.move(src!.x + src!.width / 2, src!.y + src!.height / 2)
  await page.mouse.down()
  await page.mouse.move(src!.x + src!.width / 2 + 30, src!.y + src!.height / 2 + 10, { steps: 5 })
  await page.mouse.move(dst!.x + dst!.width / 2, dst!.y + dst!.height / 2, { steps: 20 })
  await page.mouse.up()
  await expect(groupsLoc(page).nth(1).locator('[data-workspace-tab]').filter({ hasText: 'ProbeB.p5' })).toHaveCount(1)
  await groupsLoc(page).nth(0).locator('[data-workspace-tab]').filter({ hasText: 'song.strudel' }).first().click()
  await expectRunning(page, 0, 'pattern pane')
  await expectRunning(page, 1, 'viz pane')
}

/** in ProbeB's settings (right pane), pick the "Sample sound" example as its source */
async function chooseSampleSoundForProbeB(page: Page): Promise<void> {
  await groupsLoc(page).nth(1).locator('[data-testid="viz-chrome-settings"]').first().click()
  await page.locator('[data-testid="viz-chrome-source"]').selectOption('file:__sample__')
  await page.keyboard.press('Escape')
}

test('a viz picks an example sound: its own background reacts, the pattern’s does not', async ({ page }) => {
  await splitPatternAndProbeB(page)
  expect(await peakAudio(page, 0), 'idle: pattern pane silent').toBeLessThan(10)

  await chooseSampleSoundForProbeB(page)
  await expect.poll(() => peakAudio(page, 1), { timeout: 10_000, message: 'viz pane hears its example sound' }).toBeGreaterThan(20)
  // the pattern is stopped: its background stays silent while the example sounds
  for (let k = 0; k < 3; k++) {
    expect(await peakAudio(page, 0), 'pattern pane does not hear the viz’s example sound').toBeLessThan(10) // 255 before #2426
  }
  await expectRunning(page, 0, 'pattern pane still running')
})

test('the pattern plays: its background follows the pattern; the viz with its own source keeps its own', async ({ page }) => {
  await splitPatternAndProbeB(page)
  await chooseSampleSoundForProbeB(page)
  await expect.poll(() => peakAudio(page, 1), { timeout: 10_000 }).toBeGreaterThan(20)

  await groupsLoc(page).nth(0).locator('[data-workspace-tab]').filter({ hasText: 'song.strudel' }).first().click()
  await playPattern(page)
  await expectRunning(page, 0, 'pattern pane, playing', true)
  // whose audio each listens to, as the layer reports it
  await expect(groupsLoc(page).nth(0).locator('[data-workspace-background]')).toHaveAttribute('data-backdrop-source', 'sg')
  await expect(groupsLoc(page).nth(1).locator('[data-workspace-background]')).toHaveAttribute('data-backdrop-source', '__sample__')

  await stopPattern(page)
  await expect.poll(() => peakAudio(page, 0), { timeout: 10_000, message: 'pattern pane silent after Stop' }).toBeLessThan(10)
})

// #2427 — the example sound a viz's own background listens to is part of that
// background: the pattern's Play does not stop it, and it is still there after Stop.
test('the viz’s example sound keeps playing while the pattern plays, and after Stop', async ({ page }) => {
  await splitPatternAndProbeB(page)
  await chooseSampleSoundForProbeB(page)
  await expect.poll(() => peakAudio(page, 1), { timeout: 10_000 }).toBeGreaterThan(20)

  await groupsLoc(page).nth(0).locator('[data-workspace-tab]').filter({ hasText: 'song.strudel' }).first().click()
  await playPattern(page)
  await expectRunning(page, 0, 'pattern pane, playing', true)
  await expectRunning(page, 1, 'viz pane, while the pattern plays', true) // silent before #2427
  await stopPattern(page)
  await expectRunning(page, 1, 'viz pane, after Stop', true)
})

/** the probe's clock in a pane: time since its setup() ran, in 50 ms steps (capped at 255) */
async function clockOf(page: Page, i: number): Promise<number> {
  const r = await readPane(page, i)
  return r ? r[2] : -1
}

// #2428 — a new source is new audio, not a new sketch: the probe's clock keeps rising.
test('changing a viz’s source keeps its background sketch running', async ({ page }) => {
  await splitPatternAndProbeB(page)
  await expect.poll(() => clockOf(page, 1), { timeout: 15_000 }).toBeGreaterThan(60)
  const before = await clockOf(page, 1)
  await chooseSampleSoundForProbeB(page)
  await expect.poll(() => peakAudio(page, 1), { timeout: 10_000 }).toBeGreaterThan(20)
  expect(await clockOf(page, 1), 'clock after the source change (restarted to ~10 before #2428)').toBeGreaterThanOrEqual(before)
})

// #2429 — the choice is the viz file's: it survives a tab switch (the chrome
// remounts) and a reload. #2427 — and returning to the tab brings its sound back.
test('a viz’s chosen source survives a tab switch and a reload, and its sound returns with its tab', async ({ page }) => {
  await splitPatternAndProbeB(page)
  await chooseSampleSoundForProbeB(page)
  await expect.poll(() => peakAudio(page, 1), { timeout: 10_000 }).toBeGreaterThan(20)

  const right = groupsLoc(page).nth(1)
  const box = await right.boundingBox()
  await page.mouse.click(box!.x + box!.width - 40, box!.y + box!.height - 60)
  const rightActive = right.locator('[data-workspace-tab][data-tab-active="true"]')
  await page.locator('[data-file-tree-item]').filter({ hasText: 'ProbeA.p5' }).first().dblclick()
  await expect(rightActive).toHaveText(/ProbeA\.p5/, { timeout: 15_000 })
  // ProbeA has no background of its own: the pane's goes, and with it the sound
  await expect(right.locator('[data-workspace-background]')).toHaveCount(0)
  await page.waitForTimeout(500)
  await right.locator('[data-workspace-tab]').filter({ hasText: 'ProbeB.p5' }).first().click()
  await expect(rightActive).toHaveText(/ProbeB\.p5/)
  await right.locator('[data-testid="viz-chrome-settings"]').first().click()
  await expect(page.locator('[data-testid="viz-chrome-source"]')).toHaveValue('file:__sample__') // "default" before #2429
  await page.keyboard.press('Escape')
  await expectRunning(page, 1, 'viz pane, back on its tab', true)

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const tab = page.locator('[data-workspace-tab]').filter({ hasText: 'ProbeB.p5' }).first()
  await tab.click({ timeout: 60_000 })
  await page.locator('[data-testid="viz-chrome-settings"]').first().click()
  await expect(page.locator('[data-testid="viz-chrome-source"]')).toHaveValue('file:__sample__')
})
