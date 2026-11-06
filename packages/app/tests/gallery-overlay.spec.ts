/**
 * Community gallery overlay — browse, read, open; and gallery code runs only
 * after Play (#2300, #2302, #2304).
 *
 * The gallery routes are served by `page.route()` fixtures, so this spec needs no
 * store and no server-side work.
 *
 * ─── THE SIGNAL ────────────────────────────────────────────────────────────────
 * "Nothing evaluated" is read from the code ITSELF: every fixture's code bumps
 * `window.__galleryRuns` as a top-level statement. An evaluate of any kind — Play,
 * the Song timeline's quiet pre-play evaluate, a viz running — executes that
 * statement, so the counter is the harm (code running on the page), not a symbol
 * of it. The scheduler's own trigger counter (`audio.triggers`, the instrument
 * `pre-gesture-transport.spec.ts` uses) is read beside it for "nothing started".
 *
 * ─── WHY THE DRAWER IS OPEN ON THE SONG VIEW ───────────────────────────────────
 * With the Song timeline on screen, the app evaluates the active Strudel file
 * QUIETLY to draw its marks, without Play (StrudelEditorClient
 * `refreshTimelineMarks` → `evaluateForTimeline`). That is the one path that
 * would run a just-opened file's code, so it is the condition every arm runs in.
 * The CONTROL arm proves it: an ordinary (non-gallery) edit in the same state
 * DOES run, so a zero in the subject arm is the gate, not a blind instrument.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, editorValue, evalCode, seedCode } from './_appBoot'
import { ADA_SESSION_USER, COUNTER_LINE, MUSIC_CODE, routeGallery, routeSession } from './_gallery'

async function enablePerf(page: Page): Promise<void> {
  await page.addInitScript(() => {
    ;(globalThis as unknown as { __STAVE_PERF__?: boolean }).__STAVE_PERF__ = true
  })
}

const runs = (page: Page) => page.evaluate(() => (window as unknown as { __galleryRuns?: number }).__galleryRuns ?? 0)

async function triggers(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const perf = (window as unknown as { __stavePerf?: { snapshot?: () => { counters?: Record<string, number> } } })
      .__stavePerf
    const snap = perf?.snapshot?.()
    return snap ? (snap.counters?.['audio.triggers'] ?? 0) : null
  })
}

/** The highest reading of `read` over `ms` — a zero must hold for the whole window. */
async function peak(page: Page, read: (p: Page) => Promise<number | null>, ms: number): Promise<number | null> {
  const end = Date.now() + ms
  let best: number | null = null
  for (;;) {
    const n = await read(page)
    if (n !== null) best = best === null ? n : Math.max(best, n)
    if (Date.now() >= end) return best
    await page.waitForTimeout(250)
  }
}

async function openGalleryFromMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByText('Community Gallery...', { exact: true }).click()
  await expect(page.locator('[data-gallery="overlay"]')).toBeVisible()
}

const SONG_VIEW = { tabId: 'musical-timeline', height: 300 } as const

