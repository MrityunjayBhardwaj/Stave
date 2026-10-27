import { test, expect, type Page } from '@playwright/test'

/**
 * #1367 — the left panel's width is ONE concern and must be owned in ONE
 * place, so switching activity-bar tabs swaps only the CONTENT.
 *
 * Before the fix the width lived in four modules with four different values:
 * FileTree (160–600, draggable, persisted), StaveApp's `panelRoot` (240, for
 * Search and Version History), AssetLibraryPanel (260) and ConsolePanel (360).
 * Only Explorer carried a resize handle, so dragging the edge changed one
 * fifth of the UI and every other tab snapped back to its own hardcoded number.
 *
 * The assertion is deliberately a MEASUREMENT of the rendered box rather than
 * a check that some wrapper exists: a wrapper can mount and still not own the
 * width if a panel inside it sets its own. `[data-sidebar]` is on all five
 * panel roots both before and after the fix, so the same locator reports the
 * real numbers either way — the pre-fix run names 240 / 260 / 360 out loud.
 *
 * Run:
 *   pnpm --filter @stave/app exec playwright test left-panel-width.spec.ts --workers=1
 */

test.use({ viewport: { width: 1400, height: 1000 } })

/** Every panel registered in the activity bar, by its `title` (panels/registry). */
const TABS = ['Explorer', 'Search', 'Version History', 'Library', 'Console'] as const

async function boot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    ;(window as any).__STAVE_E2E__ = true // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      // Start from the default width — a width persisted by an earlier run
      // would let "all tabs agree" pass for the wrong reason.
      //
      // But `addInitScript` runs on EVERY navigation, reload included, so an
      // unguarded wipe here would erase the width the persistence test is
      // about to reload and check for. The sessionStorage marker survives the
      // reload and confines the wipe to the FIRST navigation of each test.
      if (!sessionStorage.getItem('stave:e2e:1367-wiped')) {
        localStorage.removeItem('stave:sidebar-width')
        sessionStorage.setItem('stave:e2e:1367-wiped', '1')
      }
      localStorage.setItem('stave:bottomPanel.open', 'false')
      localStorage.setItem('stave.viz.worker', '0')
    } catch { /* private mode */ }
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-workspace-shell="root"]').waitFor({ timeout: 20000 })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(800)
}

async function selectTab(page: Page, title: string): Promise<void> {
  const btn = page.locator('[data-activity-bar]').getByRole('button', { name: title, exact: true })
  await btn.click()
  await page.waitForTimeout(200)
  // The rail TOGGLES: clicking the panel that is already open collapses it.
  // Explorer is open on boot, so an unconditional click would close it and the
  // measurement would then be of nothing. Clicking again reopens the same
  // panel, which makes this idempotent whichever state we started in.
  const visible = await page.locator('[data-sidebar]').first().isVisible().catch(() => false)
  if (!visible) await btn.click()
  await page.locator('[data-sidebar]').first().waitFor({ timeout: 10000 })
  await page.waitForTimeout(250)
}

async function panelWidth(page: Page): Promise<number> {
  const box = await page.locator('[data-sidebar]').first().boundingBox()
  if (!box) throw new Error('left panel not visible')
  return Math.round(box.width)
}

/** Drag the resize handle so the panel's right edge lands at absolute `targetX`. */
async function dragEdgeTo(page: Page, targetX: number): Promise<void> {
  const handle = page.getByLabel('Resize sidebar')
  await expect(handle, 'the resize handle must exist on the ACTIVE tab').toBeVisible()
  const start = await handle.boundingBox()
  if (!start) throw new Error('resize handle not visible')
  await page.mouse.move(start.x + start.width / 2, start.y + 60)
  await page.mouse.down()
  await page.mouse.move(targetX, start.y + 60, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(250)
}

test.beforeEach(async ({ page }) => {
  await boot(page)
})

test('every tab reports the same left-panel width', async ({ page }) => {
  await selectTab(page, 'Explorer')

  // 380 is clear of the default 240 AND of both hardcoded values (260 / 360),
  // so no tab can match by coincidence.
  await dragEdgeTo(page, 380)
  const expected = await panelWidth(page)
  expect(expected, 'the drag must actually have moved the edge').toBeGreaterThan(330)

  const measured: Record<string, number> = { Explorer: expected }
  for (const tab of TABS) {
    if (tab === 'Explorer') continue
    await selectTab(page, tab)
    measured[tab] = await panelWidth(page)
  }
  // Report every number, so a failure says WHICH tab disagreed and by how much
  // rather than only that one did.
  console.log('[1367] widths: ' + JSON.stringify(measured)) // eslint-disable-line no-console

  for (const tab of TABS) {
    expect(
      Math.abs(measured[tab] - expected),
      `${tab} should be ${expected}px like every other tab, got ${measured[tab]}px`,
    ).toBeLessThanOrEqual(2)
  }

  // Returning to Explorer must not restore some private width of its own.
  await selectTab(page, 'Explorer')
  expect(Math.abs((await panelWidth(page)) - expected)).toBeLessThanOrEqual(2)
})

test('the panel resizes from a tab other than Explorer, and the width follows', async ({ page }) => {
  // Console was the widest hardcoded panel (360) and had no handle at all.
  await selectTab(page, 'Console')
  const before = await panelWidth(page)

  await dragEdgeTo(page, before + 140)
  const after = await panelWidth(page)
  expect(after, 'dragging from Console must widen the panel').toBeGreaterThan(before + 90)

  // The width a user set on Console is the same width Explorer shows.
  await selectTab(page, 'Explorer')
  expect(Math.abs((await panelWidth(page)) - after)).toBeLessThanOrEqual(2)
})

test('the width survives a reload, from whichever tab set it', async ({ page }) => {
  await selectTab(page, 'Search')
  await dragEdgeTo(page, 420)
  const set = await panelWidth(page)
  expect(set).toBeGreaterThan(370)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-workspace-shell="root"]').waitFor({ timeout: 20000 })
  await page.waitForTimeout(800)
  await selectTab(page, 'Explorer')
  expect(
    Math.abs((await panelWidth(page)) - set),
    'a width set on Search must persist like one set on Explorer',
  ).toBeLessThanOrEqual(2)
})

