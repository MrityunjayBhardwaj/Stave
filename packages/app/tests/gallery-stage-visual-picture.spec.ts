import { test, expect, type Page } from '@playwright/test'

import { bootApp } from './_appBoot'
import { GALLERY_BODY } from './_gallery'

/**
 * #2611 — before Play, an entry page's stage shows a picture of a visual instead
 * of a bare "VISUAL": the entry's cover picture (its thumbnail, the one its card
 * shows) when the file is the cover visual, a visual's own still when it has one,
 * and the placeholder only when there is neither. A pattern keeps its timeline,
 * and Play puts the live preview in the picture's place.
 *
 * The entry is served from a stand-in for /api/gallery, as its routes serve it:
 * the entry, its record (without stills), its stills, and its thumbnail bytes.
 * The pictures are real PNGs drawn in the page, each a different shape from the
 * stage (4:3 and 16:9 on a 2:1 stage), so a stretched one would show.
 */

const SHOTS = process.env.GALLERY_SHOT_DIR
const ID = 'stage2611AA'

const MANIFEST = {
  schemaVersion: 1,
  project: { name: 'Knot and Bloom', sharedAt: 1 },
  files: [
    { id: 'f1', path: 'main.strudel', language: 'strudel', content: 's("bd*4, hh*8")' },
    { id: 'k1', path: 'Knot.three', language: 'three', content: '// a knot' },
    { id: 'b1', path: 'viz/bloom.hydra', language: 'hydra', content: 'osc(10).out()' },
    { id: 'g1', path: 'viz/grain.p5', language: 'p5', content: '// no still' },
  ],
  fileOrder: {},
  subfolderOrder: {},
}
const SONG = { path: 'main.strudel', span: 'loop', cycles: 4, lanes: [{ name: 'bd' }, { name: 'hh' }], events: [[0, 0, 1, null], [1, 0.5, 1, null]], sections: [] }

interface Pictures {
  thumbnail: string
  bloom: string
  knot: string
}

/** Draw the pictures in the page: a 4:3 cover picture and two small 16:9 stills. */
async function drawPictures(page: Page): Promise<Pictures> {
  return page.evaluate(() => {
    const draw = (w: number, h: number, bg: string, fg: string, ring: boolean) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const x = c.getContext('2d')!
      x.fillStyle = bg
      x.fillRect(0, 0, w, h)
      x.strokeStyle = fg
      x.fillStyle = fg
      x.lineWidth = Math.max(2, w / 40)
      x.beginPath()
      // a circle: stretched, it would read as an ellipse
      x.arc(w / 2, h / 2, Math.min(w, h) * 0.35, 0, Math.PI * 2)
      if (ring) x.stroke()
      else x.fill()
      return c.toDataURL('image/png')
    }
    return {
      thumbnail: draw(480, 360, '#123b3b', '#ff4fd8', true),
      bloom: draw(160, 90, '#3a1d05', '#ffb347', false),
      knot: draw(160, 90, '#0b0b30', '#7fd6c2', false),
    }
  })
}

/** Serve the entry. The cover is `Knot.three`; bloom and the knot have stills, grain has none. */
async function routeEntry(page: Page, pics: () => Pictures | null): Promise<string[]> {
  const asked: string[] = []
  const entry = {
    id: ID,
    title: 'Knot and Bloom',
    kind: 'project',
    tags: [],
    authorName: 'Ada',
    authorId: 'adaAuthor01',
    publishedAt: Date.UTC(2026, 10, 14),
    fileCount: MANIFEST.files.length,
    hasThumbnail: true,
    hasRecording: true,
  }
  await page.route(/\/api\/gallery(\/.*)?$/, async (route) => {
    const path = new URL(route.request().url()).pathname
    asked.push(path)
    const p = pics()
    if (path === '/api/gallery/me') return route.fulfill({ json: { signInAvailable: false, providers: [], user: null } })
    if (path === '/api/gallery') return route.fulfill({ json: { entries: [entry] } })
    if (path === `/api/gallery/${ID}`) return route.fulfill({ json: { entry, manifest: MANIFEST } })
    if (path === `/api/gallery/${ID}/recording`) {
      return route.fulfill({ json: { v: 1, cover: 'Knot.three', contents: { patterns: 1, visuals: 3, other: 0 }, files: [SONG] } })
    }
    if (path === `/api/gallery/${ID}/frames` && p) {
      return route.fulfill({ json: { frames: [{ path: 'Knot.three', image: p.knot }, { path: 'viz/bloom.hydra', image: p.bloom }] } })
    }
    if (path === `/api/gallery/${ID}/thumbnail` && p) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(p.thumbnail.split(',')[1], 'base64') })
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } })
  })
  return asked
}

