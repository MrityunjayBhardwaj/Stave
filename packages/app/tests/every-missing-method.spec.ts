/**
 * #2186 — every misspelled method gets a squiggle, not just the first one the
 * run hits. The rest are read from the code, judged by the app's own patterns,
 * so a method Stave or a loaded package adds is never marked.
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
      .sort()
  })

test.beforeEach(async ({ page }) => {
  await bootApp(page)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
})

test('both misspelled methods are underlined, each with its own Console row', async ({ page }) => {
  await seedCode(page, '$: s("bd").gin(1)\n$: s("hh").fooo(2)\n')
  await evalCode(page)
  await expect.poll(() => squiggles(page), { timeout: 15_000 }).toEqual(['1:12-15 gin', '2:12-16 fooo'])
  await page.locator('[data-activity-bar] [data-panel-id="console"]').click()
  await expect(page.locator(ROW).filter({ hasText: 'gin' })).toHaveAttribute('data-line', '1')
  await expect(page.locator(ROW).filter({ hasText: 'fooo' })).toHaveAttribute('data-line', '2')
})

test('methods the app adds are not marked', async ({ page }) => {
  await seedCode(page, [
    '$: s("bd").gin(1)',
    '$: note("c e").s("sine").pianoroll()',
    '$: n("0 2").scale("C:major").s("piano")',
    '$: s("hh").bank("RolandTR909").viz("scope")',
    '$: s("sd").roomm(1)',
    '',
  ].join('\n'))
  await evalCode(page)
  // the real second mistake is marked; the methods the app adds are not
  await expect.poll(() => squiggles(page), { timeout: 15_000 }).toEqual(['1:12-15 gin', '5:12-17 roomm'])
})

test('once the first is fixed, the run stops at the second, still underlined', async ({ page }) => {
  await seedCode(page, '$: s("bd").gin(1)\n$: s("hh").fooo(2)\n')
  await evalCode(page)
  await expect.poll(() => squiggles(page), { timeout: 15_000 }).toEqual(['1:12-15 gin', '2:12-16 fooo'])
  await seedCode(page, '$: s("bd").gain(1)\n$: s("hh").fooo(2)\n')
  await evalCode(page)
  await expect.poll(() => squiggles(page), { timeout: 15_000 }).toEqual(['2:12-16 fooo'])
})
