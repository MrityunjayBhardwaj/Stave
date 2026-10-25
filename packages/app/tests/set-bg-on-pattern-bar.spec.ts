import { test, expect } from '@playwright/test'
import { clearPinnedBackdrop } from './_appBoot'

// #347 — "set bg" DROPDOWN on the pattern (Strudel) chrome bar, next to the
// live toggle. Mirrors the menubar bg-indicator: clicking opens the SAME
// BackdropPopover (viz-file picker → opacity/quality/crop/reveal/clear when
// pinned), anchored to the button and scoped to this pane. A `.strudel` file
// can't be a backdrop itself, so the picker lists viz files; selecting one pins
// it as this pane's sticky (no audio/eval needed — the picker sets it directly).

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.locator('.monaco-editor').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1000)
  // these arms start from a project with no backdrop; the Starter pins one (#2240)
  await clearPinnedBackdrop(page)
})

test('set-bg dropdown lives on the pattern chrome bar, next to the live toggle', async ({ page }) => {
  const bar = page.locator('[data-strudel-runtime-chrome="root"]')
  await expect(bar).toHaveCount(1)
  const btn = bar.locator('[data-testid="strudel-chrome-bg-toggle"]')
  await expect(btn).toHaveCount(1)
  await expect(bar.locator('[data-testid="strudel-chrome-live-toggle"]')).toHaveCount(1)
  // Fresh load: nothing pinned yet.
  await expect(btn).toHaveAttribute('data-pinned', 'false')
  await expect(btn).toContainText('set bg')
})

test('clicking opens the BackdropPopover; picking a viz pins it, clearing removes it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  const btn = page.locator('[data-testid="strudel-chrome-bg-toggle"]')

  // Click → the same popover the menubar uses opens.
  await btn.click()
  const popover = page.locator('[data-testid="backdrop-popover"]')
  await expect(popover).toBeVisible()
  await expect(popover).toHaveAttribute('data-pinned', 'false')

  // Pick the first real viz file from the picker → pins it as this pane's bg.
  const picker = popover.locator('[data-testid="backdrop-popover-picker"]')
  const value = await picker.locator('option').nth(1).getAttribute('value')
  expect(value).toBeTruthy()
  await picker.selectOption(value!)

  // Now pinned: a backdrop is mounted, the button reflects it, and the popover
  // switches to its pinned controls (clear button present).
  await expect(page.locator('[data-workspace-background]')).toHaveCount(1)
  await expect(btn).toHaveAttribute('data-pinned', 'true')
  await expect(popover).toHaveAttribute('data-pinned', 'true')
  const clearBtn = popover.locator('[data-testid="backdrop-chrome-clear"]')
  await expect(clearBtn).toBeVisible()

  // Clear → backdrop removed, popover closes, button back to unpinned.
  await clearBtn.click()
  await expect(page.locator('[data-workspace-background]')).toHaveCount(0)
  await expect(btn).toHaveAttribute('data-pinned', 'false')

  expect(errors).toEqual([])
})

test('picking a viz ALSO writes the global backdrop to code — all(x=>x.viz(…,{backdrop:true})) (#792)', async ({ page }) => {
  const strudelValue = () =>
    page.evaluate(() => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; getValue: () => string } | null }> } } }).monaco
      const eds = m?.editor?.getEditors?.() ?? []
      const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
      return t?.getModel()?.getValue() ?? ''
    })

  // seed a known one-line doc so the appended master backdrop line is exact
  await page.evaluate(() => {
    const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null; focus: () => void }> } } }).monaco
    const eds = m?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.getModel()?.setValue('$: s("bd*4")')
    t?.focus()
  })
  await page.waitForTimeout(150)

  const btn = page.locator('[data-testid="strudel-chrome-bg-toggle"]')
  await btn.click()
  const picker = page.locator('[data-testid="backdrop-popover-picker"]')
  const value = await picker.locator('option').nth(1).getAttribute('value')
  await picker.selectOption(value!)
  await expect(page.locator('[data-workspace-background]')).toHaveCount(1)

  // the choice round-trips to code: a master backdrop viz line is appended,
  // the track line is byte-identical
  const after = await strudelValue()
  expect(after.split('\n')[0]).toBe('$: s("bd*4")')
  expect(after).toMatch(/all\(x => x\.viz\("[^"]+", \{ backdrop: true \}\)\)/)

  // clearing removes the code line too
  await page.locator('[data-testid="backdrop-chrome-clear"]').click()
  const cleared = await strudelValue()
  expect(cleared).not.toMatch(/all\(x => x\.viz/)
})

test('manually DELETING the all() backdrop line flips the indicator to [set bg] (code→UI, #795)', async ({ page }) => {
  const editValue = (fn: (src: string) => string) =>
    page.evaluate((body) => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; getValue: () => string; setValue: (s: string) => void } | null }> } } }).monaco
      const eds = m?.editor?.getEditors?.() ?? []
      const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
      const model = t?.getModel()
      if (!model) return
      // eslint-disable-next-line no-new-func
      model.setValue((new Function('src', `return (${body})(src)`))(model.getValue()))
    }, fn.toString())

  const btn = page.locator('[data-testid="strudel-chrome-bg-toggle"]')

  // pick a viz → writes the all(x=>x.viz(…)) line AND pins the indicator
  await btn.click()
  const picker = page.locator('[data-testid="backdrop-popover-picker"]')
  const value = await picker.locator('option').nth(1).getAttribute('value')
  await picker.selectOption(value!)
  await expect(btn).toHaveAttribute('data-pinned', 'true')
  await page.keyboard.press('Escape')

  // hand-delete the backdrop line from the code
  await editValue((src: string) => src.split('\n').filter((l) => !/all\(x => x\.viz\(/.test(l)).join('\n'))

  // the indicator REACTS to the code edit — back to [set bg], backdrop cleared
  await expect(btn).toHaveAttribute('data-pinned', 'false')
  await expect(btn).toContainText('set bg')
  await expect(page.locator('[data-workspace-background]')).toHaveCount(0)
})

