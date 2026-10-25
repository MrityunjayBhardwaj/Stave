/**
 * Backdrop crop E2E.
 *
 *   - Popover shows no action controls until a backdrop is pinned.
 *   - Pinning a backdrop surfaces crop/quality/clear inside the popover.
 *   - Clicking crop opens the CropPopup with the backdrop adapter
 *     (title includes "Backdrop").
 *   - Saving a crop writes transform on the inner backdrop wrapper.
 *   - Reload restores the crop.
 *   - Clicking clear unpins the backdrop.
 */

import { test, expect } from '@playwright/test'
import { clearPinnedBackdrop } from './_appBoot'

async function gotoApp(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.locator('[data-workspace-shell="root"]').waitFor({
    timeout: 15000,
  })
  await page.locator('.monaco-editor').waitFor({ timeout: 15000 })
  // these arms start from a project with no backdrop; the Starter pins one (#2240)
  await clearPinnedBackdrop(page)
}

/**
 * Open the backdrop popover from the pattern bar's "set bg" dropdown (#347 —
 * the menubar indicator was removed). Idempotent: if it's already open, no-op.
 */
async function openPopover(page: import('@playwright/test').Page) {
  if ((await page.locator('[data-testid="backdrop-popover"]').count()) === 0) {
    await page.locator('[data-testid="strudel-chrome-bg-toggle"]').click()
  }
  await page
    .locator('[data-testid="backdrop-popover"]')
    .waitFor({ timeout: 2000 })
}

async function pinBackdropFromPatternBar(page: import('@playwright/test').Page) {
  // Pick a viz in the popover → pins it as the active pattern tab's backdrop,
  // leaving the popover open in its pinned (controls) state.
  await openPopover(page)
  const picker = page.locator('[data-testid="backdrop-popover-picker"]')
  const value = await picker.locator('option').nth(1).getAttribute('value')
  await picker.selectOption(value!)
  await page
    .locator('[data-workspace-background]')
    .first()
    .waitFor({ timeout: 5000 })
}

/**
 * Drag the east crop handle inward and save. The handles are proximity-gated,
 * so the cursor has to arrive NEAR the handle before pointer-events arm —
 * a single `mouse.down()` on the exact coordinates does nothing.
 */
async function cropActiveBackdropInward(page: import('@playwright/test').Page) {
  await openPopover(page)
  await page.locator('[data-testid="backdrop-chrome-crop"]').click()
  await page.getByText(/Crop — Backdrop:/i).waitFor({ timeout: 4000 })
  const eastHandle = page.locator('[data-testid="crop-handle-e"]')
  await eastHandle.waitFor({ state: 'attached', timeout: 3000 })
  const box = await eastHandle.boundingBox()
  if (!box) throw new Error('east handle not found')
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX - 4, startY)
  await page.waitForTimeout(60)
  await page.mouse.move(startX, startY)
  await page.waitForTimeout(40)
  await page.mouse.down()
  await page.mouse.move(startX - 30, startY)
  await page.mouse.move(startX - 90, startY)
  await page.mouse.move(startX - 180, startY)
  await page.mouse.up()
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: /Save Crop/i }).click()
  await page.waitForTimeout(600)
}

