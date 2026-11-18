import { test, expect, type Page, type Request } from '@playwright/test'

import { bootApp, evalCode, seedCode, stopCode } from './_appBoot'
import { ADA_SESSION_USER, GALLERY_BODY } from './_gallery'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/**
 * #2610 — a visual drawn inline under the code by `.viz("Knot")` is the visual
 * the author sees, so publishing keeps a still of it for its row, and when it is
 * the chosen cover the dialog's picture is of it — not of the larger backdrop
 * running behind it.
 *
 * The project is the one from the issue: `Knot.three` (here with a magenta
 * background and a green knot, so its frames are easy to tell from anything
 * else), played inline by the pattern, with the Starter's Sunset Drive backdrop
 * pinned behind it. The publish is real; POST /api/gallery is answered here and
 * the entry is served back from exactly what was sent.
 */

const SHOTS = process.env.GALLERY_SHOT_DIR
const ID = 'inline2610A'

const KNOT = `import * as THREE from 'three'
const scene = new THREE.Scene()
scene.background = new THREE.Color('#ff00aa')
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100)
camera.position.set(0, 0, 6)
const renderer = new THREE.WebGLRenderer()
renderer.setSize(innerWidth, innerHeight)
document.body.appendChild(renderer.domElement)
const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.35, 64, 8), new THREE.MeshBasicMaterial({ color: '#00ff00' }))
scene.add(knot)
renderer.setAnimationLoop(() => {
  knot.rotation.y += 0.01
  renderer.render(scene, camera)
})
`
const PATTERN = '$: s("bd*4, hh*8").gain(0.3).viz("Knot")'

/** A sketch that draws nothing but black: on screen, but its frames read back blank. */
const DARK = `import * as THREE from 'three'
const scene = new THREE.Scene()
scene.background = new THREE.Color('#000000')
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100)
const renderer = new THREE.WebGLRenderer()
renderer.setSize(innerWidth, innerHeight)
document.body.appendChild(renderer.domElement)
renderer.setAnimationLoop(() => renderer.render(scene, camera))
`

/** Make `<name>.three` through the New file prompt, as a person does, then give it the sketch and save. */
async function makeThree(page: Page, name: string, sketch: string): Promise<void> {
  await page.locator('[data-sidebar]').hover()
  await page.locator('[data-sidebar] button[title="New file"]').click()
  await page.keyboard.type(`${name}.three`)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  const id = await page.evaluate(
    ([n, code]) => {
      const w = window as unknown as {
        __staveOverrideVizFile: (n: string, c: string) => string | null
        __staveSaveVizFileById: (id: string) => boolean
      }
      const fid = w.__staveOverrideVizFile(n, code)
      if (fid) w.__staveSaveVizFileById(fid)
      return fid
    },
    [name, sketch] as const,
  )
  expect(id, `${name}.three exists`).not.toBeNull()
  await page.locator('[data-workspace-tab="tab-pattern.strudel"]').click()
}

/** Both visuals are drawing: the knot inline, and the backdrop behind it (read as the dialog reads them). */
async function waitForBothDrawn(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const lit = (c: HTMLCanvasElement | null) => {
        if (!c || !c.width) return false
        const t = document.createElement('canvas')
        t.width = 16
        t.height = 16
        const x = t.getContext('2d')!
        x.drawImage(c, 0, 0, 16, 16)
        const d = x.getImageData(0, 0, 16, 16).data
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8 && (d[i] > 8 || d[i + 1] > 8 || d[i + 2] > 8)) return true
        return false
      }
      return (
        lit(document.querySelector<HTMLCanvasElement>('[data-viz-zone-id="Knot"] canvas')) &&
        lit(document.querySelector<HTMLCanvasElement>('[data-testid^="compiled-viz-mount-"] canvas'))
      )
    },
    null,
    { timeout: 30_000 },
  )
}

