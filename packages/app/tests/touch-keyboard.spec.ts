/**
 * Typing on a phone: the line being typed stays above the keyboard (#2004).
 *
 * Nothing in the app listened to the on-screen keyboard. When it opened the page kept
 * its full height, so the keyboard lay over the lower half of the editor — often over
 * the line being typed — and the bottom strip sat under it.
 *
 * A phone's keyboard does not shrink the page; it shrinks what the browser calls the
 * VISUAL viewport. So the app sizes itself to that: the editor ends where the keyboard
 * begins, the bottom strip gives way while the keyboard is up and comes back when it
 * closes, and the cursor's line is brought into view.
 *
 * ⚠ An emulated phone draws no keyboard. Here one is STOOD IN FOR: the visual
 * viewport is told it is shorter and its `resize` is fired, which is all the app can
 * see of a real one. What a real keyboard does that this cannot show — iOS sliding the
 * whole page up under it, the keyboard's own animation, the browser's bar moving — is
 * a real-device check, and the issue's own checks are exactly those.
 *
 * A tablet is not a phone: the last test says a shorter visual viewport changes
 * nothing there.
 */
import { test, expect, type Page } from '@playwright/test'
import { bootApp, seedCode } from './_appBoot'

const PHONES = ['phone', 'phone-sideways', 'iphone']
const UPRIGHT = ['phone', 'iphone']
/** a phone keyboard, upright and sideways */
const KEYBOARD = { upright: 300, sideways: 180 }

const LONG = Array.from({ length: 60 }, (_, i) => `// line ${i + 1}`).join('\n') + '\n$: s("bd*4")\n'

/** raise a stand-in keyboard `px` tall, or lower it with 0 */
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

interface Layout {
  readonly screen: number
  readonly shell: { top: number; bottom: number }
  readonly keyboardAttr: boolean
  readonly heightVar: string
  readonly strip: boolean
  readonly play: { top: number; bottom: number } | null
  readonly topBar: { top: number; bottom: number } | null
}

function layout(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const box = (sel: string): { top: number; bottom: number } | null => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 ? { top: Math.round(r.top), bottom: Math.round(r.bottom) } : null
    }
    const root = document.documentElement
    return {
      screen: window.innerHeight,
      shell: box('main')!,
      keyboardAttr: root.hasAttribute('data-keyboard'),
      heightVar: root.style.getPropertyValue('--stave-visible-height'),
      strip: box('[data-bottom-panel="header"]') !== null,
      play: box('[data-touch-bar] button'),
      topBar: box('[data-phone-top-bar]'),
    }
  })
}

/** where the editor's cursor line is drawn, in page pixels; null when it is scrolled out of the editor */
function cursorLine(page: Page): Promise<{ top: number; bottom: number } | null> {
  return page.evaluate(() => {
    const m = (window as unknown as {
      monaco: { editor: { getEditors: () => Array<{
        getModel: () => { getLanguageId: () => string } | null
        getPosition: () => { lineNumber: number; column: number }
        getScrolledVisiblePosition: (p: { lineNumber: number; column: number }) => { top: number; height: number } | null
        getDomNode: () => HTMLElement
        getLayoutInfo: () => { height: number }
      }> } }
    }).monaco
    const ed = m.editor.getEditors().find((e) => e.getModel()?.getLanguageId() === 'strudel')!
    const at = ed.getScrolledVisiblePosition(ed.getPosition())
    if (!at) return null
    const host = ed.getDomNode().getBoundingClientRect()
    // inside the editor's own box, not merely somewhere on the page
    if (at.top < 0 || at.top + at.height > ed.getLayoutInfo().height) return null
    return { top: Math.round(host.top + at.top), bottom: Math.round(host.top + at.top + at.height) }
  })
}

/** put the cursor on the last line the editor is showing, as a tap there would, with focus in the text */
async function cursorOnLastVisibleLine(page: Page): Promise<number> {
  return page.evaluate(() => {
    const m = (window as unknown as {
      monaco: { editor: { getEditors: () => Array<{
        getModel: () => { getLanguageId: () => string } | null
        getVisibleRanges: () => Array<{ endLineNumber: number }>
        setPosition: (p: { lineNumber: number; column: number }) => void
        focus: () => void
      }> } }
    }).monaco
    const ed = m.editor.getEditors().find((e) => e.getModel()?.getLanguageId() === 'strudel')!
    const ranges = ed.getVisibleRanges()
    // the last line wholly in view: the very last range line can be cut by the editor's edge
    const line = ranges[ranges.length - 1].endLineNumber - 1
    ed.setPosition({ lineNumber: line, column: 1 })
    ed.focus()
    return line
  })
}

