/**
 * #2177 — the error badge above the code and the eval lamp say what the toast and
 * the Console say. They used to show the raw JavaScript message (`initHydra is not
 * defined`) while the toast explained it; the explanation is now kept beside the
 * error when it is worked out, and every surface reads that one sentence.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, evalCode } from './_appBoot'

const BADGE = '[data-testid="strudel-chrome-error"]'
const LAMP = '[data-stave-eval-lamp]'
const TOAST = '[data-testid="toast-action"]'

async function evaluate(page: Page, code: string): Promise<void> {
  await seedCode(page, code)
  await evalCode(page)
}

/** the badge's text, after checking its tooltip and the lamp carry the same sentence */
async function sameEverywhere(page: Page): Promise<string> {
  const badge = page.locator(BADGE)
  await expect(badge).toBeVisible({ timeout: 10_000 })
  const words = (await badge.textContent()) ?? ''
  await expect(badge).toHaveAttribute('title', words)
  const lamp = page.locator(LAMP)
  await expect(lamp).toHaveAttribute('data-stave-eval-lamp', 'error')
  await expect(lamp).toHaveAttribute('title', words)
  // a sentence keeps its own full stop or question mark: no "?." (#2177)
  await expect(lamp).toHaveAttribute('aria-label', `Evaluation failed: ${words} Show the error`)
  expect(words).toMatch(/[.?]$/)
  // the toast says it too (it may add "→ try" or a link after it)
  await expect(page.locator(TOAST).last()).toContainText(words)
  return words
}

test.beforeEach(async ({ page }) => {
  await bootApp(page)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
})

test('a Strudel feature Stave has not got says so in the badge and the lamp', async ({ page }) => {
  await evaluate(page, 'await initHydra()\n$: s("bd")\n')
  const words = await sameEverywhere(page)
  expect(words).toContain("`initHydra` is part of Strudel")
  expect(words).toContain("isn't in Stave yet")
  expect(words).not.toContain('is not defined')
})

test('a typo shows its suggestion in the badge', async ({ page }) => {
  await evaluate(page, '$: nots("c3")\n')
  expect(await sameEverywhere(page)).toBe('`nots` is not defined. Did you mean `note`?')
})

test('a method Stave has not got is named as Strudel names it', async ({ page }) => {
  await evaluate(page, '$: s("bd").mqtt()\n')
  const words = await sameEverywhere(page)
  expect(words).toContain('`.mqtt()` is part of Strudel')
  expect(words).not.toContain('s(...)')
})

test('#2190 — `.edoScale()` says it is not in Stave yet', async ({ page }) => {
  await evaluate(page, '$: n("0 1 2").edoScale("C:8")\n')
  const words = await sameEverywhere(page)
  expect(words).toContain('`.edoScale()` is part of Strudel')
  expect(words).not.toContain('is not a function')
})

test('#2191 — `getDrawContext()` says it is not in Stave, and what to use instead', async ({ page }) => {
  await evaluate(page, 'const ctx = getDrawContext()\n$: s("bd")\n')
  const words = await sameEverywhere(page)
  expect(words).toContain("`getDrawContext` is part of Strudel (it draws on Strudel's own full-screen canvas)")
  expect(words).toContain('a `.p5` file draws anything else.')
})

for (const [method, code, heard] of [
  // Strudel's `.animate()` returns silence: its pattern is drawn, not played
  ['animate', '$: s("ellipse").x(sine).y(cosine).animate()\n', 'As in Strudel, the pattern it draws makes no sound, and here nothing is drawn.'],
  ['onPaint', '$: s("bd sd").onPaint((ctx) => { globalThis.__painted = true })\n', 'The sound still plays, but nothing is drawn.'],
] as const) {
  test(`#2191 — \`.${method}()\` says nothing is drawn, instead of drawing behind the app`, async ({ page }) => {
    await evaluate(page, code)
    const lamp = page.locator(LAMP)
    await expect(lamp).toHaveAttribute('data-stave-eval-lamp', 'ok', { timeout: 10_000 })
    await expect(page.locator(BADGE)).toHaveCount(0)
    await page.locator('[data-activity-bar] [data-panel-id="console"]').click()
    const row = page.locator('[data-testid="console-row"][data-level="warn"]', { hasText: `\`.${method}()\` is part of Strudel` })
    await expect(row).toHaveCount(1, { timeout: 10_000 })
    await expect(row).toContainText(heard)
    // `s("ellipse")` is a shape, not a sound: nothing went looking for a sample by that name
    await expect(page.locator('[data-testid="console-row"]', { hasText: 'ellipse' })).toHaveCount(0)
    const link = row.locator('[data-testid="console-suggestion"]')
    await expect(link).toHaveAttribute('href', 'https://github.com/MrityunjayBhardwaj/stave/issues/2191')
    await expect(link).toContainText('#2191')
    // Strudel's own canvas never appears, and the painter is never handed anything
    expect(await page.evaluate(() => document.getElementById('test-canvas'))).toBeNull()
    expect(await page.evaluate(() => (globalThis as { __painted?: boolean }).__painted ?? false)).toBe(false)
  })
}

test('a message without its own full stop gets one in the lamp label, and only one', async ({ page }) => {
  await evaluate(page, '$: s("bd*2")\n$: s("hh*4"')
  const badge = page.locator(BADGE)
  await expect(badge).toBeVisible({ timeout: 10_000 })
  const words = (await badge.textContent()) ?? ''
  expect(words).not.toMatch(/[.?!]$/)
  await expect(page.locator(LAMP)).toHaveAttribute('aria-label', `Evaluation failed: ${words}. Show the error`)
})

test('fixed and re-evaluated, the badge goes and the lamp is clear', async ({ page }) => {
  await evaluate(page, '$: nots("c3")\n')
  await expect(page.locator(BADGE)).toBeVisible({ timeout: 10_000 })
  await evaluate(page, '$: note("c3")\n')
  await expect(page.locator(BADGE)).toHaveCount(0, { timeout: 10_000 })
  await expect(page.locator(LAMP)).toHaveAttribute('data-stave-eval-lamp', 'ok')
  await expect(page.locator(LAMP)).toHaveAttribute('title', 'No evaluation errors')
})
