/**
 * #2189 — in Safari (WebKit), an error while the code runs is underlined where
 * it was written, as in Chrome and Firefox. WebKit's stack has no position for
 * code made by `new Function`; the position comes from the error itself, one
 * past the token at fault, and the evaluate wrapper is measured in WebKit too.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, evalCode } from './_appBoot'

test.use({ browserName: 'webkit' })

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

for (const [what, code, at] of [
  ['a misspelled method on a later line', '$: note("e3 g3")\n  .s("sine").gin(0.15)\n', '2:14-17 gin'],
  ['a misspelled method on the first line', '$: s("cp").fooo()\n', '1:12-16 fooo'],
  ['an undefined name after blank lines', '// drums\n\n$: s("hh").gain(undefinedThing)\n', '3:17-31 undefinedThing'],
] as const) {
  test(`${what} is underlined at the word`, async ({ page }) => {
    await seedCode(page, code)
    await evalCode(page)
    await expect.poll(() => squiggles(page), { timeout: 15_000 }).toEqual([at])
  })
}
