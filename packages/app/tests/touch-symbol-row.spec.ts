/**
 * A row of mini-notation symbols above the phone keyboard (#2005).
 *
 * Most of what a pattern is made of — ~ * " [ ] < > ( ) — sits two or three taps deep
 * on a phone keyboard. So while the keyboard is up on a phone held upright, with the
 * cursor in a code file, one row of keys sits directly above it. A tap types that
 * character at the cursor exactly as the keyboard would, the editor's own bracket and
 * quote pairing included, as one undo step, and the cursor stays in the code.
 *
 * "Exactly as the keyboard would" is checked against the keyboard itself: each key is
 * tapped in one page and the same character is typed in another, and the two documents
 * and cursors must agree.
 *
 * ⚠ The keyboard here is the stand-in `touch-keyboard.spec.ts` describes: the visual
 * viewport is told it is shorter. Whether a real keyboard stays open across a tap on
 * the row is a real-device check — it is the issue's own.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode } from './_appBoot'

const UPRIGHT = ['phone', 'iphone']
const KEYS = ['~', '*', '"', '[', ']', '<', '>', '(', ')']
const KEYBOARD = 300
const CODE = '$: s("bd sd")\n'
/** between `bd` and ` sd`, inside the string */
const CURSOR = { lineNumber: 1, column: 10 }

async function keyboard(page: Page, px: number): Promise<void> {
  await page.evaluate((k) => {
    const vv = window.visualViewport!
    if (k > 0) {
      const shown = window.innerHeight - k
      Object.defineProperty(vv, 'height', { configurable: true, get: () => shown })
    } else {
      delete (vv as unknown as { height?: number }).height
    }
    vv.dispatchEvent(new Event('resize'))
  }, px)
}

interface Ed {
  getModel: () => { getLanguageId: () => string; getValue: () => string } | null
  getPosition: () => { lineNumber: number; column: number }
  setPosition: (p: { lineNumber: number; column: number }) => void
  focus: () => void
  hasTextFocus: () => boolean
  trigger: (source: string, id: string, payload: unknown) => void
}
const ED = `(window.monaco.editor.getEditors().find((e) => e.getModel()?.getLanguageId() === 'strudel'))`

/** the code file's text, cursor and whether the cursor is still in it */
function state(page: Page): Promise<{ value: string; at: string; focus: boolean }> {
  return page.evaluate((expr) => {
    // eslint-disable-next-line no-eval
    const ed = (0, eval)(expr) as Ed
    const p = ed.getPosition()
    return { value: ed.getModel()!.getValue(), at: `${p.lineNumber}:${p.column}`, focus: ed.hasTextFocus() }
  }, ED)
}

async function cursorInCode(page: Page): Promise<void> {
  await page.evaluate(
    ([expr, at]) => {
      // eslint-disable-next-line no-eval
      const ed = (0, eval)(expr as string) as Ed
      ed.focus()
      ed.setPosition(at as { lineNumber: number; column: number })
    },
    [ED, CURSOR] as const,
  )
}

const row = (page: Page) => page.locator('[data-symbol-row]')
const key = (page: Page, k: string) => page.locator(`[data-symbol-row] [data-symbol-key="${k === '"' ? '\\"' : k}"]`)

async function ready(page: Page): Promise<void> {
  await bootApp(page)
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
  await seedCode(page, CODE)
  await cursorInCode(page)
}

test.describe('a row of pattern symbols above the phone keyboard (#2005)', () => {
  test('the row is there only with the keyboard, directly above it, with every key a finger can hit', async ({ page }, testInfo) => {
    test.skip(!UPRIGHT.includes(testInfo.project.name), 'an upright phone')
    await ready(page)
    // no on-screen keyboard — a hardware keyboard, or none: no row
    await expect(row(page)).toHaveCount(0)

    await keyboard(page, KEYBOARD)
    await expect(row(page)).toBeVisible()
    const labels = await row(page).locator('button').allTextContents()
    expect(labels).toEqual(KEYS)

    const screen = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    const box = (await row(page).boundingBox())!
    // its bottom edge is the keyboard's top edge
    expect(Math.round(box.y + box.height)).toBe(screen.h - KEYBOARD)
    expect(Math.round(box.width)).toBe(screen.w)
    for (const k of KEYS) {
      const b = (await key(page, k).boundingBox())!
      expect(b.height, `${k} height`).toBeGreaterThanOrEqual(40)
      expect(b.width, `${k} width`).toBeGreaterThanOrEqual(36)
      expect(b.x, `${k} on screen`).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width, `${k} on screen`).toBeLessThanOrEqual(screen.w + 0.5)
    }

    await keyboard(page, 0)
    await expect(row(page)).toHaveCount(0)
  })

  for (const k of KEYS) {
    test(`tapping ${k} types it as the keyboard would, as one undo step, and the cursor stays in the code`, async ({ page, context }, testInfo) => {
      test.skip(!UPRIGHT.includes(testInfo.project.name), 'an upright phone')
      // the oracle: the same character from the keyboard, in a page of its own
      const typed = await context.newPage()
      await ready(typed)
      await typed.keyboard.type(k)
      const want = await state(typed)
      await typed.close()
      expect(want.value, 'the keyboard itself changed the document').not.toBe(CODE)

      await ready(page)
      await keyboard(page, KEYBOARD)
      await key(page, k).tap()
      const got = await state(page)
      expect(got.value).toBe(want.value)
      expect(got.at).toBe(want.at)
      expect(got.focus, 'the cursor is still in the code').toBe(true)
      await expect(row(page), 'the row is still there for the next key').toBeVisible()

      // one undo takes the whole of it back, pair and all
      await page.evaluate((expr) => {
        // eslint-disable-next-line no-eval
        ;((0, eval)(expr) as Ed).trigger('test', 'undo', null)
      }, ED)
      expect((await state(page)).value).toBe(CODE)
    })
  }

  test('two keys in a row are two undo steps', async ({ page }, testInfo) => {
    test.skip(!UPRIGHT.includes(testInfo.project.name), 'an upright phone')
    await ready(page)
    await keyboard(page, KEYBOARD)
    await key(page, '~').tap()
    const afterOne = (await state(page)).value
    await key(page, '*').tap()
    expect((await state(page)).value).not.toBe(afterOne)
    const undo = () => page.evaluate((expr) => {
      // eslint-disable-next-line no-eval
      ;((0, eval)(expr) as Ed).trigger('test', 'undo', null)
    }, ED)
    await undo()
    expect((await state(page)).value).toBe(afterOne)
    await undo()
    expect((await state(page)).value).toBe(CODE)
  })

  test('no row when the keyboard was not raised from the code', async ({ page }, testInfo) => {
    test.skip(!UPRIGHT.includes(testInfo.project.name), 'an upright phone')
    await ready(page)
    // focus leaves the code for the panel's strip, then a keyboard comes up
    await page.locator('[data-bottom-panel="header"] [role="tab"]').first().focus()
    await keyboard(page, KEYBOARD)
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-keyboard'))).toBe(true)
    await expect(row(page)).toHaveCount(0)
  })

  test('a phone held sideways and a tablet have no row', async ({ page }, testInfo) => {
    test.skip(UPRIGHT.includes(testInfo.project.name), 'sideways and tablet')
    await ready(page)
    await keyboard(page, 180)
    await page.waitForTimeout(400)
    await expect(row(page)).toHaveCount(0)
  })
})