/** The share of an image's pixels that are the knot's magenta background. */
async function magentaShare(page: Page, dataUrl: string): Promise<number> {
  return page.evaluate(async (src) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const x = c.getContext('2d')!
    x.drawImage(img, 0, 0)
    const d = x.getImageData(0, 0, c.width, c.height).data
    let hit = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] < 25 && Math.abs(d[i + 2] - 170) < 25) hit++
    return hit / (d.length / 4)
  }, dataUrl)
}

interface Sent {
  title: string
  kind: string
  thumbnail?: string
  manifest: { files: Array<{ id: string; path: string }> }
  recording?: { cover: string | null; frames?: Array<{ path: string; image: string }> }
}

/** Answer the publish, then serve the entry back from what was sent. */
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
    publishedAt: Date.UTC(2026, 10, 16),
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
    if (sent && path === `/api/gallery/${ID}/recording` && sent.recording) {
      const { frames: _frames, ...bare } = sent.recording
      return route.fulfill({ json: bare })
    }
    if (sent && path === `/api/gallery/${ID}/frames` && sent.recording) {
      return route.fulfill({ json: { frames: sent.recording.frames ?? [] } })
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } })
  })
  return seen
}

async function openPublish(page: Page): Promise<void> {
  await page.keyboard.press(`${MOD}+Shift+P`)
  await page.getByPlaceholder('Type a command...').fill('Publish to Gallery')
  // a click on the row, not Enter: Enter is sometimes ignored while the palette is still settling
  await page.locator('[data-palette-row]', { hasText: 'Publish to Gallery' }).click()
  await expect(page.getByTestId('gallery-publish-dialog')).toBeVisible({ timeout: 20_000 })
}

async function send(page: Page, seen: Request[], title: string): Promise<Sent> {
  await page.getByTestId('gallery-publish-title').fill(title)
  await page.getByTestId('gallery-publish-submit').click()
  await expect(page.locator('[data-testid="toast"]', { hasText: `Published "${title}"` })).toBeVisible({ timeout: 15_000 })
  expect(seen).toHaveLength(1)
  return seen[0].postDataJSON() as Sent
}

async function setUp(page: Page): Promise<Request[]> {
  await page.setViewportSize({ width: 1360, height: 900 })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const seen = await routeRoundTrip(page)
  await bootApp(page, { e2eHooks: true })
  await makeThree(page, 'Knot', KNOT)
  await seedCode(page, PATTERN)
  await evalCode(page)
  await waitForBothDrawn(page)
  // the issue's scene: the backdrop's canvas is the larger one, so "largest" would pick it
  const areas = await page.evaluate(() => {
    const a = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect()
      return r.width * r.height
    }
    return { knot: a('[data-viz-zone-id="Knot"] canvas'), backdrop: a('[data-testid^="compiled-viz-mount-"] canvas') }
  })
  expect(areas.backdrop).toBeGreaterThan(areas.knot)
  return seen
}