async function openEntry(page: Page): Promise<void> {
  let pics: Pictures | null = null
  await routeEntry(page, () => pics)
  await bootApp(page)
  pics = await drawPictures(page)
  await page.goto(`/#gallery=${ID}`)
  await expect(page.locator(`[data-gallery-detail="${ID}"]`)).toBeVisible({ timeout: 30_000 })
  await expect(page.locator(GALLERY_BODY).or(page.locator('[data-gallery="overlay"]')).first()).toBeVisible()
  // the record has arrived once the cover leads "In this project"
  await expect(page.locator('[data-gallery-file-row]').first()).toHaveAttribute('data-gallery-file-row', 'Knot.three')
}

const stage = (page: Page) => page.locator('[data-gallery-preview]')
const stagePicture = (page: Page) => stage(page).locator('img[data-gallery-stage-picture]')
const choose = (page: Page, path: string) => page.locator(`[data-gallery-file-row="${path}"] .sg-fname`).click()

/** The picture is decoded, fills the stage's box, and is drawn whole at its own shape. */
async function expectFitted(page: Page, natural: { w: number; h: number }): Promise<void> {
  const img = stagePicture(page)
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(natural.w)
  const m = await img.evaluate((i: HTMLImageElement) => {
    const box = i.getBoundingClientRect()
    const st = (i.closest('[data-gallery-preview]') as HTMLElement).getBoundingClientRect()
    return { fit: getComputedStyle(i).objectFit, nh: i.naturalHeight, w: box.width, h: box.height, sw: st.width, sh: st.height }
  })
  expect(m.nh).toBe(natural.h)
  expect(m.fit).toBe('contain')
  expect(Math.abs(m.w - m.sw)).toBeLessThan(3)
  expect(Math.abs(m.h - m.sh)).toBeLessThan(3)
}

async function shoot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-stave-theme', t), theme)
    await stage(page).screenshot({ path: `${SHOTS}/${name}-stage-${theme}.png` })
    await page.screenshot({ path: `${SHOTS}/${name}-page-${theme}.png` })
  }
  await page.evaluate(() => document.documentElement.setAttribute('data-stave-theme', 'dark'))
}

test.describe('#2611 a visual\'s picture on the entry stage before Play', () => {
  test.setTimeout(90_000)
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 900 })
  })

  test('the cover visual shows the cover picture, whole and unstretched; Play replaces it, Stop brings it back', async ({ page }) => {
    await openEntry(page)
    await expect(stagePicture(page)).toHaveAttribute('data-gallery-stage-picture', 'thumbnail')
    await expect(stagePicture(page)).toHaveAttribute('src', `/api/gallery/${ID}/thumbnail`)
    await expectFitted(page, { w: 480, h: 360 })
    await expect(stage(page).locator('.sg-stage-idle')).toHaveCount(0)
    await shoot(page, 'cover-visual')

    await page.locator('[data-gallery-preview-button]').click()
    await expect(stage(page).locator('[data-gallery-preview-frame]')).toBeVisible()
    await expect(stagePicture(page)).toHaveCount(0)
    await page.locator('[data-gallery-preview-button]').click()
    await expect(stage(page).locator('[data-gallery-preview-frame]')).toHaveCount(0)
    await expect(stagePicture(page)).toHaveAttribute('data-gallery-stage-picture', 'thumbnail')
  })

  test('another visual shows its own still', async ({ page }) => {
    await openEntry(page)
    await choose(page, 'viz/bloom.hydra')
    await expect(stagePicture(page)).toHaveAttribute('data-gallery-stage-picture', 'still')
    await expect(stagePicture(page)).toHaveAttribute('data-gallery-stage-picture-of', 'viz/bloom.hydra')
    await expectFitted(page, { w: 160, h: 90 })
    await shoot(page, 'other-visual-still')
  })

  test('a visual with neither keeps the placeholder; a pattern keeps its timeline', async ({ page }) => {
    await openEntry(page)
    await choose(page, 'viz/grain.p5')
    await expect(stage(page).locator('.sg-stage-idle')).toHaveText(/visual/i)
    await expect(stagePicture(page)).toHaveCount(0)
    await shoot(page, 'visual-placeholder')

    await choose(page, 'main.strudel')
    await expect(stage(page).locator('[data-gallery-timeline="main.strudel"]')).toBeVisible()
    await expect(stagePicture(page)).toHaveCount(0)
    await shoot(page, 'pattern-timeline')
  })
})
