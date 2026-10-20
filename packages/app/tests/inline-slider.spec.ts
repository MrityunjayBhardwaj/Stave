/**
 * #345 — Strudel's `slider(…)` plays, and draws a slider in the code that moves its
 * number and the sound.
 *
 * Before the fix the transpiler's `sliderWithID` was undefined, so any document with a
 * slider failed to evaluate at all. The unit suites hold the vendored half to the
 * installed transpiler and the write to the number; this covers what only the running
 * editor shows: the slider sits on its number and stays there as the text moves, a drag
 * is heard before the drag ends (no re-evaluation), and the whole drag is one undo step.
 *
 * What is heard is read from Strudel itself: `.onTrigger(…, false)` records each hap
 * that triggers, beside the normal output.
 */
import { test, expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

type Ed = {
  getModel: () => { getLanguageId?: () => string; getValue: () => string; setValue: (s: string) => void } | null
  focus: () => void
  setPosition: (p: { lineNumber: number; column: number }) => void
  trigger: (source: string, id: string, payload: unknown) => void
}

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(
    () =>
      ((window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco?.editor?.getEditors?.()
        ?.length ?? 0) > 0,
    { timeout: 20_000 },
  )
  // #872: a document set the moment Monaco mounts can be shown while something else
  // plays (measured: 6 of 6 runs drew no slider without this wait, 0 of 6 with it).
  // `strudel-viz-methods.spec.ts` waits the same.
  await page.waitForTimeout(1000)
}

async function editor(page: Page, run: string, arg?: unknown): Promise<unknown> {
  return page.evaluate(
    ([body, a]) => {
      const eds = (window as unknown as { monaco: { editor: { getEditors: () => Ed[] } } }).monaco.editor.getEditors()
      const ed = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
      return new Function('ed', 'arg', body)(ed, a)
    },
    [run, arg] as const,
  )
}

const line = (page: Page, n: number) => editor(page, 'return ed.getModel().getValue().split("\\n")[arg]', n) as Promise<string>

async function play(page: Page, doc: string): Promise<void> {
  await editor(page, 'ed.getModel().setValue(arg); ed.focus()', doc)
  await page.waitForTimeout(150)
  await page.keyboard.press(`${MOD}+Enter`)
  await page.locator('[data-stave-slider]').first().waitFor({ timeout: 20_000 })
}

/** drag the `nth` slider to `frac` of its width; returns what was heard before letting go */
async function drag(page: Page, nth: number, frac: number, during: () => Promise<unknown>): Promise<unknown> {
  const box = (await page.locator('[data-stave-slider] input').nth(nth).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * frac, box.y + box.height / 2, { steps: 6 })
  await page.waitForTimeout(600)
  const heard = await during()
  await page.mouse.up()
  return heard
}

/**
 * How far the furthest slider sits from the room reserved for it, in px — null when
 * the counts differ. Monaco places a content widget on whole pixels while the room's
 * edge can fall between two, so a slider in place reads under 1; one left behind by
 * two typed characters reads ~17.
 */
const offRoom = (page: Page) =>
  page.evaluate(() => {
    const left = (els: Element[]) => els.map((e) => e.getBoundingClientRect().left).sort((a, b) => a - b)
    const room = left([...document.querySelectorAll('.stave-slider-gap')])
    const slider = left([...document.querySelectorAll('[data-stave-slider] input')])
    return room.length === slider.length ? Math.max(...room.map((r, i) => Math.abs(r - slider[i]))) : null
  })

test.describe('slider(…) in the code (#345)', () => {
  test('plays; a drag moves the number and is heard before release; one undo takes the drag back', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await boot(page)
    await play(page, `setcps(1)\n$: s("bd*8").gain(slider(0.5, 0, 1)).onTrigger((hap) => { window.__heard = hap.value.gain }, false)`)

    await expect(page.locator('[data-stave-slider]')).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => (window as unknown as { __heard?: number }).__heard)).toBe(0.5)

    const heard = await drag(page, 0, 0.3, async () => ({
      code: await line(page, 1),
      gain: await page.evaluate(() => (window as unknown as { __heard?: number }).__heard),
    }))
    const { code, gain } = heard as { code: string; gain: number }
    const written = Number(/slider\(([\d.]+)/.exec(code)![1])
    expect(written).toBeGreaterThan(0.1)
    expect(written).toBeLessThan(0.45)
    // heard while the pointer is still down: the pattern read the new value without an evaluate
    expect(gain).toBe(written)

    await editor(page, 'ed.focus(); ed.trigger("spec", "undo", null)')
    expect(await line(page, 1)).toContain('slider(0.5, 0, 1)')
    expect(errors).toEqual([])
  })

  test('stays on its number as the text moves, and each slider on a line writes its own number', async ({ page }) => {
    await boot(page)
    await play(page, `setcps(1)\n$: s("bd*8").lpf(saw.range(slider(827, 0, 4000, 1), slider(2427, 0, 4000, 1)))`)
    await expect(page.locator('[data-stave-slider]')).toHaveCount(2)

    // typing before the sliders on their own line moves the text under them
    await editor(page, 'ed.setPosition({ lineNumber: 2, column: 1 }); ed.focus()')
    await page.keyboard.type('xx')
    await expect.poll(() => offRoom(page)).toBeLessThan(1)

    // the first number gets a digit longer; the second slider must still write over its own
    await drag(page, 0, 0.85, async () => null)
    await expect.poll(() => line(page, 1)).toMatch(/slider\(\d{4}, 0, 4000, 1\), slider\(2427, 0, 4000, 1\)/)
    await drag(page, 1, 0.1, async () => null)
    await expect.poll(() => line(page, 1)).toMatch(/slider\(\d{4}, 0, 4000, 1\), slider\(\d{1,3}, 0, 4000, 1\)\)\)$/)
    expect(await offRoom(page)).toBeLessThan(1)
  })
})
