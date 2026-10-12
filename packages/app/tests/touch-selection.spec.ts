/**
 * On a touch device only the code and text fields can be selected (#1993, pinned by #2014).
 *
 * A long press or a drag on the interface — a tab, a button, a status readout — would
 * otherwise start a text selection over a control the finger meant to press. The rule is
 * in `globals.css` under `(pointer: coarse)`: the interface is not selectable; the editor
 * and anything you type into keep the answer they had.
 *
 * This reads the answer the browser computed for real elements of the running app. What
 * it cannot say is what a real long press then does — an emulator has none.
 */
import { test, expect, type Locator } from '@playwright/test'
import { bootApp } from './_appBoot'

const userSelect = (el: Locator): Promise<string> => el.evaluate((n) => getComputedStyle(n).userSelect)

test.describe('what a finger can select (#1993)', () => {
  test('the interface cannot be selected; the code and a text field can', async ({ page }) => {
    await bootApp(page)
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)

    // the interface: a transport button, a bottom-panel tab, the page's own body text
    const play = page.locator('button:has-text("Play")').first()
    const tab = page.locator('[data-bottom-panel="root"]').locator('role=tab').first()
    await expect(play).toBeVisible()
    await expect(tab).toHaveCount(1)
    expect(await userSelect(play)).toBe('none')
    expect(await userSelect(tab)).toBe('none')
    expect(await userSelect(page.locator('[data-bottom-panel="root"]'))).toBe('none')

    // the code: the editor's outer element, and the field inside it that the typing goes to.
    // (Not the drawn lines: the editor marks those unselectable on a desktop too, and
    // paints its own selection — observed 2026-10-12 — so they say nothing about this rule.)
    const editor = page.locator('.monaco-editor').first()
    expect(await userSelect(editor)).toBe('text')
    const typing = editor.locator('textarea').first()
    await expect(typing).toHaveCount(1)
    expect(await userSelect(typing)).toBe('text')

    // a text field: one placed in the interface, where "not selectable" would be handed
    // down to it from its parent if the rule did not give it back
    const field = await page.evaluateHandle(() => {
      const host = document.querySelector('[data-bottom-panel="root"]') as HTMLElement
      const input = document.createElement('input')
      input.value = 'a name'
      host.appendChild(input)
      const area = document.createElement('textarea')
      host.appendChild(area)
      return { input: getComputedStyle(input).userSelect, area: getComputedStyle(area).userSelect }
    })
    expect(await field.jsonValue()).toEqual({ input: 'text', area: 'text' })
  })
})
