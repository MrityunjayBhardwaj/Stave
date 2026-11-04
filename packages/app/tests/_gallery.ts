/**
 * Gallery fixtures for the browser specs (#2300): `page.route()` stands in for the
 * `/api/gallery*` routes, so no store is needed. Every fixture's code bumps
 * `window.__galleryRuns` as a top-level statement — the signal that it RAN.
 */
import type { Page, Route } from '@playwright/test'

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

export async function routeGallery(page: Page, opts: { removed?: string[] } = {}): Promise<string[]> {
  const deleted: string[] = []
  await page.route(/\/api\/gallery(\/.*)?$/, async (route: Route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
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

