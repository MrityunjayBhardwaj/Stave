import { test, expect, type Page, type Request } from '@playwright/test'

import { bootApp, evalCode, seedCode, stopCode } from './_appBoot'
import { ADA_SESSION_USER, GALLERY_BODY } from './_gallery'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/**
 * #2590 — publishing records the tempo a pattern starts at (only when its own
 * code sets one) and a still of each running visual; the entry page shows them.
 *
 * The publish is real: the author's Stave records the patterns on its own engine
 * and copies the running backdrop's canvas. POST /api/gallery is answered here,
 * and the entry is then served back from exactly what was sent, so the page draws
 * what publishing produced (the client reads it through the same reader the
 * publish route uses).
 */

const SHOTS = process.env.GALLERY_SHOT_DIR
const ID = 'tempo2590AA'

async function openPublish(page: Page): Promise<void> {
  await page.keyboard.press(`${MOD}+Shift+P`)
  await page.getByPlaceholder('Type a command...').fill('Publish to Gallery')
  await expect(page.locator('[data-palette-row]', { hasText: 'Publish to Gallery' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('gallery-publish-dialog')).toBeVisible()
}

/** The backdrop's canvas has drawn something (read as the dialog reads it). */
async function waitForVizDrawn(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid^="compiled-viz-mount-"] canvas')
      if (!c || !c.width) return false
      const t = document.createElement('canvas')
      t.width = 16
      t.height = 16
      const x = t.getContext('2d')!
      x.drawImage(c, 0, 0, 16, 16)
      const d = x.getImageData(0, 0, 16, 16).data
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8 && (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8)) return true
      return false
    },
    null,
    { timeout: 30_000 },
  )
}

interface Sent {
  title: string
  kind: string
  manifest: { files: Array<{ id: string; path: string }> }
  recording?: {
    cover: string | null
    files: Array<{ path: string; cycles: number; tempo?: { cps: number; changes: boolean } }>
    frames?: Array<{ path: string; image: string }>
  }
}

/**
 * Answer the publish, then serve the entry back from what was sent: the list,
 * the entry, and its record. Everything else under /api/gallery is a 404.
 */
async function routeRoundTrip(page: Page): Promise<Request[]> {
  const seen: Request[] = []
  let sent: Sent | null = null
  const entry = () => ({
    id: ID,
    title: sent!.title,
    kind: sent!.kind,
    tags: [],
    authorName: 'Ada',
    authorId: ADA_SESSION_USER.authorId,
    publishedAt: Date.UTC(2026, 10, 14),
    fileCount: sent!.manifest.files.length,
    hasThumbnail: false,
    ...(sent!.recording ? { hasRecording: true } : {}),
  })
  await page.route(/\/api\/gallery(\/.*)?$/, async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (path === '/api/gallery/me') {
      return route.fulfill({ json: { signInAvailable: true, providers: [{ id: 'github', name: 'GitHub' }], user: ADA_SESSION_USER } })
    }
    if (path === '/api/gallery' && req.method() === 'POST') {
      seen.push(req)
      sent = req.postDataJSON() as Sent
      return route.fulfill({ status: 201, json: { id: ID, manageToken: 'tok', authorId: ADA_SESSION_USER.authorId, entry: entry() } })
    }
    if (path === '/api/gallery' && req.method() === 'GET') return route.fulfill({ json: { entries: sent ? [entry()] : [] } })
    if (sent && path === `/api/gallery/${ID}`) return route.fulfill({ json: { entry: entry(), manifest: sent.manifest } })
    if (sent && path === `/api/gallery/${ID}/recording` && sent.recording) return route.fulfill({ json: sent.recording })
    return route.fulfill({ status: 404, json: { error: 'not found' } })
  })
  return seen
}

/** Publish the project as it is now, with the given title; the request it sent. */
async function publish(page: Page, seen: Request[], title: string): Promise<Sent> {
  await openPublish(page)
  await expect(page.getByTestId('gallery-publish-thumbnail-img')).toBeVisible({ timeout: 15_000 })
  // #2590 — the dialog says which visuals keep a still, and lets the author leave them out
  await expect(page.getByTestId('gallery-publish-frames')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('gallery-publish-frames-include')).toBeChecked()
  await page.getByTestId('gallery-publish-title').fill(title)
  await page.getByTestId('gallery-publish-submit').click()
  await expect(page.locator('[data-testid="toast"]', { hasText: `Published "${title}"` })).toBeVisible({ timeout: 15_000 })
  expect(seen).toHaveLength(1)
  return seen[0].postDataJSON() as Sent
}

/** Open the published entry from its link, as anyone would. */
async function openEntry(page: Page): Promise<void> {
  await page.goto(`/#gallery=${ID}`)
  await expect(page.locator(`[data-gallery-detail="${ID}"]`)).toBeVisible({ timeout: 30_000 })
  await expect(page.locator(GALLERY_BODY).or(page.locator('[data-gallery="overlay"]')).first()).toBeVisible()
}

