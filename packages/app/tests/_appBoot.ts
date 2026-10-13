/**
 * Shared boot / seed / transport helpers for the app's Playwright specs (#872).
 *
 * These existed as near-identical copies in ~95 spec files, and every copy carried
 * the same two defects.
 *
 * ─── 1. Monaco EXISTING is not the editor being READY ───────────────────────────
 * The editor's content is a CONTROLLED value fed by an ASYNC project-file load. A
 * `boot()` that waits only for `monaco.editor.getEditors().length > 0` returns
 * while the model is still EMPTY. A spec that then seeds its fixture is racing that
 * load — and when the load lands second, it OVERWRITES the fixture and the app
 * evaluates the STARTER instead.
 *
 * That does not merely make specs flaky. It makes them run against the WRONG SONG
 * while still reporting a result. `full-song-timeline` asserted "≥ 2 lanes" from a
 * fixture that can only ever produce ONE, and was green for its whole life because
 * the 3-track starter kept satisfying it. A lost race is not a failure — it is a
 * SILENT SUBSTITUTION OF THE ORACLE.
 *
 * So `bootApp` waits for the file load to actually LAND (model non-empty), and
 * `seedCode` then asserts the model really HOLDS the fixture before returning.
 * Order the load, then seed, then verify. Never assume what you typed arrived.
 *
 * ─── 2. Focus must arrive by GESTURE, not by `.focus()` ─────────────────────────
 * A programmatic `editor.focus()` carries no user gesture, and the app then reaches
 * a transport that reports PLAY with a NULL POSITION — the LCD prints `— —` and the
 * playhead never renders (#885). Observed, arms interleaved: real click → playhead
 * 5/5 with the position advancing; programmatic focus → 0/5, position frozen.
 * A real user's focus always arrives by click or tab, so `evalCode` CLICKS.
 */
import { expect, type Page } from '@playwright/test'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

const STORAGE = {
  height: 'stave:bottomPanel.height',
  open: 'stave:bottomPanel.open',
  activeTabId: 'stave:bottomPanel.activeTabId',
  gridMode: 'stave:visualEdit.gridMode',
} as const

export interface BootOptions {
  /** open the bottom drawer at boot, on this tab (seeded into localStorage) */
  readonly drawer?: { readonly tabId: string; readonly height?: number }
  /** enable the `__stave*` E2E hooks (gated on this flag, set before mount) */
  readonly e2eHooks?: boolean
  /**
   * the step grid's layout (#1855, seeded into localStorage): a spec about how LCM draws a
   * comma pattern says so, since Exact is the default from the first launch
   */
  readonly gridMode?: 'exact' | 'lcm'
}

/** The editor's model value — the single source of truth for "what will be evaluated". */
export async function editorValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const m = (window as unknown as {
      monaco?: {
        editor?: {
          getEditors?: () => Array<{
            getModel: () => { getLanguageId?: () => string; getValue: () => string } | null
          }>
        }
      }
    }).monaco
    const eds = m?.editor?.getEditors?.() ?? []
    const strudel = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    return strudel?.getModel()?.getValue() ?? ''
  })
}

/**
 * Boot the app and wait until it is genuinely ready to be driven: the shell is up,
 * Monaco exists, AND the project file has LANDED in the model. That last wait is the
 * whole point — see the header.
 */
export async function bootApp(page: Page, opts: BootOptions = {}): Promise<void> {
  if (opts.drawer || opts.e2eHooks || opts.gridMode) {
    await page.addInitScript(
      ([drawer, hooks, keys, gridMode]: [
        BootOptions['drawer'],
        boolean,
        typeof STORAGE,
        BootOptions['gridMode'],
      ]) => {
        if (hooks) (window as unknown as { __STAVE_E2E__?: boolean }).__STAVE_E2E__ = true
        try {
          if (gridMode) window.localStorage.setItem(keys.gridMode, gridMode)
        } catch {
          /* private mode — the grid opens in its default */
        }
        if (!drawer) return
        try {
          window.localStorage.setItem(keys.open, 'true')
          window.localStorage.setItem(keys.activeTabId, drawer.tabId)
          if (drawer.height != null) window.localStorage.setItem(keys.height, String(drawer.height))
        } catch {
          /* private mode — the drawer just starts closed */
        }
      },
      [opts.drawer, Boolean(opts.e2eHooks), STORAGE, opts.gridMode] as [
        BootOptions['drawer'],
        boolean,
        typeof STORAGE,
        BootOptions['gridMode'],
      ],
    )
  }

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForEditorLoaded(page)
}

