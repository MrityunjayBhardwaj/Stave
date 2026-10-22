/**
 * W1 quick-bug batch — observed in a real browser.
 *   #597 pianoroll rows must reflect the ACTIVE track, not accumulate across switches
 *   #598 the caret + IntelliSense popup stay opaque/visible over a background viz
 *   #599 the play-bar BPM reflects the real tempo (setcps), not ¼ of it
 */
import { test, expect, type Page } from '@playwright/test'

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 15_000 })
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 15_000 },
  )
}

async function setStrudelCode(page: Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null; focus: () => void; setPosition: (p: { lineNumber: number; column: number }) => void }> } } }).monaco
    const eds = m?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.getModel()?.setValue(c)
    t?.setPosition({ lineNumber: 1, column: 1 })
    t?.focus()
  }, code)
  await page.waitForTimeout(150)
}

async function setCursorLine(page: Page, line: number): Promise<void> {
  await page.evaluate((ln) => {
    const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string } | null; setPosition: (p: { lineNumber: number; column: number }) => void; focus: () => void }> } } }).monaco
    const eds = m?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.setPosition({ lineNumber: ln, column: 1 })
    t?.focus()
  }, line)
  await page.waitForTimeout(150)
}

async function openPattern(page: Page) {
  const root = page.locator('[data-bottom-panel="root"]')
  await root.locator('[data-bottom-panel="toggle"]').click()
  await root.locator('role=tab[name="Pattern"]').click()
  return root
}

test.describe('#597 — pianoroll rows reflect the active track', () => {
  test('switching to a narrower track shrinks the rows; switching back restores them', async ({ page }) => {
    await boot(page)
    // d1 spans 4 octaves (wide); d2 is two adjacent notes (narrow).
    await setStrudelCode(page, 'd1: note("c2 c6")\nd2: note("c4 d4")')
    await openPattern(page)

    const rows = page.locator('[data-bottom-panel-tab="piano-roll"] [data-roll-key]')

    await setCursorLine(page, 1) // d1 — wide
    const wide = await rows.count()
    expect(wide).toBeGreaterThan(30)

    await setCursorLine(page, 2) // d2 — narrow; must NOT keep d1's row count
    const narrow = await rows.count()
    expect(narrow).toBeLessThan(wide)
    expect(narrow).toBeLessThan(20) // reflects d2's own content, not the max seen

    await setCursorLine(page, 1) // back to d1 — restores its extent (not stuck narrow)
    expect(await rows.count()).toBe(wide)
  })
})

test.describe('#598 — caret + IntelliSense stay readable over a background viz', () => {
  test('the caret keeps an opaque fill and the suggest popup stays opaque', async ({ page }) => {
    await boot(page)
    await setStrudelCode(page, 'note("c3 e3 g3")')
    // Force the backdrop CSS state (the bug is the rule keyed on this attribute).
    await page.evaluate(() => {
      document.querySelector('[data-stave-code-panel]')?.setAttribute('data-stave-backdrop', 'on')
    })
    await page.waitForTimeout(80)

    // (a) caret — its bar IS its background-color; must not be blanked transparent.
    const caretAlpha = await page
      .locator('.monaco-editor .cursor')
      .first()
      .evaluate((el) => {
        const c = getComputedStyle(el).backgroundColor
        const m = c.match(/rgba?\(([^)]+)\)/)
        if (!m) return c === 'transparent' ? 0 : 1
        const p = m[1].split(',').map((s) => parseFloat(s))
        return p.length >= 4 ? p[3] : 1
      })
    expect(caretAlpha).toBeGreaterThan(0)

    // (b) the IntelliSense popup must keep an opaque themed surface over the viz.
    await page.evaluate(() => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string } | null; focus: () => void; setPosition: (p: { lineNumber: number; column: number }) => void; trigger: (s: string, id: string, p: unknown) => void }> } } }).monaco
      const eds = m?.editor?.getEditors?.() ?? []
      const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
      t?.focus()
      t?.setPosition({ lineNumber: 1, column: 5 }) // inside "note"
      t?.trigger('test', 'editor.action.triggerSuggest', {})
    })
    const widget = page.locator('.monaco-editor .suggest-widget.visible').first()
    await widget.waitFor({ state: 'visible', timeout: 5000 })
    const widgetAlpha = await widget.evaluate((el) => {
      const c = getComputedStyle(el).backgroundColor
      const m = c.match(/rgba?\(([^)]+)\)/)
      if (!m) return c === 'transparent' ? 0 : 1
      const p = m[1].split(',').map((s) => parseFloat(s))
      return p.length >= 4 ? p[3] : 1
    })
    expect(widgetAlpha).toBe(1) // fully opaque — readable over the backdrop
  })
})