test.describe('community gallery overlay', () => {
  test('CONTROL: with the Song view open, an ordinary edit IS evaluated without Play', async ({ page }) => {
    await bootApp(page, { drawer: SONG_VIEW })
    await expect(page.locator('[data-full-song="root"]')).toBeVisible({ timeout: 15_000 })
    expect(await runs(page)).toBe(0)
    await seedCode(page, MUSIC_CODE)
    await expect
      .poll(() => runs(page), {
        timeout: 15_000,
        message: 'the quiet timeline evaluate never ran — the subject arms below could not see a run either',
      })
      .toBeGreaterThan(0)
  })

  test('browse: tabs group by kind, search filters, thumbnails or generated cards', async ({ page }) => {
    await routeGallery(page)
    await bootApp(page)
    await openGalleryFromMenu(page)

    const cards = page.locator('[data-gallery-card]')
    await expect(cards).toHaveCount(2)
    await expect(page.locator('[data-gallery-card="proj1AAAAAA"] img')).toHaveAttribute('src', '/api/gallery/proj1AAAAAA/thumbnail')
    await expect(page.locator('[data-gallery-card="proj2BBBBBB"] [data-gallery-thumb="generated"]')).toBeVisible()
    if (process.env.GALLERY_SHOTS) await page.screenshot({ path: `${process.env.GALLERY_SHOTS}/desktop-grid.png` })

    await page.locator('[data-gallery-tab="music"]').click()
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toContainText('Four On The Floor')
    await page.locator('[data-gallery-tab="viz"]').click()
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toContainText('Oscillator Bloom')

    await page.locator('[data-gallery-tab="project"]').click()
    await page.getByLabel('Search the gallery').fill('bob')
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toContainText('Ambient Drift')
    await page.getByLabel('Search the gallery').fill('nothing-like-this')
    await expect(page.locator('[data-gallery-state="empty"]')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('[data-gallery="overlay"]')).toHaveCount(0)
  })

  test('SUBJECT: a gallery project opens with its code visible and runs nothing until Play', async ({ page }) => {
    await enablePerf(page)
    await routeGallery(page)
    await bootApp(page, { drawer: SONG_VIEW })
    await expect(page.locator('[data-full-song="root"]')).toBeVisible({ timeout: 15_000 })
    await openGalleryFromMenu(page)

    await page.locator('[data-gallery-card="proj1AAAAAA"]').click()
    const code = page.locator('[data-gallery-code="main.strudel"]')
    await expect(code).toContainText(COUNTER_LINE)
    await expect(page.locator('[data-gallery-safe-note]')).toBeVisible()
    if (process.env.GALLERY_SHOTS) await page.screenshot({ path: `${process.env.GALLERY_SHOTS}/entry-detail.png` })
    expect(await runs(page), 'reading an entry must not run it').toBe(0)

    await page.getByRole('button', { name: 'Open as new project' }).click()
    await expect(page.locator('[data-gallery="overlay"]')).toHaveCount(0)
    // the new project is the active one and its code is in the editor
    await expect.poll(() => editorValue(page), { timeout: 20_000 }).toBe(MUSIC_CODE)
    await expect(page.getByText('Dub Techno Starter (shared)').first()).toBeVisible()
    // only the entry's files — none of the project we came from (the editor is
    // unmounted while the store switches, as File → New does)
    await expect(page.getByText('main.strudel', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('pattern.strudel', { exact: true })).toHaveCount(0)

    // Over a window longer than the timeline's quiet-evaluate cadence, nothing ran.
    const before = await triggers(page)
    expect(before, 'profiler absent — the trigger reading below would mean nothing').not.toBeNull()
    expect(await peak(page, runs, 6_000), 'gallery code ran without Play').toBe(0)
    expect(await triggers(page)).toBe(before)

    // Play: first it asks (#2328), and nothing has run while it asks; once
    // confirmed it runs, and the scheduler emits notes.
    await evalCode(page)
    await expect(page.getByText('This code was written by Alice.', { exact: false })).toBeVisible({ timeout: 10_000 })
    expect(await runs(page), 'gallery code ran before the trust step was answered').toBe(0)
    await page.getByRole('button', { name: 'Run it' }).click()
    await expect.poll(() => runs(page), { timeout: 20_000 }).toBeGreaterThan(0)
    await expect.poll(async () => (await triggers(page)) ?? -1, { timeout: 20_000 }).toBeGreaterThan(before ?? 0)
  })

  test('SUBJECT: adding music and viz to this project runs nothing; a #gallery link opens the entry', async ({ page }) => {
    await enablePerf(page)
    await routeGallery(page)
    await bootApp(page, { drawer: SONG_VIEW })
    await expect(page.locator('[data-full-song="root"]')).toBeVisible({ timeout: 15_000 })

    // The link path: same page, fragment set — the overlay opens on the entry.
    await page.goto('/#gallery=musc1CCCCCC')
    await expect(page.locator('[data-gallery-detail="musc1CCCCCC"]')).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('')
    await page.getByRole('button', { name: 'Add to this project' }).click()
    await expect(page.locator('[data-gallery="overlay"]')).toHaveCount(0)
    // the added file opens as the active tab
    await expect.poll(() => editorValue(page), { timeout: 15_000 }).toBe(MUSIC_CODE)
    await expect(page.getByText('floor.strudel').first()).toBeVisible()

    await openGalleryFromMenu(page)
    await page.locator('[data-gallery-tab="viz"]').click()
    await page.locator('[data-gallery-card="vizz1DDDDDD"]').click()
    await expect(page.locator('[data-gallery-code="bloom.hydra"]')).toContainText('osc(10')
    await page.getByRole('button', { name: 'Add to this project' }).click()
    await expect(page.locator('[data-gallery="overlay"]')).toHaveCount(0)

    expect(await peak(page, runs, 6_000), 'added gallery code ran without Play').toBe(0)
  })

  test('a removed entry says so', async ({ page }) => {
    await routeGallery(page, { removed: ['proj2BBBBBB'] })
    await bootApp(page)
    await openGalleryFromMenu(page)
    await page.locator('[data-gallery-card="proj2BBBBBB"]').click()
    await expect(page.locator('[data-gallery-state="removed"]')).toHaveText('This was removed from the gallery.')
  })

  test('My shares: lists, marks removed, deletes after confirming', async ({ page }) => {
    const deleted = await routeGallery(page)
    await page.addInitScript(() => {
      localStorage.setItem(
        'stave.gallery.shares',
        JSON.stringify([
          { id: 'musc1CCCCCC', title: 'Four On The Floor', kind: 'music', publishedAt: Date.UTC(2026, 10, 1), manageToken: 'tok-a' },
          { id: 'gone0ZZZZZZ', title: 'An old sketch', kind: 'viz', publishedAt: Date.UTC(2026, 9, 1), manageToken: 'tok-b' },
        ]),
      )
    })
    await bootApp(page)
    await openGalleryFromMenu(page)
    await page.locator('[data-gallery-tab="mine"]').click()
    const row = page.locator('[data-gallery-mine="musc1CCCCCC"]')
    await expect(row).toHaveAttribute('data-gallery-status', 'listed')
    await expect(page.locator('[data-gallery-mine="gone0ZZZZZZ"]')).toContainText('No longer in the gallery')
    if (process.env.GALLERY_SHOTS) await page.screenshot({ path: `${process.env.GALLERY_SHOTS}/my-shares.png` })

    await row.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click() // the confirm
    await expect(row).toHaveCount(0)
    expect(deleted).toEqual(['musc1CCCCCC'])
    const left = await page.evaluate(() => JSON.parse(localStorage.getItem('stave.gallery.shares') ?? '[]').map((s: { id: string }) => s.id))
    expect(left).toEqual(['gone0ZZZZZZ'])
  })

  test('#2433 your own publish and delete show at once, even while the cached list is older', async ({ page }) => {
    const NEW_ID = 'newEntry001'
    const published = {
      id: NEW_ID,
      title: 'Fresh Tune',
      kind: 'music',
      tags: [],
      authorName: 'Ada',
      authorId: ADA_SESSION_USER.authorId,
      publishedAt: Date.UTC(2026, 10, 2),
      fileCount: 1,
      hasThumbnail: false,
    }
    const lists: string[][] = []
    await routeGallery(page)
    // Every read is the list the CDN cached before either change, however often it is asked for.
    const stale = [
      { id: 'musc1CCCCCC', title: 'Four On The Floor', kind: 'music', tags: [], authorName: 'Carol', publishedAt: Date.UTC(2026, 10, 1), fileCount: 1, hasThumbnail: false },
    ]
    await page.route('**/api/gallery', (route) => {
      const method = route.request().method()
      if (method === 'POST') return route.fulfill({ status: 201, json: { id: NEW_ID, manageToken: 'tok-new', authorId: ADA_SESSION_USER.authorId, entry: published } })
      lists.push(stale.map((e) => e.id))
      return route.fulfill({ json: { entries: stale } })
    })
    await routeSession(page, ADA_SESSION_USER)
    await bootApp(page)
    await openGalleryFromMenu(page)
    await page.locator('[data-gallery-tab="music"]').click()
    const card = page.locator(`[data-gallery-card="${NEW_ID}"]`)
    await expect(page.locator('[data-gallery-card="musc1CCCCCC"]')).toBeVisible()
    await expect(card).toHaveCount(0) // the control: it isn't there before publishing

    // Publish from the gallery's own button, as a person does. It closes the gallery,
    // so coming back to it fetches the list again, and the list is still the old one.
    await page.locator('[data-gallery-publish]').click()
    await expect(page.getByTestId('gallery-publish-dialog')).toBeVisible()
    await page.getByTestId('gallery-publish-dialog').getByRole('button', { name: /^Publish/ }).click()
    await expect(page.getByTestId('gallery-publish-dialog')).toBeHidden()
    const reads = lists.length
    await openGalleryFromMenu(page)
    await expect.poll(() => lists.length).toBeGreaterThan(reads)
    await page.locator('[data-gallery-tab="music"]').click()
    await expect(card).toBeVisible()
    await expect(card).toHaveCount(1)

    // My shares must not call it "no longer in the gallery" while the list catches up.
    await page.locator('[data-gallery-tab="mine"]').click()
    const row = page.locator(`[data-gallery-mine="${NEW_ID}"]`)
    await expect(row).toHaveAttribute('data-gallery-status', 'listed')
    await row.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click() // the confirm
    await expect(row).toHaveCount(0)
    await page.locator('[data-gallery-tab="music"]').click()
    await expect(page.locator('[data-gallery-card="musc1CCCCCC"]')).toBeVisible()
    await expect(card).toHaveCount(0)
  })

  test('#2433 an admin\'s take-down and restore show at once, even while the cached list is older', async ({ page }) => {
    const entry = (id: string, title: string, kind: string) => ({
      id, title, kind, tags: [], authorName: 'Carol', publishedAt: Date.UTC(2026, 10, 1), fileCount: 1, hasThumbnail: false,
    })
    const reported = entry('musc1CCCCCC', 'Four On The Floor', 'music')
    const hidden = entry('vizz2HIDDEN', 'Back Again', 'viz')
    await routeGallery(page)
    const restored: string[] = []
    await page.route('**/api/gallery/admin/**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/reports')) return route.fulfill({ json: { flagged: [{ entryId: reported.id, entry: reported, reports: [{ reason: 'copied', reportedAt: 1 }] }] } })
      if (path.endsWith('/removed')) return route.fulfill({ json: { entries: [{ entry: hidden, removedAt: 1, restoreBy: Date.now() + 86_400_000, reason: 'mistake' }] } })
      if (path.endsWith('/suspensions')) return route.fulfill({ json: { suspensions: [] } })
      if (path.endsWith('/log')) return route.fulfill({ json: { actions: [] } })
      if (path.endsWith('/restore')) {
        restored.push(path)
        return route.fulfill({ status: 204 })
      }
      return route.fulfill({ status: 404 })
    })
    // The list the CDN cached before either change: it has the one, not the other.
    await page.route('**/api/gallery', (route) => route.fulfill({ json: { entries: [reported] } }))
    await page.route('**/api/gallery/me', (route) =>
      route.fulfill({ json: { signInAvailable: true, providers: [{ id: 'github', name: 'GitHub' }], user: ADA_SESSION_USER, isAdmin: true } }),
    )
    await bootApp(page)
    await openGalleryFromMenu(page)
    await page.locator('[data-gallery-tab="music"]').click()
    await expect(page.locator(`[data-gallery-card="${reported.id}"]`)).toBeVisible() // the control

    await page.locator('[data-gallery-tab="moderation"]').click()
    await page.locator(`[data-gallery-take-down="${reported.id}"]`).click()
    const why = page.getByPlaceholder('e.g. hateful title, copied without credit')
    await why.fill('copied')
    await why.press('Enter')
    await expect(page.locator('[data-testid="toast"]', { hasText: 'Took down' })).toBeVisible()
    await page.locator(`[data-gallery-restore="${hidden.id}"]`).click()
    const back = page.getByPlaceholder('e.g. taken down by mistake')
    await back.fill('a mistake')
    await back.press('Enter')
    await expect(page.locator('[data-testid="toast"]', { hasText: 'Restored' })).toBeVisible()
    expect(restored).toHaveLength(1)

    const check = async () => {
      await page.locator('[data-gallery-tab="music"]').click()
      await expect(page.locator(`[data-gallery-card="${reported.id}"]`)).toHaveCount(0)
      await page.locator('[data-gallery-tab="viz"]').click()
      await expect(page.locator(`[data-gallery-card="${hidden.id}"]`)).toBeVisible()
    }
    await check() // while the gallery stayed open
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-gallery-tab="music"]')).toHaveCount(0)
    await openGalleryFromMenu(page)
    await check() // and from a fresh read of the same old list
  })

  test('#2433 a delete stays gone when the next cached list still has the entry', async ({ page }) => {
    await routeGallery(page)
    const stale = [
      { id: 'musc1CCCCCC', title: 'Four On The Floor', kind: 'music', tags: [], authorName: 'Carol', publishedAt: Date.UTC(2026, 10, 1), fileCount: 1, hasThumbnail: false },
    ]
    await page.route('**/api/gallery', (route) => route.fulfill({ json: { entries: stale } }))
    await page.addInitScript(() => {
      if (localStorage.getItem('stave.gallery.shares')) return
      localStorage.setItem(
        'stave.gallery.shares',
        JSON.stringify([{ id: 'musc1CCCCCC', title: 'Four On The Floor', kind: 'music', publishedAt: Date.UTC(2026, 10, 1), manageToken: 'tok-a' }]),
      )
    })
    await bootApp(page)
    await openGalleryFromMenu(page)
    await page.locator('[data-gallery-tab="music"]').click()
    const card = page.locator('[data-gallery-card="musc1CCCCCC"]')
    await expect(card).toBeVisible() // the control: the list really has it

    await page.locator('[data-gallery-tab="mine"]').click()
    await page.locator('[data-gallery-mine="musc1CCCCCC"]').getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).last().click() // the confirm
    await expect(page.locator('[data-gallery-mine="musc1CCCCCC"]')).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(page.locator('[data-gallery-tab="music"]')).toHaveCount(0)
    await openGalleryFromMenu(page)
    await page.locator('[data-gallery-tab="music"]').click()
    await expect(page.locator('[data-gallery-state]').or(page.locator('[data-gallery-card]')).first()).toBeVisible()
    await expect(card).toHaveCount(0)
  })
})
