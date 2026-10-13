// Transport LCD in the menubar (#857): shown by default, reflects transport
// state, advances position while playing, flips display mode on click, and
// hides behind the Editor Settings toggle (brand returns).
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
  // the mount, not just the text: a seed written before it is not heard (#2036)
  await page.waitForFunction(() => {
    const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId: () => string } | null }> } } }).monaco
    const language = m?.editor?.getEditors?.()?.[0]?.getModel()?.getLanguageId()
    return language !== undefined && language !== 'plaintext'
  }, undefined, { timeout: 30_000 })
}

const LCD = '[data-stave-transport-lcd]'

test('shows by default and reflects transport + mode + settings toggle', async ({ page }) => {
  await boot(page)

  // Default ON: the LCD is present, the brand label is not.
  const lcd = page.locator(LCD)
  await expect(lcd).toBeVisible()
  await expect(page.locator('[data-stave-brand]')).toHaveCount(0)

  // Stopped state before play.
  await expect(lcd).toContainText('STOP')

  // Play → the LCD reads PLAY and the position advances over time.
  await page.locator('[data-testid="strudel-chrome-transport"]').click()
  await expect(lcd).toContainText('PLAY', { timeout: 8000 })
  const pos = page.locator('[data-stave-lcd-pos]')
  const first = await pos.textContent()
  await page.waitForTimeout(700)
  const second = await pos.textContent()
  expect(second, 'position should advance while playing').not.toBe(first)

  // Click the screen flips the display mode (CYC → BAR), which drives both the
  // LCD label and the shared ruler-units preference.
  await expect(lcd).toContainText('CYC')
  await lcd.click()
  await expect(lcd).toContainText('BAR')
  await lcd.click()
  await expect(lcd).toContainText('CYC')

  // Editor Settings toggle hides the LCD and brings the brand back.
  await page.locator('[data-testid="strudel-chrome-transport"]').click() // stop
  await page.getByText('File', { exact: true }).click()
  await page.getByText('Editor Settings...', { exact: true }).click()
  const lcdSwitch = page.locator('[data-testid="setting-menubarLcd"]')
  await expect(lcdSwitch).toBeVisible({ timeout: 5000 })
  await lcdSwitch.click()
  // Close the settings surface (Escape) and verify the swap.
  await page.keyboard.press('Escape')
  await expect(page.locator(LCD)).toHaveCount(0)
  await expect(page.locator('[data-stave-brand]')).toBeVisible()
})

// A document that sets no tempo still HAS one — Strudel's scheduler default.
// The readout must report the tempo the engine is running at, not one recovered
// by matching `setcps(...)` in the source text.
test('tempo readout reflects a document that spells no setcps', async ({ page }) => {
  const NO_SETCPS = 's("bd sd")'
  await boot(page)
  await page.evaluate((code) => {
    const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null; focus: () => void }> } } }).monaco
    const eds = m?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.getModel()?.setValue(code)
    t?.focus()
  }, NO_SETCPS)

  // #1692 — RELOAD, and only go on once the app comes back holding this
  // document. Two things that a fixed wait cannot give, in one step:
  //
  //  - the reloaded text IS the evidence that the app's file store took the
  //    edit. `play()` evaluates the store, not the editor's buffer, and that
  //    write lands ~400ms after `setValue` here — twice the 200ms this test
  //    used to wait, and longer still on a loaded machine.
  //  - tempo is a property of the SESSION, not of the document: `setCps`
  //    writes the scheduler's `cps` and nothing resets it per evaluation
  //    (`@strudel/core` cyclist.mjs:24,129). So a page that has evaluated the
  //    starter document — which spells `setcps(130/240)` — reports 0.54 for
  //    any document afterwards, including this one. Reloading starts a
  //    scheduler that has run no `setcps` at all, which is the only state in
  //    which "the default tempo" is a claim about this document.
  await expect
    .poll(async () => {
      await boot(page)
      return await page.evaluate(() => {
        const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; getValue: () => string } | null }> } } }).monaco
        const eds = m?.editor?.getEditors?.() ?? []
        return (eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0])?.getModel()?.getValue() ?? null
      })
    }, { timeout: 30_000, message: 'the app should reopen holding the test document' })
    .toBe(NO_SETCPS)

  await page.locator('[data-testid="strudel-chrome-transport"]').click()
  await expect(page.locator(LCD)).toContainText('PLAY', { timeout: 8000 })

  const tempo = page.locator('[data-stave-lcd-tempo]')
  await expect(tempo).toHaveText('0.50', { timeout: 8000 })

  // The same tempo read in the other vocabulary: 0.5 cps × 60 × 4 beats = 120
  // BPM, and a bar.beat.tick position — both through the app's one meter.
  await page.locator(LCD).click()
  await expect(page.locator(LCD)).toContainText('BAR')
  await expect(tempo).toHaveText('120', { timeout: 8000 })
  await expect(page.locator('[data-stave-lcd-pos]')).toHaveText(/^\d{3}\.[1-4]\.[1-4]$/)
})

