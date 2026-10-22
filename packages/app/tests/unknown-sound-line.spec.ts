/**
 * #2187 — a sound that isn't loaded is marked where the code names it. The note
 * that couldn't play says where its sound came from, so `bdd` is underlined and
 * its Console row takes you to its line.
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

test('the unknown sound is underlined where the code names it', async ({ page }) => {
  await seedCode(page, '$: s("hh*2")\n\n$: s("sd bdd")\n')
  await evalCode(page)
  await expect.poll(() => squiggles(page), { timeout: 15_000 }).toEqual(['3:10-13 bdd'])
  await page.locator('[data-activity-bar] [data-panel-id="console"]').click()
  const row = page.locator(ROW).filter({ hasText: 'bdd' }).last()
  await expect(row).toHaveAttribute('data-line', '3')
})

test('once the file is edited, the still-playing error is not placed on the old line', async ({ page }) => {
  await seedCode(page, '$: s("hh*2")\n\n$: s("sd bdd")\n')
  await evalCode(page)
  await expect.poll(() => squiggles(page), { timeout: 15_000 }).toEqual(['3:10-13 bdd'])
  // a line typed at the top, not run: the playing code no longer matches the file
  await page.evaluate(() => {
    const e = (window as any).monaco.editor.getEditors()[0] // eslint-disable-line @typescript-eslint/no-explicit-any
    e.executeEdits('test', [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: '// drums\n' }])
  })
  await page.locator('[data-activity-bar] [data-panel-id="console"]').click()
  // the old code keeps failing on `bdd` every cycle; those repeats carry no line
  const unplaced = page.locator(ROW).filter({ hasText: 'bdd' }).and(page.locator(':not([data-line])'))
  await expect(unplaced).toHaveCount(1, { timeout: 15_000 })
  await expect(page.locator(ROW).filter({ hasText: 'bdd' }).and(page.locator('[data-line="3"]'))).toHaveCount(1)
})
