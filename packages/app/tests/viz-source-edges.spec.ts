import { test, expect, type Page } from '@playwright/test'
import { gzipSync } from 'zlib'

// The audio source a viz's own background listens to (its ⚙ → source), at two
// edges the per-file choice (#2429) didn't cover:
//   #2451 — a reload, when the page may not play sound before a click
//   #2452 — the pattern it listens to is deleted
//
// Runs under the browser's DEFAULT autoplay policy: no
// `--autoplay-policy=no-user-gesture-required`, which would hide the click a
// page needs before it may play sound.

test.describe.configure({ timeout: 120_000 })

const SONG = `$: note("c3 e3 g3 c4 g3 e3").s("sawtooth").lpf(1200).gain(.7)\n`
// left half red = the audio level the background hears (0 while silent)
const PROBE = `function setup() { createCanvas(stave.width, stave.height) }
function draw() {
  let level = 0
  const an = stave.analyser
  if (an && an.frequencyBinCount) {
    const b = new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(b)
    let s = 0; for (let i = 0; i < b.length; i++) s += b[i]
    level = (s / b.length / 255) * 6
  }
  noStroke(); background(0)
  fill(255 * Math.min(1, level), 0, 0); rect(0, 0, width / 2, height)
}
`

function shareHash(): string {
  const manifest = {
    schemaVersion: 1,
    project: { name: 'viz source edges', sharedAt: Date.now() },
    files: [
      { id: 'pb', path: 'ProbeB.p5', language: 'p5js', content: PROBE },
      { id: 'sg', path: 'song.strudel', language: 'strudel', content: SONG },
    ],
    fileOrder: { '': ['pb', 'sg'] },
    subfolderOrder: {},
  }
  const b64 = gzipSync(Buffer.from(JSON.stringify(manifest))).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `#share=${b64}`
}

const activeTab = (page: Page) => page.locator('[data-workspace-tab][data-tab-active="true"]').first()
const background = (page: Page) => page.locator('[data-workspace-background]').first()
const sourcePicker = (page: Page) => page.locator('[data-testid="viz-chrome-source"]')

async function openFromTree(page: Page, name: string): Promise<void> {
  await page.locator('[data-file-tree-item]').filter({ hasText: name }).first().dblclick()
  await expect(activeTab(page)).toHaveText(new RegExp(name.replace('.', '\\.')), { timeout: 15_000 })
}