/**
 * The drag-to-collapse gesture is the subtlest thing the width owner carries,
 * and the easiest to lose in a move: pulling the edge past half the minimum
 * width folds the panel shut, but the drag KEEPS RUNNING, so pulling back
 * within the same gesture un-does it. Only mouseup commits. A version that
 * merely mounted and resized would pass every test above and still have
 * dropped this.
 */
test('dragging the edge shut collapses the panel', async ({ page }) => {
  await selectTab(page, 'Explorer')
  await expect(page.locator('[data-side-panel]')).toBeVisible()

  const handle = page.getByLabel('Resize sidebar')
  const start = await handle.boundingBox()
  if (!start) throw new Error('resize handle not visible')
  await page.mouse.move(start.x + start.width / 2, start.y + 60)
  await page.mouse.down()
  await page.mouse.move(10, start.y + 60, { steps: 12 }) // well past the 80px threshold
  await page.mouse.up()
  await page.waitForTimeout(300)

  await expect(page.locator('[data-side-panel]')).toHaveCount(0)
})

test('pulling back within the same gesture cancels the collapse', async ({ page }) => {
  await selectTab(page, 'Explorer')
  const handle = page.getByLabel('Resize sidebar')
  const start = await handle.boundingBox()
  if (!start) throw new Error('resize handle not visible')

  await page.mouse.move(start.x + start.width / 2, start.y + 60)
  await page.mouse.down()
  await page.mouse.move(10, start.y + 60, { steps: 8 })   // intent to collapse
  await page.waitForTimeout(120)
  await page.mouse.move(400, start.y + 60, { steps: 8 })  // ...changed my mind
  await page.mouse.up()
  await page.waitForTimeout(300)

  // Still open, and at the width the gesture ended on — not collapsed, and not
  // snapped back to where it started.
  await expect(page.locator('[data-side-panel]')).toBeVisible()
  expect(await panelWidth(page)).toBeGreaterThan(330)
})

/**
 * FileTree's hover-only header actions (New file / New folder) are studio's,
 * not something the width owner ever knew about. Hoisting the width moved the
 * element that used to carry the hover boundary, so this checks the boundary
 * survived the move.
 */
test('the Explorer header actions still appear only on hover', async ({ page }) => {
  await selectTab(page, 'Explorer')
  // The actions fade with OPACITY, not display — `toBeVisible()` would report
  // true either way, so read the property the behaviour actually uses.
  const actions = page.locator('[data-sidebar]').getByTitle('New file')
  const opacityOfRow = () =>
    actions.evaluate((el) => getComputedStyle(el.parentElement as HTMLElement).opacity)

  // Park the pointer outside the panel first — the rail click left it inside.
  await page.mouse.move(900, 500)
  await page.waitForTimeout(300)
  expect(Number(await opacityOfRow()), 'hidden while the cursor is outside').toBeLessThan(0.1)

  const box = await page.locator('[data-sidebar]').first().boundingBox()
  if (!box) throw new Error('panel not visible')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(300)
  expect(Number(await opacityOfRow()), 'shown while the cursor is inside').toBeGreaterThan(0.9)
})

/**
 * #2254 — at the panel's narrowest width a toolbar's buttons stay inside it.
 *
 * Console's filter box and Search's input are `flex: 1` text inputs. A text input
 * will not shrink below its built-in ~20-character width unless `min-width` lets it,
 * so below ~250 px it pushed its buttons past the panel's edge, and the panel does
 * not clip, so they sat on top of the editor (65 px over at 160 px for Console, 31
 * for Search). Measured as rendered boxes against the panel's own right edge, at a
 * normal width first so a toolbar that is wrong everywhere cannot pass.
 */
test('at its narrowest width, the Console and Search toolbars keep their buttons inside', async ({ page }) => {
  // two widths x two tabs, each a tab switch and a drag
  test.setTimeout(90_000)
  const toolbars = [
    { tab: 'Console', buttons: ['Copy visible entries', 'Clear log'], input: '[data-testid="console-search"]' },
    { tab: 'Search', buttons: ['Match case'], input: 'input[placeholder^="Search in files"]' },
  ] as const

  const reachPastEdge = async (title: string): Promise<number> => {
    const panel = await page.locator('[data-side-panel]').boundingBox()
    const btn = await page.locator('[data-sidebar]').getByTitle(title, { exact: true }).boundingBox()
    if (!panel || !btn) throw new Error(`${title}: not visible`)
    return Math.round(btn.x + btn.width - (panel.x + panel.width))
  }

  for (const narrow of [false, true]) {
    for (const { tab, buttons, input } of toolbars) {
      await selectTab(page, tab)
      if (narrow) {
        // well past the 160 px floor but short of the 80 px collapse line
        const panel = await page.locator('[data-side-panel]').boundingBox()
        await dragEdgeTo(page, panel!.x + 120)
        expect(await panelWidth(page), 'the drag must reach the 160 px floor').toBe(160)
      }
      for (const title of buttons) {
        expect(await reachPastEdge(title), `${tab} › ${title} at ${await panelWidth(page)} px`).toBeLessThanOrEqual(0)
      }
      // the box gave up the room, and is still there to type into
      const box = await page.locator(input).boundingBox()
      expect(box!.width, `${tab}'s input still has room`).toBeGreaterThan(30)
    }
  }
})

