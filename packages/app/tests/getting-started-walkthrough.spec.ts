import { test, expect, type Page } from '@playwright/test'
import { bootApp, editorValue } from './_appBoot'

/**
 * The getting-started walkthrough, driven as written (#180).
 *
 * `packages/docs/src/content/docs/getting-started.mdx` is the first thing a new
 * user follows, and `templates.ts` puts the same promise in the starter file's
 * own header: `Ctrl+Enter plays, Ctrl+. stops`. Nothing checked that the
 * product agreed. It did not: Ctrl+Enter was wired as a Play/Stop toggle, so
 * step 3 — "edit a line, press Ctrl+Enter again, the change is live" — STOPPED
 * the music. A fully green gate never noticed, because no spec walked the
 * documented path end to end.
 *
 * These tests are the docs' acceptance tests. If the keybinding contract ever
 * changes again, they fail HERE, next to the prose that promises it — rather
 * than silently making a liar of the tutorial.
 */

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/** The transport button's label — "■ Stop" while playing, "▶ Play" while stopped. */
async function isPlaying(page: Page): Promise<boolean> {
  const b = page.locator('[data-testid="strudel-chrome-transport"]')
  await expect(b).toHaveCount(1)
  return ((await b.first().innerText()) || '').includes('Stop')
}

/** Step 1 — "Click anywhere inside pattern.strudel." A real user focuses by click (#885). */
async function clickIntoEditor(page: Page): Promise<void> {
  await page.locator('.monaco-editor').first().click()
}

test.describe('docs: getting-started', () => {
  test('step 2 — Ctrl+Enter starts the pattern playing', async ({ page }) => {
    await bootApp(page)
    await clickIntoEditor(page)
    await page.keyboard.press(`${MOD}+Enter`)
    await expect.poll(() => isPlaying(page), { timeout: 10_000 }).toBe(true)
  })

  test('step 3 — editing a line and pressing Ctrl+Enter again keeps playing (does NOT stop)', async ({ page }) => {
    // The docs promise: "The change is live on the next cycle boundary." The
    // minimum the product must do is EVALUATE rather than stop — a toggle here
    // silences the user mid-tutorial, which is exactly what #180 was.
    await bootApp(page)
    await clickIntoEditor(page)
    await page.keyboard.press(`${MOD}+Enter`)
    await expect.poll(() => isPlaying(page), { timeout: 10_000 }).toBe(true)

    // "Change something. For example, change a `gain(0.4)` to `gain(0.8)`."
    const edited = await page.evaluate(() => {
      const m = (window as unknown as {
        monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getValue: () => string; setValue: (v: string) => void } | null }> } }
      }).monaco
      const model = (m?.editor?.getEditors?.() ?? [])[0]?.getModel()
      if (!model) return false
      const before = model.getValue()
      const after = before.replace('gain(0.4)', 'gain(0.8)')
      model.setValue(after)
      return after !== before
    })
    // Guard the fixture itself: if the starter no longer contains that phrase,
    // this test is not exercising the documented edit and must say so.
    expect(edited, 'the starter file no longer contains the line getting-started.mdx tells the user to edit').toBe(true)
    expect(await editorValue(page)).toContain('gain(0.8)')

    await clickIntoEditor(page)
    await page.keyboard.press(`${MOD}+Enter`)
    await page.waitForTimeout(2000)

    // Still playing. Pre-fix this was `▶ Play` — silence.
    expect(await isPlaying(page)).toBe(true)
  })

  test('step 4 — Ctrl+. stops', async ({ page }) => {
    await bootApp(page)
    await clickIntoEditor(page)
    await page.keyboard.press(`${MOD}+Enter`)
    await expect.poll(() => isPlaying(page), { timeout: 10_000 }).toBe(true)

    await page.keyboard.press(`${MOD}+Period`)
    await expect.poll(() => isPlaying(page), { timeout: 10_000 }).toBe(false)
  })

  test('Ctrl+Enter repeated on unchanged code never stops — it is not a toggle', async ({ page }) => {
    // The regression signature of #180: pressing evaluate twice alternated
    // play/stop. Any future re-toggle fails here, on the third press.
    await bootApp(page)
    await clickIntoEditor(page)
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press(`${MOD}+Enter`)
      await page.waitForTimeout(1500)
      expect(await isPlaying(page), `still playing after press ${i + 1}`).toBe(true)
    }
  })
})