// #1348 — the eval lamp says whether the last evaluation worked, which the
// transport dot (is the scheduler running?) cannot. A broken document turns it
// red and names the error; pressing it opens the Console and jumps to the line,
// as the error's toast does; a fixed document turns it back.
test('the eval lamp shows a failed evaluation and jumps to it (#1348)', async ({ page }) => {
  await boot(page)
  const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
  const lamp = page.locator('[data-stave-eval-lamp]')
  await expect(lamp).toHaveAttribute('data-stave-eval-lamp', 'ok')
  await expect(lamp).toHaveText('EVAL')

  const setCode = (code: string) =>
    page.evaluate((c) => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null; focus: () => void }> } } }).monaco
      const eds = m?.editor?.getEditors?.() ?? []
      const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
      t?.getModel()?.setValue(c)
      t?.focus()
    }, code)
  const caretLine = () =>
    page.evaluate(() => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string } | null; getPosition: () => { lineNumber: number } | null }> } } }).monaco
      const eds = m?.editor?.getEditors?.() ?? []
      const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
      return t?.getPosition()?.lineNumber ?? null
    })

  // A syntax error on line 2.
  await setCode('$: s("bd*2")\n$: s("hh*4"')
  await page.waitForTimeout(200)
  await page.keyboard.press(`${MOD}+Enter`)
  await expect(lamp).toHaveAttribute('data-stave-eval-lamp', 'error', { timeout: 10_000 })
  await expect(lamp).toContainText('ERR')
  const title = (await lamp.getAttribute('title')) ?? ''
  console.log(`[#1348] lamp title: ${title}`)
  expect(title.length).toBeGreaterThan(0)
  await expect(lamp).toHaveAttribute('aria-label', /^Evaluation failed: /)

  // Put the caret elsewhere, then press the lamp: Console open, caret on line 2.
  await page.keyboard.press(`${MOD}+Home`)
  expect(await caretLine()).toBe(1)
  await lamp.click()
  await expect(page.locator('[data-testid="console-panel"]')).toBeVisible({ timeout: 10_000 })
  await expect.poll(caretLine, { timeout: 5000 }).toBe(2)

  // Fixed and re-evaluated: the lamp says nothing is wrong again.
  await setCode('$: s("bd*2")\n$: s("hh*4")')
  await page.waitForTimeout(200)
  await page.keyboard.press(`${MOD}+Enter`)
  await expect(lamp).toHaveAttribute('data-stave-eval-lamp', 'ok', { timeout: 10_000 })
  await expect(lamp).toHaveText('EVAL')
})

// The error toast and the eval lamp share one "show this error" action
// (`revealLogEntry` in StaveApp, #1348). Pressing the toast still jumps to the
// line — this pins the toast side of that shared action.
test('pressing an error toast jumps to the error line (#1348)', async ({ page }) => {
  await boot(page)
  const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.evaluate(() => {
    const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null; focus: () => void; setPosition: (p: { lineNumber: number; column: number }) => void }> } } }).monaco
    const eds = m?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.getModel()?.setValue('$: s("bd*2")\n$: s("hh*4"')
    t?.focus()
    t?.setPosition({ lineNumber: 1, column: 1 })
  })
  await page.waitForTimeout(200)
  await page.keyboard.press(`${MOD}+Enter`)
  const toast = page.locator('[data-testid="toast"][data-level="error"] [data-testid="toast-action"]').first()
  await expect(toast).toBeVisible({ timeout: 10_000 })
  await toast.click()
  await expect(page.locator('[data-testid="console-panel"]')).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string } | null; getPosition: () => { lineNumber: number } | null }> } } }).monaco
          const eds = m?.editor?.getEditors?.() ?? []
          const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
          return t?.getPosition()?.lineNumber ?? null
        }),
      { timeout: 5000 },
    )
    .toBe(2)
})

// #1348 — the audio cell reports notes that were dropped because the page was
// too busy to hand them over in time. A deliberate main-thread stall while
// playing must show up as LATE, and clear again a few seconds later. The cell
// never shows a load percentage: the browser gives no such number for Web Audio.
test('the audio cell reports notes dropped while the page was busy (#1348)', async ({ page }) => {
  test.setTimeout(60_000)
  await page.addInitScript(() => {
    try { localStorage.setItem('stave:bottomPanel.open', 'false') } catch { /* ignore */ }
  })
  await boot(page)
  const cell = page.locator('[data-stave-audio-health]')
  await expect(cell).toHaveAttribute('data-stave-audio-health', 'ok')
  await expect(cell).toHaveText('OK')

  await page.evaluate(() => {
    const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId?: () => string; setValue: (s: string) => void } | null; focus: () => void }> } } }).monaco
    const eds = m?.editor?.getEditors?.() ?? []
    const t = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    t?.getModel()?.setValue('s("hh*16").gain(0.2)')
    t?.focus()
  })
  await page.waitForTimeout(200)
  await page.locator('[data-testid="strudel-chrome-transport"]').click()
  await expect(page.locator(LCD)).toContainText('PLAY', { timeout: 8000 })
  await page.waitForTimeout(1500)
  // Playing steadily: nothing dropped yet.
  await expect(cell).toHaveAttribute('data-stave-audio-health', 'ok')

  // Stall the main thread well past the scheduler's lookahead.
  await page.evaluate(() => {
    const t0 = performance.now()
    while (performance.now() - t0 < 1500) { /* busy */ }
  })
  await expect(cell).toHaveAttribute('data-stave-audio-health', /late|glitch/, { timeout: 3000 })
  const text = (await cell.textContent()) ?? ''
  console.log(`[#1348 audio] after stall: ${text} — ${await cell.getAttribute('title')}`)
  expect(text).toMatch(/^(LATE|GLITCH) [1-9]\d*$/)

  // And it clears once the window has passed with nothing new.
  await expect(cell).toHaveAttribute('data-stave-audio-health', 'ok', { timeout: 10_000 })
})