/**
 * Wait until the page's project file has LANDED in the editor (#872).
 *
 * Call it after ANY navigation, including a spec's own `page.reload()`: a
 * reload boots a fresh page whose file load races a seed exactly as the first
 * boot does, and when it lands second it puts the saved document back over the
 * fixture (#1753 — a reload followed by a seed read the starter song).
 */
export async function waitForEditorLoaded(page: Page): Promise<void> {
  await page.locator('[data-bottom-panel="root"]').waitFor({ timeout: 30_000 })

  // Monaco exists…
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { monaco?: { editor?: { getEditors?: () => unknown[] } } }).monaco
      return (m?.editor?.getEditors?.()?.length ?? 0) > 0
    },
    { timeout: 30_000 },
  )
  // …and the project file has LANDED. Without this, a seed races the load (#872).
  await page.waitForFunction(
    () => {
      const m = (window as unknown as {
        monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getValue: () => string } | null }> } }
      }).monaco
      const eds = m?.editor?.getEditors?.() ?? []
      return (eds[0]?.getModel()?.getValue() ?? '').trim().length > 0
    },
    { timeout: 30_000 },
  )
  // …and the editor has finished MOUNTING. The text arrives before the mount does: for a
  // moment the model holds the file while it is still `plaintext`, and a seed written in
  // that moment changes the model and nothing else — the app never hears of it, so Play
  // runs the file as it was (#2036: WebKit, 3 runs in 6). The language is set by the same
  // mount that starts the app listening, so it is the sign that a change will be heard.
  await page.waitForFunction(
    () => {
      const m = (window as unknown as {
        monaco?: { editor?: { getEditors?: () => Array<{ getModel: () => { getLanguageId: () => string } | null }> } }
      }).monaco
      const eds = m?.editor?.getEditors?.() ?? []
      const language = eds[0]?.getModel()?.getLanguageId()
      return language !== undefined && language !== 'plaintext'
    },
    { timeout: 30_000 },
  )
}

/**
 * Replace the editor's content with `code`, and PROVE it arrived.
 *
 * Writes the model rather than typing: `Cmd+A` + `type()` silently mangles
 * multi-line text (the select-all races the typing — a swallowed newline and a
 * stray character, observed). Then asserts the model holds exactly `code`, so a
 * late file load cannot substitute the fixture behind the spec's back.
 */
export async function seedCode(page: Page, code: string): Promise<void> {
  await page.evaluate((next) => {
    const m = (window as unknown as {
      monaco?: {
        editor?: {
          getEditors?: () => Array<{
            getModel: () => { getLanguageId?: () => string; setValue: (v: string) => void } | null
          }>
        }
      }
    }).monaco
    const eds = m?.editor?.getEditors?.() ?? []
    const strudel = eds.find((e) => e.getModel()?.getLanguageId?.() === 'strudel') ?? eds[0]
    strudel?.getModel()?.setValue(next)
  }, code)

  // The fixture is only seeded once the model actually HOLDS it.
  await expect.poll(() => editorValue(page), { timeout: 10_000 }).toBe(code)
}

/**
 * Evaluate + play, driven as a USER does — click into the editor, then the shortcut.
 * The click is load-bearing: a programmatic focus yields PLAY with a null position
 * and no playhead (#885).
 */
export async function evalCode(page: Page): Promise<void> {
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${MOD}+Enter`)
}

/** Stop the transport (same gesture rule as {@link evalCode}). */
export async function stopCode(page: Page): Promise<void> {
  await page.locator('.monaco-editor').first().click()
  await page.keyboard.press(`${MOD}+Period`)
}