test('backdrop is PER-TAB — switching tabs swaps/clears it, switching back restores', async ({ page }) => {
  const btn = page.locator('[data-testid="strudel-chrome-bg-toggle"]')

  // Pin a backdrop on the pattern tab.
  await btn.click()
  const picker = page.locator('[data-testid="backdrop-popover-picker"]')
  const value = await picker.locator('option').nth(1).getAttribute('value')
  await picker.selectOption(value!)
  await expect(page.locator('[data-workspace-background]')).toHaveCount(1)
  await expect(btn).toHaveAttribute('data-pinned', 'true')
  // Close the popover.
  await page.keyboard.press('Escape')

  // Open a second tab (a viz file) — it has no backdrop of its own, so the
  // pane's backdrop must CLEAR (it does not bleed from the pattern tab).
  await page.locator('[data-file-tree-item*="hydra"]').first().dblclick()
  await expect(page.locator('[data-workspace-background]')).toHaveCount(0)

  // Switch back to the pattern tab → its own backdrop is restored.
  await page.locator('[data-workspace-tab]', { hasText: 'pattern' }).first().click()
  await expect(page.locator('[data-workspace-background]')).toHaveCount(1)
  await expect(btn).toHaveAttribute('data-pinned', 'true')
})

test('no blue focus outline frames the editor when a backdrop is active (#723)', async ({ page }) => {
  const btn = page.locator('[data-testid="strudel-chrome-bg-toggle"]')

  // Focus the editor first — the outline only computes while `.monaco-editor`
  // is focused. Without a backdrop it's the usual 1px focus border.
  await page.locator('.monaco-editor .view-lines').click()
  const editorOutline = () =>
    page.evaluate(() => {
      const ed = document.querySelector('[data-stave-code-panel] .monaco-editor')
      return getComputedStyle(ed as Element).outlineStyle
    })
  expect(await editorOutline()).not.toBe('none') // focus border present normally

  // Pin a backdrop (real flow).
  await btn.click()
  const picker = page.locator('[data-testid="backdrop-popover-picker"]')
  await picker.selectOption((await picker.locator('option').nth(1).getAttribute('value'))!)
  await expect(page.locator('[data-workspace-background]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await page.locator('.monaco-editor .view-lines').click()

  // Over the (now transparent) editor surface the focus outline would read as a
  // blue frame — it must be suppressed in backdrop mode.
  expect(await editorOutline()).toBe('none')
})

test('the set-bg popover left-aligns to the button, opening down-and-right (#724)', async ({ page }) => {
  const btn = page.locator('[data-testid="strudel-chrome-bg-toggle"]')
  await btn.click()
  await page.locator('[data-testid="backdrop-popover"]').waitFor()

  const { buttonLeft, popoverLeft, popoverRight, buttonRight } = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="strudel-chrome-bg-toggle"]')!.getBoundingClientRect()
    const p = document.querySelector('[data-testid="backdrop-popover"]')!.getBoundingClientRect()
    return { buttonLeft: b.left, buttonRight: b.right, popoverLeft: p.left, popoverRight: p.right }
  })
  // Left edges aligned (allow a sub-pixel rounding slack), and the popover
  // extends to the RIGHT of the button's left edge (down-and-right), not left.
  expect(Math.abs(popoverLeft - buttonLeft)).toBeLessThanOrEqual(1)
  expect(popoverRight).toBeGreaterThan(buttonRight)
})