test.describe('Backdrop crop', () => {
  test('popover shows no action controls when unpinned', async ({ page }) => {
    await gotoApp(page)
    // Open the popover from the pattern bar with no backdrop pinned yet.
    await openPopover(page)
    // Popover opens in unpinned state — no action buttons.
    await expect(
      page.locator('[data-testid="backdrop-popover"][data-pinned="false"]'),
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="backdrop-chrome-crop"]'),
    ).toHaveCount(0)
    await expect(
      page.locator('[data-testid="backdrop-chrome-quality"]'),
    ).toHaveCount(0)
    await expect(
      page.locator('[data-testid="backdrop-chrome-clear"]'),
    ).toHaveCount(0)
    // Close popover.
    await page.keyboard.press('Escape')
  })

  test('pinning a backdrop surfaces controls inside the popover', async ({
    page,
  }) => {
    await gotoApp(page)
    await pinBackdropFromPatternBar(page)
    await openPopover(page)
    await expect(
      page.locator('[data-testid="backdrop-popover"][data-pinned="true"]'),
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="backdrop-chrome-crop"]'),
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="backdrop-chrome-quality"]'),
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="backdrop-chrome-clear"]'),
    ).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('crop button opens popup with backdrop adapter title', async ({
    page,
  }) => {
    await gotoApp(page)
    await pinBackdropFromPatternBar(page)
    await openPopover(page)
    await page.locator('[data-testid="backdrop-chrome-crop"]').click()
    await expect(
      page.getByText(/Crop — Backdrop:/i),
    ).toBeVisible({ timeout: 3000 })
    // Close via Esc.
    await page.keyboard.press('Escape')
  })

  test('saving a crop applies a transform to the backdrop wrapper', async ({
    page,
  }) => {
    await gotoApp(page)
    await pinBackdropFromPatternBar(page)

    // Baseline transform.
    const inner = page
      .locator('[data-workspace-background] > div')
      .first()
    const before = await inner.evaluate(
      (el) => getComputedStyle(el).transform,
    )

    await openPopover(page)
    await page.locator('[data-testid="backdrop-chrome-crop"]').click()
    await expect(page.getByText(/Crop — Backdrop:/i)).toBeVisible()

    // Proximity-gated handles: move cursor near the east handle to arm
    // pointer-events, then drag inward.
    const eastHandle = page.locator('[data-testid="crop-handle-e"]')
    await eastHandle.waitFor({ state: 'attached', timeout: 2000 })
    const box = await eastHandle.boundingBox()
    if (!box) throw new Error('east handle not found')
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    await page.mouse.move(startX - 4, startY)
    await page.waitForTimeout(60)
    await page.mouse.move(startX, startY)
    await page.waitForTimeout(40)
    await page.mouse.down()
    await page.mouse.move(startX - 30, startY)
    await page.mouse.move(startX - 90, startY)
    await page.mouse.move(startX - 180, startY)
    await page.mouse.up()
    await page.waitForTimeout(200)

    await page.getByRole('button', { name: /Save Crop/i }).click()
    await page.waitForTimeout(500)

    const after = await inner.evaluate(
      (el) => getComputedStyle(el).transform,
    )
    expect(after).not.toBe(before)
    const m = after.match(/matrix\(([^)]+)\)/)
    expect(m).toBeTruthy()
    if (m) {
      const [a, , , d] = m[1].split(',').map((v) => parseFloat(v.trim()))
      expect(a).toBeGreaterThan(d)
    }
  })

  test('clear button unpins backdrop', async ({
    page,
  }) => {
    await gotoApp(page)
    await pinBackdropFromPatternBar(page)
    await openPopover(page)
    await page.locator('[data-testid="backdrop-chrome-clear"]').click()
    // Popover closes on clear; backdrop removed.
    await expect(
      page.locator('[data-workspace-background]'),
    ).toHaveCount(0)
  })

  /**
   * #1435 — a crop belongs to the viz FILE it was cut for.
   *
   * The crop used to live on `ProjectMeta.backgroundCrop`, one per project, so
   * swapping the pinned backdrop carried the previous sketch's rectangle onto
   * the new one unchanged — while the popup's own toast named the file it had
   * been "saved for". Measured before the fix: Piano Roll cropped to
   * `matrix(0.7331, 0, 0, 0.5, 0, 0)`, then scope pinned, and scope rendered
   * with that identical matrix.
   *
   * The assertion is deliberately about the SECOND viz, not the first. An arm
   * that only re-checked the cropped file would have passed against the old
   * code too.
   */
  test('a crop cut for one viz does not follow onto the next backdrop pinned', async ({
    page,
  }) => {
    await gotoApp(page)

    await openPopover(page)
    const picker = page.locator('[data-testid="backdrop-popover-picker"]')
    const values = await picker
      .locator('option')
      .evaluateAll((els) =>
        (els as HTMLOptionElement[]).map((e) => e.value).filter((v) => v !== ''),
      )
    expect(values.length, 'project needs two viz files to swap between').toBeGreaterThan(1)
    const [first, second] = values

    // Pin viz A and record its untouched transform.
    await picker.selectOption(first)
    const inner = page.locator('[data-workspace-background] > div').first()
    await inner.waitFor({ timeout: 6000 })
    await page.waitForTimeout(400)
    const uncropped = await inner.evaluate((el) => getComputedStyle(el).transform)

    // Crop viz A.
    await cropActiveBackdropInward(page)
    const cropped = await inner.evaluate((el) => getComputedStyle(el).transform)
    expect(cropped, 'the crop should have changed A').not.toBe(uncropped)

    // Swap to viz B — no clear, no reload, the same popover.
    await openPopover(page)
    await page
      .locator('[data-testid="backdrop-popover-picker"]')
      .selectOption(second)
    await page.waitForTimeout(900)

    const afterSwap = await page
      .locator('[data-workspace-background] > div')
      .first()
      .evaluate((el) => getComputedStyle(el).transform)

    // THE REGRESSION: B must not inherit A's rectangle.
    expect(afterSwap, "the second viz inherited the first viz's crop").not.toBe(
      cropped,
    )
    expect(afterSwap).toBe(uncropped)
  })

  /**
   * #1435 — and the crop A keeps is still A's when A comes back. Storing per
   * file is only half the property; the other half is that swapping away does
   * not DISCARD it, which a naive "clear the crop on swap" fix would break
   * while still passing the arm above.
   */
  test('swapping back restores that viz’s own crop', async ({ page }) => {
    await gotoApp(page)

    await openPopover(page)
    const picker = page.locator('[data-testid="backdrop-popover-picker"]')
    const values = await picker
      .locator('option')
      .evaluateAll((els) =>
        (els as HTMLOptionElement[]).map((e) => e.value).filter((v) => v !== ''),
      )
    const [first, second] = values

    await picker.selectOption(first)
    const inner = page.locator('[data-workspace-background] > div').first()
    await inner.waitFor({ timeout: 6000 })
    await page.waitForTimeout(400)

    await cropActiveBackdropInward(page)
    const cropped = await inner.evaluate((el) => getComputedStyle(el).transform)

    await openPopover(page)
    await page.locator('[data-testid="backdrop-popover-picker"]').selectOption(second)
    await page.waitForTimeout(900)

    await openPopover(page)
    await page.locator('[data-testid="backdrop-popover-picker"]').selectOption(first)
    await page.waitForTimeout(900)

    const back = await page
      .locator('[data-workspace-background] > div')
      .first()
      .evaluate((el) => getComputedStyle(el).transform)
    expect(back, 'A lost its own crop on the round trip').toBe(cropped)
  })
  /**
   * #1435 migration — a project saved BEFORE the move keeps its crop.
   *
   * The old rect lived on `ProjectMeta.backgroundCrop` in IDB with no file
   * attached, so it cannot be keyed at read time: the backdrop FILE is restored
   * asynchronously, per tab. It is handed to the first backdrop that resolves —
   * the one that was on screen when it was saved — and the legacy slot is then
   * drained so it can never travel onto a second sketch.
   *
   * This arm exists because the alternative failure is SILENT: dropping the old
   * crop resets someone's framing with no error and nothing in the console.
   * It asserts all three halves — the crop survives, it lands under the file's
   * key, and the legacy slot is emptied.
   */
  test('a pre-#1435 project-global crop is carried over to its file, once', async ({
    page,
  }) => {
    await gotoApp(page)
    await pinBackdropFromPatternBar(page)
    const inner = page.locator('[data-workspace-background] > div').first()
    await inner.waitFor({ timeout: 6000 })
    await page.waitForTimeout(400)
    const uncropped = await inner.evaluate((el) => getComputedStyle(el).transform)

    // Put the app back in its pre-move state: a legacy crop on the project
    // record, and no per-file store at all.
    const projectId = await page.evaluate(async () => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open('stave-projects')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      const store = db.transaction('projects', 'readwrite').objectStore('projects')
      const all: Array<Record<string, unknown>> = await new Promise((res, rej) => {
        const r = store.getAll()
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      const meta = all[0]
      if (!meta) throw new Error('no project in stave-projects')
      meta.backgroundCrop = { x: 0, y: 0, w: 0.6, h: 1 }
      await new Promise((res, rej) => {
        const r = store.put(meta)
        r.onsuccess = () => res(null)
        r.onerror = () => rej(r.error)
      })
      db.close()
      const id = meta.id as string
      localStorage.removeItem(`stave:backdropCrops:${id}`)
      return id
    })

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-workspace-shell="root"]').waitFor({ timeout: 15000 })
    const innerAfter = page.locator('[data-workspace-background] > div').first()
    await innerAfter.waitFor({ timeout: 10000 })
    await page.waitForTimeout(1200)

    // 1. the crop survived the move
    const restored = await innerAfter.evaluate(
      (el) => getComputedStyle(el).transform,
    )
    expect(restored, 'the legacy crop was dropped on upgrade').not.toBe(uncropped)

    // 2. it landed under the backdrop FILE's key, not project-wide
    const stored = await page.evaluate(
      (id) => localStorage.getItem(`stave:backdropCrops:${id}`),
      projectId,
    )
    expect(stored, 'no per-file crop was written').toBeTruthy()
    const parsed = JSON.parse(stored!) as Record<string, unknown>
    expect(Object.keys(parsed)).toHaveLength(1)
    expect(Object.keys(parsed)[0]).toMatch(/^viz:/)

    // 3. the legacy slot is drained — so it can never ride onto a second viz
    const legacyLeft = await page.evaluate(async (id) => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open('stave-projects')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      const meta: Record<string, unknown> | undefined = await new Promise((res, rej) => {
        const r = db.transaction('projects', 'readonly').objectStore('projects').get(id)
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      db.close()
      return meta?.backgroundCrop ?? null
    }, projectId)
    expect(legacyLeft, 'the legacy crop slot was left full').toBeNull()
  })
})
