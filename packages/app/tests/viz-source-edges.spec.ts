import { test, expect, type Page } from '@playwright/test'
import { gzipSync } from 'zlib'

// The audio source a viz's own background listens to (its ⚙ → source), at two
// edges the per-file choice (#2429) didn't cover:
//   #2452 — the pattern it listens to is deleted
//
// Runs under the browser's DEFAULT autoplay policy: no
// `--autoplay-policy=no-user-gesture-required`, which would hide the click a
// page needs before it may play sound.

test.describe.configure({ timeout: 120_000 })

const SONG = `$: note("c3 e3 g3 c4 g3 e3").s("sawtooth").lpf(1200).gain(.7)\n`
const PROBE = `function setup() { createCanvas(stave.width, stave.height) }
function draw() { background(0) }
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
