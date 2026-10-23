/**
 * #2184 / #2185 — an error's squiggle follows the code around it, and so does
 * where the Console row says it is and where clicking it takes you. Fixing the
 * word a squiggle underlines takes the squiggle off without running again.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, evalCode } from './_appBoot'

const ROW = '[data-testid="console-row"][data-level="error"]'
const SQUIGGLE = '.monaco-editor .squiggly-error'

/** the 1-based line of the editor's cursor */
const cursorLine = (page: Page): Promise<number> =>
  page.evaluate(() => (window as any).monaco.editor.getEditors()[0].getPosition().lineNumber) // eslint-disable-line @typescript-eslint/no-explicit-any

/** put the cursor at a line and column, then focus the editor so typing goes there */
const putCursor = (page: Page, lineNumber: number, column: number): Promise<void> =>
  page.evaluate(([lineNumber, column]) => {
    const e = (window as any).monaco.editor.getEditors()[0] // eslint-disable-line @typescript-eslint/no-explicit-any
    e.setPosition({ lineNumber, column })
    e.focus()
  }, [lineNumber, column])

test.beforeEach(async ({ page }) => {
  await bootApp(page)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await seedCode(page, '$: note("c e").s("sine").gin(0.2)\n')
  await evalCode(page)
  await expect(page.locator(SQUIGGLE)).toHaveCount(1, { timeout: 10_000 })
  await page.locator('[data-activity-bar] [data-panel-id="console"]').click()
  await expect(page.locator(ROW).last()).toHaveAttribute('data-line', '1')
})

test('typing above an error moves its Console line, and clicking the row goes there', async ({ page }) => {
  await putCursor(page, 1, 1)
  await page.keyboard.type('// drums\n// bass\n')
  const row = page.locator(ROW).last()
  await expect(row).toHaveAttribute('data-line', '3')
  await expect(row).toHaveAttribute('title', 'Go to line 3')
  await expect(page.locator(SQUIGGLE)).toHaveCount(1)
  await putCursor(page, 1, 1)
  await row.locator('div').nth(1).click()
  await expect.poll(() => cursorLine(page)).toBe(3)
})

test('fixing the underlined word takes the squiggle off', async ({ page }) => {
  await putCursor(page, 1, 28) // between the `g` and the `in` of `gin`
  await page.keyboard.type('a')
  await expect(page.locator(SQUIGGLE)).toHaveCount(0)
})

test('editing elsewhere on the line leaves the squiggle on', async ({ page }) => {
  await putCursor(page, 1, 34) // inside `0.2`
  await page.keyboard.type('5')
  await expect(page.locator(SQUIGGLE)).toHaveCount(1)
})