test.describe('typing on a phone: the app ends where the keyboard begins (#2004)', () => {
  test('with the keyboard up the app is as tall as what is left, and goes back when it closes', async ({ page }, testInfo) => {
    test.skip(!PHONES.includes(testInfo.project.name), 'the tablet is the last test')
    const px = testInfo.project.name === 'phone-sideways' ? KEYBOARD.sideways : KEYBOARD.upright
    await bootApp(page)
    const before = await layout(page)
    expect(before.shell).toEqual({ top: 0, bottom: before.screen })
    expect(before.keyboardAttr).toBe(false)

    await keyboard(page, px)
    await expect.poll(async () => (await layout(page)).shell.bottom).toBe(before.screen - px)
    const up = await layout(page)
    expect(up.shell.top).toBe(0)
    expect(up.keyboardAttr).toBe(true)
    // The editor's Play bar is still on screen, above the keyboard. Upright the top bar
    // is too; sideways there is no height for both and the code, so the top bar gives
    // way while the keyboard is up (the code had two lines otherwise).
    if (testInfo.project.name === 'phone-sideways') expect(up.topBar).toBeNull()
    else expect(up.topBar!.top).toBe(0)
    expect(up.play).not.toBeNull()
    expect(up.play!.bottom).toBeLessThanOrEqual(before.screen - px)

    await keyboard(page, 0)
    await expect.poll(async () => (await layout(page)).shell.bottom).toBe(before.screen)
    const after = await layout(page)
    // no leftover gap and nothing left behind on the page
    expect(after.shell).toEqual(before.shell)
    expect(after.keyboardAttr).toBe(false)
    expect(after.heightVar).toBe('')
    expect(after.strip).toBe(before.strip)
    expect(after.topBar).toEqual(before.topBar)
  })

  test('the bottom strip gives way while typing in the code, and comes back as it was', async ({ page }, testInfo) => {
    test.skip(!UPRIGHT.includes(testInfo.project.name), 'the strip is the upright phone\'s; sideways has none')
    await bootApp(page)
    await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' })
    // open the Mixer half sheet first, so there is a state to come back to
    await page.locator('[data-bottom-panel="header"] [role="tab"]').filter({ hasText: 'Mixer' }).click()
    await expect(page.locator('[data-bottom-panel="root"]')).toHaveAttribute('data-sheet', 'half')
    await cursorOnLastVisibleLine(page)

    await keyboard(page, KEYBOARD.upright)
    await expect(page.locator('[data-bottom-panel="root"]')).toHaveCount(0)
    await expect(page.locator('[data-bottom-panel="header"]')).toHaveCount(0)

    await keyboard(page, 0)
    await expect(page.locator('[data-bottom-panel="root"]')).toHaveAttribute('data-sheet', 'half')
    await expect(page.locator('[data-bottom-panel-tab="mixer-console"]')).toBeVisible()
  })

  test('a keyboard raised from inside the panel does not take the panel away', async ({ page }, testInfo) => {
    test.skip(!UPRIGHT.includes(testInfo.project.name), 'the strip is the upright phone\'s')
    await bootApp(page)
    // focus something in the panel, as a rename box there would have it
    await page.locator('[data-bottom-panel="header"] [role="tab"]').first().focus()
    await keyboard(page, KEYBOARD.upright)
    await expect.poll(async () => (await layout(page)).keyboardAttr).toBe(true)
    await expect(page.locator('[data-bottom-panel="header"]')).toHaveCount(1)
    await keyboard(page, 0)
  })

  test('the line being typed is in view once the keyboard is up', async ({ page }, testInfo) => {
    test.skip(!PHONES.includes(testInfo.project.name), 'phones only')
    const px = testInfo.project.name === 'phone-sideways' ? KEYBOARD.sideways : KEYBOARD.upright
    await bootApp(page)
    await seedCode(page, LONG)
    const line = await cursorOnLastVisibleLine(page)
    expect(line).toBeGreaterThan(3)
    const before = await cursorLine(page)
    expect(before, 'the cursor line is on screen before the keyboard').not.toBeNull()
    const screen = (await layout(page)).screen
    // the fixture must be one the keyboard would cover: otherwise the test proves nothing
    expect(before!.bottom, 'this line would be under the keyboard').toBeGreaterThan(screen - px)

    await keyboard(page, px)
    await expect.poll(async () => (await cursorLine(page))?.bottom ?? Infinity).toBeLessThanOrEqual(screen - px)
    const up = await cursorLine(page)
    expect(up, 'the cursor line is still inside the editor').not.toBeNull()
    expect(up!.top).toBeGreaterThanOrEqual(0)
  })

  test('a tablet is not a phone: a shorter visual viewport changes nothing', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet', 'tablet only')
    await bootApp(page)
    const before = await layout(page)
    await keyboard(page, 300)
    await page.waitForTimeout(300)
    const up = await layout(page)
    expect(up.shell).toEqual(before.shell)
    expect(up.keyboardAttr).toBe(false)
    expect(up.heightVar).toBe('')
    await keyboard(page, 0)
  })
})
