/**
 * #1800 — ⌘Z undoes what the FOCUSED surface edited.
 *
 * The piano roll, the step sequencer and the Song timeline all edit code, and
 * each edit is one undo step in the code editor's own history. Before #1800,
 * ⌘Z pressed with one of them focused ran the project undo instead (files
 * created, deleted, renamed), so the edit stayed. Undo and Redo are still ONE
 * command each; they pick their target from focus.
 *
 * Expected strings are never predicted: each arm records what the mouse wrote
 * and asserts undo walks back through exactly those states.
 */
import { test, expect, type Page } from '@playwright/test'
import { pinLcmGrid } from './_appBoot'


pinLcmGrid(test)
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function boot(page: Page, tab: string): Promise<void> {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('stave:bottomPanel.open', 'true')
      localStorage.setItem('stave:bottomPanel.height', '360')
      localStorage.setItem('stave:bottomPanel.activeTabId', t)
    } catch {
      /* storage unavailable: the test fails on the missing panel */
    }
  }, tab)
  await page.goto('/')
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 20_000 })
  await page.waitForFunction(
    () => ((window as any).monaco?.editor?.getEditors?.()?.length ?? 0) > 0,
    { timeout: 20_000 },
  )
  await page.waitForTimeout(400)
}

const code = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const eds = (window as any).monaco.editor.getEditors()
    const ed = eds.find((e: any) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    return ed.getModel().getValue()
  })

async function setCode(page: Page, src: string, column: number): Promise<void> {
  await page.evaluate(
    ([s, c]) => {
      const eds = (window as any).monaco.editor.getEditors()
      const ed = eds.find((e: any) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
      ed.getModel().setValue(s)
      ed.setPosition({ lineNumber: 1, column: c })
      ed.focus()
    },
    [src, column] as const,
  )
  await page.waitForTimeout(300)
}

/** Focus must be inside `selector` — otherwise the ⌘Z would test something else. */
async function expectFocusIn(page: Page, selector: string): Promise<void> {
  expect(
    await page.evaluate((s) => !!document.activeElement?.closest(s), selector),
    `focus is inside ${selector}`,
  ).toBe(true)
}

async function press(page: Page, keys: string): Promise<void> {
  await page.keyboard.press(keys)
  await page.waitForTimeout(350)
}

const ROLL = '[data-bottom-panel-tab="piano-roll"]'

test('piano roll: three edits, three ⌘Z with the roll focused, back to the original; ⌘⇧Z redoes', async ({ page }) => {
  await boot(page, 'pattern')
  await setCode(page, '$: note("c3 ~ ~ ~")', 6)
  const states = [await code(page)]
  for (const cell of ['48:1', '48:2', '48:3']) {
    await page.locator(`[data-roll-cell="${cell}"]`).click()
    await page.waitForTimeout(350)
    states.push(await code(page))
  }
  expect(new Set(states).size, 'each click changed the code').toBe(4)
  for (let k = 3; k > 0; k--) {
    await expectFocusIn(page, ROLL)
    await press(page, `${MOD}+z`)
    expect(await code(page)).toBe(states[k - 1])
  }
  await expectFocusIn(page, ROLL)
  await press(page, `${MOD}+Shift+z`)
  expect(await code(page)).toBe(states[1])
})

// Clicking a sequencer cell keeps focus in the code editor (the cell cancels
// the focus change; measured 2026-09-27), so ⌘Z reaches the code editor's own
// undo. A regression guard: the sequencer gets keyboard focus of its own with
// the grid cursor (#1802), and the Pattern panel's undo target covers it then.
test('sequencer: ⌘Z after a step click undoes it, ⌘⇧Z redoes it (LCM grid)', async ({ page }) => {
  await boot(page, 'pattern')
  await setCode(page, '$: s("bd ~ ~ ~")', 6)
  const before = await code(page)
  await page.locator('[data-seq-cell="0:2"]').click()
  await page.waitForTimeout(350)
  const edited = await code(page)
  expect(edited).not.toBe(before)
  await press(page, `${MOD}+z`)
  expect(await code(page)).toBe(before)
  await press(page, `${MOD}+Shift+z`)
  expect(await code(page)).toBe(edited)
})

test('Song timeline: ⌘Z with the timeline focused undoes a section delete, ⌘⇧Z redoes it', async ({ page }) => {
  await boot(page, 'musical-timeline')
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.press('Backspace')
  await page.keyboard.type('arrange([2, s("bd")], [2, s("hh")])')
  await page.keyboard.press(`${MOD}+Enter`)
  const grid = page.locator('[data-full-song="grid"]')
  await page.locator('[data-full-song-canvas]').first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(1500)
  await page.keyboard.press(`${MOD}+Period`)
  const before = await code(page)
  const box = (await grid.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.12, box.y + 10)
  await page.locator('[data-full-song="clip-selection"]').waitFor({ timeout: 5000 })
  await grid.press('Delete')
  await page.waitForTimeout(400)
  const deleted = await code(page)
  expect(deleted).not.toBe(before)
  await expectFocusIn(page, '[data-full-song="grid"]')
  await press(page, `${MOD}+z`)
  expect(await code(page)).toBe(before)
  await expectFocusIn(page, '[data-full-song="grid"]')
  await press(page, `${MOD}+Shift+z`)
  expect(await code(page)).toBe(deleted)
})

test('control: ⌘Z with the Explorer focused still undoes creating a file', async ({ page }) => {
  await boot(page, 'pattern')
  const name = `undo-control-${Date.now()}.strudel`
  await page.locator('[data-testid^="tab-new-file-"]').first().click()
  await page.locator('input[placeholder="sketch.strudel"]').fill(name)
  await page.getByRole('button', { name: 'Create' }).click()
  const item = page.locator('[data-file-tree-item]', { hasText: name })
  await expect(item).toBeVisible({ timeout: 4000 })
  await item.click()
  // A file row leaves focus on the page, outside every surface that edits code.
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
  await press(page, `${MOD}+z`)
  await expect(item).toHaveCount(0, { timeout: 4000 })
})

test('Settings: Undo says where it works, and a rebind reaches the grids', async ({ page }) => {
  await boot(page, 'pattern')
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByText('Keyboard Shortcuts...').click()
  await expect(page.getByTestId('settings-shell')).toBeVisible({ timeout: 4000 })
  await expect(page.getByTestId('when-stave.edit.undo')).toContainText('timeline')
  const chord = page.getByTestId('chord-stave.edit.undo')
  await chord.click()
  await expect(chord).toContainText('Press keys')
  await page.keyboard.press(`${MOD}+J`)
  await expect(chord).toContainText('J')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('settings-shell')).toHaveCount(0)

  await setCode(page, '$: note("c3 ~ ~ ~")', 6)
  const before = await code(page)
  await page.locator('[data-roll-cell="48:2"]').click()
  await page.waitForTimeout(350)
  expect(await code(page)).not.toBe(before)
  await expectFocusIn(page, ROLL)
  await press(page, `${MOD}+J`)
  expect(await code(page)).toBe(before)
})