/** import the project and pin ProbeB as its own background */
async function bootWithProbeBackground(page: Page): Promise<void> {
  page.on('dialog', (d) => d.accept())
  await page.goto(`/${shareHash()}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Import', exact: true }).click({ timeout: 60_000 })
  await openFromTree(page, 'ProbeB.p5')
  await page.locator('[data-testid="viz-chrome-settings"]').first().click()
  await page.locator('[data-testid="viz-preview-mode-backdrop"]').first().click()
  await page.keyboard.press('Escape')
  await expect(background(page)).toHaveCount(1)
}

const storedChoice = (page: Page) => page.evaluate(() => localStorage.getItem('stave:vizSource:pb'))

/**
 * What the page itself reports, without Playwright touching it. Every Playwright
 * call that runs script in the page — `locator.count()`, `getAttribute`,
 * `screenshot`, `evaluate` — also gives the page user activation (measured
 * 2026-11-07, Playwright 1.59.1, Chromium 147: a page read only by its own script
 * stays `hasBeenActive=false`; one locator call on it flips it to true), and with
 * it permission to play audio. So the state right after a reload is read
 * passively: an init script logs it to the console, which Playwright only listens to.
 */
interface PageReport {
  active: boolean
  waiting: boolean
  contexts: string[]
}
async function installPageReporter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __contexts: AudioContext[] }
    w.__contexts = []
    const Orig = window.AudioContext
    window.AudioContext = class extends Orig {
      constructor(...a: ConstructorParameters<typeof AudioContext>) {
        super(...a)
        w.__contexts.push(this)
      }
    }
    setInterval(() => {
      const report = {
        active: (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? null,
        waiting: !!document.querySelector('[data-testid="viz-chrome-sound-waiting"]'),
        contexts: w.__contexts.map((c) => c.state),
      }
      console.log(`__page_report ${JSON.stringify(report)}`)
    }, 250)
  })
}
function nextReport(page: Page, when: (r: PageReport) => boolean, timeout = 60_000): Promise<PageReport> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      page.off('console', onMsg)
      reject(new Error('no page report matched'))
    }, timeout)
    function onMsg(msg: import('@playwright/test').ConsoleMessage) {
      const t = msg.text()
      if (!t.startsWith('__page_report ')) return
      const r = JSON.parse(t.slice('__page_report '.length)) as PageReport
      if (!when(r)) return
      clearTimeout(timer)
      page.off('console', onMsg)
      resolve(r)
    }
    page.on('console', onMsg)
  })
}

/** peak red (the probe's audio level) of the background over ~1 s, code text hidden */
async function backgroundAudio(page: Page): Promise<number> {
  await page.addStyleTag({
    content: '.monaco-editor .view-lines, .monaco-editor .margin, .monaco-editor .view-overlays { visibility: hidden !important; }',
  })
  let peak = 0
  for (let k = 0; k < 4; k++) {
    const shot = await background(page).locator('canvas').first().screenshot().catch(() => null)
    if (shot) {
      const red = await page.evaluate(async (data) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + data
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const g = c.getContext('2d')!
        g.drawImage(img, 0, 0)
        return g.getImageData(Math.floor(img.width * 0.25), Math.floor(img.height * 0.8), 1, 1).data[0]
      }, shot.toString('base64'))
      peak = Math.max(peak, red)
    }
    await page.waitForTimeout(250)
  }
  return peak
}

// #2451 — after a reload the remembered example sound never started: the panes
// came back with their backgrounds already in place, so the restore that a tab
// switch runs never ran, and the page can't play audio before a click anyway.
test('after a reload, the chosen example sound waits for the first click, says so, and starts on it', async ({ page }) => {
  await installPageReporter(page)
  await bootWithProbeBackground(page)
  await page.locator('[data-testid="viz-chrome-settings"]').first().click()
  await sourcePicker(page).selectOption('file:__sample__')
  await page.keyboard.press('Escape')
  await expect.poll(() => backgroundAudio(page), { timeout: 10_000, message: 'reacts before the reload' }).toBeGreaterThan(20)

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  // no Playwright call touches the page until it reports the waiting state
  const waiting = await nextReport(page, (r) => r.waiting) // never shown before #2451
  expect(waiting.active, 'the page has had no interaction yet').toBe(false)
  expect(waiting.contexts.filter((s) => s === 'running'), 'no audio is playing yet').toEqual([])
  await expect(page.getByTestId('viz-chrome-sound-waiting')).toBeVisible()

  // one click somewhere neutral: the empty sidebar below the file tree
  const lastItem = await page.locator('[data-file-tree-item]').last().boundingBox()
  await page.mouse.click(lastItem!.x + 20, lastItem!.y + lastItem!.height + 60)
  await expect(page.getByTestId('viz-chrome-sound-waiting')).toHaveCount(0)
  await expect.poll(() => backgroundAudio(page), { timeout: 10_000, message: 'reacts after one click' }).toBeGreaterThan(20)
})

// #2452 — the choice named a file that no longer exists: the picker showed
// "default" (its option was gone) while the background still listened to the
// dead file, and a reload brought the dead choice back.
test('deleting the pattern a viz listens to puts it back on the default source, through a reload', async ({ page }) => {
  await bootWithProbeBackground(page)
  // play the song once so the picker offers it, then choose it from ProbeB
  await openFromTree(page, 'song.strudel')
  await page.locator('[data-strudel-runtime-chrome="root"]').getByRole('button', { name: /Play/ }).first().click()
  await page.locator('[data-workspace-tab]').filter({ hasText: 'ProbeB.p5' }).first().click()
  await page.locator('[data-testid="viz-chrome-settings"]').first().click()
  await expect(sourcePicker(page).locator('option[value="file:sg"]')).toHaveCount(1, { timeout: 15_000 })
  await sourcePicker(page).selectOption('file:sg')
  await page.keyboard.press('Escape')
  await expect(background(page)).toHaveAttribute('data-backdrop-source', 'sg')
  expect(await storedChoice(page)).toBe(JSON.stringify({ kind: 'file', fileId: 'sg' }))

  // delete song.strudel from the file tree
  await page.locator('[data-file-tree-item]').filter({ hasText: 'song.strudel' }).first().click({ button: 'right' })
  await page.getByText('Delete', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Delete', exact: true }).last().click()
  await expect(page.locator('[data-file-tree-item]').filter({ hasText: 'song.strudel' })).toHaveCount(0)

  await expect(background(page), 'the background listens to the default source').toHaveAttribute('data-backdrop-source', 'default') // "sg" before #2452
  expect(await storedChoice(page), 'the stored choice is gone').toBeNull()
  await page.locator('[data-testid="viz-chrome-settings"]').first().click()
  await expect(sourcePicker(page)).toHaveValue('default')
  await page.keyboard.press('Escape')

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(background(page)).toHaveCount(1, { timeout: 60_000 })
  await expect(background(page), 'after a reload too').toHaveAttribute('data-backdrop-source', 'default')
  expect(await storedChoice(page)).toBeNull()
})