/** Screenshots for a person to look at (GALLERY_SHOT_DIR): the details, and the row with a still in view. */
async function shoot(page: Page, name: string, theme: 'dark' | 'light' = 'dark', row?: string): Promise<void> {
  if (!SHOTS) return
  await page.evaluate((t) => document.documentElement.setAttribute('data-stave-theme', t), theme)
  await page.locator('[data-testid="toast"]').evaluateAll((ts) => ts.forEach((t) => ((t as HTMLElement).style.display = 'none')))
  await page.locator(`[data-gallery-detail="${ID}"] .sg-side`).screenshot({ path: `${SHOTS}/${name}-details-${theme}.png` })
  if (row) {
    const r = page.locator(`[data-gallery-file-row="${row}"]`)
    await r.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/${name}-rows-${theme}.png` })
    await r.screenshot({ path: `${SHOTS}/${name}-row-${theme}.png` })
  }
}

/** The song's pattern file in what was sent: the cover. */
const coverOf = (sent: Sent) => sent.recording!.files.find((f) => f.path === sent.recording!.cover)!

test.describe('#2590 tempo and visual stills, recorded at publish', () => {
  test.setTimeout(120_000)

  test('a pattern that sets its tempo with setcpm: recorded, and the page shows BPM, minutes, and each visual\'s still', async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 900 })
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const seen = await routeRoundTrip(page)
    await bootApp(page)
    // 100 BPM in quarter notes: 25 cycles a minute
    await seedCode(page, 'setcpm(100/4)\n\n$: s("bd*4, hh*8").gain(0.4)')
    await evalCode(page)
    await waitForVizDrawn(page)
    const sent = await publish(page, seen, 'Steady hundred')
    await stopCode(page)

    const cover = coverOf(sent)
    expect(cover.tempo).toEqual({ cps: Math.round((100 / 4 / 60) * 1e6) / 1e6, changes: false })
    // the still of the running backdrop: a visual of this entry, small
    const visuals = sent.manifest.files.filter((f) => /\.(hydra|p5|glsl|frag|three|js)$/.test(f.path)).map((f) => f.path)
    expect(sent.recording!.frames!.length).toBeGreaterThan(0)
    for (const f of sent.recording!.frames!) {
      expect(visuals).toContain(f.path)
      expect(f.image).toMatch(/^data:image\/(webp|png);base64,/)
      expect(Buffer.from(f.image.split(',')[1], 'base64').byteLength).toBeLessThanOrEqual(12 * 1024)
    }

    await openEntry(page)
    await expect(page.locator('[data-gallery-tempo]')).toHaveText('100 BPM')
    const cycles = Math.round(cover.cycles * 100) / 100
    const secs = Math.round(cover.cycles / (100 / 4 / 60))
    await expect(page.locator('[data-gallery-cover-length]')).toContainText(`· ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`)
    await expect(page.locator('[data-gallery-cover-length]')).toContainText(String(cycles))
    // each visual that had a still shows it on its row, decoded at its own size
    for (const f of sent.recording!.frames!) {
      const img = page.locator(`[data-gallery-file-row="${f.path}"] img[data-gallery-visual-frame]`)
      await expect(img).toBeVisible()
      const size = await img.evaluate((i: HTMLImageElement) => ({ w: i.naturalWidth, h: i.naturalHeight, shown: i.getBoundingClientRect().height }))
      expect(size.w).toBeGreaterThan(0)
      expect(size.w).toBeLessThanOrEqual(160)
      expect(size.shown).toBeGreaterThan(20)
    }
    const stillRow = sent.recording!.frames![0].path
    console.log(`[2590] stills for: ${sent.recording!.frames!.map((f) => `${f.path} (${Buffer.from(f.image.split(',')[1], 'base64').byteLength} B)`).join(', ')}; tempo ${JSON.stringify(cover.tempo)}; cycles ${cover.cycles}`)
    await shoot(page, 'entry-with-tempo-and-stills', 'dark', stillRow)
    await shoot(page, 'entry-with-tempo-and-stills', 'light', stillRow)
  })

  test('a pattern that sets no tempo: none recorded (not the default), and the page shows none', async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 900 })
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const seen = await routeRoundTrip(page)
    await bootApp(page)
    await seedCode(page, '$: s("bd*4, hh*8").gain(0.4)')
    await evalCode(page)
    await waitForVizDrawn(page)
    const sent = await publish(page, seen, 'No tempo set')
    await stopCode(page)

    expect(coverOf(sent)).not.toHaveProperty('tempo')
    await openEntry(page)
    await expect(page.locator('[data-gallery-cover-length]')).toBeVisible()
    await expect(page.locator('[data-gallery-tempo]')).toHaveCount(0)
    await expect(page.locator(`[data-gallery-detail="${ID}"] .sg-facts`)).not.toContainText('BPM')
    await expect(page.locator('[data-gallery-cover-length]')).not.toContainText(':')
    await shoot(page, 'entry-without-tempo', 'dark')
  })

  test('a pattern that changes its tempo as it plays: the start is kept, and the page says "starts at"', async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 900 })
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const seen = await routeRoundTrip(page)
    await bootApp(page)
    await seedCode(page, 'setcps(0.5)\n\n$: s("bd*4, hh*8").gain(0.4).cps("<0.5 0.75>")')
    await evalCode(page)
    await waitForVizDrawn(page)
    const sent = await publish(page, seen, 'Speeds up')
    await stopCode(page)

    expect(coverOf(sent).tempo).toEqual({ cps: 0.5, changes: true })
    await openEntry(page)
    await expect(page.locator('[data-gallery-tempo]')).toHaveText('starts at 120 BPM')
    await expect(page.locator('[data-gallery-cover-length]')).not.toContainText(':')
  })
})
