/**
 * Gallery fixtures for the browser specs (#2300): `page.route()` stands in for the
 * `/api/gallery*` routes, so no store is needed. Every fixture's code bumps
 * `window.__galleryRuns` as a top-level statement — the signal that it RAN.
 */
import { expect, type Page, type Route } from '@playwright/test'

export const COUNTER_LINE = 'window.__galleryRuns = (window.__galleryRuns || 0) + 1'
export const MUSIC_CODE = `${COUNTER_LINE}\ns("bd*4, hh*8")`
export const HYDRA_CODE = `${COUNTER_LINE}\nosc(10, 0.1, 0.8).out()`

const NOW = Date.UTC(2026, 10, 1)
const ENTRIES = [
  { id: 'proj1AAAAAA', title: 'Dub Techno Starter', kind: 'project', tags: ['dub', 'techno'], authorName: 'Alice', publishedAt: NOW, fileCount: 2, hasThumbnail: true },
  { id: 'proj2BBBBBB', title: 'Ambient Drift', kind: 'project', tags: ['ambient'], authorName: 'Bob', publishedAt: NOW - 86_400_000, fileCount: 1, hasThumbnail: false },
  { id: 'musc1CCCCCC', title: 'Four On The Floor', kind: 'music', tags: ['house'], authorName: 'Carol', publishedAt: NOW, fileCount: 1, hasThumbnail: false },
  { id: 'vizz1DDDDDD', title: 'Oscillator Bloom', kind: 'viz', tags: ['hydra'], authorName: 'Dee', publishedAt: NOW, fileCount: 1, hasThumbnail: false },
] as const

function manifestFor(id: string) {
  const e = ENTRIES.find((x) => x.id === id)!
  const files =
    e.kind === 'viz'
      ? [{ id: 'g_viz1', path: 'bloom.hydra', language: 'hydra', content: HYDRA_CODE }]
      : e.kind === 'music'
        ? [{ id: 'g_mus1', path: 'floor.strudel', language: 'strudel', content: MUSIC_CODE }]
        : [
            { id: 'g_prj_main', path: 'main.strudel', language: 'strudel', content: MUSIC_CODE },
            { id: 'g_prj_viz', path: 'viz/bloom.hydra', language: 'hydra', content: HYDRA_CODE },
          ]
  return {
    entry: e,
    manifest: {
      schemaVersion: 1,
      project: { name: e.title, sharedAt: e.publishedAt },
      files,
      fileOrder: {},
      subfolderOrder: {},
    },
  }
}

// 1×1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/** #2319 — a signed-in user as GET /api/gallery/me describes them. */
export const ADA_SESSION_USER = {
  name: 'Ada',
  authorId: 'adaAuthor01',
  verified: { provider: 'github' as const, login: 'ada' },
}

/**
 * #2319 — answer GET /api/gallery/me: signed in as `user`, signed out (null), or
 * `'unavailable'` (no sign-in set up on the site). Register it BEFORE booting the
 * app (it asks who is signed in as it starts, once per page load), and AFTER any
 * broader `/api/gallery` route: Playwright tries the newest route first.
 */
export async function routeSession(
  page: Page,
  user: typeof ADA_SESSION_USER | null | 'unavailable',
  providers = [{ id: 'github', name: 'GitHub' }, { id: 'google', name: 'Google' }],
): Promise<void> {
  const body =
    user === 'unavailable'
      ? { signInAvailable: false, providers: [], user: null }
      : { signInAvailable: true, providers, user }
  await page.route('**/api/gallery/me', (route) => route.fulfill({ json: body, headers: { 'cache-control': 'no-store' } }))
}

export async function routeGallery(page: Page, opts: { removed?: string[] } = {}): Promise<string[]> {
  const deleted: string[] = []
  await page.route(/\/api\/gallery(\/.*)?$/, async (route: Route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    // #2319 — signed out unless the spec routes a session itself (routeSession).
    if (path === '/api/gallery/me') {
      return route.fulfill({ json: { signInAvailable: true, providers: [{ id: 'github', name: 'GitHub' }], user: null } })
    }
    if (path === '/api/gallery' && req.method() === 'GET') {
      return route.fulfill({ json: { entries: ENTRIES.filter((e) => !deleted.includes(e.id)) } })
    }
    const thumb = path.match(/^\/api\/gallery\/([^/]+)\/thumbnail$/)
    if (thumb) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    const one = path.match(/^\/api\/gallery\/([^/]+)$/)
    if (one && req.method() === 'DELETE') {
      deleted.push(one[1])
      return route.fulfill({ status: 204 })
    }
    if (one && req.method() === 'GET') {
      if (opts.removed?.includes(one[1]) || deleted.includes(one[1])) return route.fulfill({ status: 410, json: { error: 'removed' } })
      if (!ENTRIES.some((e) => e.id === one[1])) return route.fulfill({ status: 404, json: { error: 'not found' } })
      return route.fulfill({ json: manifestFor(one[1]) })
    }
    if (path.endsWith('/report')) return route.fulfill({ status: 202, json: {} })
    return route.fulfill({ status: 404 })
  })
  return deleted
}


/**
 * #2473 — on a desktop the gallery is a workspace tab: its tab in the tab bar,
 * and its body (drawn only while the tab is in front). Phones keep the
 * full-screen overlay (`[data-gallery="overlay"]`).
 */
export const GALLERY_TAB = '[data-workspace-tab="app-gallery"]'
export const GALLERY_BODY = '[data-gallery="tab"]'

/** Open the gallery from the View menu, as a person does; on a desktop it opens as a tab. */
export async function openGalleryFromMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByText('Community Gallery...', { exact: true }).click()
  await expect(page.locator(GALLERY_BODY)).toBeVisible()
}

/** Close the gallery tab with its × (the tab ignores Esc). */
export async function closeGalleryTab(page: Page): Promise<void> {
  await page.locator('[data-testid="tab-close-app-gallery"]').click()
  await expect(page.locator(GALLERY_TAB)).toHaveCount(0)
}
