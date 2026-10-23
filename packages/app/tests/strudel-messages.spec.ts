/**
 * Strudel's own messages, end to end, in Stave's Console.
 *
 * - #2201 — what Strudel's logger says (`.log()` output, warnings about the
 *   code) reaches the Console, named by the file whose code raised it.
 * - #2200 — the `.animate()` warning names its file and line, is underlined,
 *   and the timeline's quiet evaluate (which runs the same engine) posts nothing.
 * - #2202 — a bounce warning names the file it is about.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode, evalCode, stopCode } from './_appBoot'

const ROW = '[data-testid="console-row"]'

const openConsole = (page: Page) => page.locator('[data-activity-bar] [data-panel-id="console"]').click()

/** every marker on the editor's model, as "severity line:start-end text" */
const markers = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const m = (window as any).monaco // eslint-disable-line @typescript-eslint/no-explicit-any
    const model = m.editor.getEditors()[0].getModel()
    return m.editor.getModelMarkers({ resource: model.uri })
      .map((x: any) => `${x.severity === m.MarkerSeverity.Warning ? 'warning' : x.severity} ${x.startLineNumber}:${x.startColumn}-${x.endColumn} ${model.getValueInRange(x)}`) // eslint-disable-line @typescript-eslint/no-explicit-any
  })

/** what Strudel's logger printed (it writes each message to the browser console with `%c`) */
function watchStrudelLogger(page: Page): string[] {
  const seen: string[] = []
  page.on('console', (m) => {
    const t = m.text()
    if (t.startsWith('%c')) seen.push(t.slice(2))
  })
  return seen
}

test.beforeEach(async ({ page }) => {
  await bootApp(page)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
})

test("`.log()` prints each note to the Console, named by its file (#2201)", async ({ page }) => {
  await seedCode(page, '$: s("bd sd").log()\n')
  await evalCode(page)
  await openConsole(page)
  const logged = page.locator(`${ROW}[data-level="info"]`).filter({ hasText: '[hap] 0/1 → 1/2: s:bd' })
  await expect(logged).toHaveCount(1, { timeout: 10_000 })
  await expect(logged).toContainText('pattern.strudel')
  await stopCode(page)
})

test("a Strudel warning about the code reaches the Console, named by its file (#2201)", async ({ page }) => {
  await seedCode(page, '$: note("c e foo").transpose(2).s("sine")\n')
  await evalCode(page)
  await openConsole(page)
  const warned = page.locator(`${ROW}[data-level="warn"]`).filter({ hasText: '[tonal] transpose: not a note "foo"' })
  await expect(warned).toHaveCount(1, { timeout: 10_000 })
  // The evaluate says it first; keep playing until the scheduler's own query
  // says it again (Strudel drops a repeat within a second), and the row's count
  // goes up. Every copy must name the file, so it stays one row.
  await expect(warned).toContainText(/×[2-9]/, { timeout: 10_000 })
  await expect(warned).toHaveCount(1)
  await expect(warned).toContainText('pattern.strudel')
  await stopCode(page)
})

test("what Stave already shows another way is left out (#2201)", async ({ page }) => {
  const logger = watchStrudelLogger(page)
  await seedCode(page, '$: s("bd sd").log()\n')
  await evalCode(page)
  await openConsole(page)
  await expect(page.locator(ROW).filter({ hasText: '[hap]' }).first()).toBeVisible({ timeout: 10_000 })
  await stopCode(page)
  // Strudel did say these…
  await expect.poll(() => logger.some((l) => l.startsWith('[cyclist] stop'))).toBe(true)
  expect(logger.some((l) => l.startsWith('[eval] code updated'))).toBe(true)
  // …and the Console doesn't repeat them
  for (const left of ['[eval]', '[cyclist]', '@strudel/core loaded', '[superdough] ready', 'Deprecation warning']) {
    await expect(page.locator(ROW).filter({ hasText: left }), left).toHaveCount(0)
  }
  // the first half of a sample load ("load sound …..") is left out; its "done" half stays
  expect(logger.some((l) => /^\[sampler\] load sound "bd:0:0"\.\.(?!\.)/.test(l))).toBe(true)
  await expect(page.locator(ROW).filter({ hasText: /load sound "bd:0:0"\.\.(?!\.)/ })).toHaveCount(0)
  await expect(page.locator(ROW).filter({ hasText: 'load sound "bd:0:0"... done!' })).toHaveCount(1)
})

test('the `.animate()` warning names its file and line, and is underlined (#2200)', async ({ page }) => {
  await seedCode(page, '$: s("hh*2")\n$: s("bd sd").x(sine).y(cosine).animate()\n')
  await evalCode(page)
  await openConsole(page)
  const row = page.locator(`${ROW}[data-level="warn"]`).filter({ hasText: '`.animate()` is part of Strudel' })
  await expect(row).toHaveCount(1, { timeout: 10_000 })
  await expect(row).toHaveAttribute('data-line', '2')
  await expect(row).toContainText('pattern.strudel:2')
  await expect.poll(() => markers(page)).toEqual(['warning 2:33-40 animate'])
  await stopCode(page)
})

test("the timeline's quiet evaluate posts nothing, though it runs the same code (#2200)", async ({ page }) => {
  const logger = watchStrudelLogger(page)
  // the Song timeline evaluates the document quietly, without Play, to draw it
  await page.getByText('Timeline', { exact: true }).first().click()
  await seedCode(page, '$: s("hh*2")\n$: s("bd sd").x(sine).y(cosine).animate()\n')
  // it did evaluate…
  await expect.poll(() => logger.some((l) => l.startsWith('[eval] code updated')), { timeout: 10_000 }).toBe(true)
  await page.waitForTimeout(500)
  await openConsole(page)
  // …and nothing it raised reached the Console
  await expect(page.locator(ROW)).toHaveCount(0)
  expect(await markers(page)).toEqual([])
})

test('a bounce warning names the file it is about (#2202)', async ({ page }) => {
  test.setTimeout(120_000)
  await seedCode(page, '$: stack(s("bd*4"), s("nosuchsound*4"))\n')
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'File', exact: true }).click()
  await page.getByText('Bounce to WAV...').click()
  await page.getByRole('button', { name: '8s' }).click()
  const download = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Start Bounce' }).click()
  await download
  await openConsole(page)
  const row = page.locator(`${ROW}[data-level="warn"]`).filter({ hasText: 'Bounce left out 16 of 32 sounds' })
  await expect(row).toHaveCount(1, { timeout: 10_000 })
  await expect(row).toContainText('pattern.strudel')
})