test.describe('#599 — play-bar BPM reflects the real tempo', () => {
  test('the play-bar BPM is the real tempo (cps × 240), not ¼ of it', async ({ page }) => {
    await boot(page)
    // Read the active doc's setcps and compute the CORRECT bpm = cps × 60 × 4.
    // Asserting against the live doc avoids a type→persist→eval race (play()
    // reads the file-store eval source, which lags a model edit) while still
    // proving the ×4 fix end-to-end: the buggy code would show this ÷ 4 (#599).
    const expected = await page.evaluate(() => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; getValue: () => string } | null }> } } }).monaco
      const eds = m?.editor?.getEditors?.() ?? []
      const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
      const code = t?.getModel()?.getValue() ?? ''
      const frac = code.match(/setcps\s*\(\s*([\d.]+)\s*\/\s*([\d.]+)\s*\)/)
      if (frac) return Math.round((parseFloat(frac[1]) / parseFloat(frac[2])) * 240)
      const scal = code.match(/setcps\s*\(\s*([\d.]+)\s*\)/)
      if (scal) return Math.round(parseFloat(scal[1]) * 240)
      return null
    })
    expect(expected, 'starter doc must carry a setcps to test the BPM readout').not.toBeNull()
    await page.locator('[data-testid="strudel-chrome-transport"]').click() // play → evaluates
    const bpm = page.locator('[data-testid="strudel-chrome-bpm"]')
    await expect(bpm).toBeVisible({ timeout: 5000 })
    await expect(bpm).toContainText(String(expected), { timeout: 8000 }) // correct tempo
    // The ×4 bug would render expected/4 (e.g. 130 → 33); prove that's gone.
    await expect(bpm).not.toContainText(`${Math.round((expected as number) / 4)} BPM`)
  })
})

/** TYPE the document and evaluate — the play bar reads the file store, which a
 *  programmatic setValue does not update (the note the #599 test above carries). */
async function typeAndEval(page: Page, code: string): Promise<void> {
  const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${MOD}+A`)
  await page.keyboard.press('Backspace')
  await page.keyboard.type(code, { delay: 8 })
  await page.waitForTimeout(400)
  await page.keyboard.press(`${MOD}+Enter`)
}

test.describe('#1925 — the play-bar BPM is the tempo the code sets', () => {
  test('setcpm counts, and a commented-out setter does not', async ({ page }) => {
    await boot(page)
    const bpm = page.locator('[data-testid="strudel-chrome-bpm"]')
    const lcd = page.locator('[data-stave-lcd-tempo]')
    // setcpm(45) is 0.75 cps — the scheduler's own reading is the reference, and
    // 0.75 is not Strudel's default 0.5, so the LCD cannot pass by doing nothing.
    await typeAndEval(page, 'setcpm(45)\n$: s("bd*2")')
    await expect(lcd).toHaveText('0.75', { timeout: 8000 })
    await expect(bpm).toHaveText('180 BPM', { timeout: 8000 })
    // The comment says 0.25; the statement that runs says 0.6. A text match
    // read the comment (measured: it showed 60 for a 0.5 document).
    await typeAndEval(page, '// setcps(0.25)\nsetcps(0.6)\n$: s("bd*2")')
    await expect(lcd).toHaveText('0.60', { timeout: 8000 })
    await expect(bpm).toHaveText('144 BPM', { timeout: 8000 })
  })
})