test.describe('#2610 a visual drawn inline by .viz("name") at publish', () => {
  test.setTimeout(120_000)

  test('its row gets a still of it, and the entry shows that still', async ({ page }) => {
    const seen = await setUp(page)
    await openPublish(page)
    await expect(page.getByTestId('gallery-publish-frames')).toContainText('Knot.three', { timeout: 15_000 })
    await expect(page.getByTestId('gallery-publish-frames-missed')).toHaveCount(0)
    if (SHOTS) await page.getByTestId('gallery-publish-dialog').screenshot({ path: `${SHOTS}/dialog-pattern-cover.png` })
    const sent = await send(page, seen, 'Knot inline')
    await stopCode(page)

    const still = sent.recording!.frames!.find((f) => f.path === 'Knot.three')
    expect(still, 'a still for Knot.three').toBeDefined()
    // it is the knot's frame: mostly its magenta background
    expect(await magentaShare(page, still!.image)).toBeGreaterThan(0.3)
    // the backdrop's still is not the knot's
    const sun = sent.recording!.frames!.find((f) => f.path !== 'Knot.three')
    if (sun) expect(await magentaShare(page, sun.image)).toBeLessThan(0.05)

    await page.goto(`/#gallery=${ID}`)
    await expect(page.locator(`[data-gallery-detail="${ID}"]`)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(GALLERY_BODY).or(page.locator('[data-gallery="overlay"]')).first()).toBeVisible()
    const img = page.locator('[data-gallery-file-row="Knot.three"] img[data-gallery-visual-frame]')
    await expect(img).toBeVisible()
    if (SHOTS) {
      await page.locator('[data-gallery-file-row="Knot.three"]').scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${SHOTS}/entry-knot-row.png` })
    }
  })

  test('chosen as the cover, the picture is the knot, not the larger backdrop', async ({ page }) => {
    const seen = await setUp(page)
    await openPublish(page)
    await page.getByTestId('gallery-publish-cover').selectOption({ label: 'Knot.three' })
    const img = page.getByTestId('gallery-publish-thumbnail-img')
    await expect(img).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => magentaShare(page, (await img.getAttribute('src'))!), { timeout: 10_000 }).toBeGreaterThan(0.3)
    await expect(page.getByTestId('gallery-publish-thumbnail-note')).toHaveCount(0)
    if (SHOTS) await page.getByTestId('gallery-publish-dialog').screenshot({ path: `${SHOTS}/dialog-knot-cover.png` })
    const sent = await send(page, seen, 'Knot cover')
    await stopCode(page)
    expect(sent.recording!.cover).toBe('Knot.three')
    expect(await magentaShare(page, sent.thumbnail!)).toBeGreaterThan(0.3)
  })

  test('a pattern cover keeps the largest visual as the picture; a visual not on screen says so', async ({ page }) => {
    await setUp(page)
    await openPublish(page)
    // the pattern is the cover by default: the picture is the backdrop, as before
    const img = page.getByTestId('gallery-publish-thumbnail-img')
    await expect(img).toBeVisible({ timeout: 15_000 })
    expect(await magentaShare(page, (await img.getAttribute('src'))!)).toBeLessThan(0.05)
    // a visual of the project that isn't playing: the dialog says why the picture isn't of it
    await page.getByTestId('gallery-publish-cover').selectOption({ label: 'preset/viz/spiral.p5' })
    await expect(page.getByTestId('gallery-publish-thumbnail-note')).toHaveText(
      "preset/viz/spiral.p5 isn't drawing on screen right now. This picture is of another visual that is.",
      { timeout: 15_000 },
    )
    if (SHOTS) await page.getByTestId('gallery-publish-dialog').screenshot({ path: `${SHOTS}/dialog-offscreen-cover.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('gallery-publish-dialog')).toHaveCount(0)
    await stopCode(page)
  })

  test('an inline visual on screen whose still can\'t be taken: the dialog names it and says why', async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 900 })
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const seen = await routeRoundTrip(page)
    await bootApp(page, { e2eHooks: true })
    await makeThree(page, 'Dark', DARK)
    await seedCode(page, '$: s("bd*4").gain(0.3).viz("Dark")')
    await evalCode(page)
    await page.locator('[data-viz-zone-id="Dark"] canvas').first().waitFor({ timeout: 20_000 })
    await page.waitForTimeout(1500)
    await openPublish(page)
    await expect(page.locator('[data-gallery-missed-still="Dark.three"]')).toHaveText(
      "No still for Dark.three: it's on screen, but the running viz read back blank, so there's no thumbnail.",
      { timeout: 15_000 },
    )
    if (SHOTS) await page.getByTestId('gallery-publish-dialog').screenshot({ path: `${SHOTS}/dialog-missed-still.png` })
    const sent = await send(page, seen, 'Dark inline')
    await stopCode(page)
    expect((sent.recording!.frames ?? []).map((f) => f.path)).not.toContain('Dark.three')
  })
})
