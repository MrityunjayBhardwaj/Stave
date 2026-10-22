/**
 * #2188 — an error thrown while a pattern plays (a function passed to a pattern
 * method) is underlined where it was written, and its Console row has the line.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, evalCode } from './_appBoot'

const ROW = '[data-testid="console-row"][data-level="error"]'

/** the error squiggles on the editor's model, as "line:start-end text" */
const squiggles = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const m = (window as any).monaco // eslint-disable-line @typescript-eslint/no-explicit-any
    const model = m.editor.getEditors()[0].getModel()
    return m.editor.getModelMarkers({ resource: model.uri })
      .filter((x: any) => x.severity === m.MarkerSeverity.Error) // eslint-disable-line @typescript-eslint/no-explicit-any
      .map((x: any) => `${x.startLineNumber}:${x.startColumn}-${x.endColumn} ${model.getValueInRange(x)}`) // eslint-disable-line @typescript-eslint/no-explicit-any
  })

test.beforeEach(async ({ page }) => {
  await bootApp(page)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
})

test('a function that throws while the pattern plays is underlined where it throws', async ({ page }) => {
  await seedCode(page, '$: s("hh*2")\n\n$: s("bd sd")\n  .fmap(v => v.nope.x)\n')
  await evalCode(page)
  await expect.poll(() => squiggles(page), { timeout: 15_000 }).toEqual(['4:21-22 x'])
  await page.locator('[data-activity-bar] [data-panel-id="console"]').click()
  await expect(page.locator(ROW).filter({ hasText: "reading 'x'" }).last()).toHaveAttribute('data-line', '4')
})
