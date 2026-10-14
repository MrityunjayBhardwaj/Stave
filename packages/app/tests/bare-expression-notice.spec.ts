import { expect, test, type Page } from '@playwright/test'

import { bootApp, evalCode, seedCode, stopCode } from './_appBoot'

/**
 * A song that plays a bare expression is told, once, that a `$:` track is how
 * Stave shows it best (#2067). Play is the real shortcut; the notice is read off
 * the toast on screen.
 *
 * ONE assertion per test: a second `expect` never runs once the first fails.
 */

const notice = (page: Page) => page.locator('[data-testid="toast"]').filter({ hasText: 'is a bare expression' })

async function play(page: Page, code: string): Promise<void> {
  await seedCode(page, code)
  await evalCode(page)
}

test.describe('the bare-expression notice', () => {
  test('a song that plays a bare expression is told, with its line', async ({ page }) => {
    await bootApp(page)
    await play(page, '// my song\ns("bd*4")\n')
    await expect(notice(page)).toContainText('Line 2 is a bare expression', { timeout: 10_000 })
    await stopCode(page)
  })

  test('a song of $: tracks is not told', async ({ page }) => {
    await bootApp(page)
    await play(page, '// my song\n$: s("bd*4")\n')
    await page.waitForTimeout(3_000)
    await stopCode(page)
    expect(await notice(page).count()).toBe(0)
  })

  test('once per song: played again after a reload, it is not told again', async ({ page }) => {
    await bootApp(page)
    await play(page, 's("bd*4")\n')
    await notice(page).waitFor({ timeout: 10_000 })
    await stopCode(page)
    await bootApp(page)
    await play(page, 's("bd*4")\n')
    await page.waitForTimeout(3_000)
    await stopCode(page)
    expect(await notice(page).count()).toBe(0)
  })

  test('clicking the notice puts the cursor on the line', async ({ page }) => {
    await bootApp(page)
    await play(page, '// my song\n\n\ns("bd*4")\n')
    await notice(page).locator('[data-testid="toast-action"]').click({ timeout: 10_000 })
    // read before Stop: the Stop shortcut moves the cursor itself
    const line = await page.evaluate(
      () =>
        (window as unknown as { monaco: { editor: { getEditors: () => Array<{ getPosition: () => { lineNumber: number } }> } } })
          .monaco.editor.getEditors()[0]
          .getPosition().lineNumber,
    )
    await stopCode(page)
    // seedCode leaves the cursor on the last line, 5
    expect(line).toBe(4)
  })
})
