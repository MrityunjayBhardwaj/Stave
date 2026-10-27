/**
 * #2165 — the Library's built-in Strudel sketches.
 *
 * - Every sketch runs in the real engine (on the preview engine, so nothing in
 *   the project changes), makes events in its first four cycles, and names only
 *   sounds Stave has: a drum-machine bank's sound is checked as `<bank>_<sound>`,
 *   lower-cased, the name superdough looks up.
 * - The Library lists them under Snippets, with level chips (Beginner,
 *   Intermediate, Advanced) and topic chips.
 * - Preview plays a sketch, and starting another stops the first.
 * - `+` adds the sketch as a new file under `snippets/` and opens it; adding it
 *   again makes a copy rather than overwriting.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp } from './_appBoot'
import { STRUDEL_SNIPPETS } from '../src/assetLibrary/snippets/strudelSnippets'

const LEVEL_COUNTS = {
  beginner: STRUDEL_SNIPPETS.filter((s) => s.level === 'beginner').length,
  intermediate: STRUDEL_SNIPPETS.filter((s) => s.level === 'intermediate').length,
  advanced: STRUDEL_SNIPPETS.filter((s) => s.level === 'advanced').length,
}

/**
 * The sound map's names once the default banks have all loaded. They load in
 * parallel, so a few known names being present isn't enough (a later bank
 * brings `rim`): wait until the count stops changing.
 */
async function soundNames(page: Page): Promise<Set<string>> {
  const count = () => page.evaluate(() => Object.keys((globalThis as any).soundMap?.get?.() ?? {}).length) // eslint-disable-line @typescript-eslint/no-explicit-any
  let last = -1
  let steady = 0
  for (let i = 0; i < 60 && steady < 3; i++) {
    const n = await count()
    steady = n > 0 && n === last ? steady + 1 : 0
    last = n
    await page.waitForTimeout(1000)
  }
  expect(steady, `the sound map settled (at ${last} sounds)`).toBe(3)
  return new Set(await page.evaluate(() => Object.keys((globalThis as any).soundMap.get()))) // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function openSnippets(page: Page): Promise<void> {
  await page.locator('[data-activity-bar] button[aria-label="Library"]').click()
  const panel = page.locator('[data-asset-library]')
  await panel.locator('[data-filter="asset-type-filter"] button[data-chip="snippet"]').click()
}

const rows = (page: Page) => page.locator('[data-asset-library] [data-asset-row^="snippet:"]')
const notesPlayed = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).__staveSnippetNotesPlayed()) // eslint-disable-line @typescript-eslint/no-explicit-any

test.beforeEach(async ({ page }) => {
  await bootApp(page, { e2eHooks: true })
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
})

test('every sketch runs, makes events and names only sounds Stave has', async ({ page }) => {
  test.setTimeout(180_000)
  const known = await soundNames(page)
  const problems: string[] = []
  for (const snippet of STRUDEL_SNIPPETS) {
    const r = await page.evaluate((code) => (window as any).__staveCheckSnippet(code, 4), snippet.code) // eslint-disable-line @typescript-eslint/no-explicit-any
    if (r.error) problems.push(`${snippet.id}: ${r.error}`)
    else if (r.events === 0) problems.push(`${snippet.id}: no events in 4 cycles`)
    // every named track plays, not only the sketch as a whole
    const named = [...snippet.code.matchAll(/^([a-z][a-zA-Z0-9_]*): /gm)].map((m) => m[1])
    const silent = named.filter((t) => !(r.tracks as string[]).includes(t))
    if (silent.length) problems.push(`${snippet.id}: track ${silent.join(', ')} made no events (tracks with events: ${(r.tracks as string[]).join(', ')})`)
    // superdough looks a sound up lower-cased (superdough.mjs getSound), and so do we
    const missing = (r.sounds as string[]).filter((s) => !known.has(s.toLowerCase()))
    if (missing.length) problems.push(`${snippet.id}: unknown sound ${missing.join(', ')}`)
  }
  expect(problems).toEqual([])
  expect(STRUDEL_SNIPPETS.length).toBeGreaterThanOrEqual(45)
})

test('the Library lists them under Snippets, by level and by topic', async ({ page }) => {
  await openSnippets(page)
  const levels = page.locator('[data-filter="asset-level-filter"]')
  await expect(levels.locator('button')).toHaveText(['All', 'Beginner', 'Intermediate', 'Advanced'])
  await levels.locator('button[data-chip="beginner"]').click()
  // every beginner sketch, and only those (the list is windowed, so count by topic chip)
  const all = page.locator('[data-filter="asset-category-filter"] button[data-chip="all"]')
  await expect(all).toContainText(String(LEVEL_COUNTS.beginner))
  // a topic narrows within the level
  const rhythmBeginner = STRUDEL_SNIPPETS.filter((s) => s.level === 'beginner' && s.topic === 'Rhythm').length
  await page.locator('[data-filter="asset-category-filter"] button[data-chip="Rhythm"]').click()
  await expect(rows(page)).toHaveCount(rhythmBeginner)
  await expect(page.locator('[data-asset-level="snippet:first-beat"]')).toHaveText('Beginner')
  // the other types carry no level, so they show no level chips
  await page.locator('[data-filter="asset-type-filter"] button[data-chip="viz"]').click()
  await expect(levels).toHaveCount(0)
})

test('preview plays a sketch, and the next preview stops it', async ({ page }) => {
  await openSnippets(page)
  await page.locator('[data-asset-search]').fill('Your first beat')
  await page.locator('[data-asset-preview="snippet:first-beat"]').click()
  await expect.poll(() => notesPlayed(page), { timeout: 20_000 }).toBeGreaterThan(4)
  // a second preview: the first stops, the second plays
  await page.locator('[data-asset-search]').fill('Your first melody')
  const before = await notesPlayed(page)
  await page.locator('[data-asset-preview="snippet:first-melody"]').click()
  await expect.poll(() => notesPlayed(page), { timeout: 20_000 }).toBeGreaterThan(before + 4)
  // stopping it stops the notes
  await page.locator('[data-asset-preview="snippet:first-melody"]').click()
  await page.waitForTimeout(500)
  const stopped = await notesPlayed(page)
  await page.waitForTimeout(1500)
  expect(await notesPlayed(page)).toBe(stopped)
})

test('+ adds the sketch as a new file and opens it; adding it again makes a copy', async ({ page }) => {
  await openSnippets(page)
  await page.locator('[data-asset-search]').fill('Euclidean')
  const insert = page.locator('[data-asset-insert="snippet:euclid"]')
  await rows(page).first().hover()
  await insert.click()
  // a new file's tab is keyed by its id, so find it by its name
  const tab = (name: string) => page.locator('[data-workspace-tab]', { hasText: name })
  await expect(tab('euclid.strudel')).toHaveCount(1, { timeout: 5000 })
  const code = STRUDEL_SNIPPETS.find((s) => s.id === 'euclid')!.code
  await expect.poll(() => page.evaluate(() =>
    (window as any).monaco.editor.getEditors().map((e: any) => e.getModel()?.getValue())), // eslint-disable-line @typescript-eslint/no-explicit-any
  ).toContain(code)
  await rows(page).first().hover()
  await insert.click()
  await expect(tab('euclid copy.strudel')).toHaveCount(1, { timeout: 5000 })
  await expect(tab('euclid.strudel')).toHaveCount(1)
})
